// Backfills FinYearId for Material Requests where it's NULL, by matching
// the record's own RequestDate against dbo.FinYear's date range — not
// hardcoded to any one FinYearId. Confirmed via diagnoseMRFinYear.js that
// only 1 of 28 Material Requests (MRId 1028, REQ-2026-00032) has this gap;
// root cause is that neither POST / nor PUT /:id in materialRequests.js
// (nor the frontend's headerIsValid check) ever required FinYearId, so a
// save before the "auto-select active fin year" effect had populated it
// went through silently.
//
// Dry-run by default. Usage:
//   node backend/scripts/backfillMRFinYear.js [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const pool = getPool();

  const missingRes = await pool.request().query(`
    SELECT MRId, DocNo, RequestDate FROM dbo.MaterialRequests WHERE FinYearId IS NULL
  `);
  console.log(`${missingRes.recordset.length} Material Request(s) with NULL FinYearId.`);
  if (!missingRes.recordset.length) {
    await closeDB();
    return;
  }

  for (const mr of missingRes.recordset) {
    const matchRes = await pool.request().input("d", sql.Date, mr.RequestDate).query(`
      SELECT FId AS id, FName AS name FROM dbo.FinYear
      WHERE FStartDate <= @d AND FEndDate >= @d
    `);
    if (!matchRes.recordset.length) {
      console.log(`  MRId ${mr.MRId} (${mr.DocNo}, RequestDate ${mr.RequestDate.toISOString().slice(0, 10)}): no FinYear row covers this date — skipped, not guessing.`);
      continue;
    }
    if (matchRes.recordset.length > 1) {
      console.log(`  MRId ${mr.MRId} (${mr.DocNo}): ${matchRes.recordset.length} FinYear rows overlap this date — skipped, ambiguous.`);
      continue;
    }
    const fy = matchRes.recordset[0];
    console.log(`  MRId ${mr.MRId} (${mr.DocNo}, RequestDate ${mr.RequestDate.toISOString().slice(0, 10)}) -> FinYearId ${fy.id} ("${fy.name}")`);
    if (APPLY) {
      await pool.request().input("MRId", sql.Int, mr.MRId).input("FinYearId", sql.Int, fy.id).query(`
        UPDATE dbo.MaterialRequests SET FinYearId = @FinYearId WHERE MRId = @MRId
      `);
      console.log(`    Done.`);
    }
  }

  console.log(APPLY ? "\nApplied." : "\nDry run. Re-run with --apply to write.");
  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
