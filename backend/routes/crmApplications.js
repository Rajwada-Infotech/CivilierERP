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
const { createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError } = require("../services/crmEntityCreation");
const { placeHoldIfNeeded } = require("../services/crmHoldService");

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
    a.AssignedTo, a.AssignedBy, a.Status, a.Notes,
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
    proj.name AS ProjectMasterName, comp.name AS CompanyName, um.UnitName AS PreferredUnitName,
    -- Customer-master fields, auto-fetched here so the Application page
    -- never asks staff to retype what's already on the Customer record.
    cust.CustomerNo, cust.PanNo, cust.Address AS CustomerAddress, cust.City AS CustomerCity,
    cust.State AS CustomerState, cust.Pincode AS CustomerPincode,
    cust.CoApplicantName, cust.CoApplicantMobile, cust.CoApplicantPanNo, cust.CoApplicantRelation,
    bk.Id AS BookingId, bk.BookingNo, bk.Status AS BookingStatus, bk.UnitNo AS BookingUnitNo,
    bk.ProjectName AS BookingProjectName, bk.TotalValue AS BookingTotalValue, bk.GrandTotal AS BookingGrandTotal, bk.BookingDate,
    -- Stage drives the Converted/In Process/Not Converted split every
    -- Applications view now works from: once ANY booking has ever been
    -- created for this application, it's Converted for good (even if that
    -- booking later gets cancelled — the conversion event itself already
    -- happened and a fresh booking attempt belongs on a fresh application,
    -- matching the linear APPLICATION -> BOOKING step in the workflow spec).
    -- Dead-end applications (Rejected/Cancelled, never booked) are Not
    -- Converted; everything else still moving is In Process.
    CASE
      WHEN bk.Id IS NOT NULL THEN 'Converted'
      WHEN a.Status IN ('Rejected', 'Cancelled') THEN 'NotConverted'
      ELSE 'InProcess'
    END AS Stage
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
router.get("/", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search, stage, includeConverted } = req.query;
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
    if (stage) {
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

// POST / — create application (optionally from a lead, always starts Draft).
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
// it only ever moves through /submit, /approve, /reject below (or the
// automated AutoBooking transition), so it can't be silently overwritten.
router.put("/:id", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id FROM dbo.CrmApplication WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Application not found" });

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
      .input("ppid", sql.Int,           b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null)
      .input("ttype",sql.NVarChar(20),  b.TokenType || null)
      .input("tval", sql.Decimal(18,2), b.TokenValue != null ? parseFloat(b.TokenValue) : null)
      .input("bamt", sql.Decimal(18,2), b.BookingAmount != null ? parseFloat(b.BookingAmount) : null)
      .input("pmode",sql.NVarChar(50),  b.PaymentMode || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,           actor)
      .input("brkid", sql.Int,          b.BrokerId ? parseInt(b.BrokerId) : null)
      .input("brkpct", sql.Decimal(5,2), b.BrokerageRatePercent != null && b.BrokerageRatePercent !== "" ? parseFloat(b.BrokerageRatePercent) : null)
      .input("brksplit", sql.Bit,       b.BrokerageSplitEnabled !== undefined ? (b.BrokerageSplitEnabled ? 1 : 0) : null)
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
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId), TokenType = ISNULL(@ttype, TokenType),
          TokenValue = ISNULL(@tval, TokenValue), BookingAmount = ISNULL(@bamt, BookingAmount),
          PaymentMode = ISNULL(@pmode, PaymentMode),
          BrokerId = ISNULL(@brkid, BrokerId), BrokerageRatePercent = ISNULL(@brkpct, BrokerageRatePercent),
          BrokerageSplitEnabled = ISNULL(@brksplit, BrokerageSplitEnabled),
          -- AssignedTo/AssignedBy are intentionally never accepted here — set
          -- once at creation (the filer becomes the assignee) and locked;
          -- reassignment goes through the existing lead-transfer flow instead.
          Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-applications] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Draft/Rejected -> Pending. Any editor can submit; this is
// not an approval action, just moving the record into the approval queue.
// POST / itself already inserts new Applications straight into 'Pending'
// (not 'Draft' — see createCrmApplicationRecord), so a fresh Application
// filed through the wizard is already "in the queue" by the time staff
// reach Step 4. Treat that as already-submitted (no-op the status
// transition, skip straight to the hold-placement below) rather than
// erroring — approvalTransition only accepts Draft/Rejected -> Pending, and
// a real re-submission after Rejected still needs the actual transition.
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

    // Auto-hold the picked Unit for 72h the moment the full 4-step wizard is
    // actually submitted (not at Step 1's unit-pick, which only creates the
    // record) — reserves the unit while the application sits in the admin
    // approval queue, so a second salesperson can't pick the same unit for a
    // different customer in the meantime. Never blocks the submit itself:
    // same partial-failure tolerance as the auto-booking-on-approval logic
    // below in this file.
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
      console.error("[crm-applications] auto-hold on submit failed:", holdErr.message);
    }

    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-applications] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/dba only, enforced inside
// approvalTransition(). This is the fix for the self-approval bug: approve
// and reject no longer live on this page at all — they only happen from the
// Admin Approval Inbox (src/pages/admin/ApprovalInbox.tsx), same as every
// other approval-driven module in the system.
router.put("/:id/approve", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-applications", id, "Approved", userEmail, req.user?.role);

    // Auto-create the Booking the moment the Application is Approved — the
    // Application now captures everything a Booking needs (unit, rate,
    // payment plan, token), so there's no separate manual "convert to
    // booking" step left. Never blocks the approval itself if this fails
    // (e.g. unit got booked by someone else in the interim) — the approval
    // stands either way, and staff can create the booking by hand as a
    // fallback, same tolerance-of-partial-failure pattern used for GL posting.
    let booking = null;
    if (result.newStatus === "Approved") {
      const pool = getPool();
      const already = await pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @id AND IsActive = 1");
      if (!already.recordset.length) {
        const app = await pool.request().input("id", sql.Int, id).query(`
          SELECT PreferredUnitId, RatePerSqFt, PaymentPlanId, DateOfApply, TokenType, TokenValue,
                 BookingAmount, PaymentMode, AssignedTo, Notes,
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
              AssignedTo: a.AssignedTo, Notes: a.Notes,
              BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokerageSplitEnabled: a.BrokerageSplitEnabled,
            }, actorId(req));
            booking = created;
            // Backfilling Application-linked records (parking/bank/documents)
            // onto the new booking, and recomputing ParkingTotal/GrandTotal,
            // now happens inside createCrmBookingRecord itself (see
            // crmEntityCreation.js) — that's the single shared place every
            // caller of it goes through, so it can't be missed by a future
            // second caller the way a route-local backfill here would be.

            // createCrmBookingRecord always inserts Status='Pending' — and it
            // STAYS Pending here. Auto-approving it the moment it's created
            // used to happen in this same block, on the reasoning that
            // Application-approval and Booking-approval were gated to the
            // same admin roles anyway — but that predates the Booking review
            // checklist (UnitReviewConfirmed/PlanReviewConfirmed), the staff
            // "Book / Send for Approval" action, and ReadyForApprovalAt now
            // gating the Admin Approval Inbox (see crmBookings.js). Silently
            // auto-approving here bypassed all of that: no unit/plan review,
            // no booking-amount payment, straight to Approved with nothing
            // ever surfaced in the inbox. A Booking's own approval must go
            // through that real workflow, not be a byproduct of Application
            // approval.

            // If this Application originated from a Sales Automation lead
            // (promoteLeadToFollowup in saHandoff.js stamps LeadId at
            // creation time), reflect the real downstream outcome back onto
            // that lead — otherwise the SA pipeline shows it permanently
            // stuck "InFollowup" even after the deal is fully booked in CRM.
            // This is the one place a booking now gets created from (Application
            // approval), so it's the one place responsible for this sync,
            // regardless of whether the application was filed directly in
            // CRM or handed off from a lead.
            await pool.request().input("bid", sql.Int, created.id).input("id", sql.Int, id)
              .query(`
                UPDATE dbo.SaLead SET CrmBookingId = @bid, Status = 'Booked', UpdatedAt = SYSDATETIME()
                WHERE Id = (SELECT LeadId FROM dbo.CrmApplication WHERE Id = @id)
              `);
          } catch (bookingErr) {
            console.error("[crm-applications] auto-booking failed:", bookingErr.message);
          }
        }
      }
    }

    res.json({ success: true, status: result.newStatus, booking });
  } catch (e) {
    console.error("[crm-applications] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/dba only (Remarks recommended)
router.put("/:id/reject", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-applications", id, "Rejected", userEmail, req.user?.role, req.body?.Remarks || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-applications] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/cancel — a business action, not an approval — any editor can
// cancel a Draft/Pending/Rejected/Approved application.
router.put("/:id/cancel", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const remarks = req.body?.Remarks || null;
    const result = await advanceApplicationStatus(pool, id, "Cancelled", "Manual", remarks, actorId(req));
    if (!result.ok) return res.status(result.error === "Application not found" ? 404 : 400).json({ error: result.error });
    res.json({ success: true, status: result.to });
  } catch (e) {
    console.error("[crm-applications] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
