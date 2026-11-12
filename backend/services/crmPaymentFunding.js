const { sql } = require("../db");
const { REFUND_CLOSED_SQL } = require("../constants/crmStatuses");

function onAccountAvailableSql(alias = "o") {
  const remaining = `${alias}.Amount - ISNULL(${alias}.AppliedAmount, 0)`;
  const reserved = `ISNULL((SELECT SUM(r.GrossAmount) FROM dbo.CrmRefund r
      WHERE r.SourceOnAccountId = ${alias}.Id AND r.Status NOT IN ${REFUND_CLOSED_SQL}), 0)
    + ISNULL((SELECT SUM(t.Amount) FROM dbo.CrmRebookingTransfer t
      WHERE t.HeldOnAccountId = ${alias}.Id AND t.Status NOT IN ('Rejected', 'Applied')), 0)`;
  return `CASE
    WHEN ISNULL(${alias}.Status, '') IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') THEN 0
    WHEN ${remaining} - (${reserved}) > 0 THEN ${remaining} - (${reserved})
    ELSE 0 END`;
}

// onAccountAvailableSql() contains subqueries, and SQL Server refuses a
// subquery inside SUM(). Anything that totals available on-account money
// selects FROM this instead and SUMs `${alias}.AvailableAmount`.
function onAccountWithAvailableSql(alias = "o") {
  return `(SELECT ${alias}.*, ${onAccountAvailableSql(alias)} AS AvailableAmount
    FROM dbo.CrmOnAccountPayment ${alias}) ${alias}`;
}

// Money entered for a booking that Finance has not been handed yet: its Money Receipts still waiting to go (they go when
// the Director approves the booking), or, before any receipt exists, the token typed on the application.
function recordedMoneySql(bookingIdExpr) {
  return `(SELECT CASE WHEN COUNT(x.Id) = 0
      THEN (SELECT CASE WHEN bk.TokenType = N'Amount' THEN ISNULL(bk.TokenValue, 0) ELSE 0 END FROM dbo.CrmBooking bk WHERE bk.Id = ${bookingIdExpr})
      ELSE ISNULL(SUM(CASE WHEN x.Status = N'Pending' AND x.ReceivedPaymentId IS NULL THEN x.Amount ELSE 0 END), 0) END
    FROM dbo.CrmMoneyReceipt x WHERE x.BookingId = ${bookingIdExpr})`;
}

// SQL twin of getBookingFunding for larger list queries. The caller supplies
// a trusted booking-id expression (for example `b.Id` or `@bid`).
function bookingFullyFundedSql(bookingIdExpr) {
  return `COALESCE((SELECT SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE ISNULL(m.AmountDue, 0) END)
      FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = ${bookingIdExpr}),
      (SELECT ISNULL(NULLIF(bf.GrandTotal, 0), bf.TotalValue) FROM dbo.CrmBooking bf WHERE bf.Id = ${bookingIdExpr}), 0)
    <= ISNULL((SELECT SUM(ISNULL(m.AmountPaid, 0)) FROM dbo.CrmPaymentMilestone m
      WHERE m.BookingId = ${bookingIdExpr}), 0)
      + ISNULL((SELECT SUM(o.AvailableAmount)
        FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = ${bookingIdExpr}), 0) + 0.009`;
}

// What a booking must fund and what has funded it, as APPLY clauses on a dbo.CrmBooking alias (fm.RequiredAmount,
// fm.MilestonePaid, fo.OnAccountAvailable). Applied deposits are already represented in milestone AmountPaid, so the
// available side only includes each valid deposit's unapplied remainder.
function bookingFundingApplySql(alias = "b") {
  return `OUTER APPLY (SELECT CASE WHEN COUNT(m.Id) = 0
        THEN ISNULL(NULLIF(${alias}.GrandTotal, 0), ${alias}.TotalValue)
        ELSE ISNULL(SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE ISNULL(m.AmountDue, 0) END), 0)
      END AS RequiredAmount,
      ISNULL(SUM(ISNULL(m.AmountPaid, 0)), 0) AS MilestonePaid
    FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = ${alias}.Id) fm
    OUTER APPLY (SELECT ISNULL(SUM(o.AvailableAmount), 0) AS OnAccountAvailable
      FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = ${alias}.Id) fo`;
}

async function getBookingFunding(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT fm.RequiredAmount, fm.MilestonePaid, fo.OnAccountAvailable
    FROM dbo.CrmBooking b
    ${bookingFundingApplySql("b")}
    WHERE b.Id = @bid
  `);
  const row = result.recordset[0] || {};
  const requiredAmount = Math.max(0, Number(row.RequiredAmount) || 0);
  const milestonePaid = Math.max(0, Number(row.MilestonePaid) || 0);
  const onAccountAvailable = Math.max(0, Number(row.OnAccountAvailable) || 0);
  const totalFunded = milestonePaid + onAccountAvailable;
  return {
    requiredAmount,
    milestonePaid,
    onAccountAvailable,
    totalFunded,
    shortfall: Math.max(0, Math.round((requiredAmount - totalFunded) * 100) / 100),
  };
}

module.exports = { getBookingFunding, bookingFundingApplySql, bookingFullyFundedSql, onAccountAvailableSql, recordedMoneySql, onAccountWithAvailableSql };
