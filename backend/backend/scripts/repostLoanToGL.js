// backend/scripts/repostLoanToGL.js
//
// Finds every loan that WAS posted to GL at some point (has a reversed
// dbo.GeneralLedgerEntry with SourceType='LoanPosting') but has NO active
// posting now — a loan that got its GL reversed (typically by editing its
// financial terms after posting, see PUT /:id's own reversal step) and was
// never re-posted afterward. Deliberately narrower than "every loan with
// zero active posting" — a loan that was simply never posted yet (a real,
// common, non-broken state; posting is a manual action) is left alone.
//
// Re-posts each match using postLoanToGLInternal — the exact same function
// the "Post to GL" button's API route calls, not a reimplementation. Its
// own guards (missing lender/borrower GL heads, Fund-Transfer-linked loan,
// zero amount) still apply, so a loan that genuinely can't be safely
// re-posted is skipped and reported, not forced.
//
// Usage:
//   cd backend
//   node scripts/repostLoanToGL.js              # dry run — reports only, writes nothing
//   node scripts/repostLoanToGL.js --apply       # actually re-posts matched loans
//   node scripts/repostLoanToGL.js LN-000005     # scope to one loan
//   node scripts/repostLoanToGL.js LN-000005 --apply

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");
const { postLoanToGLInternal } = require("../routes/loanSanction");

const APPLY = process.argv.includes("--apply");
const loanNoArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

(async () => {
  await connectDB();
  const pool = getPool();

  const result = await pool.request().input("LoanNo", sql.NVarChar(50), loanNoArg || null).query(`
    SELECT ls.LoanId, ls.LoanNo, ls.LoanType, ls.Status, ls.Amount, ls.CreatedBy, ls.LoanDate, ls.DisbursedAt
    FROM dbo.LoanSanction ls
    WHERE (@LoanNo IS NULL OR ls.LoanNo = @LoanNo)
      AND EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry g
        WHERE g.SourceType = 'LoanPosting' AND g.SourceId = ls.LoanId AND g.IsReversed = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry g
        WHERE g.SourceType = 'LoanPosting' AND g.SourceId = ls.LoanId AND g.IsReversed = 0
      )
    ORDER BY ls.LoanId
  `);

  if (result.recordset.length === 0) {
    console.log(loanNoArg
      ? `${loanNoArg} doesn't match this pattern (either not reversed, already re-posted, or not found).`
      : "No loans found with a reversed-and-never-re-posted GL gap.");
    process.exit(0);
  }

  console.log(`${result.recordset.length} loan(s) with reversed GL and no active re-post.${APPLY ? "" : " (dry run — pass --apply to write)"}\n`);

  let fixed = 0;
  let skipped = 0;

  for (const loan of result.recordset) {
    // postLoanToGLInternal's own DisbursedAt update is guarded by
    // "AND DisbursedAt IS NULL" — every loan matched here already has one
    // reversed LoanPosting entry, meaning DisbursedAt was already stamped
    // during that original posting and stays untouched by this re-post
    // (confirmed against LN-000005: DisbursedAt was already non-null).
    // Surfaced here only so that's visible/auditable, not because
    // anything needs correcting.
    const label = `${loan.LoanNo} (${loan.LoanType}, ₹${loan.Amount}, ${loan.Status}, created by ${loan.CreatedBy || "unknown"}, DisbursedAt=${loan.DisbursedAt ? new Date(loan.DisbursedAt).toISOString().slice(0, 10) : "null"})`;
    if (!APPLY) {
      console.log(`WOULD RE-POST  ${label}`);
      continue;
    }
    try {
      const posted = await postLoanToGLInternal(pool, loan.LoanId, "backfill-script");
      console.log(`RE-POSTED  ${label} -> voucher ${posted.voucherNo}`);
      fixed++;
    } catch (err) {
      console.log(`SKIP  ${label} — ${err.message}`);
      skipped++;
    }
  }

  if (APPLY) console.log(`\nRe-posted: ${fixed}. Skipped: ${skipped}.`);
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
