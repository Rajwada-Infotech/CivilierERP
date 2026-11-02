const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { crmProjectGuards } = require("../services/projectScope");
const { CrmStatus } = require("../constants/crmStatuses");
const { getBookingFunding, onAccountWithAvailableSql } = require("../services/crmPaymentFunding");

router.use(apiRateLimit);
router.use(authMiddleware);
// :bookingId is refused for a booking outside the user's projects.
crmProjectGuards(router);

// GET /:bookingId — one buyer's money on one booking, read-only, by date.
//
// Every row is a record that already exists (a demand, a payment, an on-account
// deposit, a receipt still awaiting approval, a refund) with its own amount and
// status. Nothing is summed across those kinds here: the totals are
// getBookingFunding's (the same figures On Account and the full-booking hold
// use), plus each demand's own due-minus-paid. So a deposit later applied to a
// demand is shown twice as an event ("received on account", then "applied")
// but counted once.
router.get("/:bookingId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  const id = parseId(req.params.bookingId);
  if (id === null) return res.status(400).json({ error: "Invalid booking id" });
  try {
    const pool = getPool();
    const bk = (await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingNo, ProjectId FROM dbo.CrmBooking WHERE Id = @id")).recordset[0];
    if (!bk) return res.status(404).json({ error: "Booking not found" });

    const q = (text) => pool.request().input("id", sql.Int, id).query(text);
    const [milestones, payments, deposits, receipts, refunds, funding] = await Promise.all([
      q(`SELECT Id, MilestoneName, DueDate, AmountDue, ISNULL(AmountPaid, 0) AS AmountPaid, Status,
                DemandStatus, DemandNo, COALESCE(DemandRaisedOn, CAST(DemandRaisedAt AS DATE)) AS DemandDate
         FROM dbo.CrmPaymentMilestone WHERE BookingId = @id
         ORDER BY DueDate, Id`),
      q(`SELECT r.Id, r.ReceiptNo, r.Amount, r.ReceivedDate, r.PaymentMode, r.TransactionRef,
                r.OnAccountPaymentId, m.MilestoneName
         FROM dbo.CrmPaymentReceipt r
         JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
         WHERE m.BookingId = @id`),
      q(`SELECT o.Id, o.ReceiptNo, o.Amount, ISNULL(o.AppliedAmount, 0) AS AppliedAmount, o.AvailableAmount,
                o.Status, o.ReceivedDate, o.PaymentMode, o.TransactionRef
         FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = @id`),
      // Approved receipts already appear as the payment or deposit they became.
      q(`SELECT Id, ReceiptNo, Amount, ReceivedDate, PaymentMode, TransactionRef, Status
         FROM dbo.CrmMoneyReceipt
         WHERE BookingId = @id AND Status = '${CrmStatus.PENDING}' AND ReceivedPaymentId IS NULL`),
      q(`SELECT f.Id, f.RefundNo, f.NetAmount, f.Status, f.Reason, f.RefundDueDate, f.CreatedAt,
                (SELECT STRING_AGG(n.DocNo, ', ') FROM dbo.CrmGstNote n WHERE n.RefundId = f.Id) AS GstNotes
         FROM dbo.CrmRefund f WHERE f.BookingId = @id`),
      getBookingFunding(pool, id),
    ]);

    const raised = (m) => m.DemandStatus && m.DemandStatus !== CrmStatus.PENDING;
    const waived = (m) => m.Status === "Waived";
    const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
    const inr = (v) => `₹${Number(v).toLocaleString("en-IN")}`;
    const entries = [];

    for (const m of milestones.recordset.filter((x) => raised(x) && !waived(x))) {
      entries.push({
        kind: "demand", date: day(m.DemandDate) || day(m.DueDate), ref: m.DemandNo,
        text: m.MilestoneName, amount: Number(m.AmountDue), status: m.Status,
        detail: m.DueDate ? `Due ${day(m.DueDate)}` : null,
      });
    }
    for (const p of payments.recordset) {
      const fromDeposit = p.OnAccountPaymentId != null;
      entries.push({
        kind: fromDeposit ? "applied" : "payment", date: day(p.ReceivedDate), ref: p.ReceiptNo,
        text: fromDeposit ? `Applied from on account to ${p.MilestoneName}` : `Paid against ${p.MilestoneName}`,
        amount: Number(p.Amount), status: null,
        detail: fromDeposit ? null : [p.PaymentMode, p.TransactionRef].filter(Boolean).join(" · ") || null,
      });
    }
    for (const d of deposits.recordset) {
      // A bounced deposit never reached the account (its available amount is 0).
      entries.push({
        kind: d.Status === "Bounced" ? "void" : "deposit", date: day(d.ReceivedDate), ref: d.ReceiptNo,
        text: "Received on account", amount: Number(d.Amount), status: d.Status,
        detail: [d.PaymentMode, d.TransactionRef,
          Number(d.AppliedAmount) > 0 ? `${inr(d.AppliedAmount)} applied` : null,
          Number(d.AvailableAmount) > 0 ? `${inr(d.AvailableAmount)} still available` : null]
          .filter(Boolean).join(" · ") || null,
      });
    }
    for (const r of receipts.recordset) {
      entries.push({
        kind: "awaiting", date: day(r.ReceivedDate), ref: r.ReceiptNo,
        text: "Receipt awaiting approval", amount: Number(r.Amount), status: r.Status,
        detail: [r.PaymentMode, r.TransactionRef].filter(Boolean).join(" · ") || null,
      });
    }
    for (const f of refunds.recordset) {
      entries.push({
        kind: f.Status === CrmStatus.REJECTED ? "void" : "refund", date: day(f.CreatedAt), ref: f.RefundNo,
        text: f.Reason ? `Refund — ${f.Reason}` : "Refund", amount: Number(f.NetAmount), status: f.Status,
        detail: f.GstNotes ? `GST note ${f.GstNotes}` : null,
      });
    }
    entries.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    const live = milestones.recordset.filter((m) => !waived(m));
    const demandedOpen = live.filter(raised)
      .reduce((n, m) => n + Math.max(0, Number(m.AmountDue) - Number(m.AmountPaid)), 0);
    const upcoming = live.filter((m) => !raised(m)).map((m) => ({
      text: m.MilestoneName, dueDate: day(m.DueDate), amount: Number(m.AmountDue), paid: Number(m.AmountPaid),
    }));
    const awaiting = receipts.recordset.reduce((n, r) => n + Number(r.Amount), 0);

    res.json({
      BookingId: id,
      BookingNo: bk.BookingNo,
      totals: {
        price: funding.requiredAmount,
        paid: funding.milestonePaid,
        onAccount: funding.onAccountAvailable,
        balance: funding.shortfall,
        demandedOpen: Math.round(demandedOpen * 100) / 100,
        awaitingApproval: Math.round(awaiting * 100) / 100,
      },
      entries,
      upcoming,
    });
  } catch (e) {
    console.error("[crm-booking-statement] error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
