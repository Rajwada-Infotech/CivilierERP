// One-off backfill for the chequeCancellation.js bug fixed alongside this
// script: cancelPaymentCheque only ever reversed SourceType='NewPayment',
// never 'PaymentPosting' or 'BounceChargePosting' — so any payment whose
// cheque was cancelled AFTER it had been posted via one of those other two
// paths kept a live, unreversed GeneralLedgerEntry (a disbalanced ledger:
// cash/bank never actually moved, but the GL still shows it did).
//
// Finds every NewPayment with PIsChequeCancelled=1 that still has a live
// (IsReversed=0) GL posting under NewPayment/PaymentPosting/
// BounceChargePosting, and flips IsReversed=1 on those rows — same
// reversePostingBySource() flag-don't-delete convention used everywhere
// else, so the original entries stay in the audit trail.
//
// Usage:
//   node scripts/backfillCancelledChequeGLReversal.js            (dry run — reports only)
//   node scripts/backfillCancelledChequeGLReversal.js --apply    (actually reverses)
const { getPool, sql, connectDB } = require("../db");
const { reversePostingBySource } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();

  const res = await pool.request().query(`
    SELECT np.PPaymentID, np.DocNo, np.PAmount, np.Status,
           gle.SourceType, gle.EntryId, gle.DebitAmount, gle.CreditAmount, gle.VoucherDate
    FROM dbo.NewPayment np
    JOIN dbo.GeneralLedgerEntry gle
      ON gle.SourceType IN ('NewPayment','PaymentPosting','BounceChargePosting')
     AND gle.SourceId = np.PPaymentID
    WHERE np.PIsChequeCancelled = 1 AND gle.IsReversed = 0
    ORDER BY np.PPaymentID DESC
  `);

  const rows = res.recordset;
  console.log(`Found ${rows.length} live GL entr${rows.length === 1 ? "y" : "ies"} for cancelled-cheque payments.`);
  for (const r of rows) {
    console.log(
      `  Payment #${r.PPaymentID} (${r.DocNo}) — ${r.SourceType} EntryId=${r.EntryId} ` +
      `Dr=${r.DebitAmount} Cr=${r.CreditAmount} Voucher=${new Date(r.VoucherDate).toISOString().slice(0, 10)}`,
    );
  }

  if (!rows.length) {
    console.log("Nothing to fix.");
    process.exit(0);
  }

  if (!APPLY) {
    console.log("\nDry run only — re-run with --apply to reverse these entries.");
    process.exit(0);
  }

  const paymentIds = [...new Set(rows.map((r) => r.PPaymentID))];
  for (const id of paymentIds) {
    for (const sourceType of ["NewPayment", "PaymentPosting", "BounceChargePosting"]) {
      await reversePostingBySource(pool, sourceType, id);
    }
    console.log(`Reversed payment #${id}`);
  }
  console.log(`\nDone — reversed GL postings for ${paymentIds.length} cancelled-cheque payment(s).`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
