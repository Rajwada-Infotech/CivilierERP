const { sql } = require("../db");
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
async function getBookingOnAccountCoverage(pool, bookingId) {
  const milestonesRes = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT Id, MilestoneNo, MilestoneName, AmountDue, AmountPaid, Status, ExtraChargeId, ParkingAllotmentId
    FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo, Id
  `);
  const oaRes = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ISNULL(SUM(o.AvailableAmount), 0) AS TotalOnAccount FROM ${onAccountWithAvailableSql("o")}
    WHERE o.BookingId = @bid
  `);
  const totalOnAccount = Number(oaRes.recordset[0]?.TotalOnAccount) || 0;

  let cumulativeRequired = 0;
  const milestones = milestonesRes.recordset.map((m) => {
    const required = m.Status === "Waived" ? 0 : Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0));
    cumulativeRequired = Math.round((cumulativeRequired + required) * 100) / 100;
    const alreadyPaid = m.Status === "Paid" || m.Status === "Waived" || Number(m.AmountPaid || 0) >= Number(m.AmountDue || 0);
    return {
      ...m,
      CumulativeRequired: cumulativeRequired,
      VirtuallyCovered: alreadyPaid || totalOnAccount >= cumulativeRequired,
    };
  });

  return { milestones, totalOnAccount, grandRequired: cumulativeRequired };
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
async function areEarlierMilestonesCoveredByOnAccount(pool, bookingId, milestoneNo) {
  if (Number(milestoneNo) <= 1) return true;
  const { milestones } = await getBookingOnAccountCoverage(pool, bookingId);
  // Same reasoning as isMilestoneOneCoveredByOnAccount above: an older
  // booking can carry a legacy dedicated parking/extra-charge milestone
  // sharing the same MilestoneNo as a real schedule milestone. Matching on
  // MilestoneNo alone could silently return that legacy row instead of the
  // real "milestone N-1" the caller means.
  const preceding = milestones.find((m) => Number(m.MilestoneNo) === Number(milestoneNo) - 1 && m.ExtraChargeId == null && m.ParkingAllotmentId == null);
  return !!preceding?.VirtuallyCovered;
}

module.exports = { getBookingOnAccountCoverage, isMilestoneOneCoveredByOnAccount, areEarlierMilestonesCoveredByOnAccount };
