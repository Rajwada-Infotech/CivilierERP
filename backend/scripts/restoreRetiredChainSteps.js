// Undo the automatic "Cancelled" put on retired chains' steps.
//
// Changing a villa's type or undoing a conversion used to retire the villa's
// old DPR chains AND mark their untouched steps CANCELLED (PreCancelStatus
// = what they were). Nobody cancelled that work — the chain was replaced —
// and Reporting / the dashboard then showed thousands of "Cancelled"
// activities. Chains are now only retired (every list reads live chains), so
// this puts those steps back to the status they had.
//
// Touched ONLY when all of these hold, so a real cancel is never undone:
//   the chain is retired (DependencyMaster.IsActive = 0)
//   the step is CANCELLED with PreCancelStatus = PENDING
//   no user is recorded on it (a manual cancel always records UpdatedBy)
//
//   node scripts/restoreRetiredChainSteps.js            dry run (nothing written)
//   node scripts/restoreRetiredChainSteps.js --apply    restore them
const { connectDB, getPool, closeDB } = require("../db");
const APPLY = process.argv.includes("--apply");

const WHERE = `
  FROM dbo.DependencyActivityAssignment a
  JOIN dbo.DependencyMasterActivity x ON x.Id = a.DependencyMasterActivityId
  JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId
  WHERE d.IsActive = 0 AND a.Status = N'CANCELLED' AND a.PreCancelStatus = N'PENDING'
    AND a.UpdatedBy IS NULL`;

(async () => {
  await connectDB();
  const pool = getPool();
  const byProject = (await pool.request().query(`
    SELECT ISNULL(e.name, CONCAT('Project ', d.ProjectId)) AS Project, COUNT(*) AS Steps, COUNT(DISTINCT d.Id) AS Chains
    ${WHERE.replace("JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId", "JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId LEFT JOIN dbo.enterprise e ON e.id = d.ProjectId")}
    GROUP BY e.name, d.ProjectId ORDER BY Steps DESC`)).recordset;
  const total = byProject.reduce((s, r) => s + r.Steps, 0);
  console.log("Steps of retired chains marked Cancelled automatically (to put back to Pending):");
  for (const r of byProject) console.log(`  ${String(r.Project).padEnd(28)} ${String(r.Steps).padStart(6)} step(s) on ${r.Chains} retired chain(s)`);
  console.log(`  total ${total}`);
  const manual = (await pool.request().query(`
    SELECT COUNT(*) AS n FROM dbo.DependencyActivityAssignment a
    JOIN dbo.DependencyMasterActivity x ON x.Id = a.DependencyMasterActivityId
    JOIN dbo.DependencyMaster d ON d.Id = x.DependencyMasterId
    WHERE a.Status = N'CANCELLED' AND NOT (d.IsActive = 0 AND a.PreCancelStatus = N'PENDING' AND a.UpdatedBy IS NULL)`)).recordset[0].n;
  console.log(`Left as they are: ${manual} cancelled step(s) that someone cancelled (or on live chains).`);
  if (APPLY && total) {
    const r = await pool.request().query(`UPDATE a SET Status = N'PENDING', PreCancelStatus = NULL ${WHERE}`);
    console.log(`APPLIED — ${r.rowsAffected[0]} step(s) back to Pending (their chains stay retired).`);
  } else if (total) {
    console.log("DRY RUN — nothing changed. Re-run with --apply.");
  }
  await closeDB();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
