const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// POST /:id/demand — raise a payment demand for a milestone, notifying the applicant's assignee
router.post("/:id/demand", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const m = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.MilestoneName, m.AmountDue, m.AmountPaid, b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Id = @id
    `);
    if (!m.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const row = m.recordset[0];
    const balance = (row.AmountDue || 0) - (row.AmountPaid || 0);

    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmPaymentMilestone SET DemandRaisedAt = SYSDATETIME() WHERE Id = @id");

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "payment_demand",
        "Payment Demand Raised",
        `${row.ApplicantName} · ${row.BookingNo} — ${row.MilestoneName} demand raised (₹${balance.toLocaleString("en-IN")})`,
        id, "payment_milestone");
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-payments] POST /:id/demand error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/receipts — receipt history for a milestone
router.get("/:id/receipts", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT r.*, cu.name AS CreatedByName
      FROM dbo.CrmPaymentReceipt r
      LEFT JOIN dbo.Users cu ON cu.id = r.CreatedBy
      WHERE r.MilestoneId = @id
      ORDER BY r.ReceivedDate DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-payments] GET /:id/receipts error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/receipts — record a receipt against a milestone (supports partial/installment receipts)
router.post("/:id/receipts", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
    await pool.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("mid",  sql.Int,           id)
      .input("amt",  sql.Decimal(18,2), amount)
      .input("rdt",  sql.Date,          b.ReceivedDate || null)
      .input("mode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref", sql.NVarChar(200), b.TransactionRef || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentReceipt
          (ReceiptNo, MilestoneId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt)
        VALUES (@no, @mid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME())
      `);

    // Roll up receipts into the milestone's AmountPaid / Status
    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
        Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                       THEN 'Paid' ELSE Status END,
        PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    res.status(201).json({ success: true, ReceiptNo: receiptNo });
  } catch (e) {
    console.error("[crm-payments] POST /:id/receipts error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /escalate-overdue — scan for overdue milestones and notify the assigned
// salesperson + marketing head once per milestone (admin/cron-triggered).
router.post("/escalate-overdue", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const pool = getPool();
    const overdue = await pool.request().query(`
      SELECT m.Id, m.MilestoneName, m.AmountDue, m.AmountPaid, m.DueDate,
             b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Status = 'Pending' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
    `);
    let notified = 0;
    for (const m of overdue.recordset) {
      const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
      if (m.AssignedTo) {
        await emitNotification(pool, m.AssignedTo, "payment_overdue",
          "Payment Overdue",
          `${m.ApplicantName} · ${m.BookingNo} — ${m.MilestoneName} overdue (₹${balance.toLocaleString("en-IN")} pending)`,
          m.Id, "payment_milestone");
        notified++;
      }
    }
    res.json({ success: true, overdueCount: overdue.recordset.length, notified });
  } catch (e) {
    console.error("[crm-payments] POST /escalate-overdue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — milestone payment schedule for a booking
router.get("/booking/:bookingId", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const [milRes, bkRes] = await Promise.all([
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT m.*, cu.name AS CreatedByName
        FROM dbo.CrmPaymentMilestone m
        LEFT JOIN dbo.Users cu ON cu.id = m.CreatedBy
        WHERE m.BookingId = @bid
        ORDER BY m.MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT b.BookingNo, b.TotalValue, b.UnitNo, b.ProjectName,
               a.ApplicantName, a.Mobile
        FROM dbo.CrmBooking b
        JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.Id = @bid
      `),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });

    // Compute summary
    const milestones = milRes.recordset;
    const totalDue  = milestones.reduce((s, m) => s + (m.AmountDue  || 0), 0);
    const totalPaid = milestones.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    const overdue   = milestones.filter((m) => m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date()).length;

    res.json({
      booking: bkRes.recordset[0],
      milestones,
      summary: { totalDue, totalPaid, balance: totalDue - totalPaid, overdue },
    });
  } catch (e) {
    console.error("[crm-payments] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId — add a custom milestone
router.post("/booking/:bookingId", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.MilestoneName?.trim()) return res.status(400).json({ error: "MilestoneName is required" });

    // Get next MilestoneNo
    const noRes = await pool.request().input("bid", sql.Int, bid)
      .query("SELECT ISNULL(MAX(MilestoneNo),0) + 1 AS NextNo FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    const nextNo = noRes.recordset[0].NextNo;

    await pool.request()
      .input("bid",   sql.Int,           bid)
      .input("mno",   sql.Int,           nextNo)
      .input("mname", sql.NVarChar(200), b.MilestoneName.trim())
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), b.AmountDue != null ? parseFloat(b.AmountDue) : 0)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @mno, @mname, @due, @amt, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-payments] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update milestone (record payment, update due date). Status is
// never accepted from the request body — it is always derived from the
// AmountPaid vs AmountDue comparison. Waived is a distinct, explicit business
// decision and only happens via /:id/waive below.
router.put("/:id", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const paid = b.AmountPaid != null ? parseFloat(b.AmountPaid) : null;

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("mname", sql.NVarChar(200), b.MilestoneName || null)
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), b.AmountDue  != null ? parseFloat(b.AmountDue) : null)
      .input("paid",  sql.Decimal(18,2), paid)
      .input("pdate", sql.Date,          b.PaidDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref",  sql.NVarChar(200), b.TransactionRef || null)
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          MilestoneName  = ISNULL(@mname, MilestoneName),
          DueDate        = ISNULL(@due,   DueDate),
          AmountDue      = ISNULL(@amt,   AmountDue),
          AmountPaid     = ISNULL(@paid,  AmountPaid),
          PaidDate       = ISNULL(@pdate, PaidDate),
          PaymentMode    = ISNULL(@pmode, PaymentMode),
          TransactionRef = ISNULL(@tref,  TransactionRef),
          Status = CASE
            WHEN Status = 'Waived' THEN Status
            WHEN @paid IS NOT NULL AND @paid >= AmountDue THEN 'Paid'
            ELSE Status
          END,
          Remarks   = @rem,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-payments] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/waive — explicit business decision to waive a milestone. Requires
// a reason so it's auditable, unlike a free Status dropdown pick.
router.put("/:id/waive", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.Reason) return res.status(400).json({ error: "Reason is required to waive a milestone" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    if (cur.recordset[0].Status === "Paid") {
      return res.status(400).json({ error: "Cannot waive an already-paid milestone" });
    }

    await pool.request()
      .input("id",  sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), b.Reason)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          Status = 'Waived', Remarks = @rem, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Waived" });
  } catch (e) {
    console.error("[crm-payments] waive error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
