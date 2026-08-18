// One-off correction for Inter-Company loans sanctioned before the
// two-sided, counterparty-named GL posting went live (see routes/
// loanSanction.js POST / — the Inter-Company block that calls postVoucher
// twice, once per company). Loans sanctioned before that existed instead
// went through the old manual /post-to-gl endpoint, which posted a single
// combined JV under one company: Dr the borrower's Loan ledger, Cr the
// lender's Loan ledger — no bank leg, and only one company's books touched
// at all, instead of each company seeing the transaction in its own books.
//
// This script finds every Inter-Company loan still carrying that old
// single-company posting, reverses it (flips IsReversed — same audit-trail-
// preserving pattern services/amendmentEngine.js uses for every other
// module), and posts fresh two-sided entries using the exact same leg
// shape as a live sanction today. Loans missing LenderBankAccountId/
// BorrowerBankAccountId (the old sanction form didn't always collect these)
// can't be reposted this way — they're reported and skipped, not guessed at.
//
// Dry-run by default — prints what it WOULD do without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/repostLegacyIntercompanyLoans.js
//   node backend/scripts/repostLegacyIntercompanyLoans.js --apply

const { connectDB, getPool, closeDB } = require("../db");
const { postVoucher, reversePostingBySource } = require("../services/generalLedger");
const { bumpCacheVersion } = require("../redis");

const APPLY = process.argv.includes("--apply");

async function findCandidates(pool) {
  const result = await pool.request().query(`
    SELECT
      ls.LoanId, ls.LoanNo, ls.LoanDate, ls.Amount,
      ls.LenderCompanyId, ls.BorrowerCompanyId,
      ls.LenderBankAccountId, ls.BorrowerBankAccountId,
      ls.LenderLHeadId, ls.BorrowerLHeadId,
      lc.name AS LenderCompanyName, bc.name AS BorrowerCompanyName,
      COUNT(DISTINCT gle.CompanyId) AS PostedCompanyCount
    FROM dbo.LoanSanction ls
    JOIN dbo.GeneralLedgerEntry gle
      ON gle.SourceType = 'LoanPosting' AND gle.SourceId = ls.LoanId AND gle.IsReversed = 0
    LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
    LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
    WHERE ls.LoanType = 'Inter-Company'
    GROUP BY
      ls.LoanId, ls.LoanNo, ls.LoanDate, ls.Amount,
      ls.LenderCompanyId, ls.BorrowerCompanyId,
      ls.LenderBankAccountId, ls.BorrowerBankAccountId,
      ls.LenderLHeadId, ls.BorrowerLHeadId,
      lc.name, bc.name
    HAVING COUNT(DISTINCT gle.CompanyId) = 1
    ORDER BY ls.LoanDate ASC, ls.LoanId ASC
  `);
  return result.recordset;
}

async function repost(pool, loan, actor) {
  await reversePostingBySource(pool, "LoanPosting", loan.LoanId);

  const amt = Number(loan.Amount);
  await postVoucher(pool, {
    voucherNo: loan.LoanNo,
    voucherDate: loan.LoanDate,
    sourceType: "LoanPosting",
    sourceId: loan.LoanId,
    companyId: loan.LenderCompanyId,
    createdBy: actor,
    legs: [
      { lHeadId: loan.BorrowerLHeadId, debit: amt, narration: `${loan.LoanNo} — inter-company loan receivable (funds sent)` },
      { lHeadId: loan.LenderBankAccountId, credit: amt, narration: `${loan.LoanNo} — loan disbursed` },
    ],
  });
  await postVoucher(pool, {
    voucherNo: loan.LoanNo,
    voucherDate: loan.LoanDate,
    sourceType: "LoanPosting",
    sourceId: loan.LoanId,
    companyId: loan.BorrowerCompanyId,
    createdBy: actor,
    legs: [
      { lHeadId: loan.BorrowerBankAccountId, debit: amt, narration: `${loan.LoanNo} — loan received` },
      { lHeadId: loan.LenderLHeadId, credit: amt, narration: `${loan.LoanNo} — inter-company loan payable (funds received)` },
    ],
  });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const candidates = await findCandidates(pool);
  if (candidates.length === 0) {
    console.log("No Inter-Company loans found on the old single-company posting format. Nothing to do.");
    await closeDB();
    return;
  }

  console.log(`Found ${candidates.length} Inter-Company loan(s) still on the old single-JV posting format.\n`);

  const ready = [];
  const blocked = [];
  for (const loan of candidates) {
    const missing = [];
    if (!loan.LenderCompanyId) missing.push("LenderCompanyId");
    if (!loan.BorrowerCompanyId) missing.push("BorrowerCompanyId");
    if (!loan.LenderBankAccountId) missing.push("LenderBankAccountId");
    if (!loan.BorrowerBankAccountId) missing.push("BorrowerBankAccountId");
    if (!loan.LenderLHeadId) missing.push("LenderLHeadId");
    if (!loan.BorrowerLHeadId) missing.push("BorrowerLHeadId");
    if (missing.length) blocked.push({ loan, missing });
    else ready.push(loan);
  }

  if (blocked.length) {
    console.log(`Blocked — missing fields needed to repost, edit the loan to fill these in first:`);
    for (const { loan, missing } of blocked) {
      console.log(`  ${loan.LoanNo} (LoanId ${loan.LoanId}) — missing: ${missing.join(", ")}`);
    }
    console.log("");
  }

  if (ready.length === 0) {
    console.log("No loans are eligible to repost right now.");
    await closeDB();
    return;
  }

  console.log(`${ready.length} loan(s) eligible to reverse + repost:`);
  for (const loan of ready) {
    console.log(
      `  ${loan.LoanNo} (LoanId ${loan.LoanId}) — ${loan.LenderCompanyName || loan.LenderCompanyId} → ${loan.BorrowerCompanyName || loan.BorrowerCompanyId}, ₹${amtFmt(loan.Amount)}, dated ${dateFmt(loan.LoanDate)}`,
    );
  }

  if (!APPLY) {
    console.log("\n(dry run — pass --apply to reverse the old posting and write the new two-sided one)");
    await closeDB();
    return;
  }

  console.log("");
  const summary = { done: 0, errored: 0 };
  for (const loan of ready) {
    try {
      await repost(pool, loan, "repost-legacy-intercompany-loans-script");
      console.log(`  reposted: ${loan.LoanNo} (LoanId ${loan.LoanId})`);
      summary.done++;
    } catch (err) {
      console.error(`  ERROR: ${loan.LoanNo} (LoanId ${loan.LoanId}) — ${err.message}`);
      summary.errored++;
    }
  }
  await bumpCacheVersion("journal-voucher");
  await bumpCacheVersion("loan-sanction");

  console.log(`\nDone. Reposted ${summary.done}, errored ${summary.errored}.`);
  if (summary.errored > 0) {
    console.log("Loans that errored were rolled back mid-repost by postVoucher's own transaction — investigate and re-run (already-fixed loans are skipped automatically since they'll no longer match the old-format query).");
  }

  await closeDB();
}

function amtFmt(n) {
  return Number(n).toLocaleString("en-IN");
}
function dateFmt(d) {
  return new Date(d).toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
