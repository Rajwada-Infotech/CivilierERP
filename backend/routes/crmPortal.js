const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus, DEAD_BOOKING_STATUSES } = require("../constants/crmStatuses");
const multer = require("multer");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { getPool, sql } = require("../db");
const portalAuth = require("../middleware/crmPortalAuth");
const { getNextDocNumber } = require("../services/docNumber");
const { emitNotification } = require("../services/notify");
const { getPossessionLetterBuffer } = require("../services/possessionLetterPdf");
const { proposeAgreementDate, acceptAgreementDate, syncLegalMilestoneStep, getProjectSaleGate } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { getInvoicePdfBuffer } = require("../services/invoicePdf");
const { getMoneyReceiptPdfBuffer } = require("../services/moneyReceiptPdf");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const attachProjectScope = require("../services/projectScope").attachProjectScope;
const projectPredicate = require("../services/projectScope").projectPredicate;
const { getAgreementBookingLockReason, agreementExecutedLockReason } = require("./crmAgreements");
const { redisGet, redisSet, redisDel } = require("../redis");
const { redisGetStrict, getRedis } = require("../redis");
const { blacklistToken } = require("../middleware/blacklist");
const { verifyFileMatchesDeclaredType } = require("../services/fileSignature");

// Categories a customer is allowed to raise themselves — same vocabulary as
// the staff-side Service Ticket module (crmServiceTickets.js), so every
// ticket lives in one unified queue regardless of who opened it.
const CUSTOMER_TICKET_CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const TICKET_SLA_HOURS = 96; // customer-raised tickets always start Normal priority

const rateLimit = require("../middleware/rateLimiter");
// Per customer (rateLimiter.js counts the signed-in person): one visit to Civilier Home makes 10-15 requests, so 600 per
// 15 minutes (~40 a minute) leaves room for real use and still stops scripted scraping.
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, validate: false, message: { error: "Too many requests, please try again later." } }));

// 15-second in-memory cache for portal user active status.
// Declared at module scope so both the staff admin endpoint and the portal
// per-request middleware can access it.
const _portalUserStatusCache = new Map(); // portalUserId -> { isActive, cachedAt }
const PORTAL_STATUS_CACHE_TTL_MS = 15_000;

// Per-account brute-force lockout — mirrors the staff login's own protection
// in routes/users.js exactly (same Redis keys shape, same 10/15min policy).
// Before this, /login had ONLY the router-wide 200-req/15min-per-IP limiter
// above: that bounds request volume, not credential-stuffing against one
// customer account (200 guesses against a single email in 15 minutes is a
// real brute-force budget), and staff accounts already get this exact
// protection — customer portal accounts, which also expose payment history
// and identity documents, did not.
const PORTAL_MAX_LOGIN_ATTEMPTS = process.env.NODE_ENV === "development" ? 50 : 10;
const PORTAL_LOCKOUT_SECONDS = 15 * 60;
async function incrementPortalLoginAttempts(attemptsKey, lockKey) {
  try {
    const attempts = parseInt((await redisGet(attemptsKey)) || "0") + 1;
    await redisSet(attemptsKey, String(attempts), PORTAL_LOCKOUT_SECONDS);
    if (attempts >= PORTAL_MAX_LOGIN_ATTEMPTS) {
      await redisSet(lockKey, "1", PORTAL_LOCKOUT_SECONDS);
    }
  } catch { /* Redis down — never let a cache failure block login */ }
}

// POST /login — email + password (mobile number initially, forced reset on first
// login — unchanged). Identity anchor is CustomerId (migration 254); email is
// the UX credential resolved via CrmCustomer → CrmCustomerPortalUser.
// UQ_CrmCustomer_Email (migration 255, filtered on active nonblank emails)
// guarantees the lookup is always unambiguous — no silent wrong-row risk.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const normalizedEmail = email.trim().toLowerCase();
    const lockKey = `portal-login:lock:${normalizedEmail}`;
    const attemptsKey = `portal-login:attempts:${normalizedEmail}`;

    try {
      const locked = await redisGet(lockKey);
      if (locked) return res.status(429).json({ error: "Too many attempts. Try again later." });
    } catch { /* Redis down — skip lockout check, proceed to DB auth */ }

    const pool = getPool();

    // Resolve Email → CrmCustomer → CrmCustomerPortalUser
    const result = await pool.request()
      .input("em", sql.NVarChar(200), normalizedEmail)
      .query(`
        SELECT pu.Id AS PortalUserId, pu.CustomerId, pu.PasswordHash,
               pu.MustChangePassword, pu.IsActive, pu.Email, c.Mobile
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmCustomerPortalUser pu ON pu.CustomerId = c.Id
        WHERE LOWER(LTRIM(RTRIM(c.Email))) = @em
          AND c.IsActive = 1
      `);
    if (result.recordset.length > 1) {
      return res.status(409).json({
        error: "This email matches more than one customer record. Please contact the sales office to confirm your mobile number.",
      });
    }
    const user = result.recordset[0];
    if (!user) {
      // Run dummy comparison to prevent timing-based user enumeration
      await bcrypt.compare(password, '$2b$10$invalidhashfortimingnormalizationXXXXXXXXXXXXXXXXXXXXXX');
      await incrementPortalLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.IsActive) {
      await incrementPortalLoginAttempts(attemptsKey, lockKey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check the submitted password and, for the initial mobile-number
    // credential, its normalized form against the stored bcrypt hash.
    const normalizedInput = (password || '').replace(/\D/g, '').slice(-10);

    let ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok && normalizedInput) {
      ok = await bcrypt.compare(normalizedInput, user.PasswordHash);
    }
    if (!ok) { await incrementPortalLoginAttempts(attemptsKey, lockKey); return res.status(401).json({ error: "Invalid email or password" }); }

    try { await redisDel(attemptsKey); await redisDel(lockKey); } catch {}

    await pool.request().input("id", sql.Int, user.PortalUserId)
      .query("UPDATE dbo.CrmCustomerPortalUser SET LastLoginAt = SYSDATETIME() WHERE Id = @id");

    // Redis stores a per-account session generation. Password resets and
    // changes increment it, revoking every previously issued portal token.
    const sessionVersion = Number(await redisGetStrict(`crm-portal:session-version:${user.PortalUserId}`)) || 0;

    // JWT carries customerId only — applicationId is a request-scoped param,
    // validated per-request against customerId, never embedded in the token.
    // Portal uses its own secret (PORTAL_JWT_SECRET) so staff tokens can't be
    // replayed against the portal API and vice-versa.
    const token = jwt.sign(
      { type: "crm_portal", portalUserId: user.PortalUserId, customerId: user.CustomerId, email: user.Email, sessionVersion },
      process.env.PORTAL_JWT_SECRET || process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, mustChangePassword: !!user.MustChangePassword });
  } catch (e) {
    console.error("[crm-portal] POST /login error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── Staff-only admin endpoints (use staff JWT auth, NOT portal auth) ─────────
// These must be declared BEFORE router.use(portalAuth) so they are not gated
// behind the customer portal JWT.

/**
 * POST /api/crm-portal/admin/reset-password
 * Staff resets a customer's portal password to a new temp value (MustChangePassword = 1 records that it is not
 * the customer's own; setting their own stays their choice and is never forced).
 * Body: { customerId: number, newPassword?: string }
 * If newPassword is omitted, defaults to the customer's mobile number (normalized).
 */
router.post(
  "/admin/reset-password",
  authMiddleware,
  requirePageRight("crm-customers", "edit"),
  attachProjectScope,
  async (req, res, next) => {
    const customerId = Number.parseInt(req.body?.customerId, 10);
    if (!req.projectScope || !Number.isFinite(customerId)) return next();
    try {
      const visible = await getPool().request().input("cid", sql.Int, customerId).query(`
        SELECT TOP 1 1 AS Visible
        FROM dbo.CrmApplication a
        WHERE a.CustomerId = @cid${projectPredicate(req.projectScope, "a.ProjectId")}
      `);
      if (visible.recordset.length) return next();
      return res.status(403).json({ error: "You don't have access to this customer's projects." });
    } catch (e) {
      console.error("[crm-portal] reset-password project scope check failed:", e.message);
      return res.status(500).json({ error: "Could not verify customer project access." });
    }
  },
  async (req, res) => {
    const pool = getPool();
    try {
      const { customerId, newPassword } = req.body;
      if (!customerId || isNaN(parseInt(customerId, 10))) {
        return res.status(400).json({ error: "customerId is required" });
      }
      const cid = parseInt(customerId, 10);

      // Resolve portal user record
      const portalUser = (await pool.request()
        .input("cid", sql.Int, cid)
        .query("SELECT pu.Id, c.Mobile FROM dbo.CrmCustomerPortalUser pu JOIN dbo.CrmCustomer c ON c.Id = pu.CustomerId WHERE pu.CustomerId = @cid AND pu.IsActive = 1"))
        .recordset[0];

      if (!portalUser) {
        return res.status(404).json({ error: "No active portal account found for this customer" });
      }

      // Derive password: explicit value or fall back to normalized mobile
      const rawPassword = newPassword?.trim() ||
        (portalUser.Mobile || "").replace(/\D/g, "").slice(-10) ||
        null;

      if (!rawPassword || rawPassword.length < 6) {
        return res.status(400).json({ error: "Cannot determine a temporary password — please provide newPassword explicitly" });
      }

      const hash = await bcrypt.hash(rawPassword, 10);

      // Revoke existing sessions before changing credentials. If Redis is
      // unavailable, do not complete a password reset that cannot revoke.
      await getRedis().then((redis) => redis.incr(`crm-portal:session-version:${portalUser.Id}`));

      await pool.request()
        .input("id", sql.Int, portalUser.Id)
        .input("hash", sql.NVarChar(255), hash)
        .query("UPDATE dbo.CrmCustomerPortalUser SET PasswordHash = @hash, MustChangePassword = 1, UpdatedAt = SYSDATETIME() WHERE Id = @id");

      // Invalidate the 15-second in-memory cache for this portal user so the
      // next portal request reflects the new state immediately.
      _portalUserStatusCache.delete(portalUser.Id);

      res.json({ success: true, message: "Portal password reset. Customer must change it on next login." });
    } catch (e) {
      console.error("[crm-portal] POST /admin/reset-password error:", e.message);
      res.status(500).json({ error: "An internal error occurred." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────

router.use(portalAuth);

// Server-side enforcement of account deactivation: blocks EVERY route with no exception. Setting their own password
// is the customer's choice (decided 2026-11-18), so MustChangePassword (still set by a staff reset) no longer blocks
// anything — the customer can change it from their profile whenever they like.
router.use(async (req, res, next) => {
  try {
    const uid = req.portalUser?.portalUserId;
    if (!uid) return res.status(401).json({ error: "Portal account not found" });

    // Check the in-memory cache first
    const cached = _portalUserStatusCache.get(uid);
    if (cached && Date.now() - cached.cachedAt < PORTAL_STATUS_CACHE_TTL_MS) {
      if (!cached.isActive) return res.status(401).json({ error: "This portal account has been deactivated" });
      return next();
    }

    const pool = getPool();
    const row = await pool.request().input("id", sql.Int, uid)
      .query("SELECT IsActive FROM dbo.CrmCustomerPortalUser WHERE Id = @id");
    if (!row.recordset.length) return res.status(401).json({ error: "Portal account not found" });
    const { IsActive } = row.recordset[0];

    // Populate cache (only cache active accounts; deactivated ones stay uncached so
    // re-activation takes immediate effect)
    if (IsActive) {
      _portalUserStatusCache.set(uid, { isActive: true, cachedAt: Date.now() });
    }

    if (!IsActive) {
      return res.status(401).json({ error: "This portal account has been deactivated" });
    }
    next();
  } catch (e) {
    console.error("[crm-portal] password-change gate error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /change-password — force-set a real password on first login
router.post("/change-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must contain both letters and numbers" });
    }
    const pool = getPool();
    const hash = await bcrypt.hash(newPassword, 10);
    // Revoke every existing session before changing credentials. If Redis is
    // unavailable, leave the password unchanged and report the failure.
    await getRedis().then((redis) => redis.incr(`crm-portal:session-version:${req.portalUser.portalUserId}`));
    await pool.request()
      .input("id", sql.Int, req.portalUser.portalUserId)
      .input("hash", sql.NVarChar(200), hash)
      .query("UPDATE dbo.CrmCustomerPortalUser SET PasswordHash = @hash, MustChangePassword = 0 WHERE Id = @id");
    _portalUserStatusCache.delete(req.portalUser.portalUserId);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /change-password error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /push-devices/register, /push-devices/unregister — this customer's phone (the Maintenance app's customer
// side) gets their notifications. Always bound to the signed-in portal login, never an id from the body; the same
// store and rules as staff phones (services/pushNotifications.js, migration 692).
router.post("/push-devices/register", async (req, res) => {
  try {
    const { registerToken } = require("../services/pushNotifications");
    await registerToken({ portalUserId: Number(req.portalUser.portalUserId) }, String(req.body?.token ?? ""), {
      appKey: req.body?.appKey, platform: req.body?.platform, versionCode: req.body?.versionCode,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("[crm-portal] push register:", e.message);
    res.status(500).json({ error: "Could not register this device for notifications." });
  }
});
router.post("/push-devices/unregister", async (req, res) => {
  try {
    const { unregisterToken } = require("../services/pushNotifications");
    const removed = await unregisterToken({ portalUserId: Number(req.portalUser.portalUserId) }, String(req.body?.token ?? ""));
    res.json({ success: true, removed });
  } catch (e) {
    console.error("[crm-portal] push unregister:", e.message);
    res.status(500).json({ error: "Could not unregister this device." });
  }
});

// POST /logout — revoke this token before confirming logout.
router.post("/logout", async (req, res) => {
  try {
    await blacklistToken(req.portalToken, req.portalUser.exp);
    res.json({ success: true, message: "Logged out" });
  } catch (e) {
    console.error("[crm-portal] logout revocation failed:", e.message);
    res.status(503).json({ error: "Could not revoke this session. Please try again." });
  }
});

// ─── Ownership-check helper ───────────────────────────────────────────────────
// Every detail route passes an applicationId param; this validates it belongs
// to the authenticated customer before allowing the request through.
// Returns the validated integer applicationId on success, throws 403 on failure.
// This is the server-side enforcement of Option A: JWT carries customerId,
// applicationId is a request-scoped param, validated here on every request.
// The logged-in customer (@cid) is a co-applicant on application `a`.
const CO_APPLICANT_OF = (a) => `EXISTS (SELECT 1 FROM dbo.CrmCoApplicant co WHERE co.IsActive = 1 AND co.CustomerId = @cid
  AND (co.ApplicationId = ${a}.Id OR co.BookingId IN (SELECT bx.Id FROM dbo.CrmBooking bx WHERE bx.ApplicationId = ${a}.Id)))`;

async function resolveAndAssertApplication(pool, req, res) {
  const raw = req.query.applicationId || req.params.applicationId;
  const appId = parseInt(raw, 10);
  if (isNaN(appId)) {
    res.status(400).json({ error: "applicationId is required" });
    return null;
  }
  // The main applicant can see and act; a co-applicant (Applicant 2, 3 ...)
  // linked to this customer can only see (read-only: GET requests).
  const check = await pool.request()
    .input("aid", sql.Int, appId)
    .input("cid", sql.Int, req.portalUser.customerId)
    .query(`
      SELECT a.Id,
             CASE WHEN a.CustomerId = @cid THEN 1 ELSE 0 END AS IsMain,
             CASE WHEN ${CO_APPLICANT_OF("a")} THEN 1 ELSE 0 END AS IsCo
      FROM dbo.CrmApplication a
      WHERE a.Id = @aid AND a.IsActive = 1
    `);
  const row = check.recordset[0];
  if (!row || (!row.IsMain && !row.IsCo)) {
    res.status(403).json({ error: "Application not found or does not belong to this account" });
    return null;
  }
  if (!row.IsMain && req.method !== "GET") {
    res.status(403).json({ error: "As a co-applicant you can view this booking; the main applicant takes the actions." });
    return null;
  }
  return appId;
}

// ─── GET /applications — summary listing of ALL applications for this customer ─
// This is the new landing page after login: every Application + its Booking
// stage, so the customer can pick which unit's timeline to view.
// What one entry in the customer's list of properties is, for them:
//   Home       — a live booking (not in DEAD_BOOKING_STATUSES);
//   InProgress — an application the sales team is still working on, no booking yet;
//   Past       — the booking or application ended (StateLabel says how, in the customer's words).
// A staff Draft is not shown at all — nobody has submitted it yet. One rule for the web portal and the app.
const PAST_LABEL = { Cancelled: "Cancelled", Rejected: "Not approved", Expired: "Expired", Transferred: "Sold", UnitChanged: "Moved to another unit" };
const LIFECYCLE_ORDER = { Home: 0, InProgress: 1, Past: 2 };
function propertyState(r) {
  if (r.BookingId) {
    return DEAD_BOOKING_STATUSES.includes(r.BookingStatus)
      ? { Lifecycle: "Past", StateLabel: PAST_LABEL[r.BookingStatus] || r.BookingStatus }
      : { Lifecycle: "Home", StateLabel: null };
  }
  if (r.ApplicationStatus === CrmStatus.DRAFT) return null;
  if (PAST_LABEL[r.ApplicationStatus]) return { Lifecycle: "Past", StateLabel: PAST_LABEL[r.ApplicationStatus] };
  // "Converted" with no live booking row left: the booking it became is gone.
  if (r.ApplicationStatus === "Converted") return { Lifecycle: "Past", StateLabel: "Closed" };
  return { Lifecycle: "InProgress", StateLabel: "Being prepared" };
}

/** The customer's properties: homes first, then those in progress, then past ones (newest first within each). */
async function loadApplications(pool, customerId) {
    const result = await pool.request().input("cid", sql.Int, customerId).query(`
      SELECT
        a.Id AS ApplicationId, a.ApplicationNo, a.ApplicantName, a.Status AS ApplicationStatus,
        CASE WHEN a.CustomerId = @cid THEN 0 ELSE 1 END AS IsCoApplicant,
        a.InterestedProject, a.CreatedAt AS ApplicationDate,
        b.Id AS BookingId, b.BookingNo,
        COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
        COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
        b.Status AS BookingStatus, b.GrandTotal, b.BookingDate,
        ag.Status AS AgreementStatus, ag.SentToCustomerAt,
        ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
        sd.Status AS SalesDeedStatus, sd.CustomerApprovalStatus AS DeedCustomerApprovalStatus,
        h.Status AS HandoverStatus, h.ActualHandoverDate,
        -- Co-applicants (Applicant 2, 3 ...) in order, for "Mr. Roy & Mrs. Roy".
        STUFF((SELECT N'|' + c.Name FROM dbo.CrmCoApplicant c
               WHERE c.IsActive = 1 AND (c.ApplicationId = a.Id OR (b.Id IS NOT NULL AND c.BookingId = b.Id))
               ORDER BY c.CreatedAt, c.Id FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') AS CoApplicantNames
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id AND b.IsActive = 1
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      -- The latest of each (a redone agreement / deed leaves its old row): one line per booking.
      OUTER APPLY (SELECT TOP 1 x.* FROM dbo.CrmAgreement x WHERE x.BookingId = b.Id ORDER BY x.Id DESC) ag
      OUTER APPLY (SELECT TOP 1 x.* FROM dbo.CrmSalesDeed x WHERE x.BookingId = b.Id ORDER BY x.Id DESC) sd
      OUTER APPLY (SELECT TOP 1 x.* FROM dbo.CrmHandover x WHERE x.BookingId = b.Id ORDER BY x.Id DESC) h
      WHERE a.IsActive = 1 AND (a.CustomerId = @cid OR ${CO_APPLICANT_OF("a")})
      ORDER BY a.CreatedAt DESC
    `);
    return result.recordset
      .map((r) => { const st = propertyState(r); return st && { ...r, ...st }; })
      .filter(Boolean)
      .sort((x, y) => LIFECYCLE_ORDER[x.Lifecycle] - LIFECYCLE_ORDER[y.Lifecycle]);
}
router.get("/applications", async (req, res) => {
  try {
    res.json(await loadApplications(getPool(), req.portalUser.customerId));
  } catch (e) {
    console.error("[crm-portal] GET /applications error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── GET /me — customer profile from the CrmCustomer record ──────────────────
router.get("/me", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("cid", sql.Int, req.portalUser.customerId).query(`
      SELECT c.Id, c.CustomerNo, c.CustomerName AS Name, c.Mobile, c.Email, c.Address, c.City, c.State
      FROM dbo.CrmCustomer c WHERE c.Id = @cid
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Customer record not found" });
    res.json(result.recordset[0]);
  } catch (e) {
    console.error("[crm-portal] GET /me error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── GET /timeline — per-application step-by-step milestone view ─────────────
// Requires ?applicationId= — validated against req.portalUser.customerId.
/** Everything the customer sees about one application. `lite` skips the construction progress (the heaviest part),
 * for callers that only need the booking's state — e.g. what needs the customer across all their homes. */
// ─── Home facts — what the customer bought, in their words (shown only when recorded) ─────────────────────────────
const sqftText = (n) => (Number(n) > 0 ? `${Number(n).toLocaleString("en-IN")} sq ft` : null);
const feetText = (n) => (Number(n) > 0 ? `${Number(n)} ft` : null);
const keepShown = (rows) => rows.filter(([, v]) => v != null && v !== "").map(([label, value]) => ({ label, value: String(value) }));
function homeFacts(b) {
  // A plot not yet built on has no home to describe — its plots carry the facts.
  if (b.IsPlotSale && !b.UnitType && !b.UnitKind) return [];
  const anyArea = b.CarpetAreaSqFt || b.BuiltUpAreaSqFt || b.SuperBuiltUpAreaSqFt;
  return keepShown([
    ["Type", b.UnitType || b.UnitKind],
    ["Tower / block", b.BlockName],
    ["Floor", b.FloorNo],
    ["Carpet area", sqftText(b.CarpetAreaSqFt)],
    ["Built-up area", sqftText(b.BuiltUpAreaSqFt)],
    ["Super built-up area", sqftText(b.SuperBuiltUpAreaSqFt)],
    ["Open terrace", sqftText(b.OpenTerraceAreaSqFt)],
    ["Area", anyArea ? null : sqftText(b.AreaSqFt)],
    ["Facing", b.Facing],
  ]);
}
/** The project, ready to show: its facts (only what is recorded), a description, and where it is on a map. */
function projectView(p) {
  if (!p) return null;
  const address = [p.address, p.address_line2, p.address_line3, p.city, p.state, p.pincode].map((x) => String(x || "").trim()).filter(Boolean)
    .filter((x, i, all) => all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");
  const lat = Number(p.latitude), lng = Number(p.longitude);
  return {
    name: p.name,
    facts: keepShown([["Type", p.TypeName], ["Developer", p.Developer], ["Address", address || null], ["Website", p.website]]),
    description: String(p.description || "").trim() || null,
    // A map pin only when a real location is recorded; otherwise the address can still be searched.
    location: Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
    mapQuery: address ? `${p.name}, ${address}` : null,
  };
}
function plotFacts(p) {
  return keepShown([
    ["Area", sqftText(p.AreaSqFt)],
    ["Size", feetText(p.PlotWidthFt) && feetText(p.PlotDepthFt) ? `${feetText(p.PlotWidthFt)} × ${feetText(p.PlotDepthFt)}` : null],
    ["Facing", p.Facing],
    ["Position", p.IsCornerPlot ? "Corner plot" : null],
    ["Road in front", feetText(p.RoadWidthFt) ? `${feetText(p.RoadWidthFt)} wide` : null],
  ]);
}

/** A price line in the customer's words — for the app and the web portal. */
function priceLineText(l, { plot = false, area = null, rate = null, base = null, gstRate = null, noGst = null } = {}) {
  const gst = l.gst ? `Includes GST of ${inr(l.gst)}` : null;
  // Area × rate, shown only when it is exactly how the price was reached (to the rupee).
  const byArea = Number(area) > 0 && Number(rate) > 0 && Math.abs(Number(area) * Number(rate) - Number(base)) < 1
    ? `${Number(area).toLocaleString("en-IN")} sq ft × ${inr(rate)} per sq ft` : null;
  switch (l.key) {
    case "home": return { title: plot ? "Plot price" : "Home price", note: byArea };
    case "homeGst": return {
      title: plot ? "GST on the plot" : "GST on the home",
      note: Number(l.amount) > 0
        ? (Number(gstRate) > 0 ? `${Number(gstRate)}% of the ${plot ? "plot" : "home"} price` : null)
        // Why there is none: a building completed before any payment (Schedule III — outside GST), or land.
        : noGst?.why === "completed"
          ? `No GST: the building's completion certificate${noGst.certDate ? ` came on ${day(noGst.certDate)},` : " came"} before your first payment, so this sale is outside GST`
          : noGst?.why === "land" ? "No GST: land is not taxed under GST"
          : "No GST is charged on this booking",
    };
    case "parking": return { title: `Parking${l.label ? ` · ${l.label}` : ""}${l.quantity > 1 ? ` × ${l.quantity}` : ""}`, note: gst };
    case "extra": return { title: l.label || "Extra charges", note: gst };
    case "creditNotes": return { title: "Credit notes", note: "Taken off your price" };
    default: return { title: "Other adjustments", note: "Changes made to your price by our accounts team" };
  }
}

/** A payment's state, and where its money went, in the customer's words — for the app and the web portal. */
function paymentStatus(x) {
  switch (x.stage) {
    case "settled": return { label: "Counted", sub: null };
    case "held": return { label: "Received", sub: "Waiting to be matched to your instalments" };
    case "split": return { label: "Received", sub: null };
    case "finance":
    case "recorded": return { label: "Being verified", sub: "Our accounts team is checking it. It counts once confirmed." };
    case "returned": return { label: "Not accepted", sub: "This entry could not be accepted. Please contact us about it." };
    case "bounced": return { label: "Bounced", sub: x.note || "This payment did not go through." };
    case "unitChange": return { label: "Moved to your new unit", sub: null };
    case "out": return { label: Number(x.refunded) > 0 ? "Refunded" : "Moved", sub: null };
    default: return { label: "Adjustment", sub: "A credit or transfer made by us — not a payment from you" };
  }
}

/**
 * The purchase as the customer lives it, in order — each step done (with when), the current one, or still to come.
 * The same rules the CRM enforces, so the journey never claims more than has happened:
 *   welcome call — done once the customer is Welcomed (an unanswered call is not done);
 *   agreement — approved by the customer, then signed and registered (Status Registered);
 *   payments — every instalment covered (paid, or covered by verified money held — MoneyStage);
 *   sale deed — approved by the customer (a draft is not done); then the government fees and the registration;
 *   key handover — Completed (a scheduled one is not done). On an under-construction project the handover comes
 *   before the sale deed (crmWorkflowGuards getProjectSaleGate: the deed is prepared after possession).
 */
function customerJourney({ booking, welcomeCall, agreement, milestones = [], salesDeed, queryPayment, registry, handover, handoverFirst }) {
  const step = (key, label, hint, done, at) => ({ key, label, hint, done: !!done, at: done ? at || null : null });
  const handoverStep = step("handover", "Key handover", "You receive the keys and move in.",
    handover?.Status === "Completed" || !!handover?.ActualHandoverDate, handover?.ActualHandoverDate);
  const steps = [
    step("booking", "Booking confirmed", "Your home is reserved in your name.", !!booking, booking?.BookingDate),
    step("welcome", "Welcome call", "Our team calls to welcome you, answer questions and take your details.",
      welcomeCall?.Outcome === "Welcomed", welcomeCall?.CallDate),
    step("agreement", "Agreement", "You read and approve the agreement for sale.",
      agreement?.CustomerApprovalStatus === CrmStatus.APPROVED, agreement?.CustomerApprovedAt),
    step("agreementRegistered", "Agreement registered", "The agreement is signed and registered with the government.",
      agreement?.Status === CrmStatus.REGISTERED, agreement?.AfsRegistrationDate),
    step("payments", "Payments", "You pay the instalments as they fall due.",
      milestones.length > 0 && milestones.every((m) => m.Covered), null),
    ...(handoverFirst ? [handoverStep] : []),
    step("saleDeed", "Sale deed", "You read and approve the final sale deed for your home.",
      salesDeed?.CustomerApprovalStatus === CrmStatus.APPROVED, salesDeed?.CustomerApprovedAt),
    step("govtFees", "Government fees", "Stamp duty and registration fees are paid.",
      queryPayment?.Status === "Confirmed", queryPayment?.ConfirmedAt),
    step("registration", "Registration", "The sale deed is registered in your name.",
      registry?.Status === "Completed" || !!salesDeed?.RegistrationNo, registry?.CompletedDate || salesDeed?.RegistrationDate),
    ...(handoverFirst ? [] : [handoverStep]),
  ];
  const current = steps.findIndex((x) => !x.done);
  return steps.map((x, i) => ({ ...x, state: x.done ? "done" : i === current ? "current" : "upcoming" }));
}

async function loadTimeline(pool, appId, { lite = false } = {}) {
    const booking = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT b.Id, b.BookingNo,
             COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
             COALESCE(um.ProjectId, plot.ProjectId, b.ProjectId) AS ProjectId,
             COALESCE(b.UnitId, plot.ConvertedUnitId) AS UnitId, COALESCE(um.BlockId, plot.BlockId) AS BlockId,
             COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
             b.TotalValue, b.BookingAmount,
             b.TokenType, b.TokenValue, b.Status AS BookingStatus, b.BookingDate,
             b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
             CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bpx WHERE bpx.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS IsPlotSale,
             -- What the home is, as Unit Master records it (a converted villa's unit for a plot sale; plots are listed apart)
             um.UnitType, um.UnitKind, um.FloorNo, um.AreaSqFt, um.CarpetAreaSqFt, um.BuiltUpAreaSqFt, um.SuperBuiltUpAreaSqFt,
             um.OpenTerraceAreaSqFt, um.Facing, blk.BlockName,
             -- Who looks after the booking: name only (by decision: no staff phone numbers to customers)
             asg.name AS LookedAfterBy
      FROM dbo.CrmBooking b
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      OUTER APPLY (
        SELECT TOP 1 pm.ProjectId, pm.BlockId, pm.ConvertedUnitId
        FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId
        WHERE bp.BookingId = b.Id AND bp.Status = N'Active'
        ORDER BY bp.IsPrimary DESC, bp.Id
      ) plot
      LEFT JOIN dbo.UnitMaster um ON um.Id = COALESCE(b.UnitId, plot.ConvertedUnitId)
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = COALESCE(um.BlockId, plot.BlockId)
      LEFT JOIN dbo.users asg ON asg.id = b.AssignedTo
      WHERE b.ApplicationId = @aid AND b.IsActive = 1
    `);
    const bk = booking.recordset[0];

    // Active holds are surfaced regardless of whether a booking exists yet —
    // a customer can have a unit or parking slot on hold before booking
    // anything at all (e.g. parking-only, or still deciding on a unit).
    const holds = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT h.Id, h.EntityType, h.EntityId, h.HoldUntil, h.Reason,
             u.UnitName, s.SlotNo
      FROM dbo.CrmInventoryHold h
      LEFT JOIN dbo.UnitMaster u ON h.EntityType = 'Unit' AND u.Id = h.EntityId
      LEFT JOIN dbo.ParkingSlot s ON h.EntityType = 'Parking' AND s.Id = h.EntityId
      WHERE h.ApplicationId = @aid AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
      ORDER BY h.HoldUntil
    `);

    if (!bk) return { stage: "Application", steps: [], holds: holds.recordset };

    const [welcomeCall, customerDetails, agreement, milestones, deed, handover, possessionNotice, legalMilestone, nocs, prePossession, queryPayment, registry, onAccountTotal, plots, snags, project] = await Promise.all([
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT TOP 1 * FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT TOP 1
          CASE WHEN
            NULLIF(LTRIM(RTRIM(ISNULL(BankName, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AccountNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(IfscCode, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AccountHolderName, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(PanNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(AadhaarNo, ''))), '') IS NOT NULL AND
            NULLIF(LTRIM(RTRIM(ISNULL(Occupation, ''))), '') IS NOT NULL
          THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsComplete,
          UpdatedAt, CreatedAt
        FROM dbo.CrmCustomerBankDetail
        WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, AgreementNo, Status, SeniorApprovalStatus, CustomerApprovalStatus, CustomerApprovedAt,
               ProposedDate, ProposedDateStatus, AgreementDate, DateApprovalStatus, LastRecheckRemarks, SentToCustomerAt,
               AfsRegistrationNo, AfsRegistrationDate,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id) AS DocumentCount,
               (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = CrmAgreement.Id AND d.Status IN ('Requested','${CrmStatus.REJECTED}')) AS DocumentsNeedingAction
        FROM dbo.CrmAgreement WHERE BookingId = @bid AND SentToCustomerAt IS NOT NULL AND Status <> 'Cancelled'
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status
        FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Id, DeedNo, Status, DeedValue, SubRegistrarOffice, RegistrationNo, DeedDate, RegistrationDate, SentToCustomerAt,
               CustomerApprovalStatus, CustomerApprovedAt, CustomerRecheckRemarks
        FROM dbo.CrmSalesDeed WHERE BookingId = @bid AND ISNULL(Status, '') <> 'Cancelled'
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT TOP 1 Status, ScheduledDate, ActualHandoverDate FROM dbo.CrmHandover WHERE BookingId = @bid ORDER BY CASE WHEN Status = 'Cancelled' THEN 1 ELSE 0 END, Id DESC"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT TOP 1 Id, NoticeNo, Status, OfferedDate, ResponseDeadline, SentAt, AcknowledgedAt, DisputedAt, DisputeReason
        FROM dbo.CrmPossessionNotice WHERE BookingId = @bid AND Status <> 'Draft' ORDER BY CreatedAt DESC
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT OverallStatus FROM dbo.CrmLegalMilestone WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT NocType, Status, NocNo, IssuedDate FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT Status, ScheduledInspectionDate, InspectionCompletedDate, DuesClearedCheck, DocumentationCheck, QualityInspectionCheck, UtilityReadinessCheck
        FROM dbo.CrmPrePossession WHERE BookingId = @bid`),
      // Query Payment: the customer's own government payment (stamp duty +
      // registration fee) — required amount is read live from the Sales
      // Deed, same as the staff-side route, never duplicated here.
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT qp.Id, qp.QPNo, qp.Status, qp.InfoSentAt, qp.ConfirmedAt, qp.ConfirmedAmount,
               sd.StampDuty, sd.RegistrationFee, ISNULL(sd.StampDuty,0) + ISNULL(sd.RegistrationFee,0) AS RequiredAmount
        FROM dbo.CrmQueryPayment qp
        LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = qp.SalesDeedId
        WHERE qp.BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bk.Id).query("SELECT TOP 1 Id, RegNo, Status, ScheduledDate, CompletedDate FROM dbo.CrmRegistry WHERE BookingId = @bid ORDER BY CASE WHEN Status = 'Cancelled' THEN 1 ELSE 0 END, Id DESC"),
      // Every payment now lands in On Account first and stays there until an
      // explicit staff-side On Account Adjustment (crmPayments.js
      // applyOnAccountToMilestone) — so a customer who has genuinely paid can
      // still show AmountPaid=0 on every milestone. Surfaced separately here
      // so the portal's own "Total Paid" (PortalPayments.tsx) can reflect
      // real money received instead of only what's been swept, the same fix
      // already applied to the staff-side Dashboard/Customer 360.
      pool.request().input("bid", sql.Int, bk.Id).// only the part not yet applied to a milestone — applied money is already in
      // the milestones' AmountPaid, so the full Amount counted it twice
      query("SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') AND Amount > ISNULL(AppliedAmount, 0) THEN Amount - ISNULL(AppliedAmount, 0) ELSE 0 END), 0) AS Total FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid"),
      // Every plot on a plot sale (one or many), with its size and frontage
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT pm.PlotNo, pm.PlotName, bp.AreaSqFt, pm.PlotWidthFt, pm.PlotDepthFt, pm.Facing, pm.IsCornerPlot, pm.RoadWidthFt, bp.IsPrimary
        FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId
        WHERE bp.BookingId = @bid AND bp.Status = N'${CrmStatus.ACTIVE}' ORDER BY bp.IsPrimary DESC, bp.Id`),
      // Snags found at the handover inspection and whether each is fixed — the buyer's own home
      pool.request().input("bid", sql.Int, bk.Id).query(`
        SELECT s.Id, s.Category, s.Description, s.Status, s.ResolvedAt, s.CreatedAt,
               CAST(CASE WHEN s.Status IN (N'${CrmStatus.OPEN}', N'${CrmStatus.IN_PROGRESS}') THEN 1 ELSE 0 END AS BIT) AS IsOpen
        FROM dbo.CrmSnagItem s JOIN dbo.CrmHandover h ON h.Id = s.HandoverId
        WHERE h.BookingId = @bid AND ISNULL(h.Status, '') <> 'Cancelled' ORDER BY s.CreatedAt`),
      // The project as Project Master records it, with its type and the developer (the project's company).
      // rera_no is NOT read: Project Master currently saves Priority into it (known bug) — showing it would mislead.
      pool.request().input("pid", sql.Int, bk.ProjectId || 0).query(`
        SELECT p.name, p.address, p.address_line2, p.address_line3, p.city, p.state, p.pincode, p.latitude, p.longitude,
               p.website, p.description, pt.Name AS TypeName, c.name AS Developer
        FROM dbo.enterprise p
        LEFT JOIN dbo.ProjectTypeMaster pt ON pt.Id = p.project_type_id
        LEFT JOIN dbo.enterprise c ON c.id = p.company_id AND c.business_type = 'C'
        WHERE p.id = @pid AND p.business_type = 'P'`),
    ]);

    // Whether each instalment is actually paid. Money is held On Account until the full price is in (crmOnAccountCoverage),
    // so a paid instalment can still say Status = 'Pending'. Its money stage is the truth — the same one the staff
    // screens and the money statement use: Covered = paid (settled, or covered by verified money held for it);
    // Verifying = paid, being checked; Outstanding = what is genuinely still to pay on it.
    const stageOf = new Map((await getMilestoneMoneyStages(pool, bk.Id)).milestones.map((m) => [m.Id, m]));
    const paymentMilestones = milestones.recordset.map((m) => {
      const st = stageOf.get(m.Id) || {};
      const stage = st.MoneyStage ?? null;
      return {
        ...m, MoneyStage: stage,
        Covered: ["Adjusted", "Verified", "Waived"].includes(stage),
        Verifying: ["InVerification", "Recorded"].includes(stage),
        Outstanding: stage === "Waived" ? 0 : Math.max(0, Math.round((Number(m.AmountDue || 0) - Number(m.AmountPaid || 0) - Number(st.HeldOnAccount || 0)) * 100) / 100),
      };
    });
    return {
      booking: bk,
      welcomeCall: welcomeCall.recordset[0] || null,
      customerDetails: customerDetails.recordset[0] || null,
      agreement: agreement.recordset[0] || null,
      paymentMilestones,
      onAccountTotalReceived: Number(onAccountTotal.recordset[0]?.Total) || 0,
      salesDeed: deed.recordset[0] || null,
      handover: handover.recordset[0] || null,
      possessionNotice: possessionNotice.recordset[0] || null,
      // The purchase, step by step — one list for the app and the web portal (customerJourney below).
      journey: customerJourney({
        booking: bk, welcomeCall: welcomeCall.recordset[0], agreement: agreement.recordset[0], milestones: paymentMilestones,
        salesDeed: deed.recordset[0], queryPayment: queryPayment.recordset[0], registry: registry.recordset[0], handover: handover.recordset[0],
        handoverFirst: (await getProjectSaleGate(pool, bk.Id).catch(() => ({}))).requiresHandoverBeforeDeed === true,
      }),
      // The buyer's own unit as the site records it (DPR), with its tower and project for context.
      constructionProgress: bk.ProjectId && !lite
        ? await require("./crmConstructionUpdates").unitProgress(pool, { projectId: bk.ProjectId, unitId: bk.UnitId, blockId: bk.BlockId }).catch((e) => {
          console.error("[crm-portal] construction progress error:", e.message);
          return null;
        })
        : null,
      siteNotes: bk.ProjectId && !lite ? await require("./crmConstructionUpdates").buyerNotes(pool, bk.ProjectId) : [],
      // Photos from site of their own unit and shared work on their tower / project (the file opens via /site-photos/:id)
      sitePhotos: bk.ProjectId && !lite
        ? await require("./crmConstructionUpdates").buyerPhotos(pool, { projectId: bk.ProjectId, blockId: bk.BlockId, unitId: bk.UnitId }).catch((e) => {
          console.error("[crm-portal] site photos error:", e.message);
          return [];
        })
        : [],
      // What the home is, and each plot, as ready-to-show facts — built once here for the app and the web portal.
      homeFacts: homeFacts(bk),
      project: projectView(project.recordset[0]),
      plots: plots.recordset.map((p) => ({ ...p, facts: plotFacts(p) })),
      snags: snags.recordset,
      holds: holds.recordset,
      // Customer-facing framing of internal process trackers — raw step
      // names (DocCollection/LegalReview/etc) and NOC bank details are never
      // exposed, only an overall status the customer can act/wait on.
      legalDocumentation: legalMilestone.recordset[0]
        ? { status: legalMilestone.recordset[0].OverallStatus }
        : null,
      nocStatus: {
        total: nocs.recordset.length,
        issued: nocs.recordset.filter((n) => n.Status === "Issued").length,
        items: nocs.recordset.map((n) => ({ type: n.NocType, status: n.Status, nocNo: n.NocNo, issuedDate: n.IssuedDate })),
      },
      queryPayment: queryPayment.recordset[0] || null,
      registry: registry.recordset[0] || null,
      prePossession: prePossession.recordset[0]
        ? (({ Status, ScheduledInspectionDate, InspectionCompletedDate, DuesClearedCheck, DocumentationCheck, QualityInspectionCheck, UtilityReadinessCheck }) => ({
          status: Status, scheduledDate: ScheduledInspectionDate, completedDate: InspectionCompletedDate,
          checks: { duesCleared: !!DuesClearedCheck, documentation: !!DocumentationCheck, quality: !!QualityInspectionCheck, utilities: !!UtilityReadinessCheck },
        }))(prePossession.recordset[0])
        : null,
    };
}

router.get("/timeline", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    res.json(await loadTimeline(pool, appId));
  } catch (e) {
    console.error("[crm-portal] GET /timeline error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /invoices — every invoice for the selected application's booking.
// Requires ?applicationId=
router.get("/invoices", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.CreatedAt,
             b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /invoices error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Per-user rate limit for PDF generation (expensive CPU/storage operation).
// 20 downloads per minute is generous for legitimate use but stops bulk scraping.
const pdfRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => `pdf:portal:${req.portalUser?.portalUserId || req.ip}`,
  message: { error: "Too many PDF requests — please wait a moment before downloading more" },
  validate: false,
});

// Site photos load as a grid, so they get their own, larger allowance (not the PDF one).
const photoRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  keyGenerator: (req) => `photo:portal:${req.portalUser?.portalUserId || req.ip}`,
  message: { error: "Too many photo requests — please wait a moment" },
  validate: false,
});

// GET /invoices/:invoiceId/pdf — same invoice PDF the staff side downloads,
// scoped to invoices on a booking belonging to THIS logged-in customer only
// (via applicationId, same ownership check every other portal route uses —
// portalUser.customerId comes from the JWT, never a client-supplied value).
router.get("/invoices/:invoiceId/pdf", pdfRateLimiter, async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const invoiceId = parseId(req.params.invoiceId);
    if (invoiceId === null) return res.status(400).json({ error: "Invalid invoiceId" });
    const row = await pool.request().input("iid", sql.Int, invoiceId).input("aid", sql.Int, appId).query(`
      SELECT inv.InvoiceNo
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      WHERE inv.Id = @iid AND b.ApplicationId = @aid
    `);
    if (!row.recordset.length) return res.status(404).json({ error: "Invoice not found" });
    const invoiceNo = row.recordset[0].InvoiceNo;
    const buffer = await getInvoicePdfBuffer(pool, invoiceId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoiceNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-portal] GET /invoices/:invoiceId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /receipts — list approved money receipts for the customer's booking.
// Only Approved receipts are shown — Pending/Bounced receipts are internal
// workflow states the customer doesn't need to see.
router.get("/receipts", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT mr.Id, mr.ReceiptNo, mr.Amount, mr.PaymentMode, mr.ChequeNo,
             mr.TransactionRef, mr.ReceivedDate, mr.CreatedAt,
             b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND mr.Status = 'Approved'
      ORDER BY mr.ReceivedDate DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /receipts error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── GET /money — the whole money picture of one property, for the customer ─────────────────────────────────────────
// Transparent by construction: every figure comes from the same place the staff screens read it, never re-derived here.
//   price    — how the total price is made up: the same sum crmGst.js saleTotals stores as GrandTotal (home price + GST on
//              the home + parking incl. GST + extra charges incl. GST − credit notes), itemised; any legacy difference is
//              shown as its own line so the lines always add up to the total.
//   plan     — each instalment with the money against it and its stage (crmOnAccountCoverage getMilestoneMoneyStages).
//   payments — every payment, from when it was entered to where it sits now (getBookingMoneyTrail): counted, waiting to
//              be matched, being verified, refunded, moved, bounced. Only the customer's own receipt number is shown, and
//              only an approved receipt can be opened.
const { getMilestoneMoneyStages, getBookingMoneyTrail } = require("../services/crmOnAccountCoverage");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
router.get("/money", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const bk = (await pool.request().input("aid", sql.Int, appId).query(`
      SELECT b.Id, b.BookingNo, b.Status, b.TotalValue, ISNULL(b.UnitGstAmount, 0) AS UnitGstAmount,
             ISNULL(b.ParkingTotal, 0) AS ParkingTotal, ISNULL(b.ParkingGstAmount, 0) AS ParkingGstAmount,
             ISNULL(b.ExtraChargesTotal, 0) AS ExtraChargesTotal, ISNULL(b.ExtraWorkGstAmount, 0) AS ExtraWorkGstAmount,
             ISNULL(b.CreditNoteTotal, 0) AS CreditNoteTotal, ISNULL(b.TotalGstAmount, 0) AS TotalGstAmount, b.GrandTotal,
             b.AreaSqFt, b.RatePerSqFt, b.UnitParkingGstRate,
             CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bpx WHERE bpx.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS IsPlotSale
      FROM dbo.CrmBooking b WHERE b.ApplicationId = @aid AND b.IsActive = 1`)).recordset[0];
    if (!bk) return res.json({ booking: null });
    const bid = () => pool.request().input("bid", sql.Int, bk.Id);
    const [extras, parking, dates, approved, stages, trail, exemption, landSplit, plotShares] = await Promise.all([
      bid().query("SELECT Description, Amount, GstAmount, TotalAmount FROM dbo.CrmExtraCharge WHERE BookingId = @bid AND IsActive = 1 ORDER BY Id"),
      bid().query("SELECT ParkingSlotNo, Quantity, RateSnapshot, GstAmount, TotalAmount FROM dbo.CrmParkingAllotment WHERE BookingId = @bid AND IsActive = 1 ORDER BY Id"),
      bid().query("SELECT Id, DueDate, DemandStatus FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid"),
      bid().query("SELECT Id FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status = 'Approved'"),
      getMilestoneMoneyStages(pool, bk.Id),
      getBookingMoneyTrail(pool, bk.Id),
      // Why a booking carries no GST, when it carries none — the same rules crmGst.js recalculateBookingGst applies.
      require("../services/crmGst").checkGstExemption(pool, bk.Id),
      require("../services/projectType").getBookingLandSplit(pool, bk.Id, bk.TotalValue),
      bid().query(`SELECT pm.PlotNo, pm.PlotName, bp.AreaSqFt, bp.RatePerSqFt, bp.PremiumAmount, bp.AllocatedValue
                   FROM dbo.CrmBookingPlot bp JOIN dbo.PlotMaster pm ON pm.Id = bp.PlotId
                   WHERE bp.BookingId = @bid AND bp.Status = N'${CrmStatus.ACTIVE}' ORDER BY bp.IsPrimary DESC, bp.Id`),
    ]);

    const lines = [
      { key: "home", amount: r2(bk.TotalValue) },
      { key: "homeGst", amount: r2(bk.UnitGstAmount) },
      ...parking.recordset.map((x) => ({ key: "parking", label: x.ParkingSlotNo, quantity: x.Quantity, amount: r2(x.TotalAmount), gst: r2(x.GstAmount) })),
      ...extras.recordset.map((x) => ({ key: "extra", label: x.Description, amount: r2(x.TotalAmount), gst: r2(x.GstAmount) })),
      { key: "creditNotes", amount: -r2(bk.CreditNoteTotal) },
    ];
    // Parking / extra charges whose rows are gone but whose totals remain (old bookings) still add up, as one line each.
    const sumOf = (k) => r2(lines.filter((l) => l.key === k).reduce((n, l) => n + l.amount, 0));
    if (r2(bk.ParkingTotal) !== sumOf("parking")) lines.push({ key: "parking", label: null, amount: r2(bk.ParkingTotal - sumOf("parking")), gst: null });
    if (r2(bk.ExtraChargesTotal) !== sumOf("extra")) lines.push({ key: "extra", label: null, amount: r2(bk.ExtraChargesTotal - sumOf("extra")), gst: null });
    const shown = r2(lines.reduce((n, l) => n + l.amount, 0));
    if (r2(bk.GrandTotal) !== shown) lines.push({ key: "other", amount: r2(bk.GrandTotal - shown) });

    const dateOf = new Map(dates.recordset.map((d) => [d.Id, d]));
    const instalments = stages.milestones.map((m) => ({
      no: m.MilestoneNo, name: m.MilestoneName, due: r2(m.AmountDue), dueDate: dateOf.get(m.Id)?.DueDate || null,
      demanded: (dateOf.get(m.Id)?.DemandStatus || "Pending") !== "Pending", waived: m.Status === "Waived",
      settled: r2(m.AmountPaid), held: r2(m.HeldOnAccount), verifying: r2((m.WithFinanceCover || 0) + (m.RecordedCover || 0)),
      stage: m.MoneyStage,
    }));
    const planTotal = r2(instalments.filter((m) => !m.waived).reduce((n, m) => n + m.due, 0));
    const waived = r2(instalments.filter((m) => m.waived).reduce((n, m) => n + m.due - m.settled, 0));

    const ok = new Set(approved.recordset.map((x) => x.Id));
    const payments = trail.rows.map((x) => ({
      date: x.date, mode: x.mode, ref: x.ref, amount: r2(x.amount), stage: x.stage,
      // How they paid (from their Money Receipt) and which instalment it was paid against
      chequeNo: x.chequeNo, chequeDate: x.chequeDate, bankName: x.bankName, txnRef: x.txnRef, milestone: x.milestone || null,
      status: paymentStatus(x),
      // Every detail of how they paid, ready to show (built once here for the app and the web portal; only what is recorded)
      details: keepShown([
        ["Amount", inr(x.amount)],
        ["Date", x.date ? day(x.date) : null],
        ["Paid by", x.mode],
        ["Cheque / DD no.", x.chequeNo],
        ["Cheque date", x.chequeDate ? day(x.chequeDate) : null],
        ["Drawn on (your bank)", x.bankName],
        ["Transaction ref / UTR", x.txnRef || (!x.chequeNo ? x.ref : null)],
        ["Paid towards", x.milestone],
        ["Receipt no.", x.receiptNo],
      ]),
      receiptNo: x.receiptNo, receiptId: x.receiptId && ok.has(x.receiptId) ? x.receiptId : null,
      settled: r2(x.settled), held: r2(x.held), refunded: r2(x.refunded), movedOut: r2(x.otherOut),
      // Only a bounce reason is the customer's to read; other notes are staff remarks.
      note: x.stage === "bounced" ? x.note : null,
    }));
    const t = trail.totals;
    const paid = r2(t.settled + t.held);
    res.json({
      // Closed: the booking ended (DEAD_BOOKING_STATUSES) — nothing is owed; the question is where the money went.
      booking: { BookingNo: bk.BookingNo, Status: bk.Status, IsPlotSale: !!bk.IsPlotSale, Closed: DEAD_BOOKING_STATUSES.includes(bk.Status) },
      price: {
        lines: lines.filter((l) => l.amount !== 0 || l.key === "home" || l.key === "homeGst")
          .map((l) => ({ ...l, ...priceLineText(l, { plot: !!bk.IsPlotSale, area: bk.AreaSqFt, rate: bk.RatePerSqFt, base: bk.TotalValue, gstRate: bk.UnitParkingGstRate,
            noGst: exemption.exempt ? { why: "completed", certDate: exemption.certDate } : landSplit.isPureLand ? { why: "land" } : null }) }))
          // A plot sale of several plots: each plot's share of the price, under the price line (they add up to it)
          .map((l) => (l.key === "home" && plotShares.recordset.length > 1
            ? { ...l, parts: plotShares.recordset.map((p) => ({
              title: `Plot ${p.PlotName || p.PlotNo}`,
              note: [Number(p.AreaSqFt) > 0 ? `${Number(p.AreaSqFt).toLocaleString("en-IN")} sq ft` : null,
                Number(p.RatePerSqFt) > 0 ? `at ${inr(p.RatePerSqFt)} per sq ft` : null,
                Number(p.PremiumAmount) > 0 ? `incl. ${inr(p.PremiumAmount)} premium` : null].filter(Boolean).join(" ") || null,
              amount: r2(p.AllocatedValue),
            })) }
            : l)),
        total: r2(bk.GrandTotal), gstIncluded: r2(bk.TotalGstAmount),
      },
      plan: { instalments, total: planTotal, waived },
      payments,
      totals: {
        paid, received: r2(t.received), settled: r2(t.settled), held: r2(t.held), verifying: r2(t.finance + t.recorded),
        refunded: r2(t.refunded), movedOut: r2(t.otherOut),
        balance: r2(Math.max(0, planTotal - paid)), extra: r2(Math.max(0, paid - planTotal)),
        // Paid beyond the price itself — e.g. a credit note lowered the price after the plan was paid in full.
        overPrice: r2(Math.max(0, paid - r2(bk.GrandTotal))),
      },
    });
  } catch (e) {
    console.error("[crm-portal] GET /money error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /receipts/:receiptId/pdf — scoped to receipts on a booking belonging to
// THIS logged-in customer only (same ownership check as /invoices/:id/pdf).
router.get("/receipts/:receiptId/pdf", pdfRateLimiter, async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const receiptId = parseId(req.params.receiptId);
    if (receiptId === null) return res.status(400).json({ error: "Invalid receiptId" });
    const row = await pool.request()
      .input("rid", sql.Int, receiptId)
      .input("aid", sql.Int, appId)
      .query(`
        SELECT mr.ReceiptNo
        FROM dbo.CrmMoneyReceipt mr
        JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
        WHERE mr.Id = @rid AND b.ApplicationId = @aid AND mr.Status = 'Approved'
      `);
    if (!row.recordset.length) return res.status(404).json({ error: "Receipt not found" });
    const receiptNo = row.recordset[0].ReceiptNo;
    const buffer = await getMoneyReceiptPdfBuffer(pool, receiptId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${receiptNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-portal] GET /receipts/:receiptId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /agreement — requires ?applicationId=
/** The agreement shared with the customer for this application (null until one is sent). */
async function loadAgreement(pool, appId) {
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.AgreementNo, ag.Status, ag.AgreementDate, ag.LegalName, ag.LegalAddress,
             CASE WHEN LEN(ag.PanNo) >= 4 THEN CONCAT(REPLICATE(N'X', LEN(ag.PanNo) - 4), RIGHT(ag.PanNo, 4)) ELSE ag.PanNo END AS PanNo,
             CASE WHEN LEN(ag.AadhaarNo) >= 4 THEN CONCAT(REPLICATE(N'X', LEN(ag.AadhaarNo) - 4), RIGHT(ag.AadhaarNo, 4)) ELSE ag.AadhaarNo END AS AadhaarNo,
             ag.VersionNo, ag.CreatedAt,
             ag.SeniorApprovalStatus, ag.SeniorApprovedAt,
             ag.CustomerApprovalStatus, ag.CustomerApprovedAt, ag.RecheckCount,
             ag.ProposedDate, ag.ProposedDateStatus, ag.DateApprovalStatus,
             ag.SentToCustomerAt, ag.LastRecheckRemarks,
             -- Signed (Executed) and registered: the registration staff record (crmAgreements.js mark-registered)
             ag.AfsRegistrationNo, ag.AfsRegistrationDate, ag.AfsStampDuty, ag.AfsRegistrationFee,
             b.BookingNo,
             COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
             COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
             b.TotalValue, b.BookingDate
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND ag.Status <> 'Cancelled'
    `);
    return result.recordset[0] || null;
}
router.get("/agreement", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    // Not having an agreement shared yet is a normal, expected state — 200 + null.
    res.json(await loadAgreement(pool, appId));
  } catch (e) {
    console.error("[crm-portal] GET /agreement error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /agreement/documents — requires ?applicationId=
/** The agreement papers the customer can see for this application. */
async function loadAgreementDocuments(pool, appId) {
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.DocumentType, d.Label, d.IsMandatory, d.UploadedByType,
             d.FileName, d.FileSize, d.MimeType, d.Status, d.Remarks, d.VersionNo,
             d.RequestedAt, d.UploadedAt, d.CreatedAt
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      -- IdentityProof-type documents are the "first batch" — KYC paperwork
      -- the customer can and should upload right away, well before the
      -- Legal Executive's Sale Agreement paper exists or the agreement is
      -- formally sent. Every other document type stays gated behind
      -- SentToCustomerAt (the actual legal content shouldn't be visible
      -- until it's been through senior approval and been shared).
      WHERE b.ApplicationId = @aid AND (ag.SentToCustomerAt IS NOT NULL OR d.DocumentType = 'IdentityProof')
      ORDER BY d.CreatedAt DESC
    `);
    return result.recordset;
}
router.get("/agreement/documents", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    res.json(await loadAgreementDocuments(pool, appId));
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

const portalDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "application/pdf", "image/jpeg", "image/png", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed — please upload a PDF, Word document, or image"));
  },
});

// POST /agreement/documents/:docId/upload — requires ?applicationId=
router.post("/agreement/documents/:docId/upload", (req, res) => {
  portalDocUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    // multer's fileFilter only ever checked the client-declared Content-Type
    // (Findings #7) — a renamed executable with a spoofed "application/pdf"
    // header sailed straight through. This is the customer-facing upload
    // endpoint, so it gets the check first.
    const sigErr = verifyFileMatchesDeclaredType(req.file);
    if (sigErr) return res.status(400).json({ error: sigErr });
    try {
      const pool = getPool();
      const appId = await resolveAndAssertApplication(pool, req, res);
      if (appId === null) return;
      const docId = parseId(req.params.docId);
      if (docId === null) return res.status(400).json({ error: "Invalid docId" });

      const ref = (await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
        SELECT d.AgreementId, d.DocumentType, ag.BookingId
        FROM dbo.CrmAgreementDocument d
        JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE b.ApplicationId = @aid AND d.Id = @did
      `)).recordset[0];
      if (!ref) return res.status(404).json({ error: "Document not found" });

      const tx = pool.transaction();
      await tx.begin();
      let notification = null;
      try {
        const booking = (await tx.request().input("bid", sql.Int, ref.BookingId).input("aid", sql.Int, appId).query(`
          SELECT b.Status, b.IsActive, b.BookingNo, b.AssignedTo, a.ApplicantName
          FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE b.Id = @bid AND b.ApplicationId = @aid
        `)).recordset[0];
        if (!booking) throw Object.assign(new Error("Document not found"), { status: 404 });
        if (!booking.IsActive || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(booking.Status)) {
          throw Object.assign(new Error("Cannot upload for an inactive booking"), { status: 409 });
        }
        const agreement = (await tx.request().input("agid", sql.Int, ref.AgreementId).query(`
          SELECT AgreementNo, Status, SentToCustomerAt
          FROM dbo.CrmAgreement WITH (UPDLOCK, HOLDLOCK) WHERE Id = @agid
        `)).recordset[0];
        if (!agreement) throw Object.assign(new Error("Agreement not found"), { status: 404 });
        if ([CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(agreement.Status)) {
          throw Object.assign(new Error(`Cannot upload after the Agreement is ${agreement.Status}`), { status: 409 });
        }
        const doc = (await tx.request().input("did", sql.Int, docId).input("agid", sql.Int, ref.AgreementId).query(`
          SELECT Status, DocumentType FROM dbo.CrmAgreementDocument WITH (UPDLOCK, HOLDLOCK)
          WHERE Id = @did AND AgreementId = @agid
        `)).recordset[0];
        if (!doc || !["Requested", CrmStatus.REJECTED].includes(doc.Status)) {
          throw Object.assign(new Error("This document is no longer open for upload"), { status: 409 });
        }
        if (!agreement.SentToCustomerAt && doc.DocumentType !== "IdentityProof") {
          throw Object.assign(new Error("This document is not open for customer upload yet"), { status: 409 });
        }
        const uploaded = await tx.request()
          .input("id", sql.Int, docId).input("agid", sql.Int, ref.AgreementId)
          .input("dtype", sql.NVarChar(100), doc.DocumentType)
          .input("fname", sql.NVarChar(300), req.file.originalname)
          .input("fb64", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
          .input("fs", sql.BigInt, req.file.size).input("mt", sql.NVarChar(150), req.file.mimetype)
          .query(`UPDATE dbo.CrmAgreementDocument SET
            FileName = @fname, FileBase64 = @fb64, FileSize = @fs, MimeType = @mt,
            Status = 'Submitted', Remarks = NULL, UploadedAt = SYSDATETIME()
            WHERE Id = @id AND AgreementId = @agid AND Status IN ('Requested', '${CrmStatus.REJECTED}')
              AND EXISTS (SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.Id = @agid
                AND ag.Status NOT IN ('${CrmStatus.EXECUTED}', '${CrmStatus.REGISTERED}')
                AND (ag.SentToCustomerAt IS NOT NULL OR @dtype = 'IdentityProof'))`);
        if (!uploaded.rowsAffected?.some((count) => count > 0)) {
          throw Object.assign(new Error("Agreement or document changed; reload before uploading"), { status: 409 });
        }
        await logCommunication(tx, {
          bookingId: ref.BookingId, direction: "Inbound",
          subject: `Customer submitted a document — ${doc.DocumentType.replace(/([A-Z])/g, " $1").trim()}`,
          summary: `${booking.ApplicantName} uploaded ${doc.DocumentType.replace(/([A-Z])/g, " $1").trim()} for ${agreement.AgreementNo}.`,
        });
        notification = { assignedTo: booking.AssignedTo, applicantName: booking.ApplicantName,
          agreementNo: agreement.AgreementNo, bookingNo: booking.BookingNo, documentType: doc.DocumentType };
        await tx.commit();
      } catch (txErr) {
        await tx.rollback().catch(() => {});
        throw txErr;
      }
      if (notification?.assignedTo) {
        try {
          await emitNotification(pool, notification.assignedTo, "crm_document_submitted", "Document Submitted by Customer",
            `${notification.applicantName} uploaded ${notification.documentType.replace(/([A-Z])/g, " $1").trim()} for ${notification.agreementNo} (${notification.bookingNo}).`,
            docId, "crm_agreement_document");
        } catch (notifyErr) {
          console.error("[crm-portal] Agreement document notification failed:", notifyErr.message);
        }
      }
      res.json({ success: true });
    } catch (e) {
      console.error("[crm-portal] POST /agreement/documents/:docId/upload error:", e.message);
      if (e.status) return res.status(e.status).json({ error: e.message });
      res.status(500).json({ error: "An internal error occurred. Please try again later." });
    }
  });
});

// GET /agreement/documents/file/:docId — requires ?applicationId=
router.get("/agreement/documents/file/:docId", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const docId = parseId(req.params.docId);
    if (docId === null) return res.status(400).json({ error: "Invalid docId" });
    // Same early-access carve-out as GET /agreement/documents — a customer
    // must be able to preview/download an IdentityProof file they already
    // uploaded, even before the agreement itself has been sent.
    const result = await pool.request().input("aid", sql.Int, appId).input("did", sql.Int, docId).query(`
      SELECT d.FileName, d.FileBase64, d.MimeType
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      WHERE b.ApplicationId = @aid AND (ag.SentToCustomerAt IS NOT NULL OR d.DocumentType = 'IdentityProof') AND d.Id = @did
    `);
    if (!result.recordset.length || !result.recordset[0].FileBase64) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    res.send(Buffer.from(doc.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-portal] GET /agreement/documents/file error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /agreement/respond — requires ?applicationId=
router.post("/agreement/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, remarks, proposedDate } = req.body;
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.RecheckCount, ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
             ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName,
             ag.VersionNo, ag.AgreementDate, ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo, ag.Notes
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND ag.Status <> 'Cancelled'
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement pending your response" });
    if (ag.recordset[0].SeniorApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Agreement is not ready for customer approval" });
    }
    if (ag.recordset[0].CustomerApprovalStatus === CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Agreement has already been approved" });
    }
    const agreementRow = ag.recordset[0];
    const agreementId = agreementRow.Id;
    let currentAgreementRow = agreementRow;

    // Customer-initiated, legally meaningful state change spanning up to 3
    // tables (Agreement status, Revision snapshot on Recheck, Approval log)
    // — wrapped so a dropped connection mid-sequence can never leave the
    // agreement's approval status out of sync with its own revision/audit
    // trail. Notifications stay outside the tx (pure websocket, no DB write).
    const tx = pool.transaction();
    await tx.begin();
    try {
      const booking = (await tx.request().input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT b.Status, b.IsActive FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK)
        WHERE b.Id = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!booking || !booking.IsActive || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(booking.Status)) {
        throw Object.assign(new Error("The booking is no longer active"), { status: 409 });
      }
      const locked = (await tx.request().input("id", sql.Int, agreementId).input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT ag.Id, ag.RecheckCount, ag.CustomerApprovalStatus, ag.SeniorApprovalStatus,
          ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName,
          ag.VersionNo, ag.AgreementDate, ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo, ag.Notes,
          ag.Status, ag.SentToCustomerAt
        FROM dbo.CrmAgreement ag WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE ag.Id = @id AND ag.BookingId = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!locked || !locked.SentToCustomerAt || locked.Status === CrmStatus.CANCELLED
        || [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(locked.Status)
        || locked.SeniorApprovalStatus !== CrmStatus.APPROVED
        || locked.CustomerApprovalStatus === CrmStatus.APPROVED) {
        throw Object.assign(new Error("The Agreement is no longer awaiting your response"), { status: 409 });
      }
      currentAgreementRow = locked;
      const expectedStatus = locked.CustomerApprovalStatus;
      if (decision === "Approve") {
        const updated = await tx.request().input("id", sql.Int, agreementId)
          .input("expected", sql.NVarChar(30), expectedStatus)
          .query(`UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = '${CrmStatus.APPROVED}', CustomerApprovedAt = SYSDATETIME()
            WHERE Id = @id AND ISNULL(CustomerApprovalStatus, '') = ISNULL(@expected, '')
              AND SeniorApprovalStatus = '${CrmStatus.APPROVED}' AND SentToCustomerAt IS NOT NULL
              AND Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.EXECUTED}', '${CrmStatus.REGISTERED}')`);
        if (!updated.rowsAffected?.some((count) => count > 0)) throw Object.assign(new Error("The Agreement response changed; reload and try again"), { status: 409 });
        if (proposedDate) await proposeAgreementDate(tx, agreementId, "Customer", proposedDate, null);
        await syncLegalMilestoneStep(tx, locked.BookingId, "MutualAgreement", null);
      } else {
        const updated = await tx.request().input("id", sql.Int, agreementId)
          .input("expected", sql.NVarChar(30), expectedStatus)
          .input("rem", sql.NVarChar(sql.MAX), remarks || null)
          .query(`UPDATE dbo.CrmAgreement SET
            CustomerApprovalStatus = 'RecheckRequested', RecheckCount = RecheckCount + 1,
            CustomerApprovedAt = NULL, LastRecheckRemarks = @rem
            WHERE Id = @id AND ISNULL(CustomerApprovalStatus, '') = ISNULL(@expected, '')
              AND SeniorApprovalStatus = '${CrmStatus.APPROVED}' AND SentToCustomerAt IS NOT NULL
              AND Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.EXECUTED}', '${CrmStatus.REGISTERED}')`);
        if (!updated.rowsAffected?.some((count) => count > 0)) throw Object.assign(new Error("The Agreement response changed; reload and try again"), { status: 409 });
        await tx.request()
          .input("agid", sql.Int, agreementId).input("ver", sql.Int, locked.VersionNo)
          .input("adt", sql.Date, locked.AgreementDate).input("lname", sql.NVarChar(300), locked.LegalName)
          .input("laddr", sql.NVarChar(sql.MAX), locked.LegalAddress).input("pan", sql.NVarChar(20), locked.PanNo)
          .input("aadh", sql.NVarChar(20), locked.AadhaarNo).input("note", sql.NVarChar(sql.MAX), locked.Notes)
          .input("reason", sql.NVarChar(500), `Customer recheck requested: ${remarks}`)
          .query(`INSERT INTO dbo.CrmAgreementRevision
            (AgreementId, VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes, Reason, CreatedBy, CreatedAt)
            VALUES (@agid, @ver, @adt, @lname, @laddr, @pan, @aadh, @note, @reason, NULL, SYSDATETIME())`);
      }
      await tx.request()
        .input("agid", sql.Int, agreementId)
        .input("act", sql.NVarChar(30), decision === "Approve" ? "CustomerApprove" : "CustomerRecheck")
        .input("rem", sql.NVarChar(sql.MAX), remarks || null)
        .input("aname", sql.NVarChar(200), req.portalUser.email)
        .query(`INSERT INTO dbo.CrmAgreementApprovalLog
          (AgreementId, Action, Remarks, ActorType, ActorId, ActorName, CreatedAt)
          VALUES (@agid, @act, @rem, 'Customer', NULL, @aname, SYSDATETIME())`);
      await logCommunication(tx, {
        bookingId: locked.BookingId, direction: "Inbound",
        subject: decision === "Approve" ? "Customer approved the agreement" : "Customer requested a recheck",
        summary: decision === "Approve"
          ? `${locked.ApplicantName} approved ${locked.AgreementNo}.`
          : `${locked.ApplicantName} requested a recheck on ${locked.AgreementNo}: ${remarks}`,
      });
      await tx.commit();
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }

    if (currentAgreementRow.AssignedTo) {
      try { await emitNotification(pool, currentAgreementRow.AssignedTo,
        decision === "Approve" ? "crm_agreement_customer_approved" : "crm_agreement_recheck_requested",
        decision === "Approve" ? "Agreement Approved by Customer" : "Agreement Recheck Requested",
        decision === "Approve"
          ? `${currentAgreementRow.ApplicantName} approved agreement ${currentAgreementRow.AgreementNo} (${currentAgreementRow.BookingNo}).`
          : `${currentAgreementRow.ApplicantName} requested a recheck on agreement ${currentAgreementRow.AgreementNo} (${currentAgreementRow.BookingNo}): ${remarks}`,
        agreementId, "crm_agreement");
      } catch (notifyErr) { console.error("[crm-portal] Agreement response notification failed:", notifyErr.message); }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/respond error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /agreement/propose-date — requires ?applicationId=
router.post("/agreement/propose-date", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { proposedDate } = req.body;
    if (!proposedDate) return res.status(400).json({ error: "proposedDate is required" });

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.CustomerApprovalStatus, ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND ag.Status <> 'Cancelled'
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement found" });
    const agreementRow = ag.recordset[0];
    if (agreementRow.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Approve the agreement's content before proposing a date" });
    }
    const agreementId = agreementRow.Id;

    // proposeAgreementDate does 2 writes (DateHistory insert + Agreement
    // update) plus the comm log here — wrapped so a failure between them
    // can never leave the negotiation status pointing at a date history
    // entry that was never actually recorded, or vice versa.
    const tx = pool.transaction();
    await tx.begin();
    let notificationRow;
    try {
      const booking = (await tx.request().input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT b.Status, b.IsActive, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.Id = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!booking || !booking.IsActive || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(booking.Status)) {
        throw Object.assign(new Error("The booking is no longer active"), { status: 409 });
      }
      const locked = (await tx.request().input("id", sql.Int, agreementId).input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT ag.AgreementNo, ag.Status, ag.SentToCustomerAt, ag.SeniorApprovalStatus, ag.CustomerApprovalStatus, ag.BookingId
        FROM dbo.CrmAgreement ag WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE ag.Id = @id AND ag.BookingId = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!locked || !locked.SentToCustomerAt || [CrmStatus.CANCELLED, CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(locked.Status)
        || locked.SeniorApprovalStatus !== CrmStatus.APPROVED || locked.CustomerApprovalStatus !== CrmStatus.APPROVED) {
        throw Object.assign(new Error("The Agreement is no longer eligible for a customer date proposal"), { status: 409 });
      }
      notificationRow = { ...booking, AgreementNo: locked.AgreementNo, BookingId: locked.BookingId };
      await proposeAgreementDate(tx, agreementId, "Customer", proposedDate, null);
      await logCommunication(tx, {
        bookingId: locked.BookingId, direction: "Inbound",
        subject: `Customer proposed a date — ${proposedDate}`,
        summary: `${locked.AgreementNo}: ${booking.ApplicantName} proposed ${proposedDate}.`,
      });
      await tx.commit();
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }

    if (notificationRow?.AssignedTo) {
      try {
        await emitNotification(pool, notificationRow.AssignedTo,
          "crm_agreement_customer_proposed_date", "Customer Proposed an Agreement Date",
          `${notificationRow.ApplicantName} proposed ${proposedDate} for ${notificationRow.AgreementNo} (${notificationRow.BookingNo}) — review and confirm or revise.`,
          agreementId, "crm_agreement");
      } catch (notifyErr) { console.error("[crm-portal] Agreement date notification failed:", notifyErr.message); }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/propose-date error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /agreement/date/accept — requires ?applicationId=. Customer accepts
// the company's currently-proposed date as-is, without re-typing it. Moves
// the negotiation to 'Matched' and opens the super_admin sign-off gate —
// same as a same-date match did under the old two-column design.
router.post("/agreement/date/accept", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const ag = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT ag.Id, ag.CustomerApprovalStatus, ag.AgreementNo, ag.BookingId, ag.ProposedDate, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND ag.Status <> 'Cancelled'
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "No agreement found" });
    const agreementRow = ag.recordset[0];
    if (agreementRow.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Approve the agreement's content before responding to a proposed date" });
    }
    const agreementId = agreementRow.Id;

    // acceptAgreementDate does 2 writes (Agreement status update + approval
    // log insert) plus the comm log here — same atomicity concern as
    // propose-date above.
    const tx = pool.transaction();
    await tx.begin();
    let notificationRow;
    try {
      const booking = (await tx.request().input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT b.Status, b.IsActive, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmBooking b WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.Id = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!booking || !booking.IsActive || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(booking.Status)) {
        throw Object.assign(new Error("The booking is no longer active"), { status: 409 });
      }
      const locked = (await tx.request().input("id", sql.Int, agreementId).input("bid", sql.Int, agreementRow.BookingId).input("aid", sql.Int, appId).query(`
        SELECT ag.AgreementNo, ag.ProposedDate, ag.Status, ag.SentToCustomerAt, ag.SeniorApprovalStatus,
          ag.CustomerApprovalStatus, ag.BookingId
        FROM dbo.CrmAgreement ag WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE ag.Id = @id AND ag.BookingId = @bid AND b.ApplicationId = @aid
      `)).recordset[0];
      if (!locked || !locked.SentToCustomerAt || [CrmStatus.CANCELLED, CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(locked.Status)
        || locked.SeniorApprovalStatus !== CrmStatus.APPROVED || locked.CustomerApprovalStatus !== CrmStatus.APPROVED) {
        throw Object.assign(new Error("The Agreement is no longer eligible for date acceptance"), { status: 409 });
      }
      notificationRow = { ...booking, AgreementNo: locked.AgreementNo, ProposedDate: locked.ProposedDate, BookingId: locked.BookingId };
      await acceptAgreementDate(tx, agreementId, "Customer");
      await logCommunication(tx, {
        bookingId: locked.BookingId, direction: "Inbound",
        subject: "Customer accepted the proposed date — sent for approval",
        summary: `${locked.AgreementNo}: ${booking.ApplicantName} accepted ${String(locked.ProposedDate).slice(0, 10)}, sent for super admin sign-off.`,
      });
      await tx.commit();
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }

    if (notificationRow?.AssignedTo) {
      try {
        await emitNotification(pool, notificationRow.AssignedTo,
          "crm_agreement_date_pending_approval", "Agreement Date Awaiting Approval",
          `${notificationRow.ApplicantName} accepted our proposed date for ${notificationRow.AgreementNo} (${notificationRow.BookingNo}) — awaiting super admin sign-off.`,
          agreementId, "crm_agreement");
      } catch (notifyErr) { console.error("[crm-portal] Agreement date notification failed:", notifyErr.message); }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /agreement/date/accept error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /sales-deed — returns the sale deed sent to this customer (must be
// sent: SentToCustomerAt IS NOT NULL) along with its uploaded documents.
// Customer can only see documents that have a file — the 'Requested' placeholder
// rows are internal prep state and not surfaced here.
router.get("/sales-deed", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const deed = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.DeedNo, d.BookingId, d.DeedValue, d.StampDuty, d.RegistrationFee,
             d.StampDutyCredit, d.SubRegistrarOffice, d.DeedDate, d.Status,
             d.CustomerApprovalStatus, d.CustomerApprovedAt, d.CustomerRecheckRemarks,
             d.SentToCustomerAt, d.CreatedAt,
             b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      WHERE b.ApplicationId = @aid AND d.SentToCustomerAt IS NOT NULL
        AND ISNULL(d.Status, '') <> 'Cancelled'   -- the live deed, never a cancelled one (redo)
      ORDER BY d.Id DESC
    `);
    if (!deed.recordset.length) return res.json({ deed: null, documents: [] });

    const deedRow = deed.recordset[0];
    const docs = await pool.request().input("did", sql.Int, deedRow.Id).query(`
      SELECT Id, DocumentType, Label, FileName, MimeType, FileSize, UploadedAt, Status, VersionNo,
             CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS HasFile
      FROM dbo.CrmSalesDeedDocument
      WHERE SalesDeedId = @did AND FileBase64 IS NOT NULL
      ORDER BY CreatedAt
    `);
    res.json({ deed: deedRow, documents: docs.recordset });
  } catch (e) {
    console.error("[crm-portal] GET /sales-deed error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /sales-deed/documents/:docId/download — serves a deed document file to
// the customer (inline preview / download). Only returns the file if it
// belongs to a deed that was sent to this customer's application.
router.get("/sales-deed/documents/:docId/download", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const docId = parseId(req.params.docId);
    if (docId === null) return res.status(400).json({ error: "Invalid docId" });

    const result = await pool.request()
      .input("docId", sql.Int, docId)
      .input("aid", sql.Int, appId)
      .query(`
        SELECT doc.FileName, doc.FileBase64, doc.MimeType
        FROM dbo.CrmSalesDeedDocument doc
        JOIN dbo.CrmSalesDeed d ON d.Id = doc.SalesDeedId
        JOIN dbo.CrmBooking b ON b.Id = d.BookingId
        WHERE doc.Id = @docId
          AND b.ApplicationId = @aid
          AND d.SentToCustomerAt IS NOT NULL
          AND doc.FileBase64 IS NOT NULL
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "Document not found or not accessible" });
    const doc = result.recordset[0];
    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "deed-document"}"`);
    res.send(Buffer.from(doc.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-portal] GET /sales-deed/documents/:docId/download error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /sales-deed/respond — requires ?applicationId=
router.post("/sales-deed/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, remarks } = req.body;
    if (!["Approve", "Recheck"].includes(decision)) return res.status(400).json({ error: "decision must be Approve or Recheck" });
    if (decision === "Recheck" && !String(remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required when requesting a recheck" });
    }

    const deed = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT d.Id, d.CustomerApprovalStatus, d.DeedNo, d.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND d.SentToCustomerAt IS NOT NULL
        AND ISNULL(d.Status, '') <> 'Cancelled'   -- the live deed, never a cancelled one (redo)
      ORDER BY d.Id DESC
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "No sales deed pending your response" });
    if (deed.recordset[0].CustomerApprovalStatus === CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Sales deed has already been approved" });
    }
    const deedRow = deed.recordset[0];

    // Customer-initiated, legally meaningful state change spanning the deed
    // status, the communication log, and the approval-log timeline — wrapped
    // so a dropped connection mid-sequence can never leave the deed's
    // approval status out of sync with its own audit trail. Notification
    // stays outside the tx (pure websocket, no DB write).
    const tx = pool.transaction();
    await tx.begin();
    try {
      if (decision === "Approve") {
        await tx.request()
          .input("id", sql.Int, deedRow.Id)
          .query(`
            UPDATE dbo.CrmSalesDeed SET
              CustomerApprovalStatus = '${CrmStatus.APPROVED}',
              CustomerApprovedAt = SYSDATETIME(),
              CustomerRecheckRemarks = NULL,
              DirectorApprovalStatus = '${CrmStatus.PENDING}'
            WHERE Id = @id
          `);
      } else {
        await tx.request()
          .input("id", sql.Int, deedRow.Id)
          .input("rem", sql.NVarChar(sql.MAX), remarks)
          .query(`
            UPDATE dbo.CrmSalesDeed SET
              CustomerApprovalStatus = 'RecheckRequested',
              CustomerApprovedAt = NULL,
              CustomerRecheckRemarks = @rem
            WHERE Id = @id
          `);
      }

      await logCommunication(tx, {
        bookingId: deedRow.BookingId, direction: "Inbound",
        subject: decision === "Approve" ? "Customer approved the sales deed" : "Customer requested a recheck on sales deed",
        summary: decision === "Approve"
          ? `${deedRow.ApplicantName} approved ${deedRow.DeedNo}.`
          : `${deedRow.ApplicantName} requested a recheck on ${deedRow.DeedNo}: ${remarks}`,
      });

      // Record in the deed-specific approval audit log for the UI timeline.
      // Kept best-effort (caught, not rethrown) exactly as before — an older
      // install missing this table shouldn't block the deed's own status
      // update — but on the same tx so a genuine deadlock/connection-loss
      // here still rolls back cleanly instead of a partial commit.
      try {
        await tx.request()
          .input("did", sql.Int, deedRow.Id)
          .input("act", sql.NVarChar(40), decision === "Approve" ? "CustomerApprove" : "CustomerRecheck")
          .input("rem", sql.NVarChar(sql.MAX), remarks || null)
          .query(`INSERT INTO dbo.CrmSalesDeedApprovalLog (SalesDeedId, Action, Remarks, ActorType, CreatedAt)
                  VALUES (@did, @act, @rem, 'Customer', SYSDATETIME())`);
      } catch (_) { /* non-fatal — table may not exist on older installs */ }

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    if (deedRow.AssignedTo) {
      await emitNotification(pool, deedRow.AssignedTo,
        decision === "Approve" ? "crm_sales_deed_customer_approved" : "crm_sales_deed_recheck_requested",
        decision === "Approve" ? "Sales Deed Approved by Customer" : "Sales Deed Recheck Requested",
        decision === "Approve"
          ? `${deedRow.ApplicantName} approved sale deed ${deedRow.DeedNo} (${deedRow.BookingNo}).`
          : `${deedRow.ApplicantName} requested a recheck on sale deed ${deedRow.DeedNo} (${deedRow.BookingNo}): ${remarks}`,
        deedRow.Id, "crm_sales_deed");
    }

    res.json({ success: true });

  } catch (e) {
    console.error("[crm-portal] POST /sales-deed/respond error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /possession-notice/:noticeId/pdf - the letter, once sent, for THIS customer's own booking only.
router.get("/possession-notice/:noticeId/pdf", pdfRateLimiter, async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const noticeId = parseId(req.params.noticeId);
    if (noticeId === null) return res.status(400).json({ error: "Invalid noticeId" });
    const row = await pool.request().input("nid", sql.Int, noticeId).input("aid", sql.Int, appId).query(`
      SELECT n.Id FROM dbo.CrmPossessionNotice n JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      WHERE n.Id = @nid AND b.ApplicationId = @aid AND n.Status <> 'Draft'`);
    if (!row.recordset.length) return res.status(404).json({ error: "Possession notice not found" });
    const letter = await getPossessionLetterBuffer(pool, noticeId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${letter.noticeNo}.pdf"`);
    res.send(letter.buffer);
  } catch (e) {
    console.error("[crm-portal] GET /possession-notice/:noticeId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /possession-notice/respond — requires ?applicationId=
router.post("/possession-notice/respond", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { decision, reason } = req.body;
    if (!["Acknowledge", "Dispute"].includes(decision)) return res.status(400).json({ error: "decision must be Acknowledge or Dispute" });
    if (decision === "Dispute" && !String(reason || "").trim()) {
      return res.status(400).json({ error: "A reason is required to dispute the possession notice" });
    }

    const notice = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT n.Id, n.Status, n.NoticeNo, n.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmPossessionNotice n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid AND n.Status <> 'Draft'
      ORDER BY n.CreatedAt DESC
    `);
    if (!notice.recordset.length) return res.status(404).json({ error: "No possession notice found" });
    const row = notice.recordset[0];
    if (row.Status !== "Sent") {
      return res.status(400).json({ error: `Cannot respond to a notice in status '${row.Status}'` });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("id", sql.Int, row.Id).input("reason", sql.NVarChar(sql.MAX), reason || null).query(
        decision === "Acknowledge"
          ? "UPDATE dbo.CrmPossessionNotice SET Status = 'Acknowledged', AcknowledgedAt = SYSDATETIME() WHERE Id = @id"
          : "UPDATE dbo.CrmPossessionNotice SET Status = 'Disputed', DisputedAt = SYSDATETIME(), DisputeReason = @reason WHERE Id = @id"
      );

      await logCommunication(tx, {
        bookingId: row.BookingId, direction: "Inbound",
        subject: decision === "Acknowledge" ? "Customer acknowledged possession notice" : "Customer disputed possession notice",
        summary: decision === "Acknowledge"
          ? `${row.ApplicantName} acknowledged ${row.NoticeNo}.`
          : `${row.ApplicantName} disputed ${row.NoticeNo}: ${reason}`,
      });

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo,
        decision === "Acknowledge" ? "crm_possession_notice_acknowledged" : "crm_possession_notice_disputed",
        decision === "Acknowledge" ? "Possession Notice Acknowledged" : "Possession Notice Disputed",
        decision === "Acknowledge"
          ? `${row.ApplicantName} acknowledged ${row.NoticeNo} (${row.BookingNo}).`
          : `${row.ApplicantName} disputed ${row.NoticeNo} (${row.BookingNo}): ${reason}`,
        row.Id, "crm_possession_notice");
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /possession-notice/respond error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── Query Payment ──────────────────────────────────────────────────────────
// The customer's own government payment (stamp duty + registration fee, paid
// directly to the Sub-Registrar Office, never to the company — see
// crmQueryPayment.js). The customer needs to: see the amount + paperwork
// staff sent them, and upload their own proof of payment once they've paid.
// Staff still does the actual "Confirm" step (crmQueryPayment.js POST
// /:id/confirm) — this only gets the proof in front of them.
const QP_MAX_FILE_BYTES = 4 * 1024 * 1024;

// GET /query-payment/attachments — requires ?applicationId=
router.get("/query-payment/attachments", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    // Same "not visible until staff actually sent it" gate every other
    // pre-approval portal surface (agreement, sales deed) already enforces —
    // a CrmQueryPayment row can exist internally before staff opens this
    // step to the customer, and InfoSentAt is what marks that moment.
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT att.AttachmentId, att.DocType, att.FileName, att.MimeType, att.FileSize, att.UploadedAt
      FROM dbo.CrmQueryPaymentAttachments att
      JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      WHERE b.ApplicationId = @aid AND qp.InfoSentAt IS NOT NULL
      ORDER BY att.UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /query-payment/attachments error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /query-payment/attachment/:attachId/file — requires ?applicationId=
router.get("/query-payment/attachment/:attachId/file", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const attachId = parseId(req.params.attachId);
    if (attachId === null) return res.status(400).json({ error: "Invalid attachId" });
    const result = await pool.request().input("aid", sql.Int, appId).input("said", sql.Int, attachId).query(`
      SELECT att.FileName, att.MimeType, att.FileData
      FROM dbo.CrmQueryPaymentAttachments att
      JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      WHERE b.ApplicationId = @aid AND att.AttachmentId = @said
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    const att = result.recordset[0];
    res.setHeader("Content-Type", att.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.FileName)}"`);
    res.send(att.FileData);
  } catch (e) {
    console.error("[crm-portal] GET /query-payment/attachment/:id/file error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /query-payment/proof — requires ?applicationId=. Base64 JSON body
// (same convention as the staff-side route), decoded back into the exact
// bytes stored in the existing VARBINARY(MAX) column. Never flips Status —
// only staff confirming (crmQueryPayment.js) does that, since they're the
// ones who can actually verify the government received the payment.
router.post("/query-payment/proof", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { fileName, mimeType, base64 } = req.body || {};
    if (!fileName || !base64) return res.status(400).json({ error: "fileName and base64 are required" });
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "File is empty" });
    if (buffer.length > QP_MAX_FILE_BYTES) {
      return res.status(400).json({ error: `File is too large (max ${(QP_MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB)` });
    }
    // A customer upload is opened later by staff: only real PDFs / images,
    // whose content matches the declared type (it was stored and served back
    // with whatever type the browser claimed, e.g. a web page).
    const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!PROOF_TYPES.includes(mimeType)) return res.status(400).json({ error: "Upload the proof as a PDF or an image (JPG, PNG, WebP)" });
    const sigErr = verifyFileMatchesDeclaredType({ buffer, mimetype: mimeType });
    if (sigErr) return res.status(400).json({ error: sigErr });

    const qp = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT qp.Id, qp.QPNo, qp.Status, qp.BookingId, qp.InfoSentAt, b.AssignedTo, b.BookingNo, a.ApplicantName
      FROM dbo.CrmQueryPayment qp
      JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.ApplicationId = @aid
    `);
    if (!qp.recordset.length) return res.status(404).json({ error: "No government payment tracker found for this booking" });
    if (!qp.recordset[0].InfoSentAt) return res.status(400).json({ error: "This step hasn't been sent to you yet" });
    const row = qp.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed — no further proof needed" });

    await pool.request()
      .input("qpid", sql.Int, row.Id)
      .input("dtype", sql.NVarChar(20), "Proof")
      .input("fname", sql.NVarChar(255), fileName)
      .input("mtype", sql.NVarChar(100), mimeType || "application/octet-stream")
      .input("fsize", sql.Int, buffer.length)
      .input("fdata", sql.VarBinary(sql.MAX), buffer)
      .query(`
        INSERT INTO dbo.CrmQueryPaymentAttachments (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData)
        VALUES (@qpid, @dtype, @fname, @mtype, @fsize, @fdata)
      `);

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "crm_query_payment_proof_uploaded", "Payment Proof Uploaded by Customer",
        `${row.ApplicantName} uploaded proof of government payment for ${row.QPNo} (${row.BookingNo}) — review and confirm.`,
        row.Id, "crm_query_payment");
    }
    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: "Customer uploaded government payment proof",
      summary: `${row.ApplicantName} uploaded proof of payment for ${row.QPNo} — awaiting staff confirmation.`,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] POST /query-payment/proof error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /tickets — requires ?applicationId=
router.get("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const result = await pool.request().input("aid", sql.Int, appId).query(`
      SELECT t.Id, t.TicketNo, t.Category, t.Priority, t.Subject, t.Description,
             t.Status, t.ResolvedAt, t.ResolutionNotes, t.CustomerRating, t.CustomerFeedback,
             t.RaisedByCustomer, t.CreatedAt, t.SlaDueDate
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE b.ApplicationId = @aid AND b.IsActive = 1 AND b.Status <> 'Cancelled'
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-portal] GET /tickets error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /tickets — requires ?applicationId=
router.post("/tickets", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { category, subject, description } = req.body;
    if (!CUSTOMER_TICKET_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CUSTOMER_TICKET_CATEGORIES.join(", ")}` });
    }
    if (!String(subject || "").trim()) return res.status(400).json({ error: "subject is required" });

    const booking = await pool.request().input("aid", sql.Int, appId)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1 AND Status <> 'Cancelled' ORDER BY CreatedAt DESC");
    if (!booking.recordset.length) return res.status(400).json({ error: "No active booking found for this application" });
    const bookingId = booking.recordset[0].Id;

    const ticketNo = await getNextDocNumber(pool, "SVC", "SVC");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30), ticketNo)
      .input("bid",  sql.Int, bookingId)
      .input("cat",  sql.NVarChar(50), category)
      .input("subj", sql.NVarChar(300), subject.trim())
      .input("desc", sql.NVarChar(sql.MAX), description || null)
      .input("sla",  sql.DateTime2(3), new Date(Date.now() + TICKET_SLA_HOURS * 3600 * 1000))
      .query(`
        INSERT INTO dbo.CrmServiceTicket
          (TicketNo, BookingId, Category, Priority, Subject, Description, Status, SlaDueDate, RaisedByCustomer, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cat, 'Normal', @subj, @desc, 'Open', @sla, 1, SYSDATETIME())
      `);

    const bk = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT AssignedTo, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
    if (bk.recordset[0]?.AssignedTo) {
      await emitNotification(pool, bk.recordset[0].AssignedTo, "service_ticket_raised_by_customer",
        "Customer Raised a Ticket", `${ticketNo}: ${subject.trim()} (${bk.recordset[0].BookingNo})`,
        result.recordset[0].Id, "service_ticket");
    }
    await logCommunication(pool, {
      bookingId, direction: "Inbound",
      subject: `Support ticket raised — ${subject.trim()}`,
      summary: `${ticketNo} (${category}): ${description || subject.trim()}`,
    });

    res.status(201).json({ success: true, id: result.recordset[0].Id, TicketNo: ticketNo });
  } catch (e) {
    console.error("[crm-portal] POST /tickets error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /tickets/:ticketId/feedback — the customer rates how a resolved request was handled (1–5, optional comment).
// Only on their own request, once it is Resolved or Closed; it can be changed. Staff still close it (crmServiceTickets
// /:id/close keeps a rating already given — ISNULL(@rate, CustomerRating)).
router.put("/tickets/:ticketId/feedback", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const ticketId = parseId(req.params.ticketId);
    if (ticketId === null) return res.status(400).json({ error: "Invalid request" });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Choose a rating from 1 to 5" });
    const feedback = String(req.body?.feedback || "").trim() || null;
    const t = (await pool.request().input("id", sql.Int, ticketId).input("aid", sql.Int, appId).query(`
      SELECT t.Id, t.Status, t.TicketNo, t.Subject, t.BookingId FROM dbo.CrmServiceTicket t JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE t.Id = @id AND b.ApplicationId = @aid`)).recordset[0];
    if (!t) return res.status(404).json({ error: "Request not found" });
    if (![CrmStatus.RESOLVED, CrmStatus.CLOSED].includes(t.Status)) return res.status(400).json({ error: "You can rate a request once it is resolved" });
    await pool.request().input("id", sql.Int, ticketId).input("rate", sql.Int, rating).input("fb", sql.NVarChar(sql.MAX), feedback)
      .query("UPDATE dbo.CrmServiceTicket SET CustomerRating = @rate, CustomerFeedback = @fb, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await logCommunication(pool, {
      bookingId: t.BookingId, direction: "Inbound",
      subject: `Support request rated — ${t.TicketNo}`,
      summary: `${rating}/5${feedback ? `: ${feedback}` : ""} (${t.Subject})`,
    });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-portal] PUT /tickets/:ticketId/feedback error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /tickets/:ticketId/reopen — the customer says a resolved request isn't fixed: it reopens with their reason
// (the same rule staff use, crmServiceTickets reopenTicket) and the person handling it is told.
router.put("/tickets/:ticketId/reopen", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const ticketId = parseId(req.params.ticketId);
    if (ticketId === null) return res.status(400).json({ error: "Invalid request" });
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Tell us what is still wrong" });
    const t = (await pool.request().input("id", sql.Int, ticketId).input("aid", sql.Int, appId).query(`
      SELECT t.Id, t.TicketNo, t.Subject, t.BookingId, t.AssignedTo, b.AssignedTo AS BookingOwner, b.BookingNo
      FROM dbo.CrmServiceTicket t JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      WHERE t.Id = @id AND b.ApplicationId = @aid`)).recordset[0];
    if (!t) return res.status(404).json({ error: "Request not found" });
    const err = await require("./crmServiceTickets").reopenTicket(pool, ticketId, `Reopened by the customer: ${reason}`, null);
    if (err) return res.status(400).json({ error: err });
    const notifyTo = t.AssignedTo || t.BookingOwner;
    if (notifyTo) {
      await emitNotification(pool, notifyTo, "service_ticket_reopened_by_customer", "Customer Reopened a Ticket",
        `${t.TicketNo}: ${t.Subject} (${t.BookingNo}) — ${reason}`, ticketId, "service_ticket");
    }
    await logCommunication(pool, { bookingId: t.BookingId, direction: "Inbound", subject: `Support request reopened — ${t.TicketNo}`, summary: reason });
    res.json({ success: true, status: "Reopened" });
  } catch (e) {
    console.error("[crm-portal] PUT /tickets/:ticketId/reopen error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /site-photos/:photoId — one site photo, only if it is of the customer's own unit or shared work on their
// tower / project (crmConstructionUpdates buyerPhotoFile holds the rule).
router.get("/site-photos/:photoId", photoRateLimiter, async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const photoId = parseId(req.params.photoId);
    if (photoId === null) return res.status(400).json({ error: "Invalid photo" });
    const t = await loadTimeline(pool, appId, { lite: true });
    if (!t.booking?.ProjectId) return res.status(404).json({ error: "Photo not found" });
    const f = await require("./crmConstructionUpdates").buyerPhotoFile(pool, photoId,
      { projectId: t.booking.ProjectId, blockId: t.booking.BlockId, unitId: t.booking.UnitId });
    if (!f) return res.status(404).json({ error: "Photo not found" });
    res.setHeader("Content-Type", f.MimeType || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Content-Disposition", `inline; filename="${String(f.FileName || "site-photo.jpg").replace(/"/g, "")}"`);
    res.send(Buffer.isBuffer(f.FileData) ? f.FileData : Buffer.from(String(f.FileData || ""), "base64"));
  } catch (e) {
    console.error("[crm-portal] GET /site-photos/:photoId error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Only these CrmAgreementApprovalLog actions are safe to show a customer —
// everything else (SeniorApprove/SeniorReject, internal review) is staff-only.
const CUSTOMER_VISIBLE_LOG_ACTIONS = [
  "SendToCustomer", "CustomerApprove", "CustomerRecheck",
  "AgreementDateSubmittedForApproval", "AgreementDateConfirmed", "AgreementDateRejected",
];

// GET /activity — chronological feed for one application. Requires ?applicationId=
// ─── Maintenance & electricity bills — the customer's own (read-only) ────────
// The same queries as the staff Maintenance screens (maintenanceBill.js LIST_SELECT, electricityMaintenance.js
// BILL_SELECT), limited to bills billed to this application: a bill raised before a resale stays the old owner's
// (BillToApplicationId, migration 563). Electricity bills show once staff have verified them.
router.get("/maintenance-bills", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { LIST_SELECT } = require("./maintenanceBill");
    const bills = (await pool.request().input("aid", sql.Int, appId)
      .query(`${LIST_SELECT} WHERE a.Id = @aid AND b.Status <> N'Cancelled' ORDER BY b.BillDate DESC, b.Id DESC`)).recordset;
    res.json(bills);
  } catch (e) {
    console.error("[crm-portal] GET /maintenance-bills error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

router.get("/maintenance-bills/:billId", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const billId = parseId(req.params.billId);
    if (billId === null) return res.status(400).json({ error: "Invalid bill" });
    const { LIST_SELECT } = require("./maintenanceBill");
    const bill = (await pool.request().input("aid", sql.Int, appId).input("id", sql.Int, billId)
      .query(`${LIST_SELECT} WHERE a.Id = @aid AND b.Id = @id AND b.Status <> N'Cancelled'`)).recordset[0];
    if (!bill) return res.status(404).json({ error: "Bill not found" });
    const items = (await pool.request().input("id", sql.Int, billId).query(`
      SELECT Id, ChargeHeadName, HsnCode, Rate, TaxPct, TaxAmount, TotalAmount FROM dbo.MaintenanceBillItem WHERE BillId = @id ORDER BY Id`)).recordset;
    res.json({ ...bill, items });
  } catch (e) {
    console.error("[crm-portal] GET /maintenance-bills/:billId error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

router.get("/electricity-bills", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;
    const { BILL_SELECT } = require("./electricityMaintenance");
    const bills = (await pool.request().input("aid", sql.Int, appId)
      .query(`${BILL_SELECT} WHERE capp.Id = @aid AND b.BillStatus IN (N'Verified', N'AddedToCustomerBill')
              ORDER BY b.BillingPeriodTo DESC, b.Id DESC`)).recordset;
    res.json(bills);
  } catch (e) {
    console.error("[crm-portal] GET /electricity-bills error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

router.get("/activity", async (req, res) => {
  try {
    const pool = getPool();
    const appId = await resolveAndAssertApplication(pool, req, res);
    if (appId === null) return;

    const [agreementLog, payments, documents, tickets, salesDeed, queryPayment, qpProofs, registry, nocs, agreementState] = await Promise.all([
      pool.request().input("aid", sql.Int, appId)
        .query(`
          SELECT l.Action, l.Remarks, l.CreatedAt, ag.AgreementNo
          FROM dbo.CrmAgreementApprovalLog l
          JOIN dbo.CrmAgreement ag ON ag.Id = l.AgreementId
          JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
          WHERE b.ApplicationId = @aid
            AND l.Action IN (${CUSTOMER_VISIBLE_LOG_ACTIONS.map((a) => `'${a}'`).join(",")})
          ORDER BY l.CreatedAt DESC
        `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT r.Amount, r.ReceivedDate, r.PaymentMode, r.CreatedAt, m.MilestoneName
        FROM dbo.CrmPaymentReceipt r
        JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
        JOIN dbo.CrmBooking b ON b.Id = m.BookingId
        WHERE b.ApplicationId = @aid
        ORDER BY r.CreatedAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT d.DocumentType, d.Label, d.Status, d.Remarks, d.UploadedAt, ISNULL(d.UploadedAt, d.CreatedAt) AS EventAt
        FROM dbo.CrmAgreementDocument d
        JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE b.ApplicationId = @aid AND d.Status IN ('Verified', '${CrmStatus.REJECTED}', 'Submitted')
        ORDER BY EventAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT t.TicketNo, t.Subject, t.Status, t.ResolvedAt, t.CreatedAt
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        WHERE b.ApplicationId = @aid
        ORDER BY t.CreatedAt DESC
      `),
      // Sales Deed has no dedicated approval-log table like Agreement does —
      // its own timestamp columns (SentToCustomerAt/CustomerApprovedAt/
      // UpdatedAt) are the only record of when each customer-facing event
      // actually happened, so those are what the feed reads.
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT sd.DeedNo, sd.SentToCustomerAt, sd.CustomerApprovalStatus, sd.CustomerApprovedAt, sd.CustomerRecheckRemarks, sd.UpdatedAt
        FROM dbo.CrmSalesDeed sd
        JOIN dbo.CrmBooking b ON b.Id = sd.BookingId
        WHERE b.ApplicationId = @aid AND ISNULL(sd.Status, '') <> 'Cancelled'
        ORDER BY sd.Id DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT qp.Id, qp.QPNo, qp.InfoSentAt, qp.ConfirmedAt, qp.ConfirmedAmount
        FROM dbo.CrmQueryPayment qp
        JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
        WHERE b.ApplicationId = @aid
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT att.FileName, att.UploadedAt
        FROM dbo.CrmQueryPaymentAttachments att
        JOIN dbo.CrmQueryPayment qp ON qp.Id = att.QueryPaymentId
        JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
        WHERE b.ApplicationId = @aid AND att.DocType = 'Proof'
        ORDER BY att.UploadedAt DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT reg.RegNo, reg.Status, reg.ScheduledDate, reg.CompletedDate, reg.UpdatedAt
        FROM dbo.CrmRegistry reg
        JOIN dbo.CrmBooking b ON b.Id = reg.BookingId
        WHERE b.ApplicationId = @aid AND ISNULL(reg.Status, '') <> 'Cancelled'
        ORDER BY reg.Id DESC
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT n.NocType, n.NocNo, n.IssuedDate
        FROM dbo.CrmNoc n
        JOIN dbo.CrmBooking b ON b.Id = n.BookingId
        WHERE b.ApplicationId = @aid AND n.IssuedDate IS NOT NULL
      `),
      pool.request().input("aid", sql.Int, appId).query(`
        SELECT TOP 1 ag.AgreementNo, ag.Status, ag.AgreementDate, ag.AfsRegistrationNo, ag.AfsRegistrationDate, ag.UpdatedAt
        FROM dbo.CrmAgreement ag JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        WHERE b.ApplicationId = @aid AND ag.SentToCustomerAt IS NOT NULL AND ag.Status <> 'Cancelled'
        ORDER BY ag.Id DESC
      `),
    ]);

    const feed = [];
    const AGREEMENT_LOG_LABELS = {
      SendToCustomer: (r) => ({ title: "Agreement shared with you", detail: r.AgreementNo }),
      CustomerApprove: (r) => ({ title: "You approved the agreement", detail: r.AgreementNo }),
      CustomerRecheck: (r) => ({ title: "You requested a recheck", detail: r.Remarks || r.AgreementNo }),
      AgreementDateSubmittedForApproval: (r) => ({ title: "Agreement date matched — sent for approval", detail: r.AgreementNo }),
      AgreementDateConfirmed: (r) => ({ title: "Agreement date confirmed", detail: r.AgreementNo }),
      AgreementDateRejected: (r) => ({ title: "Proposed date was not accepted", detail: r.Remarks || r.AgreementNo }),
    };
    for (const r of agreementLog.recordset) {
      const fn = AGREEMENT_LOG_LABELS[r.Action];
      if (!fn) continue;
      const { title, detail } = fn(r);
      feed.push({ type: "agreement", title, detail, at: r.CreatedAt });
    }
    // Signed and registered have no customer-facing log row — read from the agreement itself, so an agreement that
    // reached them before this existed shows them too. Signing is on the agreed date; registration on its own date.
    const agS = agreementState.recordset[0];
    // Those dates carry no time (midnight). When the agreement was last updated that same day, that is when it was
    // recorded — use it, so the event sorts after what happened earlier that day, not under it.
    const sameDay = (d, t) => d && t && day(d) === day(t);
    const when = (d, t) => (sameDay(d, t) ? new Date(t) : d || t);
    if (agS && [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(agS.Status)) {
      const at = when(agS.AgreementDate, agS.UpdatedAt);
      // Signed comes just before registered when both were recorded at the same moment.
      feed.push({ type: "agreement", title: "Agreement signed", detail: agS.AgreementNo, at: at instanceof Date ? new Date(at.getTime() - 1000) : at });
    }
    if (agS && agS.Status === CrmStatus.REGISTERED) {
      feed.push({ type: "agreement", title: "Agreement registered", detail: [agS.AgreementNo, agS.AfsRegistrationNo ? `Reg. no. ${agS.AfsRegistrationNo}` : null].filter(Boolean).join(" · "),
        at: when(agS.AfsRegistrationDate, agS.UpdatedAt) });
    }
    for (const r of payments.recordset) {
      feed.push({ type: "payment", title: `Payment received — ${r.MilestoneName}`, detail: `₹${Number(r.Amount).toLocaleString("en-IN")}${r.PaymentMode ? ` via ${r.PaymentMode}` : ""}`, at: r.CreatedAt });
    }
    for (const r of documents.recordset) {
      const label = r.Label || r.DocumentType?.replace(/([A-Z])/g, " $1").trim();
      feed.push({
        type: "document",
        title: r.Status === "Verified" ? `Document verified — ${label}` : r.Status === CrmStatus.REJECTED ? `Document returned — ${label}` : `Document submitted — ${label}`,
        detail: r.Status === CrmStatus.REJECTED ? r.Remarks : null,
        at: r.EventAt,
      });
    }
    for (const r of tickets.recordset) {
      feed.push({ type: "ticket", title: `Ticket raised — ${r.Subject}`, detail: r.TicketNo, at: r.CreatedAt });
      if (r.ResolvedAt) {
        feed.push({ type: "ticket", title: `Ticket resolved — ${r.Subject}`, detail: r.TicketNo, at: r.ResolvedAt });
      }
    }

    // Sales Deed — same "agreement" bucket as the Agreement events above,
    // since they live on the same portal page and represent the same kind
    // of customer decision.
    const sd = salesDeed.recordset[0];
    if (sd) {
      if (sd.SentToCustomerAt) feed.push({ type: "agreement", title: "Sales deed shared with you", detail: sd.DeedNo, at: sd.SentToCustomerAt });
      if (sd.CustomerApprovedAt) feed.push({ type: "agreement", title: "You approved the sales deed", detail: sd.DeedNo, at: sd.CustomerApprovedAt });
      else if (sd.CustomerApprovalStatus === "RecheckRequested") feed.push({ type: "agreement", title: "You requested a recheck on the sales deed", detail: sd.CustomerRecheckRemarks || sd.DeedNo, at: sd.UpdatedAt });
    }

    // Query Payment, Registry, NOC — grouped under "legal" (the same journey
    // shown on the Agreement page's Government Payment/Registry/NOC cards),
    // distinct from the "agreement" bucket above.
    const qp = queryPayment.recordset[0];
    if (qp) {
      if (qp.InfoSentAt) feed.push({ type: "legal", title: "Government payment details sent to you", detail: qp.QPNo, at: qp.InfoSentAt });
      if (qp.ConfirmedAt) feed.push({ type: "legal", title: "Government payment confirmed", detail: qp.ConfirmedAmount ? `₹${Number(qp.ConfirmedAmount).toLocaleString("en-IN")}` : qp.QPNo, at: qp.ConfirmedAt });
    }
    for (const r of qpProofs.recordset) {
      feed.push({ type: "legal", title: "You uploaded proof of payment", detail: r.FileName, at: r.UploadedAt });
    }
    const reg = registry.recordset[0];
    if (reg) {
      if (reg.ScheduledDate) feed.push({ type: "legal", title: "Registry appointment scheduled", detail: `${reg.RegNo} · ${new Date(reg.ScheduledDate).toLocaleDateString("en-IN")}`, at: reg.ScheduledDate });
      if (reg.CompletedDate) feed.push({ type: "legal", title: "Registry completed", detail: reg.RegNo, at: reg.CompletedDate });
    }
    for (const r of nocs.recordset) {
      feed.push({ type: "legal", title: `${r.NocType} NOC issued`, detail: r.NocNo, at: r.IssuedDate });
    }

    feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(feed);
  } catch (e) {
    console.error("[crm-portal] GET /activity error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ─── Transfer deeds (a resale / buy-back the customer is a party to) ────────
// A deed belongs to people, not to one application: the SELLER (whose booking
// is passing on) and, for a resale, the BUYER (who may own nothing yet). The
// customer sees every live deed they are a party to and does their own part:
// approve the draft or ask for a recheck, agree the signing date, upload their
// papers and — when it is theirs to pay — the stamp-duty challan. Staff can do
// any of it for them (proxy) from Transfer Deeds; the rules are the same
// (services/crmTransferDeed.js), and each answer is recorded as theirs.
const deedSvc = require("../services/crmTransferDeed");
/** The deed and this customer's side of it — 404 when they aren't a party. */
async function portalDeed(pool, req) {
  const id = parseId(req.params.deedId);
  if (id === null) { const e = new Error("Invalid deed"); e.status = 400; throw e; }
  const st = await deedSvc.deedState(pool, id).catch(() => null);
  const cid = Number(req.portalUser.customerId);
  const role = !st ? null : Number(st.deed.SellerCustomerId) === cid ? "Seller"
    : st.deed.DeedType === "Assignment" && Number(st.deed.BuyerCustomerId) === cid ? "Buyer" : null;
  if (!st || !role || st.deed.Status === "Cancelled") { const e = new Error("Deed not found"); e.status = 404; throw e; }
  return { st, role, id };
}
/** What a party sees: the draft, the registered copy and their own papers — nobody else's remarks. */
function portalView(st, role) {
  const d = st.deed;
  const mine = (x) => x.Party === role || x.DocumentType === "DeedDraft" || x.DocumentType === "RegisteredDeed";
  const pay = st.payment;
  const payer = !!pay && (pay.PayableBy === role || pay.PayableBy === "Shared");
  // What is waiting on this customer right now (the portal's menu badge).
  const papersOpen = ["Draft", "UnderReview"].includes(d.Status);
  const papers = st.documents.filter((x) => x.Party === role && papersOpen && ["Requested", "Rejected"].includes(x.Status));
  const approve = d.Status === "WithParties" && d[`${role}Approval`] === "Pending";
  const date = d.Status === "PartiesApproved" && (!d.ProposedDate || !d[`${role}DateAccepted`]);
  const duty = payer && pay.Status === "InfoSent";
  const todo = papers.length + [approve, date, duty].filter(Boolean).length;
  // The same items in the customer's words, for the mobile app's "Please do this next".
  const asks = [
    papers.length ? `Upload ${papers.length === 1 ? "1 document" : `${papers.length} documents`}: ${papers.map((x) => x.Label || x.DocumentType).join(", ")}` : null,
    approve ? "Read the deed draft and approve it" : null,
    date ? (d.ProposedDate ? "Accept the proposed signing date or suggest another" : "Suggest a date to sign the deed") : null,
    duty ? "Pay the stamp duty and upload the payment proof" : null,
  ].filter(Boolean);
  return {
    role,
    todo,
    asks,
    deed: {
      Id: d.Id, DeedNo: d.DeedNo, DeedType: d.DeedType, Property: d.Property, BookingNo: d.BookingNo, Status: d.Status, StatusLabel: d.StatusLabel,
      SellerName: d.SellerName, BuyerName: d.DeedType === "Assignment" ? d.BuyerName : null, VersionNo: d.VersionNo,
      MyApproval: d[`${role}Approval`], MyDateAccepted: !!d[`${role}DateAccepted`],
      ProposedDate: d.ProposedDate, ProposedBy: d.ProposedBy, DateApprovalStatus: d.DateApprovalStatus, DeedDate: d.DeedDate, ExecutedAt: d.ExecutedAt,
    },
    parties: st.parties,
    approvals: Object.fromEntries(st.parties.map((p) => [p, d[`${p}Approval`]])),
    dateAccepted: Object.fromEntries(st.parties.map((p) => [p, !!d[`${p}DateAccepted`]])),
    documents: st.documents.filter(mine).map((x) => ({
      Id: x.Id, DocumentType: x.DocumentType, Label: x.Label, Party: x.Party, Status: x.Status, HasFile: !!x.FileName,
      Remarks: x.Party === role ? x.Remarks : null,
    })),
    payment: pay ? {
      StampDuty: pay.StampDuty, RegistrationFee: pay.RegistrationFee, PayableBy: pay.PayableBy, Status: pay.Status, PaidRef: pay.PaidRef,
      AmountPaid: pay.AmountPaid, ConfirmRemarks: payer ? pay.ConfirmRemarks : null, IAmPayer: payer,
    } : null,
    registry: st.registry ? { Office: st.registry.Office, ScheduledAt: st.registry.ScheduledAt, Attendees: st.registry.Attendees, RegNo: st.registry.RegNo, Status: st.registry.Status } : null,
    steps: st.steps.map((s) => ({ key: s.key, label: s.label, ok: s.ok, state: s.state })),
  };
}
const portalCtx = (req) => ({ actorType: "Portal", customerId: Number(req.portalUser.customerId) });
const deedFail = (res, e, where) => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(`[crm-portal] ${where}:`, e.message);
  res.status(500).json({ error: "An internal error occurred. Please try again later." });
};
const deedAction = (fn, where) => async (req, res) => {
  try {
    const pool = getPool();
    const { id, role } = await portalDeed(pool, req);
    await fn(pool, id, role, req);
    res.json(portalView(await deedSvc.deedState(pool, id), role));
  } catch (e) { deedFail(res, e, where); }
};
const deedUpload = (fn, where) => (req, res) => portalDocUpload.single("file")(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message });
  if (!req.file) return res.status(400).json({ error: "Choose a file" });
  // same content check as the agreement upload: the file must really be what it claims
  const sigErr = verifyFileMatchesDeclaredType(req.file);
  if (sigErr) return res.status(400).json({ error: sigErr });
  return deedAction(fn, where)(req, res);
});

/** Every live transfer deed the customer is a party to, each as their side sees it (portalView). */
async function loadTransferDeeds(pool, cid) {
    const rows = (await pool.request().input("c", sql.Int, cid).query(`
      SELECT d.Id FROM dbo.CrmTransferDeed d JOIN dbo.CrmUnitResale r ON r.Id = d.ResaleId
      WHERE d.IsActive = 1 AND d.Status <> N'Cancelled'
        AND (r.FromCustomerId = @c OR (d.DeedType = N'Assignment' AND r.ToCustomerId = @c))
      ORDER BY d.CreatedAt DESC`)).recordset;
    const out = [];
    for (const r of rows) {
      const st = await deedSvc.deedState(pool, r.Id);
      out.push(portalView(st, Number(st.deed.SellerCustomerId) === cid ? "Seller" : "Buyer"));
    }
    return out;
}
router.get("/transfer-deeds", async (req, res) => {
  try {
    res.json(await loadTransferDeeds(getPool(), Number(req.portalUser.customerId)));
  } catch (e) { deedFail(res, e, "GET /transfer-deeds"); }
});

// ─── What is waiting on the customer — the ONE set of rules ─────────────────
// The web portal's "Needs Your Action" and the mobile app's "Up next" both read this; neither keeps its own copy.
// Each item: kind (what it is), label + sub (the customer's words), target (which page takes the action:
// documents | payments | construction | transferDeed), urgent (blocks progress), applicationId (whose it is).
const { inr, day } = require("../services/pushNotifications");
function needsYou({ applicationId, timeline: t, agreement, documents, deeds }) {
  const out = [];
  const add = (kind, label, sub, target, urgent = false) => out.push({ applicationId, kind, label, sub, target, urgent });
  if (agreement?.SentToCustomerAt && agreement.CustomerApprovalStatus === "Pending") {
    add("agreementReview", "Your agreement is waiting for your review", `${agreement.AgreementNo || ""} — approve or request a recheck`, "documents");
  }
  const mandatory = (documents || []).filter((d) => (d.Status === "Requested" || d.Status === CrmStatus.REJECTED) && d.IsMandatory);
  if (mandatory.length) {
    add("documentsNeeded", `${mandatory.length} required document${mandatory.length > 1 ? "s" : ""} needed`, mandatory.map((d) => d.Label || d.DocumentType).join(", "), "documents", true);
  }
  if (agreement?.CustomerApprovalStatus === CrmStatus.APPROVED && !agreement.AgreementDate && agreement.DateApprovalStatus !== "Pending"
      && agreement.ProposedDateStatus !== "PendingCompanyReview") {
    const ours = agreement.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW;
    add("agreementDate", ours ? "Respond to our proposed agreement date" : "Propose an agreement date",
      ours ? `We proposed ${day(agreement.ProposedDate)} — accept or suggest another` : "Suggest a date that works for you", "documents");
  }
  if (t?.salesDeed?.SentToCustomerAt && t.salesDeed.CustomerApprovalStatus === "Pending") {
    add("salesDeedReview", "Your sales deed is waiting for your review", "Approve or request a recheck", "documents");
  }
  if (t?.queryPayment?.Status === "InfoSent") {
    add("govtPaymentProof", "Government payment proof needed", `${inr(t.queryPayment.RequiredAmount)} — upload your proof once paid`, "documents", true);
  }
  if (t?.possessionNotice?.Status === "Sent") {
    add("possessionNotice", `Possession Notice — ${t.possessionNotice.NoticeNo}`,
      t.possessionNotice.ResponseDeadline ? `Respond by ${day(t.possessionNotice.ResponseDeadline)}` : "Acknowledge or dispute", "construction");
  }
  for (const v of deeds || []) {
    if (v.todo > 0) {
      add("transferDeed", `Your transfer deed for ${v.deed.Property} needs you`,
        v.asks?.length ? v.asks.join(". ") : `${v.deed.DeedNo} — ${v.steps.find((x) => x.state === "current")?.label || v.deed.StatusLabel}`, "transferDeed");
    }
  }
  // Due = not covered by money already paid and not being verified (loadTimeline's money stages — never Status alone,
  // which stays 'Pending' while paid money is held On Account).
  const next = (t?.paymentMilestones || []).find((m) => m.Status !== "Waived" && !m.Covered && !m.Verifying && m.Outstanding > 0);
  if (next) add("paymentDue", `${next.MilestoneName} payment is due`, `${inr(next.Outstanding)}${next.DueDate ? ` · Due ${day(next.DueDate)}` : ""}`, "payments");
  return out;
}

/** What needs the customer on one application they are the main applicant on (a co-applicant takes no actions). */
async function needsYouFor(pool, app, deeds) {
  if (app.IsCoApplicant || app.Lifecycle === "Past") return [];
  const [timeline, agreement, documents] = await Promise.all([
    loadTimeline(pool, app.ApplicationId, { lite: true }), loadAgreement(pool, app.ApplicationId), loadAgreementDocuments(pool, app.ApplicationId),
  ]);
  // A transfer deed belongs to people, not an application: it shows against the booking it transfers.
  const mine = (deeds || []).filter((v) => app.BookingNo && v.deed.BookingNo === app.BookingNo);
  return needsYou({ applicationId: app.ApplicationId, timeline, agreement, documents, deeds: mine });
}

// GET /needs-you            — everything waiting on the customer, across all their homes (deeds not tied to a home
//                             of theirs, e.g. a buyer's, come last with applicationId null).
// GET /needs-you?applicationId=… — just that property's.
router.get("/needs-you", async (req, res) => {
  try {
    const pool = getPool();
    const cid = Number(req.portalUser.customerId);
    if (req.query.applicationId != null) {
      const appId = await resolveAndAssertApplication(pool, req, res);
      if (appId === null) return;
    }
    const [apps, deeds] = await Promise.all([loadApplications(pool, cid), loadTransferDeeds(pool, cid)]);
    const wanted = req.query.applicationId != null ? apps.filter((a) => a.ApplicationId === Number(req.query.applicationId)) : apps;
    const items = (await Promise.all(wanted.map((a) => needsYouFor(pool, a, deeds)))).flat();
    if (req.query.applicationId == null) {
      // Deeds already shown against one of their live homes are not repeated.
      const placed = new Set(apps.filter((a) => !a.IsCoApplicant && a.Lifecycle !== "Past").map((a) => a.BookingNo).filter(Boolean));
      items.push(...needsYou({ applicationId: null, deeds: deeds.filter((v) => !placed.has(v.deed.BookingNo)) }));
    }
    res.json({ items });
  } catch (e) {
    console.error("[crm-portal] GET /needs-you error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

router.get("/transfer-deeds/:deedId/documents/:docId/file", async (req, res) => {
  try {
    const pool = getPool();
    const { st, role, id } = await portalDeed(pool, req);
    const doc = st.documents.find((x) => x.Id === Number(req.params.docId));
    if (!doc || !(doc.Party === role || ["DeedDraft", "RegisteredDeed"].includes(doc.DocumentType))) return res.status(404).json({ error: "Document not found" });
    const f = await deedSvc.documentFile(pool, id, doc.Id);
    if (!f?.FileBase64) return res.status(404).json({ error: "No file yet" });
    res.setHeader("Content-Type", f.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.FileName || "document")}"`);
    res.send(Buffer.from(f.FileBase64, "base64"));
  } catch (e) { deedFail(res, e, "GET deed file"); }
});
router.post("/transfer-deeds/:deedId/documents/:docId/upload",
  deedUpload((pool, id, _role, req) => deedSvc.uploadDocument(pool, id, Number(req.params.docId), req.file, portalCtx(req)), "POST deed upload"));
router.put("/transfer-deeds/:deedId/respond",
  deedAction((pool, id, role, req) => deedSvc.partyRespond(pool, id, role, req.body?.decision, { ...portalCtx(req), remarks: req.body?.remarks || null }), "PUT deed respond"));
router.put("/transfer-deeds/:deedId/date/propose",
  deedAction((pool, id, role, req) => deedSvc.proposeDate(pool, id, role, req.body?.Date, portalCtx(req), null), "PUT deed propose date"));
router.put("/transfer-deeds/:deedId/date/accept",
  deedAction((pool, id, role, req) => deedSvc.acceptDate(pool, id, role, portalCtx(req), null), "PUT deed accept date"));
router.post("/transfer-deeds/:deedId/duty/proof",
  deedUpload((pool, id, _role, req) => deedSvc.uploadDutyProof(pool, id, req.file, req.body || {}, portalCtx(req)), "POST deed duty proof"));

// ─── GST documents for money given back (refund voucher / credit note) ──────
// The customer's own, for every booking they were the customer on.
router.get("/gst-notes", async (req, res) => {
  try {
    const rows = await require("../services/crmGstNotes").list(getPool(), { customerId: Number(req.portalUser.customerId), includeCancelled: false });
    res.json(rows.map((n) => ({
      Id: n.Id, DocNo: n.DocNo, DocType: n.DocType, Status: n.Status, DocDate: n.DocDate, RefundNo: n.RefundNo, Property: n.Property, BookingNo: n.BookingNo,
      AgainstRef: n.AgainstRef, TaxableValue: n.TaxableValue, GstRate: n.GstRate, GstAmount: n.GstAmount, TotalAmount: n.TotalAmount,
    })));
  } catch (e) {
    console.error("[crm-portal] GET /gst-notes:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});
router.get("/gst-notes/:noteId/pdf", async (req, res) => {
  const id = parseId(req.params.noteId);
  if (id === null) return res.status(400).json({ error: "Invalid document" });
  try {
    const gst = require("../services/crmGstNotes");
    const n = await gst.load(getPool(), id);
    if (!n || n.Status === "Cancelled" || Number(n.CustomerId) !== Number(req.portalUser.customerId)) return res.status(404).json({ error: "Document not found" });
    const buf = await gst.renderPdf(n);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${n.DocNo || `GST-certificate-${n.RefundNo}`}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error("[crm-portal] GET gst-note pdf:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
