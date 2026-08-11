// backend/routes/crmMoneyReceipts.js
//
// Money Receipt — a downloadable, customer-facing PDF generated as a direct
// byproduct of submitting the Booking Amount payment (Milestone #1) via the
// existing "Submit Payment for Approval" flow on the Booking page (see
// crmPayments.js's createReceiptForMilestone). It is NOT a separate,
// independently-typed record: one real payment, one place it's entered.
//
// Its Status is never stored/mutated here — it mirrors the linked
// ReceivedPayment row live (Pending / Approved / Bounced, see
// moneyReceiptPdf.js's deriveStatus). Approving or rejecting that payment
// from Finance's existing Received Payment queue IS approving or bouncing
// this receipt; there is exactly one approval for one real payment. A
// bounced cheque followed by a fresh "Submit Payment for Approval" attempt
// naturally produces its own new Money Receipt — that's the "ask for
// repayment/reissue" flow, with no separate bounce mechanism needed.
//
// This route file is therefore read-only: list, detail, and PDF.
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { getMoneyReceiptPdfBuffer, deriveStatus } = require("../services/moneyReceiptPdf");

router.use(authMiddleware);
router.use(apiRateLimit);

// ── GET / — list, optionally scoped to a booking ────────────────────────────
router.get("/", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (bookingId) { req0.input("bid", sql.Int, parseInt(bookingId)); conds.push("mr.BookingId = @bid"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT mr.Id, mr.ReceiptNo, mr.BookingId, mr.Amount, mr.PaymentMode, mr.ChequeNo, mr.ChequeDate,
             mr.TransactionRef, mr.ReceivedDate, mr.CreatedAt, mr.ReceivedPaymentId,
             rp.RPStatus, rp.RPRejectionNote,
             b.BookingNo, b.ProjectName, b.UnitNo,
             a.ApplicantName, a.Mobile
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
      ${where}
      ORDER BY mr.CreatedAt DESC
    `);
    const rows = result.recordset.map((r) => {
      const Status = deriveStatus(r.RPStatus);
      return { ...r, Status, BouncedReason: Status === "Bounced" ? r.RPRejectionNote : null };
    });
    res.json(rows);
  } catch (e) {
    console.error("[crm-money-receipts] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT mr.*, rp.RPStatus, rp.RPRejectionNote, b.BookingNo, b.WorkflowStage, a.ApplicantName
      FROM dbo.CrmMoneyReceipt mr
      JOIN dbo.CrmBooking b ON b.Id = mr.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = mr.ReceivedPaymentId
      WHERE mr.Id = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Money receipt not found" });
    const row = result.recordset[0];
    row.Status = deriveStatus(row.RPStatus);
    if (row.Status === "Bounced") row.BouncedReason = row.RPRejectionNote;
    res.json(row);
  } catch (e) {
    console.error("[crm-money-receipts] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /:id/pdf ─────────────────────────────────────────────────────────────
router.get("/:id/pdf", requirePageRight("crm-money-receipts", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const row = await pool.request().input("id", sql.Int, id).query("SELECT ReceiptNo FROM dbo.CrmMoneyReceipt WHERE Id = @id");
    if (!row.recordset.length) return res.status(404).json({ error: "Money receipt not found" });
    const buffer = await getMoneyReceiptPdfBuffer(pool, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.recordset[0].ReceiptNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-money-receipts] GET /:id/pdf error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
