const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const allowRoles = require("../middleware/role");
const { actorId, requireUserEmail, isSuperAdminOnly } = require("../services/saAccess");
const { validateSourceChain } = require("../services/sourceChain");
const { advanceApplicationStatus, logStatusChange } = require("../services/crmApplicationWorkflow");
// The generic multi-module approval engine — Submit/Approve/Reject go through
// this so approve/reject is gated to admin/super_admin/dba only (the same
// engine BOQ, Purchase Orders, etc. use), instead of any editor self-approving.
const { transition: approvalTransition } = require("../services/approvalService");
const { createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError, resolveApplicationPaymentPlan } = require("../services/crmEntityCreation");
const { placeHoldIfNeeded, releaseAllHoldsForApplication, findActiveHold, releaseHold } = require("../services/crmHoldService");
const { recalculateRemainingMilestones, requireActiveBooking } = require("../services/crmWorkflowGuards");
const { releaseAllParkingForApplication, applyAddParking, rollupBookingTotals } = require("../routes/crmParking");
const { ensureBrokerForChannelPartner } = require("../services/channelPartnerBrokerBridge");
const { getApplicationFormPdfBuffer } = require("../services/applicationFormPdf");

router.use(authMiddleware);
router.use(apiRateLimit);

// Mirrors SaLead.SourceType so source values stay consistent across the
// whole system, not just this module.
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

const APP_SELECT = `
  SELECT
    a.Id, a.ApplicationNo, a.LeadId, a.CustomerId,
    -- Always read from CrmCustomer master so name/mobile corrections propagate instantly.
    COALESCE(cust.CustomerName, a.ApplicantName) AS ApplicantName,
    COALESCE(cust.Mobile,       a.Mobile)        AS Mobile,
    a.AltMobile, a.Email,
    a.ProjectId, a.PreferredUnitId, a.CompanyId,
    a.InterestedProject, a.InterestedUnit, a.PropertyType, a.BhkPreference,
    a.Source, a.PlatformId, a.CampaignId, a.AdId, a.ChannelPartnerId,
    a.AssignedTo, a.AssignedBy, a.Status, a.Notes, a.CurrentStep,
    a.RatePerSqFt, a.DateOfApply, a.PaymentPlanId, a.TokenType, a.TokenValue, a.BookingAmount, a.PaymentMode, a.DepositBankId,
    a.ReferredByApplicationId, a.IsActive, a.CreatedAt, a.UpdatedAt,
    a.BrokerId, a.BrokerageRatePercent, a.BrokeragePaymentPlan, brk.LHeadName AS BrokerName,
    (
      SELECT TOP 1 CAST(Note AS NVARCHAR(MAX))
      FROM dbo.ApprovalAuditLog
      WHERE TableName = 'CrmApplication' AND RecordId = a.Id AND ActionStatus = '${CrmStatus.REJECTED}'
      ORDER BY ActionAt DESC
    ) AS RejectionNote,
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
    -- that cascade was wired in could still show Status = '${CrmStatus.APPROVED}' with a
    -- dead booking, which this change would make eligible for forBooking
    -- again. Worth a one-time check for Status = '${CrmStatus.APPROVED}' AND
    -- BookingStatus IN ('${CrmStatus.CANCELLED}','${CrmStatus.REJECTED}') before relying on this.
    CASE
      WHEN bk.Id IS NOT NULL AND bk.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}') THEN 'Converted'
      WHEN a.Status IN ('${CrmStatus.REJECTED}', '${CrmStatus.CANCELLED}') THEN 'NotConverted'
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
      WHEN a.Status NOT IN ('${CrmStatus.REJECTED}', '${CrmStatus.CANCELLED}', 'Expired') AND bk.Id IS NULL AND a.PreferredUnitId IS NOT NULL AND (
        EXISTS (SELECT 1 FROM dbo.CrmBooking ob WHERE ob.UnitId = a.PreferredUnitId AND ob.IsActive = 1 AND ob.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}') AND ob.ApplicationId <> a.Id)
        OR EXISTS (SELECT 1 FROM dbo.CrmInventoryHold oh WHERE oh.EntityType = 'Unit' AND oh.EntityId = a.PreferredUnitId AND oh.Status = '${CrmStatus.ACTIVE}' AND oh.HoldUntil >= SYSDATETIME() AND oh.ApplicationId <> a.Id)
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
    ORDER BY CASE WHEN IsActive = 1 AND Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}') THEN 0 ELSE 1 END, CreatedAt DESC
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
    const { status, search, stage, includeConverted, forBooking, companyId } = req.query;
    const req0 = pool.request();
    const conds = ["a.IsActive = 1"];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("a.Status = @st"); }
    if (companyId) { req0.input("companyId", sql.Int, parseInt(companyId, 10)); conds.push("a.CompanyId = @companyId"); }
    if (search) {
      req0.input("srch", sql.NVarChar(200), `%${search}%`);
      conds.push("(COALESCE(cust.CustomerName, a.ApplicantName) LIKE @srch OR COALESCE(cust.Mobile, a.Mobile) LIKE @srch OR a.ApplicationNo LIKE @srch)");
    }
    const where = "WHERE " + conds.join(" AND ");
    const result = await req0.query(`${APP_SELECT} ${where} ORDER BY a.CreatedAt DESC`);
    let rows = result.recordset;
    if (forBooking) {
      rows = rows.filter((r) => ![CrmStatus.REJECTED, CrmStatus.CANCELLED, "Expired"].includes(r.Status) && r.Stage !== "Converted");
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
        SELECT b.Id, b.BookingNo,
               COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
               COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
               b.TotalValue, b.Status, b.BookingDate
        FROM dbo.CrmBooking b
        LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
        WHERE b.ApplicationId = @id AND b.IsActive = 1
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

// GET /:id/pdf — Application Form PDF.
// Gated: only available after Level 1 verification, i.e. the Application has
// been Approved (which triggers Booking creation). A Pending application has
// not yet passed L1 review, so no PDF is issued — mirrors how Money Receipt
// PDFs are only available once a Booking exists and has been submitted.
router.get("/:id/pdf", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const appRow = await pool.request().input("id", sql.Int, id).query(`
      SELECT a.ApplicationNo, a.Status,
             bk.Id AS BookingId, bk.Status AS BookingStatus
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.CrmBooking bk ON bk.ApplicationId = a.Id AND bk.IsActive = 1
      WHERE a.Id = @id AND a.IsActive = 1
    `);
    if (!appRow.recordset.length) return res.status(404).json({ error: "Application not found" });
    const app = appRow.recordset[0];
    // Level 1 gate: a live booking must exist (Booking not Cancelled/Rejected),
    // which only happens after the Application is Approved.
    const hasLiveBooking = app.BookingId
      && !["Cancelled", "Rejected"].includes(app.BookingStatus);
    if (!hasLiveBooking) {
      return res.status(403).json({
        error: "Application Form PDF is only available after Level 1 verification (Application Approved). Please complete the review process first.",
      });
    }
    const buffer = await getApplicationFormPdfBuffer(pool, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${app.ApplicationNo}-ApplicationForm.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-applications] GET /:id/pdf error:", e.message);
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
    // Rejected included deliberately: PUT /:id/reject is now a real
    // "revert to fill/re-check" verification action (see approvalService's
    // crm-applications module + crmApplications.js PUT /:id/reject), and
    // the whole point of a revert is that the preparer can fix what the
    // verifier flagged — including the unit/plan selection itself — before
    // resubmitting. Locked again once Approved, same as before.
    if (changingUnitSelection && ![CrmStatus.DRAFT, CrmStatus.PENDING, CrmStatus.REJECTED].includes(existingStatus)) {
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
          // Same effectiveProjectId pattern as the deposit-bank check below —
          // b.ProjectId is what's about to be saved by the UPDATE further
          // down, not yet what's in the DB row placeHold would otherwise read.
          applicationProjectId: b.ProjectId ? parseInt(b.ProjectId) : existing.recordset[0].ProjectId,
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


    const BROKERAGE_PLANS = ["OneTime", "TwoPart", "AgreementOnly"];
    if (b.BrokeragePaymentPlan !== undefined && b.BrokeragePaymentPlan !== null && !BROKERAGE_PLANS.includes(b.BrokeragePaymentPlan)) {
      return res.status(400).json({ error: `BrokeragePaymentPlan must be one of ${BROKERAGE_PLANS.join(", ")}` });
    }

    const channelPartnerId = b.ChannelPartnerId ? parseInt(b.ChannelPartnerId) : null;
    const bridge = !b.BrokerId && channelPartnerId
      ? await ensureBrokerForChannelPartner(pool, channelPartnerId, actor)
      : null;
    const brokerId = b.BrokerId ? parseInt(b.BrokerId) : (bridge?.brokerId || null);
    const brokerageRatePercent = b.BrokerageRatePercent != null && b.BrokerageRatePercent !== ""
      ? parseFloat(b.BrokerageRatePercent)
      : (bridge?.commissionRate ?? null);

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
      .input("cpid",   sql.Int, channelPartnerId)
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
      .input("brkid", sql.Int,          brokerId)
      .input("brkpct", sql.Decimal(5,2), brokerageRatePercent)
      .input("brkplan", sql.NVarChar(20), b.BrokeragePaymentPlan || null)
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
          BrokeragePaymentPlan = ISNULL(@brkplan, BrokeragePaymentPlan),
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

// PUT /:id/submit — sends the Application into verification AND, the moment
// that succeeds, creates its Booking straight away (if a Unit was picked in
// Step 1) — there is no separate Application-approval gate anymore. Staff
// never click a distinct "Approve" for the Application; the real review/
// approval work (Level-1 data review, then Marketing Head, then Director)
// all happens on the Booking itself from here on (see crmBookingStageService.js).
// Booking creation is best-effort/non-blocking here — the response reports
// bookingId/bookingNo when it succeeds so the frontend can jump straight
// there; a failure (e.g. the unit got taken by someone else in the interim)
// never fails the submit itself, staff can retry via the "Create Booking"
// fallback button on the Applications list (POST /:id/create-booking).
// Draft/Rejected -> Pending, handled generically by approvalTransition; the
// no-op branch below runs for every normal first-time submit since POST /
// already inserts new Applications straight into 'Pending'.
router.put("/:id/submit", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const current = await getPool().request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @id");
    const currentStatus = current.recordset[0]?.Status;
    const result = currentStatus === CrmStatus.PENDING
      ? { newStatus: CrmStatus.PENDING }
      : await approvalTransition("crm-applications", id, CrmStatus.PENDING, userEmail, req.user?.role);

    // Auto-hold the picked Unit for 72h. createCrmApplicationRecord already
    // attempts this same hold at creation time (Step 1), but that attempt is
    // best-effort/non-blocking there — so this call is the enforced backstop:
    // unlike creation, a real conflict here (holdErr.status set, below) blocks
    // the submit outright instead of letting a second salesperson's application
    // sail into the approval queue unprotected.
    //
    // Parking: slots picked in the wizard are held via CrmInventoryHold
    // (Status='Active'). createCrmBookingRecord converts Active holds to real
    // CrmParkingAllotment rows after the booking is inserted. If this is a
    // re-submit (booking already exists), the conversion block below handles
    // any unconverted holds instead.
    const pool = getPool();
    const actor = actorId(req);

    // First check if it already has a booking (it was already submitted once).
    let booking = null;
    let bookingError = null;
    const already = await pool.request().input("aid", sql.Int, id)
      .query("SELECT TOP 1 Id, BookingNo FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1");
    if (already.recordset.length) {
      booking = { id: already.recordset[0].Id, BookingNo: already.recordset[0].BookingNo, alreadyExists: true };
      
      // SYNC edits from Application to the existing Booking
      const app = await pool.request().input("id", sql.Int, id).query(`
        SELECT PreferredUnitId, RatePerSqFt, PaymentPlanId, DateOfApply,
               TokenType, TokenValue, BookingAmount, PaymentMode, DepositBankId,
               AssignedTo, Notes, BrokerId, BrokerageRatePercent, BrokeragePaymentPlan
        FROM dbo.CrmApplication WHERE Id = @id
      `);
      const a = app.recordset[0];
      
      if (a) {
        await pool.request()
          .input("bid", sql.Int, booking.id)
          .input("RatePerSqFt", sql.Decimal(18, 2), a.RatePerSqFt)
          .input("PaymentPlanId", sql.Int, a.PaymentPlanId)
          .input("BookingDate", sql.Date, a.DateOfApply)
          .input("TokenType", sql.NVarChar(50), a.TokenType)
          .input("TokenValue", sql.Decimal(18, 2), a.TokenValue)
          .input("BookingAmount", sql.Decimal(18, 2), a.BookingAmount)
          .input("PaymentMode", sql.NVarChar(50), a.PaymentMode)
          .input("DepositBankId", sql.Int, a.DepositBankId)
          .input("AssignedTo", sql.Int, a.AssignedTo)
          .input("Notes", sql.NVarChar(sql.MAX), a.Notes)
          .input("BrokerId", sql.Int, a.BrokerId)
          .input("BrokerageRatePercent", sql.Decimal(5, 2), a.BrokerageRatePercent)
          .input("BrokeragePaymentPlan", sql.NVarChar(100), a.BrokeragePaymentPlan)
          .query(`
            UPDATE dbo.CrmBooking
            SET RatePerSqFt = @RatePerSqFt,
                PaymentPlanId = @PaymentPlanId,
                BookingDate = @BookingDate,
                TokenType = @TokenType,
                TokenValue = @TokenValue,
                BookingAmount = @BookingAmount,
                PaymentMode = @PaymentMode,
                AssignedTo = @AssignedTo,
                Notes = @Notes,
                BrokerId = @BrokerId,
                BrokerageRatePercent = @BrokerageRatePercent,
                BrokeragePaymentPlan = @BrokeragePaymentPlan,
                UpdatedAt = SYSDATETIME()
            WHERE Id = @bid
          `);
      }

      // Resync Milestone #1 (Booking Amount) to match the updated BookingAmount.
      // Without this, editing the application's token/booking amount and re-submitting
      // would update the CrmBooking row but leave the milestone's AmountDue stale.
      if (a?.BookingAmount) {
        try {
          const m1Res = await pool.request().input("bid", sql.Int, booking.id)
            .query("SELECT TOP 1 Id, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
          const m1 = m1Res.recordset[0];
          if (m1 && m1.Status !== "Waived") {
            const newAmountDue = Math.max(parseFloat(a.BookingAmount), Number(m1.AmountPaid || 0));
            const bkTotals = await pool.request().input("bid", sql.Int, booking.id)
              .query("SELECT GrandTotal, TotalValue FROM dbo.CrmBooking WHERE Id = @bid");
            const grandTotal = Number(bkTotals.recordset[0]?.GrandTotal || bkTotals.recordset[0]?.TotalValue || 0);
            const newPercent = grandTotal > 0 ? Math.round((newAmountDue / grandTotal) * 10000) / 100 : 0;
            await pool.request()
              .input("id", sql.Int, m1.Id)
              .input("amt", sql.Decimal(18, 2), newAmountDue)
              .input("pct", sql.Decimal(5, 2), newPercent)
              .query(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = @amt, [Percent] = @pct,
                Status = CASE WHEN AmountPaid >= @amt THEN '${CrmStatus.PAID}' ELSE '${CrmStatus.PENDING}' END,
                UpdatedAt = SYSDATETIME() WHERE Id = @id`);
            await recalculateRemainingMilestones(pool, booking.id, { fixedMilestoneId: m1.Id });
          }
        } catch (msErr) {
          console.error("[crm-applications] milestone resync on edit-submit failed:", msErr.message);
        }
      }

      await pool.request().input("bid", sql.Int, booking.id).input("aid", sql.Int, id).query(`
        UPDATE dbo.CrmBookingDocument
        SET BookingId = @bid
        WHERE ApplicationId = @aid AND BookingId IS NULL
      `);

      // Convert any active parking holds to allotments on the existing booking.
      // Holds added while the wizard was in Draft/Pending (after the first submit
      // already created the booking) are never converted by createCrmBookingRecord —
      // that only runs on first-time booking creation. Re-submitting is the only
      // trigger that can convert them.
      try {
        const parkingHolds = await pool.request().input("aid", sql.Int, id).query(`
          SELECT h.Id, h.EntityId AS ParkingSlotId, h.RateOverride
          FROM dbo.CrmInventoryHold h
          WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = 'Active'
        `);
        for (const hold of parkingHolds.recordset) {
          try {
            const slot = await pool.request().input("sid", sql.Int, hold.ParkingSlotId)
              .query("SELECT ProjectId, BlockId, ParkingType FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
            if (!slot.recordset.length) continue;
            const { ProjectId, BlockId, ParkingType } = slot.recordset[0];
            const rate = await pool.request()
              .input("pid", sql.Int, ProjectId).input("bid2", sql.Int, BlockId).input("pt", sql.NVarChar(50), ParkingType)
              .query(`SELECT TOP 1 Id FROM dbo.ParkingMaster
                      WHERE ProjectId = @pid AND ParkingType = @pt AND IsActive = 1
                        AND (BlockId = @bid2 OR BlockId IS NULL)
                      ORDER BY CASE WHEN BlockId = @bid2 THEN 0 ELSE 1 END`);
            if (rate.recordset.length) {
              await applyAddParking(pool, booking.id, {
                ParkingMasterId: rate.recordset[0].Id, ParkingSlotId: hold.ParkingSlotId,
                Quantity: 1, RateOverride: hold.RateOverride,
              }, actor);
            } else if (hold.RateOverride != null) {
              await applyAddParking(pool, booking.id, {
                ParkingType, ParkingSlotId: hold.ParkingSlotId,
                Quantity: 1, Charge: hold.RateOverride, GstRate: 0,
              }, actor);
            }
          } catch (holdErr) {
            console.error("[crm-applications] parking hold conversion (re-submit) failed:", holdErr.message);
          }
        }
        await rollupBookingTotals(pool, booking.id);
      } catch (phErr) {
        console.error("[crm-applications] parking holds query on re-submit failed:", phErr.message);
      }
    } else {
      // If no booking exists yet, place a hold and create one.
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
        if (holdErr.status) {
          console.error("[crm-applications] auto-hold on submit blocked:", holdErr.message);
          return res.status(holdErr.status).json({ error: holdErr.message });
        }
        console.error("[crm-applications] auto-hold on submit failed:", holdErr.message);
      }
      const app = await pool.request().input("id", sql.Int, id).query(`
        SELECT PreferredUnitId, RatePerSqFt, PaymentPlanId, DateOfApply,
               TokenType, TokenValue, BookingAmount, PaymentMode, DepositBankId,
               AssignedTo, Notes, BrokerId, BrokerageRatePercent, BrokeragePaymentPlan
        FROM dbo.CrmApplication WHERE Id = @id
      `);
      const a = app.recordset[0];
      if (a?.PreferredUnitId) {
        try {
          const created = await createCrmBookingRecord(pool, {
            ApplicationId: id, UnitId: a.PreferredUnitId, RatePerSqFt: a.RatePerSqFt,
            PaymentPlanId: a.PaymentPlanId, BookingDate: a.DateOfApply,
            TokenType: a.TokenType, TokenValue: a.TokenValue, BookingAmount: a.BookingAmount,
            PaymentMode: a.PaymentMode, DepositBankId: a.DepositBankId,
            AssignedTo: a.AssignedTo, Notes: a.Notes,
            BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokeragePaymentPlan: a.BrokeragePaymentPlan,
          }, actor);
          booking = { id: created.id, BookingNo: created.BookingNo };
          // Sync SA Lead to Booked now that a Booking exists
          await pool.request().input("bid", sql.Int, created.id).input("aid", sql.Int, id)
            .query(`UPDATE dbo.SaLead SET CrmBookingId = @bid, Status = '${CrmStatus.BOOKED}', UpdatedAt = SYSDATETIME()
                    WHERE Id = (SELECT LeadId FROM dbo.CrmApplication WHERE Id = @aid)`);
          await pool.request().input("bid", sql.Int, created.id).input("aid", sql.Int, id).query(`
            UPDATE dbo.CrmBookingDocument
            SET BookingId = @bid
            WHERE ApplicationId = @aid AND BookingId IS NULL
          `);
        } catch (bkErr) {
          console.error("[crm-applications] auto-create-booking on submit failed:", bkErr.message);
          bookingError = bkErr.message;
        }
      }
    }

    res.json({ success: true, status: result.newStatus, bookingId: booking?.id || null, bookingNo: booking?.BookingNo || null, bookingError });
  } catch (e) {
    console.error("[crm-applications] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Applications no longer have their own separate approve/reject cycle or
// Level-1 checklist — both retired. The moment an Application is Submitted
// (Pending), its Booking is auto-created (see PUT /:id/submit above) and
// ALL real review/approval happens there instead: the same 7 checklist
// items that used to gate this Application's own Approve now gate the
// Booking's "Review" stage, followed by Marketing Head then Director
// approval (see crmBookingStageService.js, crmBookings.js). An Application
// simply stays Pending once submitted — its Booking's own WorkflowStage is
// the real state to watch from here on.

// POST /:id/create-booking — staff-facing fallback/retry. Bookings are
// normally auto-created the instant an Application is submitted (see
// PUT /:id/submit above); this route exists for the case that auto-create
// failed (unit taken in the interim, plan unresolved, etc.) and staff need
// to retry by hand once the underlying issue is fixed.
router.post("/:id/create-booking", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const actor = actorId(req);

    const app = await pool.request().input("id", sql.Int, id).query(`
      SELECT Status, PreferredUnitId, RatePerSqFt, PaymentPlanId, DateOfApply, TokenType, TokenValue,
             BookingAmount, PaymentMode, AssignedTo, Notes, DepositBankId,
             BrokerId, BrokerageRatePercent, BrokeragePaymentPlan
      FROM dbo.CrmApplication WHERE Id = @id AND IsActive = 1
    `);
    if (!app.recordset.length) return res.status(404).json({ error: "Application not found" });
    const a = app.recordset[0];
    // Only Pending applications can have a booking created — Draft means the
    // wizard was never submitted, so the form data may be incomplete.
    if (a.Status !== "Pending") {
      return res.status(400).json({ error: `Cannot create a booking for a ${a.Status} application — the application must be submitted first` });
    }
    if (!a.PreferredUnitId) {
      return res.status(400).json({ error: "This application has no preferred unit selected" });
    }

    const created = await createCrmBookingRecord(pool, {
      ApplicationId: id, UnitId: a.PreferredUnitId, RatePerSqFt: a.RatePerSqFt,
      PaymentPlanId: a.PaymentPlanId, BookingDate: a.DateOfApply, TokenType: a.TokenType,
      TokenValue: a.TokenValue, BookingAmount: a.BookingAmount, PaymentMode: a.PaymentMode,
      DepositBankId: a.DepositBankId,
      AssignedTo: a.AssignedTo, Notes: a.Notes,
      BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokeragePaymentPlan: a.BrokeragePaymentPlan,
    }, actor);

    // Same SA-lead sync that used to live inside submit — still the one
    // place a Booking gets created from, just moved here.
    await pool.request().input("bid", sql.Int, created.id).input("id", sql.Int, id)
      .query(`
        UPDATE dbo.SaLead SET CrmBookingId = @bid, Status = '${CrmStatus.BOOKED}', UpdatedAt = SYSDATETIME()
        WHERE Id = (SELECT LeadId FROM dbo.CrmApplication WHERE Id = @id)
      `);
    await pool.request().input("bid", sql.Int, created.id).input("aid", sql.Int, id).query(`
      UPDATE dbo.CrmBookingDocument
      SET BookingId = @bid
      WHERE ApplicationId = @aid AND BookingId IS NULL
    `);

    res.json({ success: true, booking: created });
  } catch (e) {
    console.error("[crm-applications] create-booking error:", e.message);
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

    // Release inventory BEFORE advancing status so that if a release fails
    // the Application is still Active and the user gets a real error to act on,
    // rather than ending up Cancelled with inventory stuck in a held state.
    // releaseAllHoldsForApplication / releaseAllParkingForApplication are both
    // idempotent, so running them on an application whose holds are already
    // clear is always safe.
    await releaseAllHoldsForApplication(pool, id, actorId(req));
    await releaseAllParkingForApplication(pool, id);

    const result = await advanceApplicationStatus(pool, id, "Cancelled", "Manual", remarks, actorId(req));
    if (!result.ok) return res.status(result.error === "Application not found" ? 404 : 400).json({ error: result.error });
    res.json({ success: true, status: result.to });
  } catch (e) {
    console.error("[crm-applications] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id - admin cleanup only. Applications that already have a live
// booking must be handled from the booking side; this endpoint is only for
// pre-booking mistakes/noise that should disappear from the active lists.
router.delete("/:id", allowRoles("admin", "super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const appRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT Id, ApplicationNo, Status, IsActive
      FROM dbo.CrmApplication
      WHERE Id = @id AND IsActive = 1
    `);
    const app = appRes.recordset[0];
    if (!app) return res.status(404).json({ error: "Application not found" });

    const activeBooking = await pool.request().input("id", sql.Int, id).query(`
      SELECT TOP 1 Id, BookingNo, Status
      FROM dbo.CrmBooking
      WHERE ApplicationId = @id AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')
    `);
    if (activeBooking.recordset.length) {
      const b = activeBooking.recordset[0];
      return res.status(400).json({
        error: `Cannot delete application ${app.ApplicationNo} because it has an active booking (${b.BookingNo}, ${b.Status}). Delete the unprogressed booking first, or use Cancellation Request if it has progressed.`,
      });
    }

    const progressed = await pool.request().input("aid", sql.Int, id).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.CrmBooking WHERE ApplicationId = @aid AND Status = 'Approved') AS ApprovedBookings,
        (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id WHERE b.ApplicationId = @aid) AS Agreements,
        (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.CrmInvoice inv ON inv.BookingId = b.Id WHERE b.ApplicationId = @aid AND inv.Status <> 'Void') AS Invoices,
        (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.CrmMoneyReceipt mr ON mr.BookingId = b.Id WHERE b.ApplicationId = @aid AND mr.Status <> 'Rejected') AS MoneyReceipts
    `);
    const p = progressed.recordset[0] || {};
    const blockers = Object.entries(p).filter(([, count]) => Number(count) > 0).map(([label]) => label);
    if (blockers.length) {
      return res.status(400).json({
        error: `Cannot delete application ${app.ApplicationNo} because downstream activity exists: ${blockers.join(", ")}.`,
      });
    }

    const actor = actorId(req);

    // Release inventory BEFORE setting IsActive = 0 so that if a release
    // fails the application is still visible/active and the error surfaces
    // to the caller rather than leaving inventory stuck on a "deleted" record.
    await releaseAllHoldsForApplication(pool, id, actor);
    await releaseAllParkingForApplication(pool, id);

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmApplication
        SET IsActive = 0, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logStatusChange(pool, id, app.Status, app.Status, "AdminDelete", "Application soft-deleted by admin", actor);
    res.json({ success: true, message: `Application ${app.ApplicationNo} deleted` });
  } catch (e) {
    console.error("[crm-applications] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
