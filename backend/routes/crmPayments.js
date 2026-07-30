const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");
const { maybeAutoCreateSalesDeed, maybeAutoGenerateInvoice, maybeAutoCreateBrokerage, maybeUnlockBrokerageMilestoneTranche, requireActiveBooking, recalculateRemainingMilestones } = require("../services/crmWorkflowGuards");
const { postCrmReceiptToGL, postCrmOnAccountToGL, postCrmOnAccountApplied } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Spec: "BROKER PAYMENT -> NEXT MILESTONE DUE". Business confirmed this should
// be a soft warning, not a hard block (a customer's payment must never be
// refused over unrelated broker bookkeeping) — so this fires alongside the
// milestone being marked Paid rather than gating it. Returns a short string
// for the caller's response (surfaced as a toast) and also drops a proactive
// reminder notification into the bell for whoever registered the brokerage,
// since they're the one who'd action the actual payout.
async function warnIfBrokerUnpaid(pool, bookingId, actorUserId) {
  const br = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id, BrokerName, Status, CreatedBy
    FROM dbo.CrmBrokerageMaster
    WHERE BookingId = @bid AND Status IN ('Pending', 'Approved')
    ORDER BY CreatedAt DESC
  `);
  if (!br.recordset.length) return null;
  const row = br.recordset[0];

  const warning = `Broker ${row.BrokerName || ""} has not been fully paid yet (brokerage status: ${row.Status}) — the next milestone is now due regardless, but broker payout is outstanding.`.trim();

  if (row.CreatedBy) {
    await emitNotification(
      pool, row.CreatedBy, "brokerage_payment_reminder",
      "Broker payment still pending",
      warning, row.Id, "crm-brokerage",
    );
  }
  return warning;
}

// Shared by PUT /on-account/:id/apply (an explicit staff pick) AND
// autoApplyOnAccount below (the automatic sweep that now runs right after
// money lands on a booking's On Account balance) — applies part or all of
// one on-account deposit's remaining balance to one target milestone,
// enforcing the same "earlier milestones must already be Paid/Waived"
// sequencing guard either way, so on-account money can never be used to
// skip ahead in the payment plan regardless of which path put it there.
// Returns { error } on failure, or { applied, remaining, becamePaid } on
// success — callers decide how to surface that (HTTP response vs. just
// looping to the next deposit/milestone).
async function applyOnAccountToMilestone(pool, { onAccountId, milestoneId, amount, actorUserId, actorEmail }) {
  const oa = await pool.request().input("id", sql.Int, onAccountId)
    .query("SELECT BookingId, Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  if (!oa.recordset.length) return { error: "On-account payment not found" };
  const oaRow = oa.recordset[0];
  const remaining = Number(oaRow.Amount) - Number(oaRow.AppliedAmount);

  const target = await pool.request().input("id", sql.Int, milestoneId)
    .query("SELECT BookingId, MilestoneNo, MilestoneName, AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WHERE Id = @id");
  if (!target.recordset.length) return { error: "Milestone not found" };
  const targetRow = target.recordset[0];
  if (targetRow.BookingId !== oaRow.BookingId) {
    return { error: "This on-account deposit belongs to a different booking" };
  }

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) return { error: activeErr };

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('Paid', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    return { error: `Cannot apply to "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first` };
  }

  const milestoneBalance = Number(targetRow.AmountDue) - Number(targetRow.AmountPaid || 0);
  const requested = Math.min(remaining, milestoneBalance, amount != null ? amount : Infinity);
  if (!requested || requested <= 0) return { error: "Nothing to apply" };

  const receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
  await pool.request()
    .input("no",  sql.NVarChar(30),  receiptNo)
    .input("mid", sql.Int,           milestoneId)
    .input("amt", sql.Decimal(18,2), requested)
    .input("oaid",sql.Int,           onAccountId)
    .input("cb",  sql.Int,           actorUserId)
    .query(`
      INSERT INTO dbo.CrmPaymentReceipt
        (ReceiptNo, MilestoneId, Amount, ReceivedDate, PaymentMode, Notes, OnAccountPaymentId, CreatedBy, CreatedAt)
      VALUES (@no, @mid, @amt, CAST(SYSDATETIME() AS DATE), 'OnAccount', 'Auto-applied from on-account balance', @oaid, @cb, SYSDATETIME())
    `);

  await pool.request().input("id", sql.Int, milestoneId).query(`
    UPDATE dbo.CrmPaymentMilestone SET
      AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
      Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                     THEN 'Paid' ELSE Status END,
      PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                      THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
      DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                      THEN 'Paid' ELSE DemandStatus END,
      UpdatedAt = SYSDATETIME()
    WHERE Id = @id
  `);

  const newApplied = Number(oaRow.AppliedAmount) + requested;
  await pool.request()
    .input("id", sql.Int, onAccountId)
    .input("applied", sql.Decimal(18,2), newApplied)
    .input("status", sql.NVarChar(20), newApplied >= Number(oaRow.Amount) ? "Applied" : "PartiallyApplied")
    .query("UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = @applied, Status = @status WHERE Id = @id");

  // Not new cash — the deposit's cash was already posted to GL when it was
  // received. This just moves the party's advance balance (OnAccountLedger)
  // from "unapplied" to "applied against this milestone."
  try {
    await postCrmOnAccountApplied(pool, onAccountId, requested, actorEmail);
  } catch (glErr) {
    console.error("[crm-payments] postCrmOnAccountApplied failed:", glErr.message);
  }

  const finalCheck = await pool.request().input("id", sql.Int, milestoneId).query("SELECT Status FROM dbo.CrmPaymentMilestone WHERE Id = @id");
  const becamePaid = finalCheck.recordset[0]?.Status === "Paid";
  if (becamePaid) {
    await maybeAutoCreateSalesDeed(pool, targetRow.BookingId, actorUserId);
    await maybeAutoGenerateInvoice(pool, targetRow.BookingId, actorUserId);
    await maybeUnlockBrokerageMilestoneTranche(pool, targetRow.BookingId, milestoneId);
  }

  return { applied: requested, remaining: remaining - requested, becamePaid, milestoneId, onAccountId };
}

// Auto-sweep: whenever money lands on a booking's On Account balance —
// either a manual deposit (POST /booking/:id/on-account) or overflow
// diverted off an overpayment (PUT /:id, e.g. a customer paying more than
// the fixed Booking Amount) — immediately walk forward and apply as much
// of it as possible to the earliest outstanding milestone(s) in sequence,
// splitting across several deposits/milestones as needed. This is now the
// default: the excess never just sits unapplied waiting for a staff click.
// PUT /on-account/:id/apply still exists for any manual top-up/adjustment,
// but in the normal flow it should rarely have anything left to do.
async function autoApplyOnAccount(pool, bookingId, actorUserId, actorEmail) {
  const results = [];
  // Hard safety cap — no real payment plan has anywhere near this many
  // milestones, this just guards against an unexpected infinite loop.
  for (let i = 0; i < 50; i++) {
    const deposit = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id FROM dbo.CrmOnAccountPayment
      WHERE BookingId = @bid AND Amount > AppliedAmount
      ORDER BY CreatedAt ASC
    `);
    if (!deposit.recordset.length) break;

    const milestone = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived') AND AmountDue > ISNULL(AmountPaid, 0)
      ORDER BY MilestoneNo ASC
    `);
    if (!milestone.recordset.length) break;

    const outcome = await applyOnAccountToMilestone(pool, {
      onAccountId: deposit.recordset[0].Id, milestoneId: milestone.recordset[0].Id,
      amount: null, actorUserId, actorEmail,
    });
    if (outcome.error || !outcome.applied) break;
    results.push(outcome);
  }
  return results;
}

// Same DemandNo shape the Followup module's demand workflow already uses
// (followupDemands.js buildDemandNo) — DEM-{BookingNo}-{3-digit milestone
// sequence} — kept identical purely for staff familiarity across the two
// modules; the tables themselves are entirely separate.
function buildDemandNo(bookingNo, milestoneNo) {
  return `DEM-${bookingNo}-${String(milestoneNo).padStart(3, "0")}`;
}

// GET /demands — every milestone across every booking, for the CRM Demand
// page's list + summary. Deliberately not scoped to "has a demand raised
// yet" — Pending ones are exactly what the page exists to surface.
router.get("/demands", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status && ["Pending", "Demanded", "Paid"].includes(status)) {
      req0.input("st", sql.NVarChar(20), status);
      conds.push("m.DemandStatus = @st");
    }
    if (search) {
      req0.input("q", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @q OR b.BookingNo LIKE @q OR m.DemandNo LIKE @q OR m.MilestoneName LIKE @q)");
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT m.Id, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.[Percent], m.DueDate, m.Status,
             m.DemandStatus, m.DemandNo, m.DemandRaisedOn, m.DemandNotes,
             b.Id AS BookingId, b.BookingNo, b.ProjectName, b.UnitNo, b.AssignedTo,
             a.ApplicantName, a.Mobile
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY CASE WHEN m.DemandStatus = 'Pending' THEN 0 ELSE 1 END, m.DueDate ASC, b.BookingNo, m.MilestoneNo
    `);

    const rows = result.recordset;
    const summary = {
      pendingCount: 0, pendingAmount: 0,
      demandedCount: 0, demandedAmount: 0,
      paidCount: 0, paidAmount: 0,
    };
    for (const r of rows) {
      const balance = Number(r.AmountDue || 0) - Number(r.AmountPaid || 0);
      if (r.DemandStatus === "Pending") { summary.pendingCount++; summary.pendingAmount += balance; }
      else if (r.DemandStatus === "Demanded") { summary.demandedCount++; summary.demandedAmount += balance; }
      else if (r.DemandStatus === "Paid") { summary.paidCount++; summary.paidAmount += balance; }
    }
    res.json({ demands: rows, summary });
  } catch (e) {
    console.error("[crm-payments] GET /demands error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/demand — raise a payment demand for a milestone: assigns a real
// DemandNo, moves DemandStatus Pending -> Demanded, and notifies the
// applicant's assignee. Blocked on an already-fully-paid milestone (nothing
// left to demand) or one that's already been demanded/paid (use undo first).
router.post("/:id/demand", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const m = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.Status, m.DemandStatus,
             b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Id = @id
    `);
    if (!m.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const row = m.recordset[0];
    if (row.Status === "Paid" || row.Status === "Waived") {
      return res.status(400).json({ error: `This milestone is already ${row.Status.toLowerCase()} — nothing to demand` });
    }
    if (row.DemandStatus !== "Pending") {
      return res.status(400).json({ error: `Cannot raise demand — current status is ${row.DemandStatus}` });
    }

    const balance = (row.AmountDue || 0) - (row.AmountPaid || 0);
    const demandNo = buildDemandNo(row.BookingNo, row.MilestoneNo);
    const demandRaisedOn = new Date().toISOString().slice(0, 10);
    const notes = (req.body?.Notes || "").trim() || null;

    await pool.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar(60), demandNo)
      .input("dt", sql.Date, demandRaisedOn)
      .input("notes", sql.NVarChar(500), notes)
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          DemandStatus = 'Demanded', DemandNo = @no, DemandRaisedOn = @dt,
          DemandNotes = ISNULL(@notes, DemandNotes),
          DemandRaisedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "payment_demand",
        "Payment Demand Raised",
        `${row.ApplicantName} · ${row.BookingNo} — ${row.MilestoneName} demand raised (₹${balance.toLocaleString("en-IN")})`,
        id, "payment_milestone");
    }
    res.json({ success: true, DemandNo: demandNo, DemandRaisedOn: demandRaisedOn });
  } catch (e) {
    console.error("[crm-payments] POST /:id/demand error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /:id/demand/undo — walk a wrongly-raised demand back to Pending.
// Blocked once the milestone is actually paid (DemandStatus='Paid') —
// undoing a settled demand would misrepresent real money already collected.
router.patch("/:id/demand/undo", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT DemandStatus FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    if (cur.recordset[0].DemandStatus === "Paid") {
      return res.status(400).json({ error: "Cannot undo a demand that's already paid" });
    }

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        DemandStatus = 'Pending', DemandNo = NULL, DemandRaisedOn = NULL,
        DemandNotes = NULL, DemandRaisedAt = NULL
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-payments] PATCH /:id/demand/undo error:", e.message);
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

class ReceiptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Shared by POST /:id/receipts below AND by createCrmBookingRecord
// (crmEntityCreation.js), which calls this the moment a Booking auto-creates
// if the originating Application already captured a token payment (cheque/
// card/UPI/etc — see CrmApplication.tsx's Payment Details step) — so that
// payment lands as a real, GL-posted receipt against the booking's first
// milestone immediately, instead of Finance only finding out once someone
// manually re-enters what sales already recorded. Exact same validation,
// rollup, and GL-posting path either way — nothing about how a receipt
// gets accounted for changes based on who/what triggered it.
//
// Workflow guard: "MILESTONE => ... NEXT MILESTONE DUE => MILESTONE WISE
// PAYMENT" is explicit sequencing — a customer paying milestone #5 while
// #1-4 are still outstanding would leave earlier stages permanently
// unaccounted for. Every earlier-numbered milestone on the same booking
// must already be Paid or Waived first (always true for milestone #1, the
// only one the auto-booking caller ever targets, since it has no earlier
// milestone to check against).
// enforceBankMandate defaults true for every direct caller (POST /:id/receipts
// below), and — now that CrmApplication.tsx's Details step actually captures
// a Payment Details section (Token Type/Value, Payment Mode, Deposit Bank) —
// also true for createCrmBookingRecord's auto-sync (crmEntityCreation.js).
// Still wrapped in that caller's own try/catch, so a genuinely missing bank
// (e.g. an Application submitted before this field existed) fails the
// auto-receipt-sync alone rather than blocking Booking creation itself;
// staff can then record it manually through the mandate-enforced path like
// any other receipt.
async function createReceiptForMilestone(pool, milestoneId, data, actorUserId, actorEmail, { enforceBankMandate = true } = {}) {
  const amount = parseFloat(data.Amount);
  if (!amount || amount <= 0) throw new ReceiptError("Amount must be greater than 0");

  const target = await pool.request().input("id", sql.Int, milestoneId)
    .query(`
      SELECT m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, bk.ProjectId
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      WHERE m.Id = @id
    `);
  if (!target.recordset.length) throw new ReceiptError("Milestone not found", 404);
  const targetRow = target.recordset[0];

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) throw new ReceiptError(activeErr);

  if (enforceBankMandate) {
    const tagged = await pool.request().input("pid", sql.Int, targetRow.ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !data.DepositBankId) {
      throw new ReceiptError("Deposit bank is required for this project");
    }
  }

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('Paid', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    throw new ReceiptError(`Cannot pay "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first`);
  }

  // Overpayment cap: this milestone — most commonly Milestone #1, the fixed
  // ₹ Booking Amount — never gets receipted past its own AmountDue. Anything
  // beyond the remaining balance is automatically diverted to the
  // customer's On Account balance below (same ledger a manual on-account
  // deposit lands in), ready to be applied against later milestones as they
  // come due, instead of inflating what THIS milestone shows as paid.
  const balance = Math.max(0, Number(targetRow.AmountDue) - Number(targetRow.AmountPaid || 0));
  const receiptAmount = Math.min(amount, balance);
  const overflowAmount = Math.round((amount - receiptAmount) * 100) / 100;

  let receiptId = null;
  let receiptNo = null;
  if (receiptAmount > 0) {
    receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
    const insResult = await pool.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("mid",  sql.Int,           milestoneId)
      .input("amt",  sql.Decimal(18,2), receiptAmount)
      .input("rdt",  sql.Date,          data.ReceivedDate || null)
      .input("mode", sql.NVarChar(50),  data.PaymentMode || null)
      .input("tref", sql.NVarChar(200), data.TransactionRef || null)
      .input("cdt",  sql.Date,          data.ChequeDate || null)
      .input("note", sql.NVarChar(sql.MAX), data.Notes || null)
      .input("cb",   sql.Int,           actorUserId)
      .input("bkid", sql.Int,           data.DepositBankId ? parseInt(data.DepositBankId) : null)
      .input("bkname", sql.NVarChar(200), data.DepositBankName || null)
      .query(`
        INSERT INTO dbo.CrmPaymentReceipt
          (ReceiptNo, MilestoneId, Amount, ReceivedDate, PaymentMode, TransactionRef, ChequeDate, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName)
        OUTPUT INSERTED.Id
        VALUES (@no, @mid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @cdt, @note, @cb, SYSDATETIME(), @bkid, @bkname)
      `);
    receiptId = insResult.recordset[0].Id;

    // Roll up receipts into the milestone's AmountPaid / Status. A milestone
    // that just became Paid also settles its own demand (if one was ever
    // raised) — DemandStatus tracks real money received, not left dangling
    // at 'Demanded' forever once the customer has actually paid.
    const rollup = await pool.request().input("id", sql.Int, milestoneId).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
        Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                       THEN 'Paid' ELSE Status END,
        PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
        DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN 'Paid' ELSE DemandStatus END,
        UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Status
      WHERE Id = @id
    `);

    // Post to the core Finance GL — money actually received. Never allowed
    // to fail the receipt itself; outcome logged to dbo.GLPostingLog so an
    // unposted receipt is findable, same as every other GL-posting module.
    try {
      const outcome = await postCrmReceiptToGL(pool, receiptId, actorEmail);
      await recordGLPosting("crm-payment-receipt", receiptId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-payment-receipt", receiptId, { failed: true, reason: glErr.message }, actorEmail);
    }

    // This milestone may have just been the last one outstanding — the direct
    // milestone-edit (PUT /:id) and /waive routes already fire this same check
    // on the same "just became Paid/Waived" trigger; recording payment via a
    // real receipt (the properly-accounted path, with GL posting and cheque/
    // transaction tracking) was the one route missing it, leaving Sales Deed
    // and the Possession invoice stuck waiting on staff to notice even though
    // every milestone was genuinely settled.
    if (rollup.recordset[0]?.Status === "Paid") {
      await maybeAutoCreateSalesDeed(pool, targetRow.BookingId, actorUserId);
      await maybeAutoGenerateInvoice(pool, targetRow.BookingId, actorUserId);

      // Brokerage's creation trigger is Milestone #1 specifically becoming
      // Paid — unlike the two guards above, which react to "all milestones
      // settled" — so it needs its own inline condition, not the same "Paid"
      // check reused. Once the schedule exists, every later milestone's own
      // Paid transition unlocks that milestone's own tranche.
      if (targetRow.MilestoneNo === 1) {
        await maybeAutoCreateBrokerage(pool, targetRow.BookingId, actorUserId);
      }
      await maybeUnlockBrokerageMilestoneTranche(pool, targetRow.BookingId, milestoneId);
    }
  }

  // Whatever didn't fit against this milestone's own balance (see the
  // "Overpayment cap" comment above) is parked on the customer's On
  // Account balance right now — same insert + GL-posting path
  // POST /booking/:id/on-account uses — so a customer paying more than
  // what's actually due (most commonly, more than the Booking Amount at
  // Milestone #1) never inflates this milestone past what was ever asked
  // for; the excess sits ready to apply against whichever milestone comes
  // due next (PUT /on-account/:id/apply).
  let onAccountId = null;
  let onAccountReceiptNo = null;
  if (overflowAmount > 0) {
    onAccountReceiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const oaResult = await pool.request()
      .input("no",   sql.NVarChar(30),  onAccountReceiptNo)
      .input("bid",  sql.Int,           targetRow.BookingId)
      .input("amt",  sql.Decimal(18,2), overflowAmount)
      .input("rdt",  sql.Date,          data.ReceivedDate || null)
      .input("mode", sql.NVarChar(50),  data.PaymentMode || null)
      .input("tref", sql.NVarChar(200), data.TransactionRef || null)
      .input("note", sql.NVarChar(sql.MAX), `Auto-parked — payment for "${targetRow.MilestoneName}" exceeded its due amount by ₹${overflowAmount.toLocaleString("en-IN")}`)
      .input("cb",   sql.Int,           actorUserId)
      .input("bkid", sql.Int,           data.DepositBankId ? parseInt(data.DepositBankId) : null)
      .input("bkname", sql.NVarChar(200), data.DepositBankName || null)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname)
      `);
    onAccountId = oaResult.recordset[0].Id;
    try {
      const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
      await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
    }
  }

  return { receiptId, ReceiptNo: receiptNo, bookingId: targetRow.BookingId, overflowAmount, onAccountId, OnAccountReceiptNo: onAccountReceiptNo };
}

// POST /:id/receipts — record a receipt against a milestone (supports partial/installment receipts)
router.post("/:id/receipts", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actorEmail = req.user?.email || req.user?.name || null;
    const { ReceiptNo, overflowAmount, OnAccountReceiptNo } = await createReceiptForMilestone(pool, id, req.body, actorId(req), actorEmail);
    res.status(201).json({ success: true, ReceiptNo, overflowAmount, OnAccountReceiptNo });
  } catch (e) {
    if (e instanceof ReceiptError) return res.status(e.status).json({ error: e.message });
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
        SELECT b.BookingNo, b.TotalValue, b.UnitNo, b.ProjectId, b.ProjectName, b.BookingAmount,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
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

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

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
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @mno, @mname, @due, @amt, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
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

    const paidRaw = b.AmountPaid != null ? parseFloat(b.AmountPaid) : null;
    const amountDueOverride = b.AmountDue != null ? parseFloat(b.AmountDue) : null;

    // Fetch the current row up front — needed both for the AmountDue
    // override's %-recompute (against the booking's GrandTotal) AND, now,
    // to know this milestone's own AmountDue so an AmountPaid write can be
    // capped against it (see the overpayment handling below).
    const curRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.AmountDue, m.MilestoneName, bk.GrandTotal, bk.TotalValue, bk.ProjectId
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      WHERE m.Id = @id
    `);
    if (!curRes.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const curRow = curRes.recordset[0];

    // A payment actually being recorded here (not a remarks/due-date-only
    // edit — this same route doubles as that) must specify which of the
    // project's tagged bank accounts received it, whenever the project has
    // at least one tagged. Zero tagged banks for the project means nothing
    // to mandate — falls back to the open company bank list, same as the
    // frontend's own fallback.
    if (paidRaw != null) {
      const tagged = await pool.request().input("pid", sql.Int, curRow.ProjectId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
      if (tagged.recordset[0].Cnt > 0 && !b.DepositBankId) {
        return res.status(400).json({ error: "Deposit bank is required for this project" });
      }
    }

    // A manual AmountDue override changes this milestone's own weight in
    // the schedule — recompute its stored Percent alongside it (against the
    // booking's current GrandTotal), or the % shown right next to the new
    // ₹ figure would silently go stale.
    let percentOverride = null;
    const grandTotal = Number(curRow.GrandTotal || curRow.TotalValue || 0);
    if (amountDueOverride != null && grandTotal > 0) {
      percentOverride = Math.round((amountDueOverride / grandTotal) * 10000) / 100;
    }

    // Overpayment cap: a milestone — most commonly Milestone #1, the fixed
    // ₹ Booking Amount — can never be pushed past its own AmountDue by this
    // direct edit. "The deduction is constant": if staff key in a figure
    // beyond what's actually due (e.g. the customer paid more than the
    // booking amount), only the amount actually due gets recorded against
    // THIS milestone here; the rest is automatically diverted to the
    // customer's On Account balance below — same ledger a manual on-account
    // deposit lands in — ready to apply against later milestones as they
    // come due, rather than silently inflating what this milestone shows
    // as paid.
    const effectiveAmountDue = amountDueOverride != null ? amountDueOverride : Number(curRow.AmountDue);
    let paid = paidRaw;
    let overflowAmount = 0;
    if (paid != null && effectiveAmountDue > 0 && paid > effectiveAmountDue) {
      overflowAmount = Math.round((paid - effectiveAmountDue) * 100) / 100;
      paid = effectiveAmountDue;
    }

    const result = await pool.request()
      .input("id",    sql.Int,           id)
      .input("mname", sql.NVarChar(200), b.MilestoneName || null)
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), amountDueOverride)
      .input("pct",   sql.Decimal(5,2),  percentOverride)
      .input("paid",  sql.Decimal(18,2), paid)
      .input("pdate", sql.Date,          b.PaidDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref",  sql.NVarChar(200), b.TransactionRef || null)
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("bkid",  sql.Int,           b.DepositBankId ? parseInt(b.DepositBankId) : null)
      .input("bkname",sql.NVarChar(200), b.DepositBankName || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          MilestoneName  = ISNULL(@mname, MilestoneName),
          DueDate        = ISNULL(@due,   DueDate),
          AmountDue      = ISNULL(@amt,   AmountDue),
          [Percent]      = ISNULL(@pct,   [Percent]),
          AmountPaid     = ISNULL(@paid,  AmountPaid),
          PaidDate       = ISNULL(@pdate, PaidDate),
          PaymentMode    = ISNULL(@pmode, PaymentMode),
          TransactionRef = ISNULL(@tref,  TransactionRef),
          RequiredDocuments = ISNULL(@rdocs, RequiredDocuments),
          ResponsibleDepartment = ISNULL(@dept, ResponsibleDepartment),
          DepositBankId   = ISNULL(@bkid,   DepositBankId),
          DepositBankName = ISNULL(@bkname, DepositBankName),
          Status = CASE
            WHEN Status = 'Waived' THEN Status
            WHEN @paid IS NOT NULL AND @paid >= ISNULL(@amt, AmountDue) THEN 'Paid'
            ELSE Status
          END,
          DemandStatus = CASE
            WHEN @paid IS NOT NULL AND @paid >= ISNULL(@amt, AmountDue) THEN 'Paid'
            ELSE DemandStatus
          END,
          Remarks   = @rem,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.BookingId, INSERTED.Status
        WHERE Id = @id
      `);

    // Auto-flow: this milestone may have just been the last one outstanding —
    // fire the auto-create check (no-op unless the agreement is also Executed).
    const updated = result.recordset[0];
    let brokerWarning = null;
    if (updated?.Status === "Paid") {
      await maybeAutoCreateSalesDeed(pool, updated.BookingId, actorId(req));
      await maybeAutoGenerateInvoice(pool, updated.BookingId, actorId(req));
      await maybeUnlockBrokerageMilestoneTranche(pool, updated.BookingId, id);
      brokerWarning = await warnIfBrokerUnpaid(pool, updated.BookingId, actorId(req));
    }

    // Manual override of this milestone's own AmountDue cascades to the
    // OTHER still-open milestones so the schedule keeps summing to
    // GrandTotal — this one stays fixed at what staff just typed in.
    if (amountDueOverride != null && updated?.BookingId) {
      await recalculateRemainingMilestones(pool, updated.BookingId, { fixedMilestoneId: id });
    }

    // The overflow capped off above (see the "Overpayment cap" comment)
    // gets parked on the customer's On Account balance right now, through
    // the exact same insert + GL-posting path POST /booking/:id/on-account
    // uses — so it shows up immediately in the On-Account panel, ready to
    // apply to whichever milestone comes due next.
    let onAccountReceiptNo = null;
    if (overflowAmount > 0 && updated?.BookingId) {
      onAccountReceiptNo = await getNextDocNumber(pool, "OACC", "OACC");
      const oaResult = await pool.request()
        .input("no",   sql.NVarChar(30),  onAccountReceiptNo)
        .input("bid",  sql.Int,           updated.BookingId)
        .input("amt",  sql.Decimal(18,2), overflowAmount)
        .input("rdt",  sql.Date,          b.PaidDate || null)
        .input("mode", sql.NVarChar(50),  b.PaymentMode || null)
        .input("tref", sql.NVarChar(200), b.TransactionRef || null)
        .input("note", sql.NVarChar(sql.MAX), `Auto-parked — payment for "${curRow.MilestoneName}" exceeded its due amount by ₹${overflowAmount.toLocaleString("en-IN")}`)
        .input("cb",   sql.Int,           actorId(req))
        .input("bkid", sql.Int,           b.DepositBankId ? parseInt(b.DepositBankId) : null)
        .input("bkname", sql.NVarChar(200), b.DepositBankName || null)
        .query(`
          INSERT INTO dbo.CrmOnAccountPayment
            (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName)
          OUTPUT INSERTED.Id
          VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname)
        `);
      const onAccountId = oaResult.recordset[0].Id;
      const actorEmail = req.user?.email || req.user?.name || null;
      try {
        const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
        await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
      } catch (glErr) {
        await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
      }

      // Don't leave the overflow sitting unapplied — immediately sweep it
      // (and any other unapplied on-account balance for this booking)
      // forward onto whichever milestone is next due, in sequence.
      await autoApplyOnAccount(pool, updated.BookingId, actorId(req), actorEmail);
    }

    res.json({ success: true, brokerWarning, overflowAmount, onAccountReceiptNo });
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

    const result = await pool.request()
      .input("id",  sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), b.Reason)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          Status = 'Waived', Remarks = @rem, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.BookingId
        WHERE Id = @id
      `);

    // Auto-flow: a waived milestone can also be the last one outstanding.
    await maybeAutoCreateSalesDeed(pool, result.recordset[0].BookingId, actorId(req));
    await maybeAutoGenerateInvoice(pool, result.recordset[0].BookingId, actorId(req));
    // Waiving still resolves the milestone — the broker's tranche for it
    // shouldn't stay locked forever just because the customer's charge was
    // forgiven.
    await maybeUnlockBrokerageMilestoneTranche(pool, result.recordset[0].BookingId, id);

    res.json({ success: true, status: "Waived" });
  } catch (e) {
    console.error("[crm-payments] waive error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId/on-account — every on-account deposit for this
// booking, plus the balance still unapplied. Used by Welcome Call and the
// Booking Details tab to show "customer has ₹X sitting on account" instead
// of that money just disappearing into a milestone it wasn't actually
// meant for yet.
router.get("/booking/:bookingId/on-account", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT o.*, cu.name AS CreatedByName
      FROM dbo.CrmOnAccountPayment o
      LEFT JOIN dbo.Users cu ON cu.id = o.CreatedBy
      WHERE o.BookingId = @bid
      ORDER BY o.CreatedAt DESC
    `);
    const rows = result.recordset;
    const available = rows.reduce((s, r) => s + (Number(r.Amount) - Number(r.AppliedAmount)), 0);
    res.json({ payments: rows, availableBalance: available });
  } catch (e) {
    console.error("[crm-payments] GET /booking/:id/on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId/on-account — record a new on-account deposit.
// Not tied to any milestone at creation time — that's the whole point;
// it's applied later via PUT /on-account/:id/apply, possibly split across
// several milestones as they come due.
router.post("/booking/:bookingId/on-account", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Same rule as a milestone payment: a deposit against a project with one
    // or more tagged bank accounts must say which one it landed in. A
    // project with nothing tagged falls back to the open company bank
    // list, so nothing is mandated there.
    const projRes = await pool.request().input("bid", sql.Int, bid)
      .query("SELECT ProjectId FROM dbo.CrmBooking WHERE Id = @bid");
    if (!projRes.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const tagged = await pool.request().input("pid", sql.Int, projRes.recordset[0].ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !b.DepositBankId) {
      return res.status(400).json({ error: "Deposit bank is required for this project" });
    }

    const receiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("bid",  sql.Int,           bid)
      .input("amt",  sql.Decimal(18,2), amount)
      .input("rdt",  sql.Date,          b.ReceivedDate || null)
      .input("mode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref", sql.NVarChar(200), b.TransactionRef || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .input("bkid", sql.Int,           b.DepositBankId ? parseInt(b.DepositBankId) : null)
      .input("bkname", sql.NVarChar(200), b.DepositBankName || null)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname)
      `);
    const onAccountId = result.recordset[0].Id;

    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
      await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
    }

    // Auto-sweep this deposit onto whichever milestone is next due, same as
    // an overflow diversion does — a manual on-account deposit shouldn't sit
    // unapplied any more than an overpayment's overflow does.
    await autoApplyOnAccount(pool, bid, actorId(req), actorEmail);

    res.status(201).json({ success: true, id: onAccountId, ReceiptNo: receiptNo });
  } catch (e) {
    console.error("[crm-payments] POST /booking/:id/on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /on-account/:id/apply — now mostly a manual override/adjustment
// path, since the default flow (autoApplyOnAccount) already sweeps new
// on-account money onto the next due milestone automatically the moment it
// lands. Still available for staff to explicitly redirect or top up a
// specific milestone. Delegates to the same applyOnAccountToMilestone the
// auto-sweep uses, so both paths enforce identical rules (sequencing,
// balance caps, GL posting, auto-flow triggers) and can't drift apart.
router.put("/on-account/:id/apply", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const onAccountId = parseInt(req.params.id);
    const b = req.body;
    const milestoneId = parseInt(b.MilestoneId);
    if (!milestoneId) return res.status(400).json({ error: "MilestoneId is required" });

    const actorEmail = req.user?.email || req.user?.name || null;
    const outcome = await applyOnAccountToMilestone(pool, {
      onAccountId, milestoneId,
      amount: b.Amount != null ? parseFloat(b.Amount) : null,
      actorUserId: actorId(req), actorEmail,
    });
    if (outcome.error) return res.status(400).json({ error: outcome.error });

    res.json({ success: true, applied: outcome.applied, remaining: outcome.remaining });
  } catch (e) {
    console.error("[crm-payments] PUT /on-account/:id/apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
// Reused by crmEntityCreation.js's createCrmBookingRecord to sync an
// Application-stage token payment onto the new Booking's first milestone.
module.exports.createReceiptForMilestone = createReceiptForMilestone;