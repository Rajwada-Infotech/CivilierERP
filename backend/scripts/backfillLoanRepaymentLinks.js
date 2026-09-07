// backend/scripts/backfillLoanRepaymentLinks.js
//
// Backfills the missing dbo.LoanPayment row for a loan whose EMI is marked
// paid (LoanEMISchedule.IsPaid = 1) but has no payment record behind it —
// ONLY when a real, unambiguous dbo.NewPayment exists to link it to. This
// never fabricates a payment: if zero or more-than-one candidate NewPayment
// matches a gap, that loan is skipped and reported, not guessed at.
//
// What this does NOT do: re-run OnAccountLedger or GL posting for the
// backfilled payment. Whatever actually happened financially already
// happened (the EMI is already marked paid); this script only repairs the
// missing cross-reference so Repayment History / GET /:id/payments can show
// how it was actually paid, and so future SUM(PrincipalInterestAmount)
// queries (already filtered on IsReversed = 0) count it correctly.
//
// A candidate NewPayment must:
//   - not already be linked to any LoanPayment row (NewPaymentId is 1:1)
//   - match the gap's EMI amount within a few paisa
//   - be Approved (not Pending/Rejected/Cancelled)
// If more than one NewPayment matches a single gap, it's ambiguous — skipped,
// not guessed at.
//
// Usage:
//   cd backend
//   node scripts/backfillLoanRepaymentLinks.js            # dry run (default) — reports only, writes nothing
//   node scripts/backfillLoanRepaymentLinks.js --apply     # actually writes the backfilled LoanPayment rows

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();

  const gaps = await pool.request().query(`
    SELECT
      ls.LoanId, ls.LoanNo, ls.LoanType, ls.Status,
      e.EMIId, e.InstallmentNo, e.EMIAmount, e.PaidDate
    FROM dbo.LoanSanction ls
    JOIN dbo.LoanEMISchedule e ON e.LoanId = ls.LoanId
    WHERE e.IsPaid = 1 AND e.PaymentId IS NULL
    ORDER BY ls.LoanId, e.InstallmentNo
  `);

  if (gaps.recordset.length === 0) {
    console.log("No gaps found — every paid EMI already has a LoanPayment row.");
    process.exit(0);
  }

  console.log(`${gaps.recordset.length} paid EMI(s) with no LoanPayment row.${APPLY ? "" : " (dry run — pass --apply to write)"}\n`);

  let backfilled = 0;
  let skipped = 0;

  for (const gap of gaps.recordset) {
    const candidates = await pool.request()
      .input("Amount", sql.Decimal(18, 2), gap.EMIAmount)
      .input("LoanNo", sql.NVarChar(100), gap.LoanNo)
      .query(`
        SELECT np.PPaymentID, np.DocNo, np.PAmount, np.PDate, np.PMode, np.Status
        FROM dbo.NewPayment np
        WHERE np.Status = 'Approved'
          AND ABS(np.PAmount - @Amount) < 0.01
          AND NOT EXISTS (SELECT 1 FROM dbo.LoanPayment lp WHERE lp.NewPaymentId = np.PPaymentID)
          AND (np.PRemarks LIKE '%' + @LoanNo + '%' OR np.PPaymentName LIKE '%' + @LoanNo + '%')
      `);

    const label = `${gap.LoanNo} — EMI #${gap.InstallmentNo} (₹${gap.EMIAmount}, paid ${gap.PaidDate ? new Date(gap.PaidDate).toISOString().slice(0, 10) : "unknown date"})`;

    if (candidates.recordset.length === 0) {
      console.log(`SKIP  ${label} — no matching NewPayment found. No real record to link; leaving as-is.`);
      skipped++;
      continue;
    }
    if (candidates.recordset.length > 1) {
      console.log(`SKIP  ${label} — ${candidates.recordset.length} ambiguous NewPayment candidates (${candidates.recordset.map((c) => c.DocNo).join(", ")}). Link manually.`);
      skipped++;
      continue;
    }

    const match = candidates.recordset[0];
    console.log(`${APPLY ? "LINK " : "WOULD LINK"} ${label} -> NewPayment ${match.DocNo} (₹${match.PAmount}, ${match.PMode})`);

    if (!APPLY) continue;

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const paymentRef = `PAY-${gap.LoanNo}-BACKFILL-${gap.EMIId}`;
      const paymentDate = match.PDate || gap.PaidDate || new Date();
      const inserted = await new sql.Request(tx)
        .input("LoanId", sql.Int, gap.LoanId)
        .input("PaymentRef", sql.NVarChar(100), paymentRef)
        .input("PaymentDate", sql.Date, paymentDate)
        .input("PaymentType", sql.NVarChar(20), "EMI")
        .input("PrincipalInterestAmount", sql.Decimal(18, 2), gap.EMIAmount)
        .input("LateFee", sql.Decimal(18, 2), 0)
        .input("TotalAmount", sql.Decimal(18, 2), gap.EMIAmount)
        .input("ExcessCredited", sql.Decimal(18, 2), 0)
        .input("ClosedLoan", sql.Bit, 0)
        .input("Notes", sql.NVarChar(500), "Backfilled: linked to a pre-existing NewPayment found by backfillLoanRepaymentLinks.js")
        .input("NewPaymentId", sql.Int, match.PPaymentID)
        .input("CreatedBy", sql.NVarChar(150), "backfill-script").query(`
          INSERT INTO dbo.LoanPayment
            (LoanId, PaymentRef, PaymentDate, PaymentType, PrincipalInterestAmount, LateFee, TotalAmount, ExcessCredited, ClosedLoan, Notes, NewPaymentId, CreatedBy)
          OUTPUT INSERTED.PaymentId
          VALUES
            (@LoanId, @PaymentRef, @PaymentDate, @PaymentType, @PrincipalInterestAmount, @LateFee, @TotalAmount, @ExcessCredited, @ClosedLoan, @Notes, @NewPaymentId, @CreatedBy)
        `);
      const loanPaymentId = inserted.recordset[0].PaymentId;

      await new sql.Request(tx)
        .input("EMIId", sql.Int, gap.EMIId)
        .input("PaymentId", sql.Int, loanPaymentId)
        .query(`UPDATE dbo.LoanEMISchedule SET PaymentId = @PaymentId WHERE EMIId = @EMIId`);

      await tx.commit();
      console.log(`      -> LoanPayment #${loanPaymentId} created.`);
      backfilled++;
    } catch (err) {
      await tx.rollback().catch(() => {});
      console.error(`      -> FAILED: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n${APPLY ? "Backfilled" : "Would backfill"}: ${backfilled}. Skipped (no safe match): ${skipped}.`);
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
