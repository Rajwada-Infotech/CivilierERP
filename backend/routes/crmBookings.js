const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail, isSaAdmin } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { emitNotification } = require("../services/notify");
const { guardAndConvertHold } = require("../services/crmHoldService");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking, recalculateRemainingMilestones, maybeAutoGenerateBookingInvoice } = require("../services/crmWorkflowGuards");
// Bookings land in Pending on creation and only ever reach Approved/Rejected
// through this shared engine — gated to admin/super_admin/marketing_head via
// the Admin Approval Inbox, same as every other CRM approval flow.
const { transition: approvalTransition } = require("../services/approvalService");
const { createCrmBookingRecord, CrmCreationError, generateMilestonesForBooking, validatePaymentPlanScope } = require("../services/crmEntityCreation");

router.use(authMiddleware);
router.use(apiRateLimit);

const UPLOAD_DIR = path.join(__dirname, "../uploads/crm-booking-attachments");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "application/pdf", "image/jpeg", "image/png", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed"));
  },
});

// Flow-progress flags (HasWelcomeCall / BankDetailsComplete / Agreement*)
// drive the list page's single "next step" action — the UI is never allowed
// to jump ahead to a later step than the record has actually reached.
const BOOKING_SELECT = `
  SELECT
    b.Id, b.BookingNo, b.ApplicationId, b.UnitId, b.ProjectId, b.ProjectName, b.CompanyId,
    b.UnitNo, b.BlockName, um.BlockId, b.FloorName, b.UnitType, b.AreaSqFt,
    b.RatePerSqFt, b.TotalValue, b.BookingAmount, b.TokenType, b.TokenValue,
    b.PaymentPlanId, b.BookingDate, b.HsnCode,
    b.PaymentMode, b.AssignedTo, b.Status, b.Notes, b.IsActive,
    b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
    b.UnitReviewConfirmed, b.UnitReviewConfirmedBy, b.UnitReviewConfirmedAt,
    b.PlanReviewConfirmed, b.PlanReviewConfirmedBy, b.PlanReviewConfirmedAt,
    b.ReadyForApprovalAt,
    b.CreatedAt, b.UpdatedAt,
    a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email, a.LeadId,
    u.name  AS AssigneeName,
    cu.name AS CreatedByName,
    pp.PlanName AS PaymentPlanName,
    comp.name AS CompanyName,
    CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmWelcomeCall wc WHERE wc.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS HasWelcomeCall,
    CAST(CASE WHEN EXISTS (
      SELECT 1 FROM dbo.CrmCustomerBankDetail bd WHERE bd.BookingId = b.Id
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.BankName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AccountNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.IfscCode, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AccountHolderName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.NomineeName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.NomineeRelation, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.PanNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AadhaarNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.Occupation, ''))), '') IS NOT NULL
    ) THEN 1 ELSE 0 END AS BIT) AS BankDetailsComplete,
    ag.Id AS AgreementId, ag.SeniorApprovalStatus, ag.CustomerApprovalStatus,
    (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND m.Status = 'Pending') AS PendingMilestoneCount
  FROM dbo.CrmBooking b
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.Users u  ON u.id  = b.AssignedTo
  LEFT JOIN dbo.Users cu ON cu.id = b.CreatedBy
  LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = b.PaymentPlanId
  LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id
`;

// GET / — all bookings. By default, Cancelled/Rejected bookings are
// excluded — every "select a booking" dropdown across the CRM (Legal
// Milestones, NOC, Sales Deed, Pre-Possession, Possession Notice, Payments,
// Service Tickets, Brokerage, Communication Log, Handover) calls this with
// no params and previously kept offering cancelled bookings as if they were
// still live. The main Bookings management page (which needs to show and
// filter to Cancelled/Rejected for record-keeping) passes
// ?includeCancelled=1 to opt back in; an explicit ?status=X always wins.
router.get("/", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, applicationId, includeCancelled } = req.query;
    const req0 = pool.request();
    const conds = ["b.IsActive = 1"];
    if (status) {
      req0.input("st", sql.NVarChar(30), status);
      conds.push("b.Status = @st");
    } else if (!includeCancelled) {
      conds.push("b.Status NOT IN ('Cancelled', 'Rejected')");
    }
    if (applicationId) { req0.input("appId", sql.Int, parseInt(applicationId)); conds.push("b.ApplicationId = @appId"); }
    const result = await req0.query(`${BOOKING_SELECT} WHERE ${conds.join(" AND ")} ORDER BY b.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single booking with milestones, welcome calls, agreement,
// full customer record (Details tab needs "all means all" — every KYC/
// contact/co-applicant field, not just the denormalized name/mobile on the
// booking itself), and a payment summary.
router.get("/:id", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [bkRes, milRes, wcRes, agRes, custRes, coAppRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${BOOKING_SELECT} WHERE b.Id = @id`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT * FROM dbo.CrmPaymentMilestone WHERE BookingId = @id ORDER BY MilestoneNo`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT wc.*, u.name AS CalledByName FROM dbo.CrmWelcomeCall wc LEFT JOIN dbo.Users u ON u.id = wc.CalledBy WHERE wc.BookingId = @id ORDER BY wc.CreatedAt DESC`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ag.*, (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = ag.Id) AS DocumentCount FROM dbo.CrmAgreement ag WHERE ag.BookingId = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT c.*
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id
        WHERE b.Id = @id
      `),
      // The per-booking CrmCoApplicant table (not CrmCustomer's inline
      // CoApplicant* fields) is the authoritative source once a booking
      // exists — createCrmBookingRecord() seeds a row here from the
      // customer's intake-time co-applicant data, and Welcome Call's
      // checklist already counts against this table. Booking Details
      // should show the same list, not the intake-time snapshot.
      pool.request().input("id", sql.Int, id).query(
        `SELECT * FROM dbo.CrmCoApplicant WHERE BookingId = @id AND IsActive = 1 ORDER BY CreatedAt`),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });
    const milestones = milRes.recordset;
    const totalDue = milestones.reduce((s, m) => s + (m.AmountDue || 0), 0);
    const totalPaid = milestones.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    res.json({
      booking: bkRes.recordset[0],
      milestones,
      welcomeCalls: wcRes.recordset,
      agreement: agRes.recordset[0] || null,
      customer: custRes.recordset[0] || null,
      coApplicants: coAppRes.recordset,
      paymentSummary: { totalDue, totalPaid, balance: totalDue - totalPaid },
    });
  } catch (e) {
    console.error("[crm-bookings] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create booking from an application. Unit selection is mandatory —
// the customer's chosen unit must exist in dbo.UnitMaster and must not
// already be attached to another active CRM booking. Delegates to the
// shared creation service (backend/services/crmEntityCreation.js) — the
// exact same function backend/services/saHandoff.js calls for the Sales
// Automation -> CRM handoff, so a booking created either way goes through
// identical Unit Master validation, milestone generation, and hold
// conversion — no second, drifting copy of this logic.
router.post("/", requirePageRight("crm-bookings", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const { id: bookingId, BookingNo: bookingNo, tokenWarning } = await createCrmBookingRecord(pool, req.body, actorId(req));
    res.status(201).json({ success: true, id: bookingId, BookingNo: bookingNo, tokenWarning });
  } catch (e) {
    if (e instanceof CrmCreationError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-bookings] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id — update booking. Status is never accepted here — it starts
// 'Pending' at creation and only moves via /submit, /approve, /reject above,
// or becomes 'Cancelled' via the CrmCancellation approval cascade in
// crmCancellations.js. UnitType and AreaSqFt are also never accepted here —
// both are inherited once from Unit Master at creation and the unit itself
// never changes on an existing booking.
router.put("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const rate  = b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null;
    const actor = actorId(req);

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, AssignedTo, AreaSqFt, PaymentPlanId, CompanyId, ProjectId, UnitId, TotalValue, BookingAmount FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!old.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const oldRow = old.recordset[0];
    const existingArea = oldRow.AreaSqFt;

    const total = b.TotalValue != null ? parseFloat(b.TotalValue)
                : (existingArea && rate ? Math.round(existingArea * rate) : null);

    // Changing the payment plan on a booking that already has milestone
    // history is NOT a cosmetic FK swap — the actual payment schedule
    // (amounts, due dates) was generated from the OLD plan and, unless
    // regenerated, silently keeps running on it while the record now claims
    // to be on the new one. Blocked once any real payment exists (nothing
    // to safely regenerate against); regenerated from scratch otherwise so
    // the schedule actually matches what's now selected — matching what
    // booking creation itself would have produced.
    const newPlanId = b.PaymentPlanId !== undefined ? (b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null) : undefined;
    const planIsChanging = newPlanId !== undefined && newPlanId !== oldRow.PaymentPlanId;
    if (planIsChanging) {
      if (newPlanId) {
        const unitBlock = oldRow.UnitId
          ? await pool.request().input("uid", sql.Int, oldRow.UnitId).query("SELECT BlockId FROM dbo.UnitMaster WHERE Id = @uid")
          : { recordset: [] };
        try {
          await validatePaymentPlanScope(pool, newPlanId, {
            companyId: oldRow.CompanyId, projectId: oldRow.ProjectId, blockId: unitBlock.recordset[0]?.BlockId || null,
          });
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      const paid = await pool.request().input("bid", sql.Int, id).query(`
        SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND (AmountPaid > 0 OR Status IN ('Paid', 'Waived'))
      `);
      if (paid.recordset[0]?.Cnt > 0) {
        return res.status(400).json({ error: "Cannot change payment plan — payments have already been recorded against the existing schedule" });
      }
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("pid",   sql.Int,           b.ProjectId   ? parseInt(b.ProjectId) : null)
      .input("pname", sql.NVarChar(200), b.ProjectName || null)
      .input("unit",  sql.NVarChar(100), b.UnitNo || null)
      .input("blk",   sql.NVarChar(100), b.BlockName   || null)
      .input("flr",   sql.NVarChar(100), b.FloorName   || null)
      .input("rate",  sql.Decimal(18,2), rate)
      .input("tot",   sql.Decimal(18,2), total)
      .input("bamt",  sql.Decimal(18,2), b.BookingAmount  != null ? parseFloat(b.BookingAmount) : null)
      .input("bdate", sql.Date,          b.BookingDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode  || null)
      .input("asgn",  sql.Int,           b.AssignedTo   ? parseInt(b.AssignedTo) : null)
      .input("ppid",  sql.Int,           b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null)
      .input("hsn",   sql.VarChar(20),   b.HsnCode || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmBooking SET
          ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          UnitNo = ISNULL(@unit, UnitNo), BlockName = @blk, FloorName = @flr,
          RatePerSqFt = ISNULL(@rate, RatePerSqFt),
          TotalValue = ISNULL(@tot, TotalValue),
          BookingAmount = ISNULL(@bamt, BookingAmount),
          BookingDate = ISNULL(@bdate, BookingDate), PaymentMode = ISNULL(@pmode, PaymentMode),
          AssignedTo = ISNULL(@asgn, AssignedTo),
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId),
          HsnCode = ISNULL(@hsn, HsnCode),
          -- GrandTotal tracks TotalValue changes without disturbing the
          -- already-rolled-up Parking/ExtraCharges totals.
          GrandTotal = ISNULL(@tot, TotalValue) + ParkingTotal + ExtraChargesTotal,
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "AssignedTo", oldVal: oldRow.AssignedTo, newVal: b.AssignedTo },
    ]);

    if (planIsChanging) {
      await pool.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
      const effectiveTotal = total || oldRow.TotalValue;
      const effectiveBookingAmount = b.BookingAmount != null ? parseFloat(b.BookingAmount) : oldRow.BookingAmount;
      await generateMilestonesForBooking(pool, id, effectiveTotal, newPlanId, b.BookingDate || null, actor, effectiveBookingAmount);
    } else if (total != null && total !== oldRow.TotalValue) {
      // TotalValue moved (rate correction) without a plan switch — the
      // existing schedule's ₹/% no longer add up to what's actually owed.
      // A plan switch already regenerates the whole schedule from scratch
      // above, so this only fires on the "same plan, new total" path.
      await recalculateRemainingMilestones(pool, id);
    }

    res.json({ success: true, milestonesRegenerated: planIsChanging });
  } catch (e) {
    console.error("[crm-bookings] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/change-unit — the only way UnitId can ever change on an existing
// booking. Restricted to admin/super_admin/dba/marketing_head (this
// re-points a real legal transaction to a different physical unit) and
// requires a mandatory reason. Every change is permanently logged to
// CrmUnitChangeLog — nothing here is ever silently overwritten.
router.put("/:id/change-unit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Only admin/super_admin/marketing_head can change a booking's unit" });
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.NewUnitId) return res.status(400).json({ error: "NewUnitId is required" });
    if (!b.Reason?.trim()) return res.status(400).json({ error: "Reason is required to change a booking's unit" });

    const booking = await pool.request().input("id", sql.Int, id)
      .query("SELECT UnitId, Status, RatePerSqFt, TotalValue, BookingAmount FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (booking.recordset[0].Status === "Cancelled") {
      return res.status(400).json({ error: "Cannot change the unit on a cancelled booking" });
    }
    const oldUnitId = booking.recordset[0].UnitId;
    const oldRow = booking.recordset[0];
    const newUnitId = parseInt(b.NewUnitId);
    if (newUnitId === oldUnitId) return res.status(400).json({ error: "New unit is the same as the current unit" });

    // Same lookup + availability checks as booking creation — the new unit
    // must be real, active, and not already locked by another booking.
    const unit = await pool.request().input("uid", sql.Int, newUnitId).query(`
      SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt, u.DefaultPaymentPlanId,
             proj.name AS ProjectName, proj.company_id AS CompanyId, blk.BlockName
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
      WHERE u.Id = @uid AND u.IsActive = 1
    `);
    if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
    const unitRow = unit.recordset[0];

    const taken = await pool.request().input("uid", sql.Int, newUnitId).input("id", sql.Int, id)
      .query("SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND Id <> @id AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
    if (taken.recordset.length) return res.status(409).json({ error: "This unit is already booked" });

    const bookingAppId = await pool.request().input("id", sql.Int, id)
      .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @id");
    await guardAndConvertHold(pool, "Unit", newUnitId, bookingAppId.recordset[0].ApplicationId);

    const actor = actorId(req);
    const paid = await pool.request().input("bid", sql.Int, id).query(`
      SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND (AmountPaid > 0 OR Status IN ('Paid', 'Waived'))
    `);
    const canRegenerateSchedule = paid.recordset[0]?.Cnt === 0;
    const newPlanId = canRegenerateSchedule && unitRow.DefaultPaymentPlanId ? unitRow.DefaultPaymentPlanId : null;
    if (newPlanId) {
      await validatePaymentPlanScope(pool, newPlanId, {
        companyId: unitRow.CompanyId || null,
        projectId: unitRow.ProjectId || null,
        blockId: unitRow.BlockId || null,
        unitId: unitRow.Id || null,
      });
    }
    const rate = oldRow.RatePerSqFt != null ? Number(oldRow.RatePerSqFt) : null;
    const area = unitRow.AreaSqFt != null ? Number(unitRow.AreaSqFt) : null;
    const total = area && rate ? Math.round(area * rate) : oldRow.TotalValue;
    await pool.request()
      .input("id",    sql.Int, id)
      .input("uid",   sql.Int, newUnitId)
      .input("pid",   sql.Int, unitRow.ProjectId || null)
      .input("pname", sql.NVarChar(200), unitRow.ProjectName || null)
      .input("cid",   sql.Int, unitRow.CompanyId || null)
      .input("unit",  sql.NVarChar(100), unitRow.UnitName)
      .input("blk",   sql.NVarChar(100), unitRow.BlockName || null)
      .input("utype", sql.NVarChar(100), unitRow.UnitType || null)
      .input("area",  sql.Decimal(18,2), unitRow.AreaSqFt || null)
      .input("tot",   sql.Decimal(18,2), total)
      .input("ppid",  sql.Int, newPlanId)
      .input("ub",    sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBooking SET
          UnitId = @uid, ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          CompanyId = @cid, UnitNo = @unit, BlockName = @blk, UnitType = @utype, AreaSqFt = @area,
          TotalValue = @tot,
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId),
          GrandTotal = @tot + ParkingTotal + ExtraChargesTotal,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    if (newPlanId) {
      // Only the %-based schedule steps get wiped and regenerated — a
      // Parking/Extra-Charge milestone is a fixed line item tied to a real
      // allotment/charge row elsewhere (see the same exclusion in
      // recalculateRemainingMilestones), not part of the plan schedule, and
      // deleting it here would silently orphan that charge's own payment
      // tracking.
      await pool.request().input("bid", sql.Int, id).query(`
        DELETE FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL
      `);
      await generateMilestonesForBooking(pool, id, total, newPlanId, null, actor, oldRow.BookingAmount);
    }

    await pool.request()
      .input("bid",    sql.Int, id)
      .input("oldUid", sql.Int, oldUnitId || null)
      .input("newUid", sql.Int, newUnitId)
      .input("reason", sql.NVarChar(sql.MAX), b.Reason.trim())
      .input("cb",     sql.Int, actor)
      .query(`
        INSERT INTO dbo.CrmUnitChangeLog (BookingId, OldUnitId, NewUnitId, Reason, ChangedBy, ChangedAt)
        VALUES (@bid, @oldUid, @newUid, @reason, @cb, SYSDATETIME())
      `);

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "UnitId", oldVal: oldUnitId, newVal: newUnitId },
    ]);

    res.json({ success: true, unitNo: unitRow.UnitName, paymentPlanUpdated: !!newPlanId });
  } catch (e) {
    console.error("[crm-bookings] change-unit error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /:id/unit-change-log — history of unit changes for a booking
router.get("/:id/unit-change-log", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("bid", sql.Int, id).query(`
      SELECT l.*, ou.UnitName AS OldUnitName, nu.UnitName AS NewUnitName, u.name AS ChangedByName
      FROM dbo.CrmUnitChangeLog l
      LEFT JOIN dbo.UnitMaster ou ON ou.Id = l.OldUnitId
      LEFT JOIN dbo.UnitMaster nu ON nu.Id = l.NewUnitId
      LEFT JOIN dbo.Users u ON u.id = l.ChangedBy
      WHERE l.BookingId = @bid
      ORDER BY l.ChangedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET unit-change-log error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — re-submit a Rejected booking for approval. New bookings
// already land in Pending on creation, so this only matters for the
// Rejected -> Pending resubmit path (ApprovalActions renders Submit there).
router.put("/:id/submit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-bookings", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-bookings] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Shared readiness gate: both the staff-facing "Book" action
// (PUT /:id/ready-for-approval) and the admin-facing Approve action
// (PUT /:id/approve) must agree on what "ready" means, so the two routes
// can never drift — a booking that passes one but fails the other would be
// a confusing, unexplainable state for whoever hits the mismatch.
async function checkBookingApprovalReadiness(pool, id) {
  const checklist = await pool.request().input("id", sql.Int, id).query(`
    SELECT b.UnitReviewConfirmed, b.PlanReviewConfirmed,
           ISNULL(fm.AmountDue, 0) AS FirstMilestoneDue, ISNULL(fm.AmountPaid, 0) AS FirstMilestonePaid
    FROM dbo.CrmBooking b
    OUTER APPLY (SELECT TOP 1 AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id ORDER BY MilestoneNo) fm
    WHERE b.Id = @id
  `);
  if (!checklist.recordset.length) return { notFound: true, missing: [] };
  const row = checklist.recordset[0];
  const missing = [];
  if (!row.UnitReviewConfirmed) missing.push("Unit, Rate & Total Value");
  if (!row.PlanReviewConfirmed) missing.push("Payment Plan & Token/Booking Amount");
  if (!(row.FirstMilestoneDue > 0) || row.FirstMilestonePaid < row.FirstMilestoneDue) missing.push("Booking Amount Payment");
  return { notFound: false, missing };
}

// PUT /:id/confirm-unit — first Booking-checklist item: staff explicitly
// confirms the unit, rate, and total/grand value carried over from the
// Application are correct. Un-confirmable once already Approved (nothing to
// re-check after the fact — a correction at that point is a real edit, not
// a checklist tick).
router.put("/:id/confirm-unit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved — nothing to confirm" });

    await pool.request().input("id", sql.Int, id).input("cb", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmBooking SET UnitReviewConfirmed = 1, UnitReviewConfirmedBy = @cb, UnitReviewConfirmedAt = SYSDATETIME()
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] confirm-unit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/revert-unit — undo a Unit checklist confirmation when something
// was actually wrong (e.g. rate/value needs correcting) instead of forcing
// staff to raise a separate change request for what a re-check would catch.
// Also clears ReadyForApprovalAt so an already-"Book"-ed booking drops back
// out of the Admin Approval Inbox until it's re-confirmed and re-submitted —
// otherwise a reverted-but-still-pending booking could sit in the inbox
// looking ready when it explicitly isn't anymore.
router.put("/:id/revert-unit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved — cannot revert a confirmed checklist item" });

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmBooking SET UnitReviewConfirmed = 0, UnitReviewConfirmedBy = NULL, UnitReviewConfirmedAt = NULL, ReadyForApprovalAt = NULL
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] revert-unit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/confirm-plan — second Booking-checklist item: staff explicitly
// confirms the payment plan and the token/booking-amount figure are correct
// — this is the number the whole milestone schedule is built from.
router.put("/:id/confirm-plan", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved — nothing to confirm" });

    await pool.request().input("id", sql.Int, id).input("cb", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmBooking SET PlanReviewConfirmed = 1, PlanReviewConfirmedBy = @cb, PlanReviewConfirmedAt = SYSDATETIME()
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] confirm-plan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/revert-plan — undo a Payment Plan checklist confirmation, same
// rationale and ReadyForApprovalAt-clearing behavior as revert-unit above.
router.put("/:id/revert-plan", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved — cannot revert a confirmed checklist item" });

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmBooking SET PlanReviewConfirmed = 0, PlanReviewConfirmedBy = NULL, PlanReviewConfirmedAt = NULL, ReadyForApprovalAt = NULL
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] revert-plan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/ready-for-approval — staff-facing "Book" action. Re-runs the
// exact same readiness gate PUT /:id/approve enforces, so a booking can
// never be marked "ready" and then be surprised by a rejection for the same
// missing item. Stamps ReadyForApprovalAt (which the Admin Approval Inbox
// now requires before it will even list a Pending booking — see
// approvalInbox.js), auto-generates the Booking invoice, and notifies every
// admin/super_admin/marketing_head that a booking is waiting on them.
router.put("/:id/ready-for-approval", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const readiness = await checkBookingApprovalReadiness(pool, id);
    if (readiness.notFound) return res.status(404).json({ error: "Booking not found" });
    if (readiness.missing.length) {
      return res.status(400).json({ error: `Cannot submit for approval — confirm ${readiness.missing.join(" and ")} first` });
    }

    const actor = actorId(req);
    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmBooking SET ReadyForApprovalAt = SYSDATETIME() WHERE Id = @id
    `);

    await maybeAutoGenerateBookingInvoice(pool, id, actor);

    const booking = await pool.request().input("id", sql.Int, id).query("SELECT BookingNo FROM dbo.CrmBooking WHERE Id = @id");
    const bookingNo = booking.recordset[0]?.BookingNo;
    const admins = await pool.request().query(`
      SELECT id FROM dbo.Users WHERE LOWER(role) IN ('admin', 'super_admin', 'marketing_head') AND discontinue = 0
    `);
    for (const a of admins.recordset) {
      await emitNotification(pool, a.id, "crm_booking_ready_for_approval",
        "Booking Ready for Approval",
        `Booking ${bookingNo} has cleared its checklist and is ready for approval.`,
        id, "crm_booking");
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] ready-for-approval error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition(). Approve/reject only ever happen from the Admin
// Approval Inbox, not self-service on this page. Also re-checks the exact
// same readiness gate ready-for-approval already enforced — belt-and-
// suspenders in case a booking is approved directly without ever going
// through the staff "Book" step.
router.put("/:id/approve", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool0 = getPool();
    const readiness = await checkBookingApprovalReadiness(pool0, id);
    if (readiness.notFound) return res.status(404).json({ error: "Booking not found" });
    if (readiness.missing.length) {
      return res.status(400).json({ error: `Cannot approve — confirm ${readiness.missing.join(" and ")} first` });
    }

    const result = await approvalTransition("crm-bookings", id, "Approved", userEmail, req.user?.role);

    // Auto-flow: an approved booking's very next step is the welcome call —
    // push that to the assigned salesperson instead of waiting for them to
    // notice the booking list changed.
    if (result.newStatus === "Approved") {
      const pool = getPool();
      const row = await pool.request().input("id", sql.Int, id)
        .query("SELECT BookingNo, AssignedTo FROM dbo.CrmBooking WHERE Id = @id");
      const booking = row.recordset[0];
      if (booking?.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_welcome_call_due",
          "Welcome Call Due",
          `Booking ${booking.BookingNo} is approved — make the welcome call to proceed.`,
          id, "crm_booking");
      }
    }

    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-bookings] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/marketing_head only (Remarks recommended)
router.put("/:id/reject", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-bookings", id, "Rejected", userEmail, req.user?.role, req.body?.Remarks || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-bookings] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// GET /:id/loan — home loan / bank coordination detail for a booking
router.get("/:id/loan", requirePageRight("crm-loan-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("bid", sql.Int, id)
      .query("SELECT * FROM dbo.CrmLoanDetail WHERE BookingId = @bid");
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/loan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/loan — upsert loan detail for a booking
router.put("/:id/loan", requirePageRight("crm-loan-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const actor = actorId(req);

    const existing = await pool.request().input("bid", sql.Int, id)
      .query("SELECT Id FROM dbo.CrmLoanDetail WHERE BookingId = @bid");

    if (existing.recordset.length) {
      await pool.request()
        .input("bid",   sql.Int,           id)
        .input("bank",  sql.NVarChar(200), b.BankName    || null)
        .input("branch",sql.NVarChar(200), b.BranchName  || null)
        .input("amt",   sql.Decimal(18,2), b.LoanAmount  != null ? parseFloat(b.LoanAmount) : null)
        .input("st",    sql.NVarChar(30),  b.SanctionStatus || null)
        .input("sdate", sql.Date,          b.SanctionDate   || null)
        .input("disb",  sql.Decimal(18,2), b.DisbursedAmount!= null ? parseFloat(b.DisbursedAmount) : null)
        .input("acc",   sql.NVarChar(100), b.LoanAccountNo || null)
        .input("rm",    sql.NVarChar(200), b.RmName || null)
        .input("rmc",   sql.NVarChar(20),  b.RmContact || null)
        .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("ub",    sql.Int,           actor)
        .query(`
          UPDATE dbo.CrmLoanDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            LoanAmount = ISNULL(@amt, LoanAmount), SanctionStatus = ISNULL(@st, SanctionStatus),
            SanctionDate = ISNULL(@sdate, SanctionDate), DisbursedAmount = ISNULL(@disb, DisbursedAmount),
            LoanAccountNo = ISNULL(@acc, LoanAccountNo), RmName = ISNULL(@rm, RmName), RmContact = ISNULL(@rmc, RmContact),
            Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE BookingId = @bid
        `);
    } else {
      await pool.request()
        .input("bid",   sql.Int,           id)
        .input("bank",  sql.NVarChar(200), b.BankName    || null)
        .input("branch",sql.NVarChar(200), b.BranchName  || null)
        .input("amt",   sql.Decimal(18,2), b.LoanAmount  != null ? parseFloat(b.LoanAmount) : null)
        .input("st",    sql.NVarChar(30),  b.SanctionStatus || "NotApplied")
        .input("sdate", sql.Date,          b.SanctionDate   || null)
        .input("acc",   sql.NVarChar(100), b.LoanAccountNo || null)
        .input("rm",    sql.NVarChar(200), b.RmName || null)
        .input("rmc",   sql.NVarChar(20),  b.RmContact || null)
        .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cb",    sql.Int,           actor)
        .query(`
          INSERT INTO dbo.CrmLoanDetail
            (BookingId, BankName, BranchName, LoanAmount, SanctionStatus, SanctionDate, LoanAccountNo, RmName, RmContact, Notes, CreatedBy, CreatedAt)
          VALUES (@bid, @bank, @branch, @amt, @st, @sdate, @acc, @rm, @rmc, @notes, @cb, SYSDATETIME())
        `);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] PUT /:id/loan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Invoice tab ──────────────────────────────────────────────────────────────

// GET /:id/invoices — every invoice generated for this booking
router.get("/:id/invoices", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT inv.*, cu.name AS CreatedByName
      FROM dbo.CrmInvoice inv
      LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
      WHERE inv.BookingId = @id
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/invoices error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/invoices — generate a real, permanently-numbered invoice.
// Visible to the customer in their portal immediately (no separate "send"
// step — an invoice is a record of a real transaction, not a draft that
// needs sign-off like the Agreement/Sales Deed documents).
router.post("/:id/invoices", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const invoiceNo = await getNextDocNumber(pool, "INV", "INV");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  invoiceNo)
      .input("bid",  sql.Int,           id)
      .input("type", sql.NVarChar(30),  b.InvoiceType || "Booking")
      .input("amt",  sql.Decimal(18,2), amount)
      .input("dt",   sql.Date,          b.InvoiceDate || null)
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, InvoiceDate, Description, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @type, @amt, ISNULL(@dt, CAST(SYSDATETIME() AS DATE)), @desc, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, InvoiceNo: invoiceNo });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/invoices error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/resync-schedule — retroactive fix for bookings whose payment
// schedule was generated before Milestone #1 tracked the booking's real
// BookingAmount (it used to be sized off the payment plan's own fixed %,
// which could badly mismatch what the customer actually booked with — see
// generateMilestonesForBooking). Pulls Milestone #1's AmountDue/Percent into
// line with the booking's real BookingAmount, then redistributes every other
// still-open milestone across (GrandTotal - BookingAmount), preserving their
// relative weighting to each other — the exact same math new bookings get at
// creation time, just re-run on demand for one already created. Safe/
// idempotent: a no-op if Milestone #1 already matches, and never touches a
// Waived milestone or reduces AmountDue below what's already been collected.
router.post("/:id/resync-schedule", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const bk = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingAmount, GrandTotal, TotalValue FROM dbo.CrmBooking WHERE Id = @id");
    if (!bk.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const booking = bk.recordset[0];
    const bookingAmount = Number(booking.BookingAmount || 0);
    if (!bookingAmount) return res.status(400).json({ error: "This booking has no BookingAmount recorded — nothing to resync against" });
    const grandTotal = Number(booking.GrandTotal || booking.TotalValue || 0);
    if (!grandTotal) return res.status(400).json({ error: "This booking has no total value set" });

    const m1Res = await pool.request().input("bid", sql.Int, id)
      .query("SELECT TOP 1 Id, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
    if (!m1Res.recordset.length) return res.status(400).json({ error: "No milestones found on this booking" });
    const m1 = m1Res.recordset[0];
    if (m1.Status === "Waived") return res.status(400).json({ error: "Milestone 1 has been waived — nothing to resync" });

    if (Math.abs(Number(m1.AmountDue) - bookingAmount) < 1) {
      return res.json({ success: true, changed: false, message: "Milestone 1 already matches the booking amount — nothing to do" });
    }

    const newAmountDue = Math.max(bookingAmount, Number(m1.AmountPaid || 0));
    const newPercent = Math.round((newAmountDue / grandTotal) * 10000) / 100;
    await pool.request()
      .input("id", sql.Int, m1.Id)
      .input("amt", sql.Decimal(18, 2), newAmountDue)
      .input("pct", sql.Decimal(5, 2), newPercent)
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          AmountDue = @amt,
          [Percent] = @pct,
          Status = CASE WHEN Status = 'Paid' THEN Status WHEN AmountPaid >= @amt THEN 'Paid' ELSE Status END,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await recalculateRemainingMilestones(pool, id, { fixedMilestoneId: m1.Id });

    res.json({ success: true, changed: true });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/resync-schedule error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Attachments tab ──────────────────────────────────────────────────────────

// GET /:id/attachments — every file attached to this booking
router.get("/:id/attachments", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT a.Id, a.Label, a.FileName, a.FileSize, a.MimeType, a.UploadedAt, u.name AS UploadedByName
      FROM dbo.CrmBookingAttachment a
      LEFT JOIN dbo.Users u ON u.id = a.UploadedBy
      WHERE a.BookingId = @id
      ORDER BY a.UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/attachments error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/attachments — upload one or more files
router.post("/:id/attachments", requirePageRight("crm-bookings", "edit"), upload.array("files", 10), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    const inserted = [];
    for (const file of files) {
      const result = await pool.request()
        .input("bid",   sql.Int,           id)
        .input("label", sql.NVarChar(200), req.body.Label || null)
        .input("fname", sql.NVarChar(300), file.originalname)
        .input("sname", sql.NVarChar(300), file.filename)
        .input("fsize", sql.Int,           file.size)
        .input("mime",  sql.NVarChar(150), file.mimetype)
        .input("cb",    sql.Int,           actorId(req))
        .query(`
          INSERT INTO dbo.CrmBookingAttachment (BookingId, Label, FileName, StoredName, FileSize, MimeType, UploadedBy, UploadedAt)
          OUTPUT INSERTED.Id
          VALUES (@bid, @label, @fname, @sname, @fsize, @mime, @cb, SYSDATETIME())
        `);
      inserted.push(result.recordset[0].Id);
    }
    res.status(201).json({ success: true, ids: inserted });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/attachments error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/attachments/file/:attId — download/preview a stored file
router.get("/:id/attachments/file/:attId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const attId = parseInt(req.params.attId);
    const result = await pool.request().input("id", sql.Int, attId)
      .query("SELECT StoredName, FileName, MimeType FROM dbo.CrmBookingAttachment WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    const row = result.recordset[0];
    const resolvedPath = path.resolve(UPLOAD_DIR, row.StoredName);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return res.status(403).json({ error: "Access denied" });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found on disk" });
    res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.FileName.replace(/"/g, "")}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/attachments/file/:attId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id/attachments/:attId
router.delete("/:id/attachments/:attId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const attId = parseInt(req.params.attId);
    const result = await pool.request().input("id", sql.Int, attId)
      .query("SELECT StoredName FROM dbo.CrmBookingAttachment WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    await pool.request().input("id", sql.Int, attId).query("DELETE FROM dbo.CrmBookingAttachment WHERE Id = @id");
    const resolvedPath = path.resolve(UPLOAD_DIR, result.recordset[0].StoredName);
    if (resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.unlink(resolvedPath, () => {});
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] DELETE /:id/attachments/:attId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
