const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");

const { getNextDocNumber } = require("../services/docNumber");
// Approve/reject is gated to admin/super_admin/marketing_head via this shared
// engine — same mechanism BOQ/Purchase Orders/etc. use — instead of any
// editor being able to self-approve a cancellation/refund on this page.
const { transition: approvalTransition } = require("../services/approvalService");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const CANCEL_SELECT = `
  SELECT
    c.Id, c.CancellationNo, c.BookingId, c.RequestedDate, c.Reason, c.AmountPaidTillDate,
    c.DeductionPercent, c.DeductionAmount, c.RefundAmount, c.Status,
    c.RequestedBy, c.ApprovedBy, c.ApprovedAt, c.RefundDate, c.RefundMode,
    c.RefundRef, c.Notes, c.CreatedAt, c.UpdatedAt,
    b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.AssignedTo,
    a.ApplicantName, a.Mobile,
    rb.name AS RequestedByName, ab.name AS ApprovedByName
  FROM dbo.CrmCancellation c
  JOIN  dbo.CrmBooking b     ON b.Id = c.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users rb ON rb.id = c.RequestedBy
  LEFT JOIN dbo.Users ab ON ab.id = c.ApprovedBy
`;

// GET / — all cancellation requests
router.get("/", requirePageRight("crm-cancellations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("c.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${CANCEL_SELECT} ${where} ORDER BY c.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-cancellations] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — request a cancellation; auto-computes refund from paid milestones
router.post("/", requirePageRight("crm-cancellations", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });

    const paidRes = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT ISNULL(SUM(AmountPaid), 0) AS TotalPaid FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    const totalPaid = paidRes.recordset[0].TotalPaid || 0;

    const deductionPct = b.DeductionPercent != null ? parseFloat(b.DeductionPercent) : 10; // default 10% cancellation charge
    const deductionAmt = Math.round(totalPaid * deductionPct) / 100;
    const refundAmt = Math.max(0, totalPaid - deductionAmt);
    const cancellationNo = await getNextDocNumber(pool, "CXL", "CXL");

    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  cancellationNo)
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("reason",sql.NVarChar(sql.MAX), b.Reason || null)
      .input("paid",  sql.Decimal(18,2), totalPaid)
      .input("dpct",  sql.Decimal(5,2),  deductionPct)
      .input("damt",  sql.Decimal(18,2), deductionAmt)
      .input("ramt",  sql.Decimal(18,2), refundAmt)
      .input("rb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCancellation
          (CancellationNo, BookingId, Reason, AmountPaidTillDate, DeductionPercent, DeductionAmount, RefundAmount, Status, RequestedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @reason, @paid, @dpct, @damt, @ramt, 'Pending', @rb, SYSDATETIME())
      `);

    res.status(201).json({
      success: true, id: result.recordset[0].Id, CancellationNo: cancellationNo,
      totalPaid, deductionAmt, refundAmt,
    });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A cancellation request already exists for this booking" });
    console.error("[crm-cancellations] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit notes only. Status is never settable here — Approved/
// Rejected go through the endpoints below, Refunded through /:id/mark-refunded.
router.put("/:id", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    await pool.request()
      .input("id",    sql.Int,           id)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .query("UPDATE dbo.CrmCancellation SET Notes = ISNULL(@notes, Notes), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-cancellations] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending (resubmit)
router.put("/:id/submit", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-cancellations", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition(). On approval, the underlying booking is cancelled.
router.put("/:id/approve", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    const result = await approvalTransition("crm-cancellations", id, "Approved", userEmail, req.user?.role);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmCancellation WHERE Id = @id");
    if (cur.recordset.length) {
      await pool.request().input("bid", sql.Int, cur.recordset[0].BookingId)
        .query("UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedAt = SYSDATETIME() WHERE Id = @bid");
    }

    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/marketing_head only.
router.put("/:id/reject", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-cancellations", id, "Rejected", userEmail, req.user?.role, req.body?.Remarks || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/mark-refunded — a business action (recording that money actually
// moved), not an approval decision — any editor can do this once Approved.
router.put("/:id/mark-refunded", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status !== "Approved") {
      return res.status(400).json({ error: `Cannot mark refunded — cancellation must be Approved (currently '${cur.recordset[0].Status}')` });
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("rdate", sql.Date,          b.RefundDate || null)
      .input("rmode", sql.NVarChar(50),  b.RefundMode || null)
      .input("rref",  sql.NVarChar(200), b.RefundRef  || null)
      .query(`
        UPDATE dbo.CrmCancellation SET
          Status = 'Refunded',
          RefundDate = ISNULL(@rdate, CAST(SYSDATETIME() AS DATE)),
          RefundMode = @rmode, RefundRef = @rref,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-cancellations] mark-refunded error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
