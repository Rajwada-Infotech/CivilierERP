// Read-only diagnostic: the Trial Balance drill-down for "Director or
// Partner Remuneration" (under the DRAWINGS group) is only showing one GL
// entry (GL-2026-00025 / DINV/00022, Rs 1,86,000), but entries for Dinesh
// Swaika and Nistha Kumari are expected too and aren't appearing.
//
// Checks, in order:
//   1. Every AccountHeadMaster row whose name mentions these people or
//      "Director"/"Partner"/"Remuneration" — are they separate ledger
//      heads, or expected to share the one "Director or Partner
//      Remuneration" head?
//   2. Every GeneralLedgerEntry whose Narration/VoucherNo mentions these
//      names, regardless of LHeadId, period, IsReversed, or company/project
//      — to see whether they exist at all, and if so where.
//   3. The FULL (unfiltered by date/company) history of whichever LHeadId
//      "Director or Partner Remuneration" resolves to, so we can see if
//      period/company scoping in the Trial Balance UI is just hiding them.
//
// Usage:
//   node backend/scripts/checkDirectorRemunerationEntries.js

const { connectDB, getPool, closeDB, sql } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  console.log("=== 1. AccountHeadMaster rows matching these names ===\n");
  const headRes = await pool.request().query(`
    SELECT LHeadId, LHeadName, LHeadType, LHeadStatus, LBelongsTo
    FROM dbo.AccountHeadMaster
    WHERE LHeadName LIKE '%Director%' OR LHeadName LIKE '%Partner%Remuneration%'
       OR LHeadName LIKE '%Dinesh%' OR LHeadName LIKE '%Nistha%' OR LHeadName LIKE '%Swaika%'
       OR LHeadName LIKE '%Kumari%'
  `);
  console.log(headRes.recordset);

  console.log("\n=== 2. GL entries mentioning these names anywhere (Narration/VoucherNo), any LHeadId, any period ===\n");
  const glByNameRes = await pool.request().query(`
    SELECT gle.EntryId, gle.LHeadId, ah.LHeadName, gle.VoucherNo, gle.VoucherDate,
           gle.DebitAmount, gle.CreditAmount, gle.Narration, gle.SourceType, gle.SourceId,
           gle.IsReversed, gle.CompanyId, gle.ProjectId
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.Narration LIKE '%Dinesh%' OR gle.Narration LIKE '%Nistha%'
       OR gle.Narration LIKE '%Swaika%' OR gle.Narration LIKE '%Kumari%'
       OR gle.VoucherNo LIKE '%Dinesh%' OR gle.VoucherNo LIKE '%Nistha%'
    ORDER BY gle.EntryId DESC
  `);
  console.log(glByNameRes.recordset);

  console.log('\n=== 3. Full unfiltered history of "Director or Partner Remuneration" LHeadId(s) ===\n');
  const remunHeadRes = await pool.request().query(`
    SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadName LIKE '%Director or Partner Remuneration%'
  `);
  console.log("Matched head(s):", remunHeadRes.recordset);

  for (const head of remunHeadRes.recordset) {
    const allRes = await pool.request().input("id", sql.Int, head.LHeadId).query(`
      SELECT EntryId, VoucherNo, VoucherDate, DebitAmount, CreditAmount, Narration, SourceType, SourceId, IsReversed, CompanyId, ProjectId
      FROM dbo.GeneralLedgerEntry
      WHERE LHeadId = @id
      ORDER BY EntryId DESC
    `);
    console.log(`\nAll entries ever posted to LHeadId ${head.LHeadId} (${head.LHeadName}), including reversed/out-of-period:`);
    console.log(allRes.recordset);
    const liveTotal = allRes.recordset.filter(r => !r.IsReversed).reduce((s, r) => s + Number(r.DebitAmount) - Number(r.CreditAmount), 0);
    console.log(`Live (non-reversed) net total: Rs ${fmt(liveTotal)}`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
