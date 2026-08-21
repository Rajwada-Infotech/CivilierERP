// backend/scripts/diagLoanRepaymentGaps.js
//
// Read-only report — writes nothing. Finds loans where an EMI is marked
// paid (dbo.LoanEMISchedule.IsPaid = 1) but there's no real
// dbo.LoanPayment row behind it, i.e. a repayment that was recorded with
// no financial trail (predates the Payment-page-only repayment flow, or
// was set directly). For each such loan, also searches dbo.NewPayment for
// any payment whose remarks/name mention that loan's LoanNo, in case the
// real payment exists but was never linked.
//
// This does NOT create or fix anything — a "paid" EMI with genuinely no
// underlying payment record has no source of truth to backfill from, and
// fabricating one would corrupt the audit trail rather than fix it. Use
// this to see what's actually there, then decide per-loan (leave it, or
// record a real payment through Finance -> Payment's Loan EMIs tab).
//
// Usage (run against whichever DB your current .env points at):
//   cd backend
//   node scripts/diagLoanRepaymentGaps.js

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();

  const gaps = await pool.request().query(`
    SELECT
      ls.LoanId, ls.LoanNo, ls.LoanType, ls.Status, ls.Amount,
      COUNT(e.EMIId) AS TotalEmis,
      SUM(CASE WHEN e.IsPaid = 1 THEN 1 ELSE 0 END) AS PaidEmis,
      (SELECT COUNT(*) FROM dbo.LoanPayment lp WHERE lp.LoanId = ls.LoanId) AS RealPaymentRows,
      MIN(CASE WHEN e.IsPaid = 1 THEN e.PaidDate END) AS EarliestPaidDate,
      MAX(CASE WHEN e.IsPaid = 1 THEN e.PaidDate END) AS LatestPaidDate
    FROM dbo.LoanSanction ls
    JOIN dbo.LoanEMISchedule e ON e.LoanId = ls.LoanId
    GROUP BY ls.LoanId, ls.LoanNo, ls.LoanType, ls.Status, ls.Amount
    HAVING SUM(CASE WHEN e.IsPaid = 1 THEN 1 ELSE 0 END) > 0
       AND (SELECT COUNT(*) FROM dbo.LoanPayment lp WHERE lp.LoanId = ls.LoanId) = 0
    ORDER BY ls.LoanId
  `);

  if (gaps.recordset.length === 0) {
    console.log("No gaps found — every loan with a paid EMI has a real LoanPayment row behind it.");
    process.exit(0);
  }

  console.log(`${gaps.recordset.length} loan(s) with EMIs marked paid but zero LoanPayment rows:\n`);
  console.table(gaps.recordset);

  for (const loan of gaps.recordset) {
    const candidates = await pool.request().input("loanNo", sql.NVarChar(100), loan.LoanNo).query(`
      SELECT np.PPaymentID, np.DocNo, np.PAmount, np.PDate, np.PMode, np.PRemarks, np.PPaymentName
      FROM dbo.NewPayment np
      WHERE np.PRemarks LIKE '%' + @loanNo + '%' OR np.PPaymentName LIKE '%' + @loanNo + '%'
    `);
    console.log(`\nLoan ${loan.LoanNo} (LoanId=${loan.LoanId}) — candidate NewPayment rows mentioning its LoanNo:`);
    if (candidates.recordset.length === 0) {
      console.log("  none found — nothing to link. This EMI has no payment record anywhere in the system.");
    } else {
      console.table(candidates.recordset);
      console.log("  If one of these IS the real repayment, link it manually via Finance > Payment's");
      console.log("  Loan EMIs tab (do not hand-edit LoanPayment/NewPaymentId directly).");
    }
  }

  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
