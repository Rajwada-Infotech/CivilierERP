const { sql } = require("../db");
const { CrmStatus } = require("../constants/crmStatuses");
const { round2, sumMoney } = require("./bookingUnits");
const { onAccountWithAvailableSql, recordedMoneySql } = require("./crmPaymentFunding");
const { DEAD_BOOKING_STATUSES } = require("../constants/crmStatuses");

// Business rule (confirmed 2026-09-15): every rupee a customer pays lands in
// On Account and stays there, on hold — it is never swept onto a specific
// milestone by hand. It is only ever auto-adjusted, all at once, in
// milestone order, once settled milestone payments plus available deposits
// cover all non-waived dues (see autoApplyOnAccountIfFullyFunded in crmPayments.js).
//
// But staff and downstream workflow gates (Agreement prep, Bank/KYC save)
// still need to see "the customer has paid this milestone" the moment
// enough money is sitting on-account to cover it — waiting for the full
// booking to be funded before showing that would make every gate lie about
// money that's already, genuinely, in hand. This module computes that
// *virtual* per-milestone coverage from the unapplied on-account balance, without
// ever touching CrmPaymentMilestone.AmountPaid/Status itself — the real
// ledger only moves via the auto-adjustment described above.
//
// Coverage is cumulative and sequential: milestone N is virtually covered
// once the on-account pool is enough to pay milestones 1..N in full (a
// Waived milestone requires nothing). This mirrors the same
// "earlier-milestone-first" ordering the real sweep enforces.
//
// With { withPendingVerification: true } money staff have entered and Finance
// hasn't verified yet counts too — used only to decide whether the NEXT entry
// may be made / verified, so payments can be entered one after another without
// waiting for each verification. Shown coverage never uses it.
function coverMilestones(rows, totalOnAccount) {
  let cumulativeRequired = 0;
  const milestones = rows.map((m) => {
    const required = m.Status === "Waived" ? 0 : Math.max(0, round2(Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)));
    const before = cumulativeRequired;
    cumulativeRequired = round2(cumulativeRequired + required);
    const alreadyPaid = m.Status === "Paid" || m.Status === "Waived" || Number(m.AmountPaid || 0) >= Number(m.AmountDue || 0);
    return {
      ...m,
      CumulativeRequired: cumulativeRequired,
      VirtuallyCovered: alreadyPaid || totalOnAccount >= cumulativeRequired,
      // The on-account money that sits against this milestone, in milestone order (the same order the real sweep
      // follows): shown so a customer's payments are visible on the plan while they are held. Nothing is moved.
      HeldOnAccount: Math.min(required, Math.max(0, round2(totalOnAccount - before))),
    };
  });
  return { milestones, grandRequired: cumulativeRequired };
}

// Each milestone's money stage: one answer, so no screen guesses.
//   Adjusted        settled on the milestone
//   Verified        Finance-verified money held On Account covers it
//   InVerification  covered once the entries waiting for Finance are verified
//   Recorded        covered once money entered but not yet with Finance gets there and is verified
//   null            nothing entered for it yet
// Rows come in milestone order; held = verified money On Account, pending = entered and waiting for Finance,
// recorded = entered but not yet with Finance. WithFinanceCover and RecordedCover = how much of the milestone those
// would cover, on top of what is held.
function stageMilestones(rows, held, pending, recorded = 0) {
  const verified = coverMilestones(rows, held).milestones;
  const entered = coverMilestones(rows, round2(held + pending)).milestones;
  const all = coverMilestones(rows, round2(held + pending + recorded)).milestones;
  return verified.map((m, i) => {
    let stage = null;
    if (m.Status === "Waived") stage = "Waived";
    else if (m.Status === "Paid" || Number(m.AmountPaid || 0) >= Number(m.AmountDue || 0)) stage = "Adjusted";
    else if (m.VirtuallyCovered) stage = "Verified";
    else if (entered[i].VirtuallyCovered) stage = "InVerification";
    else if (all[i].VirtuallyCovered) stage = "Recorded";
    return { ...m, WithFinanceCover: round2(entered[i].HeldOnAccount - m.HeldOnAccount), RecordedCover: round2(all[i].HeldOnAccount - entered[i].HeldOnAccount), MoneyStage: stage };
  });
}

async function getBookingOnAccountCoverage(pool, bookingId, { withPendingVerification = false } = {}) {
  const milestonesRes = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT Id, MilestoneNo, MilestoneName, AmountDue, AmountPaid, Status, ExtraChargeId, ParkingAllotmentId
    FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo, Id
  `);
  const oaRes = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ISNULL(SUM(o.AvailableAmount), 0) AS TotalOnAccount FROM ${onAccountWithAvailableSql("o")}
    WHERE o.BookingId = @bid
  `);
  const pendingVerification = withPendingVerification ? await pendingVerificationTotal(pool, bookingId) : 0;
  const totalOnAccount = round2((Number(oaRes.recordset[0]?.TotalOnAccount) || 0) + pendingVerification);

  const { milestones, grandRequired } = coverMilestones(milestonesRes.recordset, totalOnAccount);
  return { milestones, totalOnAccount, grandRequired };
}

// One booking's milestones with their money stage and the money against each (stageMilestones).
async function getMilestoneMoneyStages(pool, bookingId) {
  const { milestones, totalOnAccount } = await getBookingOnAccountCoverage(pool, bookingId);
  const pending = await pendingVerificationTotal(pool, bookingId);
  const recorded = await recordedTotal(pool, bookingId);
  return { milestones: stageMilestones(milestones, totalOnAccount, pending, recorded), totalOnAccount, pending, recorded };
}

async function recordedTotal(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId).query(`SELECT ${recordedMoneySql("@bid")} AS Recorded`);
  return Number(r.recordset[0]?.Recorded) || 0;
}

// Every rupee of a booking, one row per payment, from where it was entered to where it sits now. It joins up what the
// flows keep apart: the Money Receipt, Finance's Received Payment, the On Account deposit and any refund out of it.
async function getBookingMoneyTrail(pool, bookingId) {
  const bid = () => pool.request().input("bid", sql.Int, bookingId);
  const [bkRes, mrRes, rpRes, oaRes, refundRes] = await Promise.all([
    bid().query("SELECT TokenType, TokenValue, PaymentMode, Status FROM dbo.CrmBooking WHERE Id = @bid"),
    bid().query(`SELECT Id, ReceiptNo, Amount, Status, ReceivedPaymentId, PaymentMode, ChequeNo, TransactionRef, ReceivedDate, BouncedReason
                 FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid ORDER BY ReceivedDate, Id`),
    bid().query(`SELECT rp.RPPaymentID, rp.RPDocNo, rp.RPAmount, rp.RPStatus, rp.RPMode, rp.RPTransactionID, rp.RPDocDate, rp.RPRejectionNote, m.MilestoneName
                 FROM dbo.ReceivedPayment rp LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
                 WHERE rp.CrmBookingId = @bid ORDER BY rp.RPDocDate, rp.RPPaymentID`),
    bid().query(`SELECT o.Id, o.ReceiptNo, o.Amount, o.AppliedAmount, o.AvailableAmount, o.Status, o.PaymentMode, o.ReceivedDate, o.SourceReceivedPaymentId
                 FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = @bid ORDER BY o.ReceivedDate, o.Id`),
    bid().query(`SELECT r.SourceOnAccountId, SUM(r.GrossAmount) AS Paid FROM dbo.CrmRefund r
                 JOIN dbo.CrmOnAccountPayment o ON o.Id = r.SourceOnAccountId
                 WHERE o.BookingId = @bid AND r.Status = N'Paid' GROUP BY r.SourceOnAccountId`),
  ]);
  const booking = bkRes.recordset[0] || {};
  const receipts = mrRes.recordset;
  const entries = rpRes.recordset;
  const deposits = oaRes.recordset;
  const usedDeposits = new Set();
  const closed = DEAD_BOOKING_STATUSES.includes(booking.Status);
  const refundedOf = new Map(refundRes.recordset.map((r) => [r.SourceOnAccountId, Number(r.Paid) || 0]));
  const row = (x) => ({ settled: 0, held: 0, out: 0, note: null, milestone: null, ...x });
  // A deposit's money: settled on milestones, still held, or gone out (refunded, reserved for a refund or transfer). A
  // paid refund also counts in the deposit's applied figure, and on a closed booking nothing stays settled: the
  // cancellation moved it on.
  const fromDeposit = (o) => {
    const amount = Number(o.Amount) || 0;
    const held = Number(o.AvailableAmount) || 0;
    const settled = closed ? 0 : round2(Math.max(0, (Number(o.AppliedAmount) || 0) - (refundedOf.get(o.Id) || 0)));
    return { settled, held, out: round2(Math.max(0, amount - settled - held)) };
  };
  const whereNow = ({ settled, held, out }) => {
    if (out > 0 && !settled && !held) return "out";
    if (held > 0 && !settled && !out) return "held";
    if (settled > 0 && !held && !out) return "settled";
    return "split";
  };
  const rows = [];
  for (const rp of entries) {
    const mr = receipts.find((r) => r.ReceivedPaymentId === rp.RPPaymentID);
    const docs = [mr?.ReceiptNo, rp.RPDocNo].filter(Boolean);
    const base = { id: `rp-${rp.RPPaymentID}`, date: mr?.ReceivedDate || rp.RPDocDate, mode: rp.RPMode || mr?.PaymentMode || null, ref: rp.RPTransactionID || mr?.ChequeNo || mr?.TransactionRef || null, amount: Number(rp.RPAmount) || 0, milestone: rp.MilestoneName };
    if (rp.RPStatus === "Pending") { rows.push(row({ ...base, docs, stage: "finance" })); continue; }
    if (rp.RPStatus === "Rejected") { rows.push(row({ ...base, docs, stage: "returned", note: rp.RPRejectionNote })); continue; }
    const o = deposits.find((d) => d.SourceReceivedPaymentId === rp.RPPaymentID);
    if (o) {
      usedDeposits.add(o.Id);
      const money = fromDeposit(o);
      rows.push(row({ ...base, docs: [...docs, o.ReceiptNo], ...money, stage: whereNow(money) }));
    } else {
      const money = closed ? { out: base.amount } : { settled: base.amount };
      rows.push(row({ ...base, docs, ...money, stage: closed ? "out" : "settled" }));
    }
  }
  for (const mr of receipts) {
    if (mr.ReceivedPaymentId && entries.some((e) => e.RPPaymentID === mr.ReceivedPaymentId)) continue;
    const base = { id: `mr-${mr.Id}`, date: mr.ReceivedDate, docs: [mr.ReceiptNo], mode: mr.PaymentMode, ref: mr.ChequeNo || mr.TransactionRef, amount: Number(mr.Amount) || 0 };
    if (mr.Status === "Bounced") rows.push(row({ ...base, stage: "bounced", note: mr.BouncedReason }));
    else if (mr.Status === "Pending") rows.push(row({ ...base, stage: "recorded" }));
    else rows.push(row({ ...base, ...(closed ? { out: base.amount } : { settled: base.amount }), stage: closed ? "out" : "settled" }));
  }
  // On-account lines Finance never received as a payment (a credit note, a cancellation's hold): the system's own
  // moves, listed so nothing is hidden, but not money the customer paid.
  for (const o of deposits) {
    if (usedDeposits.has(o.Id)) continue;
    rows.push(row({ id: `oa-${o.Id}`, date: o.ReceivedDate, docs: [o.ReceiptNo], mode: o.PaymentMode, ref: null, amount: Number(o.Amount) || 0, stage: "adjustment" }));
  }
  const token = booking.TokenType === "Amount" ? Number(booking.TokenValue) || 0 : 0;
  if (!receipts.length && token > 0) {
    rows.push(row({ id: "token", date: null, docs: [], mode: booking.PaymentMode, ref: null, amount: token, stage: "recorded", note: "Entered on the application; no Money Receipt yet" }));
  }
  rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const counted = rows.filter((r) => !["returned", "bounced", "adjustment"].includes(r.stage));
  const liveReceipt = receipts.find((r) => r.Status !== "Bounced");
  return {
    rows,
    totals: {
      received: sumMoney(counted, (r) => r.amount), settled: sumMoney(counted, (r) => r.settled), held: sumMoney(counted, (r) => r.held), out: sumMoney(counted, (r) => r.out),
      finance: sumMoney(counted.filter((r) => r.stage === "finance"), (r) => r.amount), recorded: sumMoney(counted.filter((r) => r.stage === "recorded"), (r) => r.amount),
    },
    // What the application said, against the Money Receipt actually made.
    applicationToken: token,
    receiptAmount: liveReceipt ? Number(liveReceipt.Amount) || 0 : null,
  };
}

// Convenience for the common case — is Milestone #1 (the one every
// workflow gate cares about) virtually covered by on-account money yet?
async function isMilestoneOneCoveredByOnAccount(pool, bookingId) {
  const { milestones } = await getBookingOnAccountCoverage(pool, bookingId);
  const bookingMilestone = milestones.find((m) => Number(m.MilestoneNo) === 1 && m.ExtraChargeId == null && m.ParkingAllotmentId == null);
  return !!bookingMilestone?.VirtuallyCovered;
}

// Are all milestones strictly before milestoneNo virtually covered (Paid,
// Waived, or enough on-account has arrived to pay them in full)? Coverage is
// cumulative, so this reduces to "is the immediately preceding milestone
// covered" — milestone 1 has no predecessor and is trivially true. Used to
// let a customer's payment for milestone N be submitted/approved before
// milestone N-1 has been physically swept, as long as its money has
// genuinely arrived — otherwise no payment past Milestone 1 could ever be
// approved, since Milestone 1 itself only becomes physically Paid once the
// WHOLE booking (money for every later milestone included) is already in.
async function areEarlierMilestonesCoveredByOnAccount(pool, bookingId, milestoneNo, opts = {}) {
  if (Number(milestoneNo) <= 1) return true;
  const { milestones } = await getBookingOnAccountCoverage(pool, bookingId, opts);
  // Same reasoning as isMilestoneOneCoveredByOnAccount above: an older
  // booking can carry a legacy dedicated parking/extra-charge milestone
  // sharing the same MilestoneNo as a real schedule milestone. Matching on
  // MilestoneNo alone could silently return that legacy row instead of the
  // real "milestone N-1" the caller means.
  const preceding = milestones.find((m) => Number(m.MilestoneNo) === Number(milestoneNo) - 1 && m.ExtraChargeId == null && m.ParkingAllotmentId == null);
  return !!preceding?.VirtuallyCovered;
}

// Money entered against this booking (a milestone or its account) that Finance
// hasn't verified yet — Received Payment rows still Pending.
const PENDING_VERIFICATION_SQL = `
  SELECT rp.RPPaymentID, rp.RPDocNo, rp.RPAmount, rp.RPMode, rp.RPDocDate, rp.RPTransactionID,
         rp.RPCreatedBy, rp.RPCreatedAt, rp.CrmMilestoneId, m.MilestoneName
  FROM dbo.ReceivedPayment rp
  LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
  WHERE rp.CrmBookingId = @bid AND rp.RPStatus = N'Pending'`;
async function pendingVerificationEntries(pool, bookingId) {
  return (await pool.request().input("bid", sql.Int, bookingId).query(`${PENDING_VERIFICATION_SQL} ORDER BY rp.RPCreatedAt, rp.RPPaymentID`)).recordset;
}
// Entries Finance returned (rejected), newest first — shown so a returned
// payment never just vanishes from "With Finance".
async function returnedEntries(pool, bookingId) {
  return (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT rp.RPPaymentID, rp.RPDocNo, rp.RPAmount, rp.RPMode, rp.RPDocDate, rp.RPTransactionID,
           rp.RPCreatedBy, rp.RPRejectedBy, rp.RPRejectedAt, rp.RPRejectionNote, m.MilestoneName
    FROM dbo.ReceivedPayment rp
    LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
    WHERE rp.CrmBookingId = @bid AND rp.RPStatus = N'Rejected'
    ORDER BY rp.RPRejectedAt DESC, rp.RPPaymentID DESC`)).recordset;
}
async function pendingVerificationTotal(pool, bookingId) {
  return sumMoney(await pendingVerificationEntries(pool, bookingId), (r) => r.RPAmount);
}

// A booking's waivers, newest first, with who asked, who decided, and any reversal.
// What stops an approved waiver being reversed: something already relies on the waived figure. Null when nothing does.
async function waiverReversalBlock(executor, bookingId) {
  const dep = (await executor.request().input("b", sql.Int, bookingId).query(`
    SELECT (SELECT TOP 1 InvoiceNo FROM dbo.CrmInvoice WHERE BookingId = @b AND InvoiceType = 'Final' AND Status <> 'Void') AS FinalNo,
           (SELECT TOP 1 DeedNo FROM dbo.CrmSalesDeed WHERE BookingId = @b AND Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')) AS DeedNo`)).recordset[0];
  if (dep?.FinalNo) return `Final invoice ${dep.FinalNo} already bills this booking without this milestone. Void it first.`;
  if (dep?.DeedNo) return `Sale deed ${dep.DeedNo} already relies on this waiver, so it can't be reversed.`;
  return null;
}

async function getBookingWaivers(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT w.Id, w.MilestoneId, m.MilestoneNo, m.MilestoneName, w.Amount, w.TaxableValue, w.GstAmount, w.Reason, w.Status, w.RequestedAt, w.DecidedAt, w.RejectionNote,
           w.ReversalStatus, w.ReversalReason, w.ReversalRequestedAt, w.ReversalDecidedAt, w.ReversalRejectionNote,
           rq.name AS RequestedByName, dc.name AS DecidedByName, rr.name AS ReversalRequestedByName
    FROM dbo.CrmMilestoneWaiver w
    JOIN dbo.CrmPaymentMilestone m ON m.Id = w.MilestoneId
    LEFT JOIN dbo.Users rq ON rq.id = w.RequestedById
    LEFT JOIN dbo.Users dc ON dc.id = w.DecidedById
    LEFT JOIN dbo.Users rr ON rr.id = w.ReversalRequestedById
    WHERE w.BookingId = @bid AND w.Status <> N'Draft' ORDER BY w.Id DESC`);
  if (!r.recordset.length) return [];
  const ReversalBlock = await waiverReversalBlock(pool, bookingId);
  return r.recordset.map((w) => ({ ...w, ReversalBlock }));
}

module.exports = { getBookingWaivers, waiverReversalBlock, coverMilestones, stageMilestones, getBookingOnAccountCoverage, getMilestoneMoneyStages, getBookingMoneyTrail, pendingVerificationEntries, returnedEntries, isMilestoneOneCoveredByOnAccount, areEarlierMilestonesCoveredByOnAccount };
