// backend/scripts/fixDuplicateLoanDisbursementPayments.js
//
// The general version of the LN-000015 fix — scans every loan for a
// repayment (dbo.LoanPayment -> dbo.NewPayment) whose cheque number, cheque
// date, AND amount are IDENTICAL to that same loan's own disbursement
// (dbo.LoanSanction.ChequeNo/ChequeDate/Amount). All three matching at once
// is the signature of the same physical cheque being entered twice — once
// correctly as the disbursement, once by mistake as a "repayment" through
// Payment > Loan EMIs — not a coincidence between two real, separate
// transactions.
//
// For each match found, cancels that NewPayment using the exact same
// cancelPaymentCheque() logic the Cheque Cancellation page's API route
// uses (see scripts/cancelDuplicatePayment.js for the single-loan version
// of this) — which reverses the linked LoanPayment's GL/OnAccountLedger
// and reverts the EMI it wrongly marked paid.
//
// Usage:
//   cd backend
//   node scripts/fixDuplicateLoanDisbursementPayments.js            # dry run — reports matches, writes nothing
//   node scripts/fixDuplicateLoanDisbursementPayments.js --apply     # cancels every matched duplicate

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");
const { cancelPaymentCheque } = require("../routes/chequeCancellation");

const APPLY = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();

  const matches = await pool.request().query(`
    SELECT
      ls.LoanId, ls.LoanNo, ls.LoanType, ls.ChequeNo AS LoanChequeNo, ls.ChequeDate AS LoanChequeDate, ls.Amount AS LoanAmount,
      lp.PaymentId AS LoanPaymentId, lp.PaymentRef, lp.IsReversed AS LoanPaymentReversed,
      np.PPaymentID, np.DocNo, np.PAmount, np.PChequeNo, np.PChequeDate, np.Status AS PaymentStatus, np.PIsChequeCancelled
    FROM dbo.LoanSanction ls
    JOIN dbo.LoanPayment lp ON lp.LoanId = ls.LoanId AND lp.IsReversed = 0
    JOIN dbo.NewPayment np ON np.PPaymentID = lp.NewPaymentId
    WHERE ls.ChequeNo IS NOT NULL
      AND ls.ChequeNo = np.PChequeNo
      AND ls.ChequeDate = np.PChequeDate
      AND ls.Amount = np.PAmount
      AND np.PIsChequeCancelled = 0
      AND np.Status <> 'Cancelled'
  `);

  if (matches.recordset.length === 0) {
    console.log("No duplicate disbursement-as-repayment entries found — every loan's cheque number differs from its linked repayment's.");
    process.exit(0);
  }

  console.log(`${matches.recordset.length} loan(s) where the "repayment" reuses the loan's own disbursement cheque.${APPLY ? "" : " (dry run — pass --apply to fix)"}\n`);

  let fixed = 0;
  let failed = 0;

  for (const m of matches.recordset) {
    const label = `${m.LoanNo} — NewPayment ${m.DocNo} (#${m.PPaymentID}), cheque ${m.LoanChequeNo}, ₹${m.LoanAmount}`;
    if (!APPLY) {
      console.log(`WOULD CANCEL  ${label}`);
      continue;
    }
    const reason = `Duplicate entry — same cheque as loan ${m.LoanNo}'s own disbursement, entered a second time by mistake (found by fixDuplicateLoanDisbursementPayments.js).`;
    const result = await cancelPaymentCheque(pool, {
      paymentId: m.PPaymentID,
      chequeNo: m.PChequeNo,
      reason,
      userEmail: "backfill-script",
    });
    if (result.ok) {
      console.log(`FIXED  ${label}`);
      fixed++;
    } else {
      console.log(`FAILED  ${label} — ${result.error}`);
      failed++;
    }
  }

  if (APPLY) console.log(`\nFixed: ${fixed}. Failed: ${failed}.`);
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
