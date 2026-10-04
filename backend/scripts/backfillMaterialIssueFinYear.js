// Backfills FinYearId for Material Issues where it's NULL, by matching the
// record's own Date against dbo.FinYear's date range — same approach as
// backfillMRFinYear.js. Confirmed via diagnoseMaterialIssueGaps.js: 19 of
// 23 Material Issues have a NULL FinYearId (most of the table, not a
// one-off) — these predate the frontend's headerIsValid requiring a fin
// year on create (already in place in Issues.tsx), so new issues won't
// keep adding to this.
//
// Dry-run by default. Usage:
//   node backend/scripts/backfillMaterialIssueFinYear.js [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const pool = getPool();

  const missingRes = await pool.request().query(`
    SELECT IssueId, DocNo, Date FROM dbo.MaterialIssues WHERE FinYearId IS NULL
  `);
  console.log(`${missingRes.recordset.length} Material Issue(s) with NULL FinYearId.`);
  if (!missingRes.recordset.length) {
    await closeDB();
    return;
  }

  let updated = 0;
  for (const mi of missingRes.recordset) {
    if (!mi.Date) {
      console.log(`  IssueId ${mi.IssueId} (${mi.DocNo}): no Date on the record — skipped, not guessing.`);
      continue;
    }
    const matchRes = await pool.request().input("d", sql.Date, mi.Date).query(`
      SELECT FId AS id, FName AS name FROM dbo.FinYear
      WHERE FStartDate <= @d AND FEndDate >= @d
    `);
    if (!matchRes.recordset.length) {
      console.log(`  IssueId ${mi.IssueId} (${mi.DocNo}, Date ${mi.Date.toISOString().slice(0, 10)}): no FinYear row covers this date — skipped.`);
      continue;
    }
    if (matchRes.recordset.length > 1) {
      console.log(`  IssueId ${mi.IssueId} (${mi.DocNo}): ${matchRes.recordset.length} FinYear rows overlap this date — skipped, ambiguous.`);
      continue;
    }
    const fy = matchRes.recordset[0];
    console.log(`  IssueId ${mi.IssueId} (${mi.DocNo}, Date ${mi.Date.toISOString().slice(0, 10)}) -> FinYearId ${fy.id} ("${fy.name}")`);
    if (APPLY) {
      await pool.request().input("IssueId", sql.Int, mi.IssueId).input("FinYearId", sql.Int, fy.id).query(`
        UPDATE dbo.MaterialIssues SET FinYearId = @FinYearId WHERE IssueId = @IssueId
      `);
      updated++;
    }
  }

  console.log(APPLY ? `\nApplied — updated ${updated} row(s).` : "\nDry run. Re-run with --apply to write.");
  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
