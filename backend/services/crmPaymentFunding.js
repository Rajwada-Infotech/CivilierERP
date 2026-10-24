const { sql } = require("../db");

// SQL twin of getBookingFunding for larger list queries. The caller supplies
// a trusted booking-id expression (for example `b.Id` or `@bid`).
function bookingFullyFundedSql(bookingIdExpr) {
  return `COALESCE((SELECT SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE ISNULL(m.AmountDue, 0) END)
      FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = ${bookingIdExpr}),
      (SELECT ISNULL(NULLIF(bf.GrandTotal, 0), bf.TotalValue) FROM dbo.CrmBooking bf WHERE bf.Id = ${bookingIdExpr}), 0)
    <= ISNULL((SELECT SUM(ISNULL(m.AmountPaid, 0)) FROM dbo.CrmPaymentMilestone m
      WHERE m.BookingId = ${bookingIdExpr}), 0)
      + ISNULL((SELECT SUM(CASE WHEN ISNULL(o.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded')
          AND o.Amount > ISNULL(o.AppliedAmount, 0) THEN o.Amount - ISNULL(o.AppliedAmount, 0) ELSE 0 END)
        FROM dbo.CrmOnAccountPayment o WHERE o.BookingId = ${bookingIdExpr}), 0) + 0.009`;
}

// Applied deposits are already represented in milestone AmountPaid, so the
// available side only includes each valid deposit's unapplied remainder.
async function getBookingFunding(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      CASE WHEN COUNT(m.Id) = 0
        THEN ISNULL(NULLIF(b.GrandTotal, 0), b.TotalValue)
        ELSE ISNULL(SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE ISNULL(m.AmountDue, 0) END), 0)
      END AS RequiredAmount,
      ISNULL(SUM(ISNULL(m.AmountPaid, 0)), 0) AS MilestonePaid,
      ISNULL((
        SELECT SUM(CASE WHEN o.Amount > ISNULL(o.AppliedAmount, 0)
          THEN o.Amount - ISNULL(o.AppliedAmount, 0) ELSE 0 END)
        FROM dbo.CrmOnAccountPayment o
        WHERE o.BookingId = b.Id
          AND ISNULL(o.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded')
      ), 0) AS OnAccountAvailable
    FROM dbo.CrmBooking b
    LEFT JOIN dbo.CrmPaymentMilestone m ON m.BookingId = b.Id
    WHERE b.Id = @bid
    GROUP BY b.Id, b.GrandTotal, b.TotalValue
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

module.exports = { getBookingFunding, bookingFullyFundedSql };
