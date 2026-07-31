const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail, isSuperAdminOnly } = require("../services/saAccess");
const { validateSourceChain } = require("../services/sourceChain");
const { advanceApplicationStatus } = require("../services/crmApplicationWorkflow");
// The generic multi-module approval engine — Submit/Approve/Reject go through
// this so approve/reject is gated to admin/super_admin/dba only (the same
// engine BOQ, Purchase Orders, etc. use), instead of any editor self-approving.
const { transition: approvalTransition } = require("../services/approvalService");
const { createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError, resolveApplicationPaymentPlan } = require("../services/crmEntityCreation");
const { placeHoldIfNeeded, releaseAllHoldsForApplication, findActiveHold, releaseHold } = require("../services/crmHoldService");
const { releaseAllParkingForApplication } = require("../routes/crmParking");

router.use(authMiddleware);
router.use(apiRateLimit);

// Mirrors SaLead.SourceType so source values stay consistent across the
// whole system, not just this module.
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

const APP_SELECT = `
  SELECT
    a.Id, a.ApplicationNo, a.LeadId, a.CustomerId, a.ApplicantName, a.Mobile, a.AltMobile, a.Email,
    a.ProjectId, a.PreferredUnitId, a.CompanyId,
    a.InterestedProject, a.InterestedUnit, a.PropertyType, a.BhkPreference,
    a.Source, a.PlatformId, a.CampaignId, a.AdId, a.ChannelPartnerId,
    a.AssignedTo, a.AssignedBy, a.Status, a.Notes, a.CurrentStep,
    a.RatePerSqFt, a.DateOfApply, a.PaymentPlanId, a.TokenType, a.TokenValue, a.BookingAmount, a.PaymentMode,
    a.ReferredByApplicationId, a.IsActive, a.CreatedAt, a.UpdatedAt,
    a.BrokerId, a.BrokerageRatePercent, a.BrokerageSplitEnabled, brk.LHeadName AS BrokerName,
    u.name  AS AssigneeName,
    ab.name AS AssignedByName,
    cu.name AS CreatedByName,
    pp.PlanName AS PaymentPlanName,
    l.LeadUid, l.Classification AS LeadClassification,
    plat.Name AS PlatformName, camp.Name AS CampaignName, ad.Name AS AdName,
    cp.Name AS ChannelPartnerName,
    ref.ApplicationNo AS ReferredByApplicationNo, ref.ApplicantName AS ReferredByName,
    proj.name AS ProjectMasterName, comp.name AS CompanyName, um.UnitName AS PreferredUnitName, um.BlockId AS BlockId,
    -- The Application's own PropertyType/BhkPreference are free-text intake
    -- fields nothing in the current wizard actually populates (no step asks
    -- for them), so they're blank on every application created here. The
    -- picked Unit already carries this (its own dropdown shows "UnitType ·
    -- AreaSqFt sqft" at pick time — see CrmApplication.tsx step 1) — surface
    -- it here too so the detail dialog's "Type" line isn't permanently "—"
    -- for every application that has a real unit on it.
    um.UnitType AS UnitTypeFromMaster, um.AreaSqFt AS UnitAreaSqFt,
    -- Customer-master fields, auto-fetched here so the Application page
    -- never asks staff to retype what's already on the Customer record.
    cust.CustomerNo, cust.PanNo, cust.Address AS CustomerAddress, cust.City AS CustomerCity,
    cust.State AS CustomerState, cust.Pincode AS CustomerPincode,
    bk.Id AS BookingId, bk.BookingNo, bk.Status AS BookingStatus, bk.UnitNo AS BookingUnitNo,
    bk.ProjectName AS BookingProjectName, bk.TotalValue AS BookingTotalValue, bk.GrandTotal AS BookingGrandTotal, bk.BookingDate,
    -- Stage drives the Converted/In Process/Not Converted split every
    -- Applications view now works from. Converted means a LIVE booking
    -- exists right now (bk.Status NOT IN Cancelled/Rejected) — not merely
    -- that one was created at some point. A booking that later dies no
    -- longer represents a real conversion, so its Application falls back
    -- to NotConverted alongside every other dead-end Application, instead
    -- of permanently masquerading as a successful sale.
    -- This is safe against re-booking the same unit twice: the moment a
    -- Booking is cancelled/rejected, syncApplicationOnBookingTerminal (see
    -- crmApplicationWorkflow.js, called from crmCancellations.js /:id/approve)
    -- force-advances this Application's own Status to match — so it no
    -- longer reads 'Approved' either, which is what actually keeps it out
    -- of the forBooking dropdown below (Stage alone was never the guard
    -- against a second booking; Status is). NOTE: this assumes that sync
    -- has always run — any pre-existing row where a booking died before
    -- that cascade was wired in could still show Status='Approved' with a
    -- dead booking, which this change would make eligible for forBooking
    -- again. Worth a one-time check for Status='Approved' AND
    -- BookingStatus IN ('Cancelled','Rejected') before relying on this.
    CASE
      WHEN bk.Id IS NOT NULL AND bk.Status NOT IN ('Cancelled', 'Rejected') THEN 'Converted'
      WHEN a.Status IN ('Rejected', 'Cancelled') THEN 'NotConverted'
      ELSE 'InProcess'
    END AS Stage,
    -- Distinguishes a bookable application that's actually bookable from one
    -- that isn't, so the frontend can show something other than a "Create
    -- Booking" button that's just going to 409 again for the same reason it
    -- did last time. Computed live against current CrmBooking/CrmInventoryHold
    -- rows (same checks createCrmBookingRecord itself uses) rather than stored
    -- from whatever error the last attempt happened to produce, so it can't go
    -- stale in either direction — it clears itself the moment the conflict
    -- actually resolves (e.g. the other booking gets cancelled). There's no
    -- more Application-approval gate — a Booking is auto-attempted the
    -- moment the Application is submitted (see PUT /:id/submit), so a live
    -- Application (not Rejected/Cancelled/Expired) with no booking yet is
    -- exactly the "auto-create didn't happen, still needs retrying" case,
    -- whatever its Status happens to read.
    CASE
      WHEN a.Status NOT IN ('Rejected', 'Cancelled', 'Expired') AND bk.Id IS NULL AND a.PreferredUnitId IS NOT NULL AND (
        EXISTS (SELECT 1 FROM dbo.CrmBooking ob WHERE ob.UnitId = a.PreferredUnitId AND ob.IsActive = 1 AND ob.Status NOT IN ('Cancelled', 'Rejected') AND ob.ApplicationId <> a.Id)
        OR EXISTS (SELECT 1 FROM dbo.CrmInventoryHold oh WHERE oh.EntityType = 'Unit' AND oh.EntityId = a.PreferredUnitId AND oh.Status = 'Active' AND oh.HoldUntil >= SYSDATETIME() AND oh.ApplicationId <> a.Id)
      ) THEN 1 ELSE 0
    END AS UnitUnavailableForBooking
  FROM dbo.CrmApplication a
  LEFT JOIN dbo.Users u   ON u.id  = a.AssignedTo
  LEFT JOIN dbo.Users ab  ON ab.id = a.AssignedBy
  LEFT JOIN dbo.AccountHeadMaster brk ON brk.LHeadId = a.BrokerId
  LEFT JOIN dbo.Users cu  ON cu.id = a.CreatedBy
  LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = a.PaymentPlanId
  LEFT JOIN dbo.SaLead l  ON l.Id  = a.LeadId
  LEFT JOIN dbo.SaSocialMediaPlatform plat ON plat.Id = a.PlatformId
  LEFT JOIN dbo.SaCampaign camp ON camp.Id = a.CampaignId
  LEFT JOIN dbo.SaAd ad ON ad.Id = a.AdId
  LEFT JOIN dbo.SaChannelPartner cp ON cp.Id = a.ChannelPartnerId
  LEFT JOIN dbo.CrmApplication ref ON ref.Id = a.ReferredByApplicationId
  LEFT JOIN dbo.enterprise proj ON proj.id = a.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.enterprise comp ON comp.id = a.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.UnitMaster um   ON um.Id  = a.PreferredUnitId
  LEFT JOIN dbo.CrmCustomer cust ON cust.Id = a.CustomerId
  OUTER APPLY (
    SELECT TOP 1 Id, BookingNo, Status, UnitNo, ProjectName, TotalValue, GrandTotal, BookingDate
    FROM dbo.CrmBooking
    WHERE ApplicationId = a.Id
    ORDER BY CASE WHEN IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected') THEN 0 ELSE 1 END, CreatedAt DESC
  ) bk
`;

// GET / — all applications. By default, Converted applications (one that
// already has a booking) are excluded — every "select an application"
// dropdown across the CRM (new Booking, Unit/Parking Matrix hold
// assignment, Communication Log) calls this with no params and previously
// kept offering already-converted applications as if they still needed
// booking. The Applications management page itself passes
// ?includeConverted=1 (or an explicit ?stage=/?status=) to see everything,
// which is how its own Converted/In Process/Not Converted tabs work.
//
// ?forBooking=1 — the New Booking dropdown's own dedicated filter (see
// CrmBooking.tsx). "Open for booking" means: not yet Converted (no booking
// exists for it yet — one Application maps to at most one Booking, ever)
// AND not a dead status (Rejected/Cancelled/Expired). There's no more
// admin-approval gate to also check — a Booking is auto-attempted the
// moment the Application is submitted (PUT /:id/submit), so anything
// showing up here at all is either brand new (auto-create hasn't run yet,
// rare) or the retry case (auto-create failed, e.g. a unit-hold conflict).
// This is deliberately independent of the status/stage/includeConverted
// params above so it can't be silently widened by combining with them.
router.get("/", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search, stage, includeConverted, forBooking } = req.query;
    const req0 = pool.request();
    const conds = ["a.IsActive = 1"];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("a.Status = @st"); }
    if (search) {
      req0.input("srch", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @srch OR a.Mobile LIKE @srch OR a.ApplicationNo LIKE @srch)");
    }
    const where = "WHERE " + conds.join(" AND ");
    const result = await req0.query(`${APP_SELECT} ${where} ORDER BY a.CreatedAt DESC`);
    let rows = result.recordset;
    if (forBooking) {
      rows = rows.filter((r) => !["Rejected", "Cancelled", "Expired"].includes(r.Status) && r.Stage !== "Converted");
    } else if (stage) {
      rows = rows.filter((r) => r.Stage === stage);
    } else if (!status && !includeConverted) {
      rows = rows.filter((r) => r.Stage !== "Converted");
    }
    res.json(rows);
  } catch (e) {
    console.error("[crm-applications] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single application with booking summary + status trail
router.get("/:id", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [appRes, bookRes, logRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${APP_SELECT} WHERE a.Id = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.Status, b.BookingDate
        FROM dbo.CrmBooking b WHERE b.ApplicationId = @id AND b.IsActive = 1
      `),
      pool.request().input("id", sql.Int, id).query(`
        SELECT s.*, u.name AS ActorName
        FROM dbo.CrmApplicationStatusLog s
        LEFT JOIN dbo.Users u ON u.id = s.ActorId
        WHERE s.ApplicationId = @id ORDER BY s.CreatedAt DESC
      `),
    ]);
    if (!appRes.recordset[0]) return res.status(404).json({ error: "Application not found" });
    res.json({ application: appRes.recordset[0], bookings: bookRes.recordset, statusLog: logRes.recordset });
  } catch (e) {
    console.error("[crm-applications] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create application (optionally from a lead). createCrmApplicationRecord
// inserts Status = 'Pending' directly — there is no Draft phase for CrmApplication;
// 'Draft' remains in STATUSES/APPLICATION_TRANSITIONS/the frontend's Resume check for
// backward compatibility but nothing in this codebase ever writes it. A unit pick at
// creation is also checked (assertEntityNotTaken + findActiveHold) and hold-placed
// immediately, best-effort — see createCrmApplicationRecord in crmEntityCreation.js.
// Delegates to the shared creation service (backend/services/crmEntityCreation.js)
// — the exact same function backend/services/saHandoff.js calls for the
// Sales Automation -> CRM handoff, so there is one single source of truth
// for what makes a valid CrmApplication.
router.post("/", requirePageRight("crm-applications", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const actor = actorId(req);
    // The human-filed Application form never lets AssignedTo/AssignedBy be
    // picked — the filer becomes the assignee, permanently recorded as the
    // filer too. (saHandoff.js, the other caller of this shared service,
    // passes its own AssignedTo explicitly and is unaffected by this route-
    // level override.)
    const body = { ...req.body, AssignedTo: actor, AssignedBy: actor };
    const { id: applicationId, ApplicationNo: appNo } = await createCrmApplicationRecord(pool, body, actor);
    res.status(201).json({ success: true, id: applicationId, ApplicationNo: appNo });
  } catch (e) {
    if (e instanceof CrmCreationError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-applications] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update application details. Status is never editable here —
// it only ever moves through /submit and /cancel below (or the automated
// AutoBooking transition), so it can't be silently overwritten.
router.put("/:id", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, PreferredUnitId, Status, ProjectId, DepositBankId FROM dbo.CrmApplication WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Application not found" });
    const existingUnitId = existing.recordset[0].PreferredUnitId || null;
    const existingStatus = existing.recordset[0].Status;

    // Company/Project/Unit/Payment Plan can move freely pre-submission (the
    // frontend wizard's own Edit toggle on the Project/Unit tree relies on
    // this) but never after — submitting (PUT /:id/submit) now immediately
    // attempts to create a real Booking off whatever Unit/Plan is on the
    // Application at that moment, so silently repointing PreferredUnitId
    // here afterward would move the deal onto different inventory out from
    // under that Booking. This is the server-side twin of the frontend's
    // canEditUnitSelection check (CrmApplication.tsx) — kept here too since
    // PUT /:id is reachable directly, not only through the wizard UI.
    const changingUnitSelection =
      b.CompanyId !== undefined || b.ProjectId !== undefined ||
      b.PreferredUnitId !== undefined || b.PaymentPlanId !== undefined;
    if (changingUnitSelection && !["Draft", "Pending"].includes(existingStatus)) {
      return res.status(400).json({
        error: `Cannot change the Company/Project/Unit/Payment Plan selection once the application is ${existingStatus} — this is locked after approval.`,
      });
    }

    // Contact identity fields (Mobile/AltMobile/Email) get the same
    // protection Status already had — but tighter, since these are used as
    // the customer portal's own login credentials (email as username,
    // mobile as the initial password) and as the phone number any
    // verification call/SMS goes to. crm-applications:edit is held by
    // admin/dba/marketing_head too (see requirePageRight.js's crm- prefix
    // bypass), which is far too wide a blast radius for a field that can
    // redirect verification contact away from the real customer — so this
    // is a hard super_admin-only gate, not the page-right check above.
    const changingContact = b.Mobile !== undefined || b.AltMobile !== undefined || b.Email !== undefined;
    if (changingContact && !isSuperAdminOnly(req)) {
      return res.status(403).json({ error: "Only a super admin can change contact details (Mobile, Alternate Mobile, or Email)." });
    }

    if (b.Source && !SOURCE_TYPES.includes(b.Source))
      return res.status(400).json({ error: `Invalid Source. Must be one of: ${SOURCE_TYPES.join(", ")}` });

    const platformId = b.PlatformId !== undefined ? (b.PlatformId ? parseInt(b.PlatformId) : null) : undefined;
    const campaignId = b.CampaignId !== undefined ? (b.CampaignId ? parseInt(b.CampaignId) : null) : undefined;
    const adId       = b.AdId       !== undefined ? (b.AdId       ? parseInt(b.AdId)       : null) : undefined;
    if (platformId !== undefined || campaignId !== undefined || adId !== undefined) {
      const sourceError = await validateSourceChain(pool, { PlatformId: platformId, CampaignId: campaignId, AdId: adId });
      if (sourceError) return res.status(400).json({ error: sourceError });
    }

    let projectName = b.InterestedProject || null;
    let companyId = b.CompanyId ? parseInt(b.CompanyId) : null;
    if (b.ProjectId) {
      const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
        .query("SELECT name, company_id FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
      if (!proj.recordset.length) return res.status(400).json({ error: "Selected project does not exist" });
      projectName = proj.recordset[0].name;
      companyId = companyId || proj.recordset[0].company_id || null;
    }
    let unitName = b.InterestedUnit || null;
    if (b.PreferredUnitId) {
      const unit = await pool.request().input("uid", sql.Int, parseInt(b.PreferredUnitId))
        .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1");
      if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
      unitName = unit.recordset[0].UnitName;
    }

    // If the unit pick is actually changing (not just re-sent unchanged), the
    // hold has to move with it — otherwise either the old unit's hold leaks
    // forever, or the newly-picked unit sits completely unprotected the same
    // way units did before creation-time holds existed at all (see
    // createCrmApplicationRecord). Placed BEFORE the main UPDATE below runs,
    // so a conflict on the new unit blocks this edit outright and the
    // Application's PreferredUnitId is never changed to something already
    // taken; the old hold is only released afterward, once the new one is
    // confirmed in place.
    const newUnitId = b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null;
    const unitIsChanging = newUnitId !== null && newUnitId !== existingUnitId;
    if (unitIsChanging) {
      try {
        await placeHoldIfNeeded(pool, {
          entityType: "Unit", entityId: newUnitId, applicationId: id, holdDays: 3,
          reason: "Application unit changed — auto-hold", userId: actor,
        });
      } catch (holdErr) {
        return res.status(holdErr.status || 400).json({ error: holdErr.message });
      }
    }
    // Same resolver used at Application creation (see createCrmApplicationRecord)
    // and Booking creation — validates the picked plan against the unit's
    // CrmUnitPaymentPlan tags and enforces the "2+ tags -> must pick one"
    // rule, instead of the old single DefaultPaymentPlanId fallback.
    const pptouched = (b.PaymentPlanId !== undefined || b.PreferredUnitId !== undefined) ? 1 : 0;
    let effectivePaymentPlanId = null;
    if (pptouched) {
      const effectiveUnitId = b.PreferredUnitId ? parseInt(b.PreferredUnitId) : existingUnitId;
      try {
        effectivePaymentPlanId = await resolveApplicationPaymentPlan(pool, {
          preferredUnitId: effectiveUnitId,
          paymentPlanId: b.PaymentPlanId || null,
        });
      } catch (planErr) {
        return res.status(planErr.status || 400).json({ error: planErr.message });
      }
    }

    // Mandatory-bank rule — same pattern as crmPayments.js's
    // createReceiptForMilestone (the auto-sync's own receipt-write check)
    // and CrmBooking.tsx's client-side check: once a real token amount is
    // on the application and the project has at least one tagged company
    // bank, a DepositBankId must be present (either just supplied, or
    // already saved from an earlier step). Only gated on TokenValue —
    // matches the wizard, which only shows/requires the picker once a
    // token value is actually entered.
    const effectiveTokenValue = b.TokenValue !== undefined ? b.TokenValue : undefined;
    if (effectiveTokenValue !== undefined && effectiveTokenValue !== null && effectiveTokenValue !== "") {
      const effectiveProjectId = b.ProjectId ? parseInt(b.ProjectId) : existing.recordset[0].ProjectId;
      const effectiveDepositBankId = b.DepositBankId !== undefined ? b.DepositBankId : existing.recordset[0].DepositBankId;
      if (effectiveProjectId) {
        const tagged = await pool.request().input("pid", sql.Int, effectiveProjectId)
          .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
        if (tagged.recordset[0].Cnt > 0 && !effectiveDepositBankId) {
          return res.status(400).json({ error: "Deposit bank is required for this project" });
        }
      }
    }

    await pool.request()
      .input("id",   sql.Int,           id)
      .input("name", sql.NVarChar(200), b.ApplicantName || null)
      .input("mob",  sql.NVarChar(20),  b.Mobile || null)
      .input("alt",  sql.NVarChar(20),  b.AltMobile || null)
      .input("em",   sql.NVarChar(200), b.Email || null)
      .input("pid",  sql.Int,           b.ProjectId ? parseInt(b.ProjectId) : null)
      .input("uid",  sql.Int,           b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null)
      .input("cid",  sql.Int,           companyId)
      .input("proj", sql.NVarChar(200), projectName)
      .input("unit", sql.NVarChar(100), unitName)
      .input("pt",   sql.NVarChar(50),  b.PropertyType || null)
      .input("bhk",  sql.NVarChar(30),  b.BhkPreference || null)
      .input("src",  sql.NVarChar(200), b.Source || null)
      .input("platid", sql.Int, platformId ?? null)
      .input("campid", sql.Int, campaignId ?? null)
      .input("adid",   sql.Int, adId ?? null)
      .input("cpid",   sql.Int, b.ChannelPartnerId ? parseInt(b.ChannelPartnerId) : null)
      .input("rate", sql.Decimal(18,2), b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null)
      .input("doa",  sql.Date,          b.DateOfApply || null)
      .input("ppid", sql.Int,           effectivePaymentPlanId)
      .input("pptouched", sql.Bit,      pptouched)
      .input("ttype",sql.NVarChar(20),  b.TokenType || null)
      .input("tval", sql.Decimal(18,2), b.TokenValue != null ? parseFloat(b.TokenValue) : null)
      .input("bamt", sql.Decimal(18,2), b.BookingAmount != null ? parseFloat(b.BookingAmount) : null)
      .input("pmode",sql.NVarChar(50),  b.PaymentMode || null)
      .input("dbid", sql.Int,           b.DepositBankId ? parseInt(b.DepositBankId) : null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,           actor)
      .input("brkid", sql.Int,          b.BrokerId ? parseInt(b.BrokerId) : null)
      .input("brkpct", sql.Decimal(5,2), b.BrokerageRatePercent != null && b.BrokerageRatePercent !== "" ? parseFloat(b.BrokerageRatePercent) : null)
      .input("brksplit", sql.Bit,       b.BrokerageSplitEnabled !== undefined ? (b.BrokerageSplitEnabled ? 1 : 0) : null)
      // Wizard resume progress. Clamped to the 1-6 step range the frontend
      // stepper actually has; CurrentStep only ever moves forward (see the
      // CASE below) — it tracks the furthest point reached, not merely the
      // last one visited, so clicking Back and closing the dialog doesn't
      // erase progress already made.
      .input("cstep", sql.TinyInt,      b.CurrentStep != null && !isNaN(parseInt(b.CurrentStep)) ? Math.min(6, Math.max(1, parseInt(b.CurrentStep))) : null)
      .query(`
        UPDATE dbo.CrmApplication SET
          ApplicantName = ISNULL(@name, ApplicantName),
          Mobile = ISNULL(@mob, Mobile), AltMobile = ISNULL(@alt, AltMobile), Email = ISNULL(@em, Email),
          ProjectId = ISNULL(@pid, ProjectId), PreferredUnitId = ISNULL(@uid, PreferredUnitId),
          CompanyId = ISNULL(@cid, CompanyId),
          InterestedProject = ISNULL(@proj, InterestedProject), InterestedUnit = ISNULL(@unit, InterestedUnit),
          PropertyType = @pt, BhkPreference = @bhk,
          Source = ISNULL(@src, Source),
          PlatformId = ISNULL(@platid, PlatformId), CampaignId = ISNULL(@campid, CampaignId),
          AdId = ISNULL(@adid, AdId), ChannelPartnerId = ISNULL(@cpid, ChannelPartnerId),
          RatePerSqFt = ISNULL(@rate, RatePerSqFt), DateOfApply = ISNULL(@doa, DateOfApply),
          PaymentPlanId = CASE WHEN @pptouched = 1 THEN @ppid ELSE PaymentPlanId END,
          TokenType = ISNULL(@ttype, TokenType),
          TokenValue = ISNULL(@tval, TokenValue), BookingAmount = ISNULL(@bamt, BookingAmount),
          PaymentMode = ISNULL(@pmode, PaymentMode),
          DepositBankId = ISNULL(@dbid, DepositBankId),
          BrokerId = ISNULL(@brkid, BrokerId), BrokerageRatePercent = ISNULL(@brkpct, BrokerageRatePercent),
          BrokerageSplitEnabled = ISNULL(@brksplit, BrokerageSplitEnabled),
          -- AssignedTo/AssignedBy are intentionally never accepted here — set
          -- once at creation (the filer becomes the assignee) and locked;
          -- reassignment goes through the existing lead-transfer flow instead.
          Notes = @note,
          CurrentStep = CASE WHEN @cstep IS NOT NULL AND @cstep > CurrentStep THEN @cstep ELSE CurrentStep END,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    // Now that the new unit's hold is confirmed and the row itself is saved,
    // release whatever hold this same application still has on the OLD unit
    // — findActiveHold + a targeted releaseHold, not
    // releaseAllHoldsForApplication, since that bulk helper would also tear
    // down the new hold just placed above.
    if (unitIsChanging && existingUnitId) {
      try {
        const oldHold = await findActiveHold(pool, "Unit", existingUnitId);
        if (oldHold && oldHold.ApplicationId === id) {
          await releaseHold(pool, oldHold.Id, actor);
        }
      } catch (releaseErr) {
        console.error("[crm-applications] releasing old unit hold on edit failed:", releaseErr.message);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-applications] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending (a real resubmit) via approvalTransition;
// otherwise a no-op. POST / itself already inserts new Applications straight into
// 'Pending' (see createCrmApplicationRecord), so a fresh Application filed through
// the wizard is already "in the queue" by the time staff reach Step 4 — the no-op
// branch below is what actually runs for every normal creation; the Draft->Pending
// transition this route was originally written for is unreachable in practice since
// nothing creates a CrmApplication as Draft anymore.
//
// This is also where the Booking now gets created — there is no separate
// Application-approval step anymore (see crmEntityCreation.js's relaxed
// gate): the moment staff submit the Application, a Booking is created
// straight away if a Unit was picked, and the frontend navigates directly
// to that Booking's page. Booking Approval and Broker Approval are what
// actually go through review from here — both fire off the Booking itself
// (crmBookings.js's ready-for-approval, and crmWorkflowGuards.js's
// maybeAutoCreateBrokerage, triggered inside createCrmBookingRecord's own
// Milestone #1 auto-receipt sync) — never blocks the submit itself if
// booking creation fails (e.g. the unit got taken by someone else in the
// interim); staff can retry via the "Create Booking" button on the
// Applications list, the same fallback path this always had.
router.put("/:id/submit", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const current = await getPool().request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @id");
    const currentStatus = current.recordset[0]?.Status;
    const result = currentStatus === "Pending"
      ? { newStatus: "Pending" }
      : await approvalTransition("crm-applications", id, "Pending", userEmail, req.user?.role);

    // Auto-hold the picked Unit for 72h. createCrmApplicationRecord already
    // attempts this same hold at creation time (Step 1), but that attempt is
    // best-effort/non-blocking there — so this call is the enforced backstop:
    // unlike creation, a real conflict here (holdErr.status set, below) blocks
    // the submit outright instead of letting a second salesperson's application
    // sail into the approval queue unprotected.
    //
    // Parking deliberately gets no separate hold here: unlike a Unit (which
    // is only a soft PreferredUnitId preference until a real Booking exists),
    // crmParking.js's POST /standalone already creates a real, permanent
    // CrmParkingAllotment row the instant a slot is picked during the
    // Attachments step — that row itself is what makes the slot exclusive to
    // this application (assertSlotAvailable blocks anyone else from taking
    // it), so it already shows as "Booked" in the parking matrix, not
    // "OnHold". Placing an additional hold on top would just fail (the slot
    // already reads as "taken") and add nothing.
    const pool = getPool();
    const actor = actorId(req);
    try {
      const app = await pool.request().input("id", sql.Int, id)
        .query("SELECT PreferredUnitId FROM dbo.CrmApplication WHERE Id = @id");
      const unitId = app.recordset[0]?.PreferredUnitId;
      if (unitId) {
        await placeHoldIfNeeded(pool, {
          entityType: "Unit", entityId: unitId, applicationId: id, holdDays: 3,
          reason: "Application submitted — auto-hold", userId: actor,
        });
      }
    } catch (holdErr) {
      // A deliberate business-rule throw (unit already held by another
      // application, unit already booked, project mismatch, etc.) always
      // carries an explicit .status — that's this codebase's own convention
      // (CrmCreationError, and crmHoldService.js's manually-set e.status).
      // Those must block the submit, not be treated as tolerable infra noise
      // — otherwise a second application for the same unit sails into the
      // approval queue with no hold protecting it. Only a truly unexpected
      // error (driver timeout, connection reset — no .status) stays
      // non-blocking, matching the tolerance this comment originally intended.
      if (holdErr.status) {
        console.error("[crm-applications] auto-hold on submit blocked:", holdErr.message);
        return res.status(holdErr.status).json({ error: holdErr.message });
      }
      console.error("[crm-applications] auto-hold on submit failed:", holdErr.message);
    }

    // Auto-create the Booking the moment the Application is submitted — the
    // Application now captures everything a Booking needs (unit, rate,
    // payment plan, token), so there's no separate approval step or manual
    // "convert to booking" step left. Never blocks the submit itself if this
    // fails (e.g. unit got booked by someone else in the interim) — the
    // submit stands either way, and staff can create the booking by hand as
    // a fallback (the "Create Booking" retry button on the Applications
    // list), same tolerance-of-partial-failure pattern used for GL posting.
    let booking = null;
    let bookingError = null;
    const already = await pool.request().input("id", sql.Int, id)
      .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @id AND IsActive = 1");
    if (!already.recordset.length) {
      const app = await pool.request().input("id", sql.Int, id).query(`
        SELECT PreferredUnitId, RatePerSqFt, PaymentPlanId, DateOfApply, TokenType, TokenValue,
               BookingAmount, PaymentMode, AssignedTo, Notes, DepositBankId,
               BrokerId, BrokerageRatePercent, BrokerageSplitEnabled
        FROM dbo.CrmApplication WHERE Id = @id
      `);
      const a = app.recordset[0];
      if (a?.PreferredUnitId) {
        try {
          const created = await createCrmBookingRecord(pool, {
            ApplicationId: id, UnitId: a.PreferredUnitId, RatePerSqFt: a.RatePerSqFt,
            PaymentPlanId: a.PaymentPlanId, BookingDate: a.DateOfApply, TokenType: a.TokenType,
            TokenValue: a.TokenValue, BookingAmount: a.BookingAmount, PaymentMode: a.PaymentMode,
            DepositBankId: a.DepositBankId,
            AssignedTo: a.AssignedTo, Notes: a.Notes,
            BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokerageSplitEnabled: a.BrokerageSplitEnabled,
          }, actor);
          booking = created;
          // Backfilling Application-linked records (parking/bank/documents)
          // onto the new booking, and recomputing ParkingTotal/GrandTotal,
          // now happens inside createCrmBookingRecord itself (see
          // crmEntityCreation.js) — that's the single shared place every
          // caller of it goes through, so it can't be missed by a future
          // second caller the way a route-local backfill here would be.

          // createCrmBookingRecord always inserts Status='Pending' and it
          // STAYS Pending here — Booking Approval is a real, separate
          // workflow (the staff review checklist, "Confirm & Book",
          // ReadyForApprovalAt gating the Admin Approval Inbox — see
          // crmBookings.js), never a byproduct of submitting the
          // Application. Broker Approval (crmWorkflowGuards.js's
          // maybeAutoCreateBrokerage) fires independently too, the moment
          // Milestone #1 clears — which createCrmBookingRecord's own
          // auto-receipt sync above already does synchronously whenever the
          // Application captured a real token payment.

          // If this Application originated from a Sales Automation lead
          // (promoteLeadToFollowup in saHandoff.js stamps LeadId at
          // creation time), reflect the real downstream outcome back onto
          // that lead — otherwise the SA pipeline shows it permanently
          // stuck "InFollowup" even after the deal is fully booked in CRM.
          // This is the one place a booking now gets created from
          // (Application submission), so it's the one place responsible for
          // this sync, regardless of whether the application was filed
          // directly in CRM or handed off from a lead.
          await pool.request().input("bid", sql.Int, created.id).input("id", sql.Int, id)
            .query(`
              UPDATE dbo.SaLead SET CrmBookingId = @bid, Status = 'Booked', UpdatedAt = SYSDATETIME()
              WHERE Id = (SELECT LeadId FROM dbo.CrmApplication WHERE Id = @id)
            `);
        } catch (bookingErr) {
          if (bookingErr.status) {
            // The submit above has already committed and must stay
            // committed (same reasoning as the existing comment on this
            // block) — so this stays a 200, not a 409. But the response can
            // no longer pretend booking creation succeeded: bookingError
            // surfaces the real conflict (e.g. unit taken by another
            // application's booking in the interim) so the frontend can
            // show it and fall back to the manual retry button instead of a
            // silently null booking that looks like "nothing to create yet."
            console.error("[crm-applications] auto-booking blocked:", bookingErr.message);
            bookingError = bookingErr.message;
          } else {
            console.error("[crm-applications] auto-booking failed:", bookingErr.message);
          }
        }
      }
    }

    res.json({ success: true, status: result.newStatus, booking, bookingError });
  } catch (e) {
    console.error("[crm-applications] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/cancel — a business action, not an approval — any editor can
// cancel a Draft/Pending/Rejected application to fix an accidental or
// mistaken filing and free up whatever it was holding. Approved is
// deliberately excluded (see APPLICATION_TRANSITIONS in
// crmApplicationWorkflow.js) — advanceApplicationStatus below will refuse
// the transition and this route just surfaces that as a 400. Once
// Approved, undoing the deal has to go through the Booking's own
// Cancellation Request flow instead of this single-step action.
router.put("/:id/cancel", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const remarks = req.body?.Remarks || null;

    // An Application with an active Booking must be cancelled through the
    // Booking's own cancellation flow (crmCancellations.js: request ->
    // admin-approved -> refund/parking/hold/amendment cascade), not this
    // single-step any-editor action. Without this check, cancelling here
    // leaves the Booking (possibly Approved, mid-Agreement, or mid-payments)
    // completely untouched -- orphaned under a Cancelled parent, invisible
    // to the sales-deed check, refund computation, parking release, hold
    // release, and amendment auto-rejection that a real Booking cancellation
    // performs. The Stage logic above (see BOOKING_SELECT/CrmApplication
    // query comment: "once ANY booking has ever been created for this
    // application, it's Converted for good") already treats a booked
    // Application and its Booking as one linked lifecycle -- this just
    // enforces that on the cancel path too. In practice this is now mostly a
    // second line of defense — an Approved Application can no longer reach
    // Cancelled at all (APPLICATION_TRANSITIONS), so this only still matters
    // for the rare case of an Approved Application with an active Booking
    // where someone hits this endpoint directly.
    const activeBooking = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingNo, Status FROM dbo.CrmBooking WHERE ApplicationId = @id AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
    if (activeBooking.recordset.length) {
      const bk = activeBooking.recordset[0];
      return res.status(400).json({
        error: `This application has an active booking (${bk.BookingNo}, ${bk.Status}) — cancel the booking itself (Cancellation Request) instead of the application`,
      });
    }

    const result = await advanceApplicationStatus(pool, id, "Cancelled", "Manual", remarks, actorId(req));
    if (!result.ok) return res.status(result.error === "Application not found" ? 404 : 400).json({ error: result.error });
    // Same reasoning as the Reject path above — the active-Booking check
    // just above guarantees nothing but a hold or a standalone parking
    // allotment could still be tying up real inventory for this
    // Application, so release both now rather than waiting on the hourly
    // SLA sweep (which only ever covers hold expiry, never parking
    // allotments — see releaseAllParkingForApplication in crmParking.js).
    try { await releaseAllHoldsForApplication(pool, id, actorId(req)); }
    catch (holdErr) { console.error("[crm-applications] hold release on cancel failed:", holdErr.message); }
    try { await releaseAllParkingForApplication(pool, id); }
    catch (parkErr) { console.error("[crm-applications] parking release on cancel failed:", parkErr.message); }
    res.json({ success: true, status: result.to });
  } catch (e) {
    console.error("[crm-applications] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;