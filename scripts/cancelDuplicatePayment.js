// backend/scripts/cancelDuplicatePayment.js
//
// Cancels one NewPayment by its PPaymentID, using the exact same
// cancelPaymentCheque() logic the Cheque Cancellation page's API route
// uses — not a bespoke reimplementation. For a payment linked to a loan
// repayment (dbo.LoanPayment.NewPaymentId), this also reverses that
// repayment's effect on the loan: the EMI(s) it marked paid go back to
// unpaid, its OnAccountLedger entries get compensating reversal entries,
// its GL voucher is reversed, and dbo.LoanPayment is flagged
// IsReversed = 1 (never deleted — same audit-trail convention as
// GeneralLedgerEntry.IsReversed).
//
// Built for LN-000015 (Inter-Company): its NewPayment #79 (DocNo
// PAY-2026-00076) turned out to be the SAME cheque (#353123), same date,
// same amount, and same "loan given from X" remarks as the loan's own
// disbursement — entered a second time by mistake through Payment >
// Loan EMIs, which then processed it as a real (backwards) repayment.
//
// Usage:
//   cd backend
//   node scripts/cancelDuplicatePayment.js <PPaymentID> "<reason>"     # dry run — reports what it would do
//   node scripts/cancelDuplicatePayment.js <PPaymentID> "<reason>" --apply

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");
const { cancelPaymentCheque } = require("../routes/chequeCancellation");

const paymentId = parseInt(process.argv[2], 10);
const reason = process.argv[3];
const APPLY = process.argv.includes("--apply");

if (!paymentId || !reason) {
  console.error('Usage: node scripts/cancelDuplicatePayment.js <PPaymentID> "<reason>" [--apply]');
  process.exit(1);
}

(async () => {
  await connectDB();
  const pool = getPool();

  const payRes = await pool.request().input("id", sql.Int, paymentId).query(`
    SELECT PPaymentID, DocNo, PAmount, PDate, PMode, PChequeNo, PChequeDate, PRemarks, Status, PIsChequeCancelled
    FROM dbo.NewPayment WHERE PPaymentID = @id
  `);
  const payment = payRes.recordset[0];
  if (!payment) {
    console.error(`No NewPayment with PPaymentID = ${paymentId}`);
    process.exit(1);
  }
  console.log("Payment to cancel:", payment);

  const lpRes = await pool.request().input("id", sql.Int, paymentId).query(`
    SELECT PaymentId, LoanId, PrincipalInterestAmount, IsReversed FROM dbo.LoanPayment WHERE NewPaymentId = @id
  `);
  if (lpRes.recordset.length) {
    console.log("Linked LoanPayment (will also be reversed):", lpRes.recordset[0]);
  } else {
    console.log("No linked LoanPayment — this is a plain payment cancellation.");
  }

  if (!APPLY) {
    console.log("\nDry run — pass --apply to actually cancel this payment and reverse the linked loan repayment.");
    process.exit(0);
  }

  const result = await cancelPaymentCheque(pool, {
    paymentId,
    chequeNo: payment.PChequeNo,
    reason,
    userEmail: "backfill-script",
  });

  if (!result.ok) {
    console.error("Cancellation failed:", result.error);
    process.exit(1);
  }
  console.log("\nCancelled successfully.", result);
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
