const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCrmAudit } = require("../services/crmAudit");
const { advanceApplicationStatus } = require("../services/crmApplicationWorkflow");

router.use(authMiddleware);
router.use(apiRateLimit);

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
    comp.name AS CompanyName
  FROM dbo.CrmBooking b
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.Users u  ON u.id  = b.AssignedTo
  LEFT JOIN dbo.Users cu ON cu.id = b.CreatedBy
  LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = b.PaymentPlanId
  LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
`;

// GET / — all bookings
router.get("/", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, applicationId } = req.query;
    const req0 = pool.request();
    const conds = ["b.IsActive = 1"];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("b.Status = @st"); }
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
// already be attached to another active CRM booking.
router.post("/", requirePageRight("crm-bookings", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ApplicationId) return res.status(400).json({ error: "ApplicationId is required" });
    if (!b.UnitId) return res.status(400).json({ error: "UnitId is required — a unit must be selected from Unit Master" });

    // The unit's own ProjectId (and that project's parent Company) is the
    // source of truth — Project/Company are derived from the Unit selection
    // rather than needing separate dropdowns the caller could mismatch.
    const unit = await pool.request().input("uid", sql.Int, parseInt(b.UnitId)).query(`
      SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt,
             proj.name AS ProjectName, proj.company_id AS CompanyId,
             blk.BlockName
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
      WHERE u.Id = @uid AND u.IsActive = 1
    `);
    if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
    const unitRow = unit.recordset[0];

    const taken = await pool.request().input("uid", sql.Int, parseInt(b.UnitId))
      .query("SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND IsActive = 1 AND Status <> 'Cancelled'");
    if (taken.recordset.length) return res.status(409).json({ error: "This unit is already booked" });

    // Area is a fixed physical attribute of the unit — always taken from
    // Unit Master, never re-typed per booking (same as UnitType above).
    const area  = unitRow.AreaSqFt != null ? unitRow.AreaSqFt : (b.AreaSqFt != null ? parseFloat(b.AreaSqFt) : null);
    const rate  = b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null;
    const total = b.TotalValue  != null ? parseFloat(b.TotalValue)
                : (area && rate ? Math.round(area * rate) : null);

    // Booking token/amount can be agreed as a % of TotalValue or a fixed amount
    const tokenType = b.TokenType === "Amount" ? "Amount" : "Percentage";
    const tokenValue = b.TokenValue != null ? parseFloat(b.TokenValue) : null;
    let bookingAmount = b.BookingAmount != null ? parseFloat(b.BookingAmount) : 0;
    if (tokenValue != null) {
      bookingAmount = tokenType === "Percentage" && total
        ? Math.round(total * tokenValue) / 100
        : tokenValue;
    }

    // Status is always Confirmed on creation — never accepted from the request
    // body. A booking row only ever exists once a real, available Unit and a
    // token amount are locked in (checked above), so there is no meaningful
    // "Draft" state to pick from; the only further transition is Cancelled,
    // which happens exclusively via the CrmCancellation approval cascade
    // (see crmCancellations.js mark-refunded/approve, not this route).
    const bookingNo = await getNextDocNumber(pool, "BKG", "BKG");
    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  bookingNo)
      .input("appId", sql.Int,           parseInt(b.ApplicationId))
      .input("uid",   sql.Int,           parseInt(b.UnitId))
      .input("pid",   sql.Int,           unitRow.ProjectId || null)
      .input("pname", sql.NVarChar(200), unitRow.ProjectName || b.ProjectName || null)
      .input("cid",   sql.Int,           unitRow.CompanyId || null)
      .input("unit",  sql.NVarChar(100), unitRow.UnitName)
      .input("blk",   sql.NVarChar(100), unitRow.BlockName || b.BlockName || null)
      .input("flr",   sql.NVarChar(100), b.FloorName   || null)
      .input("utype", sql.NVarChar(100), unitRow.UnitType || b.UnitType || null)
      .input("area",  sql.Decimal(18,2), area)
      .input("rate",  sql.Decimal(18,2), rate)
      .input("tot",   sql.Decimal(18,2), total)
      .input("bamt",  sql.Decimal(18,2), bookingAmount)
      .input("ttype", sql.NVarChar(20),  tokenType)
      .input("tval",  sql.Decimal(18,2), tokenValue)
      .input("ppid",  sql.Int,           b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null)
      .input("bdate", sql.Date,          b.BookingDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode  || null)
      .input("asgn",  sql.Int,           b.AssignedTo   ? parseInt(b.AssignedTo) : null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmBooking
          (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, UnitNo, BlockName, FloorName, UnitType,
           AreaSqFt, RatePerSqFt, TotalValue, BookingAmount, TokenType, TokenValue, PaymentPlanId,
           BookingDate, PaymentMode, AssignedTo, Status, Notes, IsActive,
           ParkingTotal, ExtraChargesTotal, GrandTotal, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @appId, @uid, @pid, @pname, @cid, @unit, @blk, @flr, @utype,
           @area, @rate, @tot, @bamt, @ttype, @tval, @ppid,
           ISNULL(@bdate, CAST(SYSDATETIME() AS DATE)), @pmode,
           @asgn, 'Confirmed', @note, 1,
           0, 0, ISNULL(@tot, 0), @cb, SYSDATETIME())
      `);

    const bookingId = result.recordset[0].Id;

    if (total && total > 0) {
      // Apply the chosen payment plan template if given, else the default 7-stage split
      let milestones;
      if (b.PaymentPlanId) {
        const planItems = await pool.request().input("pid", sql.Int, parseInt(b.PaymentPlanId))
          .query("SELECT MilestoneNo, MilestoneName, [Percent] FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @pid ORDER BY MilestoneNo");
        milestones = planItems.recordset.map((r) => ({ no: r.MilestoneNo, name: r.MilestoneName, pct: r.Percent }));
      }
      if (!milestones?.length) {
        milestones = [
          { no: 1, name: "Booking",          pct: 5  },
          { no: 2, name: "Agreement",        pct: 10 },
          { no: 3, name: "Foundation",       pct: 15 },
          { no: 4, name: "Superstructure",   pct: 20 },
          { no: 5, name: "Slab Casting",     pct: 20 },
          { no: 6, name: "Plastering",       pct: 15 },
          { no: 7, name: "Handover",         pct: 15 },
        ];
      }
      for (const m of milestones) {
        await pool.request()
          .input("bid",  sql.Int,           bookingId)
          .input("mno",  sql.Int,           m.no)
          .input("mname",sql.NVarChar(200), m.name)
          .input("amt",  sql.Decimal(18,2), Math.round(total * m.pct) / 100)
          .input("cb",   sql.Int,           actorId(req))
          .query(`
            INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, Status, CreatedBy, CreatedAt)
            VALUES (@bid, @mno, @mname, @amt, 'Pending', @cb, SYSDATETIME())
          `);
      }
    }

    // A booking existing at all is the strongest possible signal that the
    // application behind it was approved — advance it automatically instead
    // of relying on someone to remember to flip the status by hand. Applies
    // to Submitted only (Draft applications shouldn't silently skip review);
    // already-Approved is a no-op.
    await advanceApplicationStatus(pool, parseInt(b.ApplicationId), "Approved", "AutoBooking",
      `Auto-approved: booking ${bookingNo} created`, actorId(req), { force: true });

    res.status(201).json({ success: true, id: bookingId, BookingNo: bookingNo });
  } catch (e) {
    console.error("[crm-bookings] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update booking. Status is never accepted here — it is fixed at
// creation ('Confirmed') and can only become 'Cancelled' via the
// CrmCancellation approval cascade in crmCancellations.js. UnitType and
// AreaSqFt are also never accepted here — both are inherited once from Unit
// Master at creation and the unit itself never changes on an existing booking.
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
