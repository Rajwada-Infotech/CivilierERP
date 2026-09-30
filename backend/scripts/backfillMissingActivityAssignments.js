// Re-runs migration 487's exact backfill for any DependencyMasterActivity
// row that still has no dbo.DependencyActivityAssignment stub row —
// confirmed gap: bulkFillDependencyChains.js (used to backfill Luxuria's
// 644 dependency chains) inserts DependencyMaster + DependencyMasterActivity
// directly via raw SQL, but never creates the stub assignment row
// dependencyMaster.js's own POST / route creates for chains made through
// the UI (see migration 487's comment for why that stub matters — Work
// Reporting's GET / in dependencyActivityAssignment.js INNER JOINs on this
// table, so a rung with no row at all is invisible there, even though Work
// Allocation's own chain browser has a client-side "PENDING" fallback that
// hides the same gap). This is why Luxuria showed up in Work Allocation
// but not in Reporting.
//
// Dry-run by default. Usage:
//   node backend/scripts/backfillMissingActivityAssignments.js [--apply]

const { connectDB, getPool, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const pool = getPool();

  const missingRes = await pool.request().query(`
    SELECT dma.Id, dm.Alias, ep.name AS ProjectName
    FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.DependencyActivityAssignment daa WHERE daa.DependencyMasterActivityId = dma.Id
    )
  `);
  console.log(`${missingRes.recordset.length} DependencyMasterActivity row(s) with no assignment stub at all.`);

  const byProject = new Map();
  for (const r of missingRes.recordset) {
    const key = r.ProjectName || "(no project)";
    byProject.set(key, (byProject.get(key) || 0) + 1);
  }
  for (const [project, count] of byProject) console.log(`  ${project}: ${count}`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await closeDB();
    return;
  }

  const result = await pool.request().input("by", require("../db").sql.NVarChar(200), "backfillMissingActivityAssignments.js").query(`
    INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
    SELECT dma.Id, @by
    FROM dbo.DependencyMasterActivity dma
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.DependencyActivityAssignment daa WHERE daa.DependencyMasterActivityId = dma.Id
    )
  `);
  console.log(`\nApplied — inserted ${result.rowsAffected[0]} stub assignment row(s).`);

  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
