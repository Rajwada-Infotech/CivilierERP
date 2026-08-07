const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { convertLead } = require("../services/saHandoff");
const { applyLeadScope, actorId, isSaAdmin } = require("../services/saAccess");
const { getIo } = require("../socket");
const crypto = require("crypto");

// Insert notification row and emit to the user's personal socket room.
async function emitNotification(pool, userId, type, title, body, refId) {
  try {
    const result = await pool.request()
      .input("UserId",  sql.Int,           userId)
      .input("Type",    sql.NVarChar(50),  type)
      .input("Title",   sql.NVarChar(200), title)
      .input("Body",    sql.NVarChar(500), body || null)
      .input("RefId",   sql.Int,           refId || null)
      .input("RefType", sql.NVarChar(50),  refId ? "lead" : null)
      .query(`
        INSERT INTO dbo.SaNotification (UserId, Type, Title, Body, RefId, RefType)
        OUTPUT INSERTED.Id, INSERTED.UserId, INSERTED.Type, INSERTED.Title,
               INSERTED.Body, INSERTED.RefId, INSERTED.RefType, INSERTED.IsRead, INSERTED.CreatedAt
        VALUES (@UserId, @Type, @Title, @Body, @RefId, @RefType)
      `);
    const notif = result.recordset[0];
    try {
      getIo().to(`user:${userId}`).emit("sa:notification", {
        id: notif.Id,
        userId: notif.UserId,
        type: notif.Type,
        title: notif.Title,
        body: notif.Body,
        refId: notif.RefId,
        refType: notif.RefType,
        isRead: false,
        createdAt: notif.CreatedAt,
      });
    } catch { /* socket may not be initialised in tests */ }
  } catch (e) {
    console.error("[sa-leads] emitNotification error:", e.message);
  }
}

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

function genUid() {
  return "LEAD-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

const { validateSourceChain } = require("../services/sourceChain");

// GET / — list all leads (row-level scoped)
router.get("/", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope = applyLeadScope(req0, req, "l");
    const conds = [scope];
    if (req.query.status) { req0.input("st", sql.NVarChar(30), req.query.status); conds.push("l.Status = @st"); }
    const where = conds.join(" AND ");
    const result = await req0.query(`
      SELECT
        l.Id, l.LeadUid, l.CustomerName, l.Mobile, l.AltMobile, l.Email,
        l.DateGenerated, l.Status, l.Classification, l.CustomerRemarks,
        l.AssignedTeamLeadId, l.AssignedSalespersonId,
        l.FollowupCustomerId, l.BookingId, l.CrmApplicationId, l.CrmBookingId, l.IsActive, l.CreatedAt,
        l.PlatformId, l.CampaignId, l.AdId,
        l.ExternalLeadId, l.LeadFormName, l.SourceCampaignName, l.SourceAdName,
        l.SourcePlacement, l.LeadCaptureUrl, l.UtmSource, l.UtmMedium,
        l.UtmCampaign, l.UtmContent, l.UtmTerm, l.CapturedAt, l.SourcePayload,
        -- CRM preference fields
        l.SourceType, l.ChannelPartnerId, l.BudgetMin, l.BudgetMax,
        l.PropertyType, l.BhkPreference, l.PreferredLocation, l.PurchaseTimeline,
        l.LastActivityAt,
        cp.Name AS ChannelPartnerName,
        p.Name AS PlatformName,
        c.Name AS CampaignName,
        a.Name AS AdName,
        tl.name AS TeamLeadName,
        sp.name AS SalespersonName,
        -- Computed lead score (0–100)
        (
          CASE l.Classification WHEN 'Hot' THEN 30 WHEN 'Warm' THEN 20 WHEN 'Cold' THEN 5 ELSE 0 END +
          CASE l.Status
            WHEN 'VisitScheduled' THEN 20 WHEN 'Visited' THEN 20 WHEN 'Converted' THEN 20
            WHEN 'FollowUp' THEN 20 WHEN 'Booking' THEN 30
            WHEN 'Contacted' THEN 10 WHEN 'Assigned' THEN 5 ELSE 0 END +
          CASE WHEN l.PurchaseTimeline IN ('Immediate','3Months') THEN 15 ELSE 0 END +
          CASE WHEN l.BudgetMax IS NOT NULL THEN 10 ELSE 0 END +
          CASE WHEN l.LastActivityAt >= DATEADD(DAY, -7, SYSDATETIME()) THEN 15 ELSE 0 END
        ) AS LeadScore
      FROM dbo.SaLead l
      LEFT JOIN dbo.SaSocialMediaPlatform p  ON l.PlatformId      = p.Id
      LEFT JOIN dbo.SaCampaign c             ON l.CampaignId      = c.Id
      LEFT JOIN dbo.SaAd a                   ON l.AdId            = a.Id
      LEFT JOIN dbo.Users tl                 ON l.AssignedTeamLeadId   = tl.id
      LEFT JOIN dbo.Users sp                 ON l.AssignedSalespersonId = sp.id
      LEFT JOIN dbo.SaChannelPartner cp      ON l.ChannelPartnerId = cp.Id
      WHERE l.IsActive = 1 AND ${where}
      ORDER BY l.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-leads] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /users — dropdown for assigning leads (SA roles only)
router.get("/users", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS Id, u.name AS Name, ro.RName AS role
      FROM dbo.Users u
      JOIN dbo.Role ro ON ro.RId = u.RoleId
      WHERE u.discontinue = 0
        AND ro.RName IN ('super_admin','admin','dba','marketing_head','sales_team_lead','sales_person')
      ORDER BY u.name
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-leads] GET /users error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create lead
// Manual entry (this endpoint) previously had no dedup check at all — only
// the ad-platform import path (saAds.js POST /:id/import-leads) checked for
// existing leads, and even that was scoped per-ad so the same phone number
// still created a new row per different ad/campaign. A phone number is
// meant to be the effective key against duplicates system-wide, so this
// checks across ALL active leads regardless of source, and points the
// caller at the existing lead instead of silently creating a twin record.
router.post("/", requirePageRight("sa-leads", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const uid = genUid();
    const sourceError = await validateSourceChain(pool, b);
    if (sourceError) return res.status(400).json({ error: sourceError });

    if (b.Mobile) {
      const dup = await pool.request().input("mob", sql.NVarChar(20), b.Mobile)
        .query("SELECT TOP 1 Id, LeadUid, CustomerName, Status FROM dbo.SaLead WHERE Mobile = @mob AND IsActive = 1 ORDER BY CreatedAt DESC");
      if (dup.recordset.length) {
        return res.status(409).json({
          error: `A lead with this mobile number already exists: ${dup.recordset[0].LeadUid} (${dup.recordset[0].CustomerName || "no name"}, ${dup.recordset[0].Status})`,
          existingLeadId: dup.recordset[0].Id,
        });
      }
    }

    await pool.request()
      .input("uid", sql.NVarChar(50), uid)
      .input("cn", sql.NVarChar(200), b.CustomerName || null)
      .input("mob", sql.NVarChar(20), b.Mobile || null)
      .input("alt", sql.NVarChar(20), b.AltMobile || null)
      .input("em", sql.NVarChar(200), b.Email || null)
      .input("pid", sql.Int, b.PlatformId || null)
      .input("cid", sql.Int, b.CampaignId || null)
      .input("aid", sql.Int, b.AdId || null)
      .input("dg", sql.Date, b.DateGenerated || null)
      .input("rem", sql.NVarChar(sql.MAX), b.CustomerRemarks || null)
      .input("st", sql.NVarChar(30), b.Status || "New")
      .input("cl", sql.NVarChar(30), b.Classification || null)
      .input("tl", sql.Int, b.AssignedTeamLeadId || null)
      .input("sp", sql.Int, b.AssignedSalespersonId || null)
      .input("srcType", sql.NVarChar(30), b.SourceType || null)
      .input("cpid", sql.Int, b.ChannelPartnerId || null)
      .input("bmin", sql.Decimal(18, 2), b.BudgetMin != null && b.BudgetMin !== "" ? parseFloat(b.BudgetMin) : null)
      .input("bmax", sql.Decimal(18, 2), b.BudgetMax != null && b.BudgetMax !== "" ? parseFloat(b.BudgetMax) : null)
      .input("ptype", sql.NVarChar(50), b.PropertyType || null)
      .input("bhk", sql.NVarChar(30), b.BhkPreference || null)
      .input("loc", sql.NVarChar(200), b.PreferredLocation || null)
      .input("timeline", sql.NVarChar(30), b.PurchaseTimeline || null)
      .input("externalLeadId", sql.NVarChar(200), b.ExternalLeadId || null)
      .input("leadFormName", sql.NVarChar(200), b.LeadFormName || null)
      .input("sourceCampaignName", sql.NVarChar(200), b.SourceCampaignName || null)
      .input("sourceAdName", sql.NVarChar(200), b.SourceAdName || null)
      .input("sourcePlacement", sql.NVarChar(200), b.SourcePlacement || null)
      .input("leadCaptureUrl", sql.NVarChar(2000), b.LeadCaptureUrl || null)
      .input("utmSource", sql.NVarChar(100), b.UtmSource || null)
      .input("utmMedium", sql.NVarChar(100), b.UtmMedium || null)
      .input("utmCampaign", sql.NVarChar(200), b.UtmCampaign || null)
      .input("utmContent", sql.NVarChar(200), b.UtmContent || null)
      .input("utmTerm", sql.NVarChar(200), b.UtmTerm || null)
      .input("capturedAt", sql.DateTime2(3), b.CapturedAt || null)
      .input("sourcePayload", sql.NVarChar(sql.MAX), b.SourcePayload ? JSON.stringify(b.SourcePayload) : null)
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.SaLead
          (LeadUid, CustomerName, Mobile, AltMobile, Email, PlatformId, CampaignId, AdId,
           DateGenerated, CustomerRemarks, Status, Classification,
           AssignedTeamLeadId, AssignedSalespersonId,
           SourceType, ChannelPartnerId, BudgetMin, BudgetMax, PropertyType,
           BhkPreference, PreferredLocation, PurchaseTimeline,
           ExternalLeadId, LeadFormName, SourceCampaignName, SourceAdName,
           SourcePlacement, LeadCaptureUrl, UtmSource, UtmMedium, UtmCampaign,
           UtmContent, UtmTerm, CapturedAt, SourcePayload,
           IsActive, CreatedBy, CreatedAt)
        VALUES
          (@uid, @cn, @mob, @alt, @em, @pid, @cid, @aid,
           ISNULL(@dg, CAST(SYSDATETIME() AS DATE)), @rem, @st, @cl,
           @tl, @sp, @srcType, @cpid, @bmin, @bmax, @ptype, @bhk, @loc, @timeline,
           @externalLeadId, @leadFormName, @sourceCampaignName, @sourceAdName,
           @sourcePlacement, @leadCaptureUrl, @utmSource, @utmMedium, @utmCampaign,
           @utmContent, @utmTerm, @capturedAt, @sourcePayload,
           1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, LeadUid: uid });
  } catch (e) {
    console.error("[sa-leads] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Allowed forward transitions per status
const STATUS_TRANSITIONS = {
  New: ["New", "Assigned", "Contacted", "Lost"],
  Assigned: ["Assigned", "Contacted", "Lost"],
  Contacted: ["Contacted", "FollowUp", "VisitScheduled", "Lost"],
  FollowUp: ["FollowUp", "VisitScheduled", "Lost"],
  VisitScheduled: ["VisitScheduled", "Visited", "Lost"],
  Visited: ["Visited", "FollowUp", "Booking", "Lost"],
  Booking: ["Booking"],
  Lost: ["Lost"],
};

// PUT /:id — update lead (with audit trail + notifications)
router.put("/:id", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const leadId = parseInt(req.params.id);
    const actor = actorId(req);

    // Fetch current state for transition validation + audit comparison
    const currentResult = await pool.request()
      .input("id", sql.Int, leadId)
      .query(`
        SELECT LeadUid, Status, Classification, CustomerName, Mobile, AltMobile, Email, DateGenerated,
               AssignedTeamLeadId, AssignedSalespersonId, CustomerRemarks,
               SourceType, ChannelPartnerId, BudgetMin, BudgetMax, PropertyType,
               BhkPreference, PreferredLocation, PurchaseTimeline,
               PlatformId, CampaignId, AdId, ExternalLeadId, LeadFormName,
               SourceCampaignName, SourceAdName, SourcePlacement, LeadCaptureUrl,
               UtmSource, UtmMedium, UtmCampaign, UtmContent, UtmTerm, CapturedAt
        FROM dbo.SaLead WHERE Id = @id AND IsActive = 1
      `);
    if (!currentResult.recordset.length) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const old = currentResult.recordset[0];

    // Scope check — non-admins can only edit leads within their own scope
    if (!isSaAdmin(req)) {
      const scopeReq = pool.request();
      const scope = applyLeadScope(scopeReq, req, "l");
      const scopeCheck = await scopeReq.input("lid", sql.Int, leadId)
        .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
      if (!scopeCheck.recordset.length) return res.status(403).json({ error: "Access denied" });
    }

    // Validate status transition
    if (b.Status && b.Status !== old.Status) {
      const allowed = STATUS_TRANSITIONS[old.Status] || [];
      if (!allowed.includes(b.Status)) {
        return res.status(400).json({ error: `Cannot transition lead from '${old.Status}' to '${b.Status}'` });
      }
    }

    const sourceError = await validateSourceChain(pool, {
      PlatformId: b.PlatformId,
      CampaignId: b.CampaignId,
      AdId: b.AdId,
    });
    if (sourceError) return res.status(400).json({ error: sourceError });

    // Effective values actually being written — @x falls back to the
    // existing column via ISNULL below whenever the caller omits a field,
    // instead of the old behavior of writing a bare NULL over it. The audit
    // trail below compares against these same effective values (not the
    // raw request body), so a partial PUT no longer logs a false "changed
    // to blank" for every field it didn't touch.
    await pool.request()
      .input("id",  sql.Int,           leadId)
      .input("cn",  sql.NVarChar(200), b.CustomerName || null)
      .input("mob", sql.NVarChar(20),  b.Mobile || null)
      .input("alt", sql.NVarChar(20),  b.AltMobile || null)
      .input("em",  sql.NVarChar(200), b.Email || null)
      .input("pid", sql.Int,           b.PlatformId || null)
      .input("cid", sql.Int,           b.CampaignId || null)
      .input("aid", sql.Int,           b.AdId || null)
      .input("dg",  sql.Date,          b.DateGenerated || null)
      .input("rem", sql.NVarChar(sql.MAX), b.CustomerRemarks || null)
      .input("st",  sql.NVarChar(30),  b.Status !== undefined ? b.Status : old.Status)
      .input("cl",  sql.NVarChar(30),  b.Classification || null)
      .input("tl",  sql.Int,           b.AssignedTeamLeadId || null)
      .input("sp",  sql.Int,           b.AssignedSalespersonId || null)
      .input("srcType", sql.NVarChar(30), b.SourceType || null)
      .input("cpid", sql.Int, b.ChannelPartnerId || null)
      .input("bmin", sql.Decimal(18, 2), b.BudgetMin != null && b.BudgetMin !== "" ? parseFloat(b.BudgetMin) : null)
      .input("bmax", sql.Decimal(18, 2), b.BudgetMax != null && b.BudgetMax !== "" ? parseFloat(b.BudgetMax) : null)
      .input("ptype", sql.NVarChar(50), b.PropertyType || null)
      .input("bhk", sql.NVarChar(30), b.BhkPreference || null)
      .input("loc", sql.NVarChar(200), b.PreferredLocation || null)
      .input("timeline", sql.NVarChar(30), b.PurchaseTimeline || null)
      .input("externalLeadId", sql.NVarChar(200), b.ExternalLeadId || null)
      .input("leadFormName", sql.NVarChar(200), b.LeadFormName || null)
      .input("sourceCampaignName", sql.NVarChar(200), b.SourceCampaignName || null)
      .input("sourceAdName", sql.NVarChar(200), b.SourceAdName || null)
      .input("sourcePlacement", sql.NVarChar(200), b.SourcePlacement || null)
      .input("leadCaptureUrl", sql.NVarChar(2000), b.LeadCaptureUrl || null)
      .input("utmSource", sql.NVarChar(100), b.UtmSource || null)
      .input("utmMedium", sql.NVarChar(100), b.UtmMedium || null)
      .input("utmCampaign", sql.NVarChar(200), b.UtmCampaign || null)
      .input("utmContent", sql.NVarChar(200), b.UtmContent || null)
      .input("utmTerm", sql.NVarChar(200), b.UtmTerm || null)
      .input("capturedAt", sql.DateTime2(3), b.CapturedAt || null)
      .input("ub",  sql.Int,           actor)
      .query(`
        UPDATE dbo.SaLead SET
          CustomerName = ISNULL(@cn, CustomerName), Mobile = ISNULL(@mob, Mobile),
          AltMobile = ISNULL(@alt, AltMobile), Email = ISNULL(@em, Email),
          PlatformId = ISNULL(@pid, PlatformId), CampaignId = ISNULL(@cid, CampaignId), AdId = ISNULL(@aid, AdId),
          DateGenerated = ISNULL(@dg, DateGenerated),
          CustomerRemarks = ISNULL(@rem, CustomerRemarks), Status = @st, Classification = ISNULL(@cl, Classification),
          AssignedTeamLeadId = ISNULL(@tl, AssignedTeamLeadId), AssignedSalespersonId = ISNULL(@sp, AssignedSalespersonId),
          SourceType = ISNULL(@srcType, SourceType), ChannelPartnerId = ISNULL(@cpid, ChannelPartnerId),
          BudgetMin = ISNULL(@bmin, BudgetMin), BudgetMax = ISNULL(@bmax, BudgetMax), PropertyType = ISNULL(@ptype, PropertyType),
          BhkPreference = ISNULL(@bhk, BhkPreference), PreferredLocation = ISNULL(@loc, PreferredLocation),
          PurchaseTimeline = ISNULL(@timeline, PurchaseTimeline),
          ExternalLeadId = ISNULL(@externalLeadId, ExternalLeadId), LeadFormName = ISNULL(@leadFormName, LeadFormName),
          SourceCampaignName = ISNULL(@sourceCampaignName, SourceCampaignName), SourceAdName = ISNULL(@sourceAdName, SourceAdName),
          SourcePlacement = ISNULL(@sourcePlacement, SourcePlacement), LeadCaptureUrl = ISNULL(@leadCaptureUrl, LeadCaptureUrl),
          UtmSource = ISNULL(@utmSource, UtmSource), UtmMedium = ISNULL(@utmMedium, UtmMedium), UtmCampaign = ISNULL(@utmCampaign, UtmCampaign),
          UtmContent = ISNULL(@utmContent, UtmContent), UtmTerm = ISNULL(@utmTerm, UtmTerm), CapturedAt = ISNULL(@capturedAt, CapturedAt),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Audit: compare old vs the EFFECTIVE new value (falls back to old when
    // the caller omitted the field) — not the raw request body, which is
    // what previously logged a false "changed to blank" for every field a
    // partial PUT didn't include.
    const eff = (key) => (b[key] !== undefined && b[key] !== null && b[key] !== "" ? b[key] : old[key]);
    const auditFields = [
      { field: "Status",               oldVal: old.Status,               newVal: b.Status !== undefined ? b.Status : old.Status },
      { field: "Classification",       oldVal: old.Classification,       newVal: eff("Classification") },
      { field: "AssignedTeamLeadId",   oldVal: old.AssignedTeamLeadId,   newVal: eff("AssignedTeamLeadId") },
      { field: "AssignedSalespersonId",oldVal: old.AssignedSalespersonId,newVal: eff("AssignedSalespersonId") },
      { field: "CustomerRemarks",      oldVal: old.CustomerRemarks,      newVal: eff("CustomerRemarks") },
      { field: "SourceType",           oldVal: old.SourceType,           newVal: eff("SourceType") },
      { field: "ChannelPartnerId",     oldVal: old.ChannelPartnerId,     newVal: eff("ChannelPartnerId") },
      { field: "BudgetMin",            oldVal: old.BudgetMin,            newVal: eff("BudgetMin") },
      { field: "BudgetMax",            oldVal: old.BudgetMax,            newVal: eff("BudgetMax") },
      { field: "PropertyType",         oldVal: old.PropertyType,         newVal: eff("PropertyType") },
      { field: "BhkPreference",        oldVal: old.BhkPreference,        newVal: eff("BhkPreference") },
      { field: "PreferredLocation",    oldVal: old.PreferredLocation,    newVal: eff("PreferredLocation") },
      { field: "PurchaseTimeline",     oldVal: old.PurchaseTimeline,     newVal: eff("PurchaseTimeline") },
      { field: "PlatformId",           oldVal: old.PlatformId,           newVal: eff("PlatformId") },
      { field: "CampaignId",           oldVal: old.CampaignId,           newVal: eff("CampaignId") },
      { field: "AdId",                 oldVal: old.AdId,                 newVal: eff("AdId") },
      { field: "ExternalLeadId",       oldVal: old.ExternalLeadId,       newVal: eff("ExternalLeadId") },
      { field: "LeadFormName",         oldVal: old.LeadFormName,         newVal: eff("LeadFormName") },
      { field: "SourceCampaignName",   oldVal: old.SourceCampaignName,   newVal: eff("SourceCampaignName") },
      { field: "SourceAdName",         oldVal: old.SourceAdName,         newVal: eff("SourceAdName") },
      { field: "SourcePlacement",      oldVal: old.SourcePlacement,      newVal: eff("SourcePlacement") },
      { field: "LeadCaptureUrl",       oldVal: old.LeadCaptureUrl,       newVal: eff("LeadCaptureUrl") },
      { field: "UtmSource",            oldVal: old.UtmSource,            newVal: eff("UtmSource") },
      { field: "UtmMedium",            oldVal: old.UtmMedium,            newVal: eff("UtmMedium") },
      { field: "UtmCampaign",          oldVal: old.UtmCampaign,          newVal: eff("UtmCampaign") },
      { field: "UtmContent",           oldVal: old.UtmContent,           newVal: eff("UtmContent") },
      { field: "UtmTerm",              oldVal: old.UtmTerm,              newVal: eff("UtmTerm") },
      { field: "CapturedAt",           oldVal: old.CapturedAt,           newVal: eff("CapturedAt") },
    ];
    for (const af of auditFields) {
      const o = af.oldVal == null ? "" : String(af.oldVal);
      const n = af.newVal == null ? "" : String(af.newVal);
      if (o !== n) {
        await pool.request()
          .input("LeadId",   sql.Int,           leadId)
          .input("Field",    sql.NVarChar(50),  af.field)
          .input("OldValue", sql.NVarChar(500), o || null)
          .input("NewValue", sql.NVarChar(500), n || null)
          .input("ChangedBy",sql.Int,           actor)
          .query(`
            INSERT INTO dbo.SaLeadAudit (LeadId, Field, OldValue, NewValue, ChangedBy)
            VALUES (@LeadId, @Field, @OldValue, @NewValue, @ChangedBy)
          `);
      }
    }

    // Notify new TL when AssignedTeamLeadId changes
    const newTl = b.AssignedTeamLeadId ? parseInt(b.AssignedTeamLeadId) : null;
    if (newTl && String(newTl) !== String(old.AssignedTeamLeadId ?? "")) {
      await emitNotification(pool, newTl, "lead_assigned",
        "Lead Assigned to Your Team",
        `Lead ${old.LeadUid} has been assigned to your team.`,
        leadId);
    }

    // Notify new SP when AssignedSalespersonId changes
    const newSp = b.AssignedSalespersonId ? parseInt(b.AssignedSalespersonId) : null;
    if (newSp && String(newSp) !== String(old.AssignedSalespersonId ?? "")) {
      await emitNotification(pool, newSp, "lead_assigned",
        "Lead Assigned to You",
        `Lead ${old.LeadUid} has been assigned to you for follow-up.`,
        leadId);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-leads] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/audit — audit trail for a lead
router.get("/:id/audit", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const leadId = parseInt(req.params.id, 10);
    // Verify caller has scope access to this lead before returning its audit trail
    if (!isSaAdmin(req)) {
      const scopeReq = pool.request();
      const scope = applyLeadScope(scopeReq, req, "l");
      const check = await scopeReq.input("lid", sql.Int, leadId)
        .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
      if (!check.recordset.length) return res.status(403).json({ error: "Access denied" });
    }
    const result = await pool.request()
      .input("id", sql.Int, leadId)
      .query(`
        SELECT a.Id, a.LeadId, a.Field, a.OldValue, a.NewValue,
               a.ChangedAt, u.name AS ChangedByName
        FROM dbo.SaLeadAudit a
        LEFT JOIN dbo.Users u ON u.id = a.ChangedBy
        WHERE a.LeadId = @id
        ORDER BY a.ChangedAt DESC
      `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-leads] GET audit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — soft delete
// A lead/enquiry is a permanent record — editable, never deletable, even by
// admins. Route kept (rather than removed) so any existing caller gets a
// clear, explicit rejection instead of a 404.
router.delete("/:id", requirePageRight("sa-leads", "view"), async (req, res) => {
  res.status(403).json({ error: "Leads cannot be deleted — this is a permanent record. Edit its status/classification instead." });
});

// PUT /:id/convert — marks the lead Converted, putting it in the CRM Leads
// pool. Does NOT create a CrmApplication (see saHandoff.js convertLead) —
// that only happens when CRM staff explicitly pick this lead in the New
// Application flow. Route kept at the old /promote-followup path too
// (below) as a compatibility alias in case anything else still calls it.
router.put("/:id/convert", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const scopeReq = pool.request().input("id", sql.Int, id);
    const scope = applyLeadScope(scopeReq, req, "l");
    const owned = await scopeReq.query(`SELECT Id FROM dbo.SaLead l WHERE l.Id = @id AND (${scope})`);
    if (!owned.recordset.length) return res.status(403).json({ error: "This lead is not assigned to you" });

    const result = await convertLead(pool, id, actorId(req));
    if (result.alreadyConverted) return res.json({ message: "Already converted" });
    res.json({ success: true, message: "Lead converted — now available in the CRM Leads pool" });
  } catch (e) {
    console.error("[sa-leads] convert error:", e.message);
    res.status(500).json({ error: e.message });
  }
});
router.post("/:id/promote-followup", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const scopeReq = pool.request().input("id", sql.Int, id);
    const scope = applyLeadScope(scopeReq, req, "l");
    const owned = await scopeReq.query(`SELECT Id FROM dbo.SaLead l WHERE l.Id = @id AND (${scope})`);
    if (!owned.recordset.length) return res.status(403).json({ error: "This lead is not assigned to you" });

    const result = await convertLead(pool, id, actorId(req));
    if (result.alreadyConverted) return res.json({ message: "Already converted" });
    res.json({ success: true, message: "Lead converted — now available in the CRM Leads pool" });
  } catch (e) {
    console.error("[sa-leads] convert error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
