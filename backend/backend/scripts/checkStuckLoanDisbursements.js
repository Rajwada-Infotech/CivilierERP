// Follow-up to checkLoanGLPosting.js: every Customer Loan in production is
// stuck at Sanctioned/DisbursedAt=null. Checks whether this matches the
// PBankName NULL-insert bug just fixed in Payment.tsx's
// handleSelectCustomerLoanDisbursement (it pre-filled bankId from the
// loan's LenderBankAccountId but never bankName, so saving without
// re-touching the Bank dropdown failed the insert) — i.e. were there any
// NewPayment save attempts for these loans at all, and did any of them
// actually reach NewPayment/PPaymentID (meaning the save succeeded but the
// separate /disburse linking step is what's broken), or does nothing exist
// at the NewPayment level at all (meaning every attempt died at save, which
// is exactly what the PBankName bug would cause)?
//
// Usage:
//   node backend/scripts/checkStuckLoanDisbursements.js

const { connectDB, getPool, closeDB, sql } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const loansRes = await pool.request().query(`
    SELECT LoanId, LoanNo, Amount, LenderBankAccountId, LenderCustomerId
    FROM dbo.LoanSanction
    WHERE LoanType = 'Customer Loan' AND DisbursedAt IS NULL
    ORDER BY LoanId
  `);
  console.log(`${loansRes.recordset.length} undisbursed Customer Loan(s):\n`);

  for (const loan of loansRes.recordset) {
    console.log(`${loan.LoanNo} (Id ${loan.LoanId}, ₹${Number(loan.Amount).toLocaleString("en-IN")}) — LenderBankAccountId=${loan.LenderBankAccountId}`);
  }

  // Any NewPayment rows whose purpose text matches the picker's default
  // "Loan disbursement — <LoanNo>" naming, regardless of whether they ended
  // up linked back to a loan.
  const npRes = await pool.request().query(`
    SELECT PPaymentID, DocNo, PPaymentName, PDate, PBankName, PBankID, Status, PAmount
    FROM dbo.NewPayment
    WHERE PPaymentName LIKE 'Loan disbursement %'
    ORDER BY PPaymentID DESC
  `);
  console.log(`\nNewPayment rows matching "Loan disbursement — ..." naming (${npRes.recordset.length}):`);
  console.log(npRes.recordset);

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
