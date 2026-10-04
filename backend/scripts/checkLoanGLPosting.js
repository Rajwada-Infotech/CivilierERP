// Read-only diagnostic: for every loan type (Bank Loan, Customer Loan —
// both directions, Inter-Company), checks whether it actually has a live
// GeneralLedgerEntry posting (SourceType IN ('LoanPosting','LoanRepayment'))
// and would therefore show up in Trial Balance — vs. sanctioned/disbursed
// loans that never got posted (DisbursedAt set but no live GL row), or
// loans stuck pre-disbursement (DisbursedAt still null).
//
// Usage:
//   node backend/scripts/checkLoanGLPosting.js

const { connectDB, getPool, closeDB, sql } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const loansRes = await pool.request().query(`
    SELECT ls.LoanId, ls.LoanNo, ls.LoanType, ls.Status, ls.Amount, ls.DisbursedAt,
           ls.LenderCustomerId, ls.LenderLHeadId, ls.BorrowerLHeadId,
           ls.LenderCompanyId, ls.BorrowerCompanyId
    FROM dbo.LoanSanction ls
    ORDER BY ls.LoanType, ls.LoanId
  `);

  console.log(`Found ${loansRes.recordset.length} total loan(s).\n`);

  const byType = {};
  for (const loan of loansRes.recordset) {
    const direction = loan.LoanType === "Customer Loan" && loan.LenderCustomerId ? " (Customer→Company)" : "";
    const key = `${loan.LoanType}${direction}`;
    byType[key] = byType[key] || [];
    byType[key].push(loan);
  }

  for (const [type, loans] of Object.entries(byType)) {
    console.log(`\n=== ${type}: ${loans.length} loan(s) ===`);
    for (const loan of loans) {
      const postingRes = await pool.request().input("SrcId", sql.Int, loan.LoanId).query(`
        SELECT SourceType, COUNT(*) AS legCount, SUM(DebitAmount) AS totalDebit, SUM(CreditAmount) AS totalCredit
        FROM dbo.GeneralLedgerEntry
        WHERE SourceType IN ('LoanPosting', 'LoanRepayment') AND SourceId = @SrcId AND IsReversed = 0
        GROUP BY SourceType
      `);
      const postings = postingRes.recordset;
      const hasDisbursementPosting = postings.some((p) => p.SourceType === "LoanPosting");
      const hasRepaymentPosting = postings.some((p) => p.SourceType === "LoanRepayment");

      let flag = "✓";
      let note = "";
      if (!loan.LenderLHeadId || !loan.BorrowerLHeadId) {
        flag = "⚠";
        note = "missing lender/borrower LHeadId — can never post";
      } else if (loan.DisbursedAt && !hasDisbursementPosting) {
        flag = "⚠";
        note = "DisbursedAt is set but NO live LoanPosting GL entry found";
      } else if (!loan.DisbursedAt && loan.Status === "Approved") {
        flag = "○";
        note = "approved but not yet disbursed (nothing to post yet)";
      }

      console.log(
        `  ${flag} ${loan.LoanNo} (Id ${loan.LoanId}, ${loan.Status}, ₹${fmt(loan.Amount)}) — ` +
        `DisbursedAt=${loan.DisbursedAt ? new Date(loan.DisbursedAt).toISOString().slice(0, 10) : "null"}, ` +
        `LoanPosting=${hasDisbursementPosting ? "live" : "none"}, LoanRepayment=${hasRepaymentPosting ? "live" : "none"}` +
        (note ? ` — ${note}` : "")
      );
    }
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
