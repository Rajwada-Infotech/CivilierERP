const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail, isSaAdmin } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { advanceApplicationStatus } = require("../services/crmApplicationWorkflow");
const { emitNotification } = require("../services/notify");
const { guardAndConvertHold } = require("../services/crmHoldService");
// Bookings land in Pending on creation and only ever reach Approved/Rejected
// through this shared engine — gated to admin/super_admin/marketing_head via
// the Admin Approval Inbox, same as every other CRM approval flow.
const { transition: approvalTransition } = require("../services/approvalService");
const { createCrmBookingRecord, CrmCreationError } = require("../services/crmEntityCreation");

router.use(authMiddleware);

// Flow-progress flags (HasWelcomeCall / BankDetailsComplete / Agreement*)
// drive the list page's single "next step" action — the UI is never allowed
// to jump ahead to a later step than the record has actually reached.
const BOOKING_SELECT = `
  SELECT
    b.Id, b.BookingNo, b.ApplicationId, b.UnitId, b.ProjectId, b.ProjectName, b.CompanyId,
    b.UnitNo, b.BlockName, um.BlockId, b.FloorName, b.UnitType, b.AreaSqFt,
    b.RatePerSqFt, b.TotalValue, b.BookingAmount, b.TokenType, b.TokenValue,
    b.PaymentPlanId, b.BookingDate,
    b.PaymentMode, b.AssignedTo, b.Status, b.Notes, b.IsActive,
    b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
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

// GET /:id — single booking with milestones, welcome calls, agreement
router.get("/:id", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [bkRes, milRes, wcRes, agRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${BOOKING_SELECT} WHERE b.Id = @id`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT * FROM dbo.CrmPaymentMilestone WHERE BookingId = @id ORDER BY MilestoneNo`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT wc.*, u.name AS CalledByName FROM dbo.CrmWelcomeCall wc LEFT JOIN dbo.Users u ON u.id = wc.CalledBy WHERE wc.BookingId = @id ORDER BY wc.CreatedAt DESC`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ag.*, (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = ag.Id) AS DocumentCount FROM dbo.CrmAgreement ag WHERE ag.BookingId = @id`),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });
    res.json({
      booking: bkRes.recordset[0],
      milestones: milRes.recordset,
      welcomeCalls: wcRes.recordset,
      agreement: agRes.recordset[0] || null,
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
    const { id: bookingId, BookingNo: bookingNo } = await createCrmBookingRecord(pool, req.body, actorId(req));
    res.status(201).json({ success: true, id: bookingId, BookingNo: bookingNo });
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
      .query("SELECT Status, AssignedTo, AreaSqFt FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!old.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const existingArea = old.recordset[0].AreaSqFt;

    const total = b.TotalValue != null ? parseFloat(b.TotalValue)
                : (existingArea && rate ? Math.round(existingArea * rate) : null);

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
          -- GrandTotal tracks TotalValue changes without disturbing the
          -- already-rolled-up Parking/ExtraCharges totals.
          GrandTotal = ISNULL(@tot, TotalValue) + ParkingTotal + ExtraChargesTotal,
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "AssignedTo", oldVal: old.recordset[0].AssignedTo, newVal: b.AssignedTo },
    ]);

    res.json({ success: true });
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
      .query("SELECT UnitId, Status FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (booking.recordset[0].Status === "Cancelled") {
      return res.status(400).json({ error: "Cannot change the unit on a cancelled booking" });
    }
    const oldUnitId = booking.recordset[0].UnitId;
    const newUnitId = parseInt(b.NewUnitId);
    if (newUnitId === oldUnitId) return res.status(400).json({ error: "New unit is the same as the current unit" });

    // Same lookup + availability checks as booking creation — the new unit
    // must be real, active, and not already locked by another booking.
    const unit = await pool.request().input("uid", sql.Int, newUnitId).query(`
      SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt,
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
      .input("ub",    sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBooking SET
          UnitId = @uid, ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          CompanyId = @cid, UnitNo = @unit, BlockName = @blk, UnitType = @utype, AreaSqFt = @area,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

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

    res.json({ success: true, unitNo: unitRow.UnitName });
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

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition(). Approve/reject only ever happen from the Admin
// Approval Inbox, not self-service on this page.
router.put("/:id/approve", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
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

module.exports = router;
