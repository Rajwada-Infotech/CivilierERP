const { sql } = require("../db");
const { round2, sumMoney } = require("./bookingUnits");
const { onAccountWithAvailableSql } = require("./crmPaymentFunding");

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

  let cumulativeRequired = 0;
  const milestones = milestonesRes.recordset.map((m) => {
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

  return { milestones, totalOnAccount, grandRequired: cumulativeRequired };
}

// Each milestone's money stage — one answer, so no screen guesses:
//   Adjusted        settled on the milestone
//   Verified        Finance-verified money held On Account covers it
//   InVerification  covered once the entries waiting for Finance are verified
//   null            nothing entered for it yet
// Returns the milestones (coverage order) with VirtuallyCovered, HeldOnAccount and MoneyStage.
async function getMilestoneMoneyStages(pool, bookingId) {
  const { milestones, totalOnAccount } = await getBookingOnAccountCoverage(pool, bookingId);
  const { milestones: entered } = await getBookingOnAccountCoverage(pool, bookingId, { withPendingVerification: true });
  const enteredById = new Map(entered.map((c) => [c.Id, c.VirtuallyCovered]));
  const stageOf = (m) => {
    if (m.Status === "Waived") return "Waived";
    if (m.Status === "Paid" || Number(m.AmountPaid || 0) >= Number(m.AmountDue || 0)) return "Adjusted";
    if (m.VirtuallyCovered) return "Verified";
    if (enteredById.get(m.Id)) return "InVerification";
    return null;
  };
  return { milestones: milestones.map((m) => ({ ...m, MoneyStage: stageOf(m) })), totalOnAccount };
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

module.exports = { getBookingOnAccountCoverage, getMilestoneMoneyStages, pendingVerificationEntries, returnedEntries, isMilestoneOneCoveredByOnAccount, areEarlierMilestonesCoveredByOnAccount };
