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
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { postCrmCancellationRefundToGL } = require("../services/crmLedger");
const { releaseAllParkingForBooking } = require("./crmParking");
const { emitNotification } = require("../services/notify");
const { findActiveHold, releaseHold } = require("../services/crmHoldService");
const { syncApplicationOnBookingTerminal } = require("../services/crmApplicationWorkflow");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// The set of company banks THIS booking's real payments actually landed in
// (milestone receipts + on-account deposits, wherever DepositBankId is set).
// Feeds the refund's own bank default: "the same account, same" only makes
// sense to auto-apply when every payment agrees on one bank — a booking
// whose milestones landed across more than one company bank has no single
// "same account" answer, so the frontend forces an explicit pick instead of
// guessing.
const DEPOSIT_BANKS_FOR_BOOKING = `
  (SELECT r.DepositBankId FROM dbo.CrmPaymentReceipt r
     JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
     WHERE m.BookingId = b.Id AND r.DepositBankId IS NOT NULL
   UNION ALL
   SELECT DepositBankId FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id AND DepositBankId IS NOT NULL) x
`;

const CANCEL_SELECT = `
  SELECT
    c.Id, c.CancellationNo, c.BookingId, c.RequestedDate, c.Reason, c.AmountPaidTillDate,
    c.DeductionPercent, c.DeductionAmount, c.RefundAmount, c.Status,
    c.RequestedBy, c.ApprovedBy, c.ApprovedAt, c.RefundDate, c.RefundMode,
    c.RefundRef, c.RefundBankId, c.Notes, c.CreatedAt, c.UpdatedAt,
    b.BookingNo, b.UnitNo, b.ProjectName, b.ProjectId, b.TotalValue, b.AssignedTo,
    a.ApplicantName, a.Mobile,
    rb.name AS RequestedByName, ab.name AS ApprovedByName,
    (SELECT COUNT(DISTINCT x.DepositBankId) FROM ${DEPOSIT_BANKS_FOR_BOOKING}) AS DistinctDepositBankCount,
    (SELECT TOP 1 x.DepositBankId FROM ${DEPOSIT_BANKS_FOR_BOOKING}) AS SingleDepositBankId
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
//
// Workflow guard: once the sales deed is Registered, the unit is legally
// conveyed — a simple refund-and-release cancellation is no longer the
// correct instrument (that needs a formal deed-cancellation/deed-of-
// rescission process, not this flow). Blocked here rather than silently
// letting staff "cancel" a booking whose title has already legally passed.
router.post("/", requirePageRight("crm-cancellations", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query(`SELECT TOP 1 Status FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (deed.recordset.length && deed.recordset[0].Status === "Registered") {
      return res.status(400).json({ error: "This booking's sales deed is already Registered — a legal deed-cancellation process is required, not a standard cancellation request" });
    }

    const paidRes = await pool.request().input("bid", sql.Int, bookingId)
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) +
          (SELECT ISNULL(SUM(BalanceAmount), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS TotalPaid
      `);
    const totalPaid = paidRes.recordset[0].TotalPaid || 0;

    // Default 10% cancellation charge if the requester doesn't override it.
    // No per-project/per-plan cancellation policy exists yet to validate
    // against, but the proposed number must still be a sane percentage —
    // previously this was taken straight from req.body with only a numeric
    // parse, so anyone with create rights could pass a negative or >100%
    // value at request time (the real approve/reject gate is later, but the
    // *proposed* record itself was unconstrained).
    let deductionPct = 10;
    if (b.DeductionPercent != null) {
      deductionPct = parseFloat(b.DeductionPercent);
      if (!Number.isFinite(deductionPct) || deductionPct < 0 || deductionPct > 100) {
        return res.status(400).json({ error: "DeductionPercent must be a number between 0 and 100" });
      }
    }
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
// Blocked once Refunded — that's the final, GL-posted state; the notes on a
// completed refund shouldn't be quietly rewritable afterward.
router.put("/:id", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status === "Refunded") {
      return res.status(400).json({ error: "This cancellation has already been refunded — notes can no longer be edited" });
    }

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
// approvalTransition(). On approval:
//   1. Refund figures are recomputed fresh (AmountPaidTillDate/DeductionAmount/
//      RefundAmount were frozen at request time — if a payment landed on the
//      booking while the request sat Pending, that would otherwise be
//      silently absorbed into the refund liability without ever updating
//      the record). Never blocks approval, just corrects the numbers.
//   2. The underlying booking is cancelled. Status='Cancelled' is what every
//      active-workflow dropdown now excludes by default (see crmBookings.js
//      GET /) — IsActive is deliberately left alone since it's an orthogonal
//      soft-delete flag used elsewhere, not a cancellation signal.
//   3. Every parking slot allotted to this booking is released back to
//      available inventory (previously a permanent leak — nothing released
//      a cancelled booking's parking).
//   4. Any pending CrmBookingAmendmentRequest for this booking is
//      auto-rejected — approving one after the booking is cancelled would
//      otherwise create a live Extra Charge/Parking allotment on a dead
//      booking (the requireActiveBooking() guards added to those apply*
//      functions would now reject it anyway, but leaving the request
//      dangling forever as "Pending" is its own kind of clutter/confusion).
router.put("/:id/approve", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();

    const before = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, AmountPaidTillDate, DeductionPercent, Notes FROM dbo.CrmCancellation WHERE Id = @id");
    if (!before.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    const { BookingId: bookingId, AmountPaidTillDate: staleAmountPaid, DeductionPercent: deductionPct, Notes: existingNotes } = before.recordset[0];

    const freshPaidRes = await pool.request().input("bid", sql.Int, bookingId)
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) +
          (SELECT ISNULL(SUM(BalanceAmount), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS TotalPaid
      `);
    const freshTotalPaid = freshPaidRes.recordset[0].TotalPaid || 0;
    if (Math.abs(freshTotalPaid - Number(staleAmountPaid || 0)) >= 1) {
      const deductionAmt = Math.round(freshTotalPaid * deductionPct) / 100;
      const refundAmt = Math.max(0, freshTotalPaid - deductionAmt);
      const note = `[Auto-recomputed at approval] Paid amount changed from ₹${Number(staleAmountPaid || 0).toLocaleString("en-IN")} to ₹${freshTotalPaid.toLocaleString("en-IN")} since the request was filed — refund figures updated accordingly.`;
      await pool.request()
        .input("id", sql.Int, id)
        .input("paid", sql.Decimal(18, 2), freshTotalPaid)
        .input("damt", sql.Decimal(18, 2), deductionAmt)
        .input("ramt", sql.Decimal(18, 2), refundAmt)
        .input("notes", sql.NVarChar(sql.MAX), existingNotes ? `${existingNotes}\n${note}` : note)
        .query(`
          UPDATE dbo.CrmCancellation SET
            AmountPaidTillDate = @paid, DeductionAmount = @damt, RefundAmount = @ramt,
            Notes = @notes, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    }

    const result = await approvalTransition("crm-cancellations", id, "Approved", userEmail, req.user?.role);

    // The generic approvalTransition() engine only ever writes the Status
    // column — ApprovedBy/ApprovedAt exist on this table but were never
    // populated by anything, permanently NULL despite CANCEL_SELECT joining
    // them in as ApprovedByName. Set explicitly here rather than changing
    // the shared engine (which every other approval-gated CRM module also
    // uses, with its own column-naming conventions).
    await pool.request().input("id", sql.Int, id).input("ab", sql.Int, actorId(req))
      .query("UPDATE dbo.CrmCancellation SET ApprovedBy = @ab, ApprovedAt = SYSDATETIME() WHERE Id = @id");

    await pool.request().input("bid", sql.Int, bookingId)
      .query("UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedAt = SYSDATETIME() WHERE Id = @bid");

    // The Application was force-advanced to 'Approved' the instant this
    // Booking was created and nothing has touched it since — without this,
    // it would sit at 'Approved' forever with a Cancelled Booking
    // underneath, indistinguishable from a genuinely active sale.
    await syncApplicationOnBookingTerminal(pool, bookingId, "Cancelled", "BookingCancelled",
      "Application cancelled — its booking was cancelled", actorId(req));

    await releaseAllParkingForBooking(pool, bookingId);

    // Orphaned Brokerage Clawback
    // Void any pending brokerage tranches for this cancelled booking, and flag paid ones for clawback.
    await pool.request().input("bid", sql.Int, bookingId).query(`
      UPDATE dbo.CrmBrokerageMaster 
      SET Status = 'Voided', UpdatedAt = SYSDATETIME(), Notes = ISNULL(Notes, '') + char(10) + 'Auto-voided due to booking cancellation.'
      WHERE BookingId = @bid AND Status = 'Pending';
      
      UPDATE dbo.CrmBrokerageMaster 
      SET Status = 'Clawback Required', UpdatedAt = SYSDATETIME(), Notes = ISNULL(Notes, '') + char(10) + 'Clawback required due to booking cancellation.'
      WHERE BookingId = @bid AND Status = 'Paid';
    `);

    // guardAndConvertHold() closes the Unit's hold to 'Converted' the moment
    // a Booking is created from it — but if an Active hold on this same unit
    // still lingers for any reason (e.g. legacy data from before that
    // conversion existed), a Cancelled booking must not leave it standing:
    // that would keep blocking every other genuinely current applicant for
    // a unit that just became free again.
    const unitRow = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT UnitId FROM dbo.CrmBooking WHERE Id = @bid");
    const unitId = unitRow.recordset[0]?.UnitId;
    if (unitId) {
      const stuckHold = await findActiveHold(pool, "Unit", unitId);
      if (stuckHold) await releaseHold(pool, stuckHold.Id, actorId(req));
    }

    const pendingAmendments = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, RequestedBy FROM dbo.CrmBookingAmendmentRequest WHERE BookingId = @bid AND Status = 'Pending'");
    for (const amend of pendingAmendments.recordset) {
      await pool.request().input("id", sql.Int, amend.Id).input("rb", sql.Int, actorId(req))
        .query(`
          UPDATE dbo.CrmBookingAmendmentRequest SET
            Status = 'Rejected', ReviewedBy = @rb, ReviewedAt = SYSDATETIME(),
            ReviewNotes = 'Auto-rejected — the booking was cancelled'
          WHERE Id = @id
        `);
      if (amend.RequestedBy) {
        await emitNotification(pool, amend.RequestedBy, "crm_booking_amendment_rejected",
          "Amendment Request Auto-Rejected",
          "Your requested change was auto-rejected because the booking was cancelled.",
          amend.Id, "crm_booking_amendment");
      }
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
    const result = await approvalTransition("crm-cancellations", id, "Rejected", userEmail, req.user?.role, req.body?.note || null);
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
      .query(`
        SELECT c.Status, b.ProjectId
        FROM dbo.CrmCancellation c
        JOIN dbo.CrmBooking b ON b.Id = c.BookingId
        WHERE c.Id = @id
      `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status !== "Approved") {
      return res.status(400).json({ error: `Cannot mark refunded — cancellation must be Approved (currently '${cur.recordset[0].Status}')` });
    }

    // Same mandatory-bank rule as every deposit — mirrored for the money
    // going back out. "Same account, same" is only ever a frontend default;
    // the requirement itself doesn't relax just because this is a refund.
    const tagged = await pool.request().input("pid", sql.Int, cur.recordset[0].ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !b.RefundBankId) {
      return res.status(400).json({ error: "Refund bank is required for this project" });
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("rdate", sql.Date,          b.RefundDate || null)
      .input("rmode", sql.NVarChar(50),  b.RefundMode || null)
      .input("rref",  sql.NVarChar(200), b.RefundRef  || null)
      .input("rbank", sql.Int,           b.RefundBankId ? parseInt(b.RefundBankId) : null)
      .query(`
        UPDATE dbo.CrmCancellation SET
          Status = 'Refunded',
          RefundDate = ISNULL(@rdate, CAST(SYSDATETIME() AS DATE)),
          RefundMode = @rmode, RefundRef = @rref, RefundBankId = @rbank,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Post to the core Finance GL — cash actually paid back to the customer.
    // Never allowed to fail the refund record itself.
    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      const outcome = await postCrmCancellationRefundToGL(pool, id, actorEmail);
      await recordGLPosting("crm-cancellation-refund", id, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-cancellation-refund", id, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-cancellations] mark-refunded error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
