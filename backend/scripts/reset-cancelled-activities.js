// Civil Work DPR: every Cancelled activity back to Allocated with its Work Done bar at 0%.
// Changes the current assignment row in place: no new attempt, no remarks, no log entries, UpdatedBy/At untouched.
//   Preview by default.  APPLY=1 to write.  PROJECT=<part of a project name> to limit it (optional).
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();
  const apply = process.env.APPLY === "1";
  const project = process.env.PROJECT || "";

  const FROM = `
    FROM dbo.DependencyActivityAssignment daa
    JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId
    WHERE daa.IsCurrent = 1 AND daa.Status = 'CANCELLED' AND ISNULL(ep.name, '') LIKE @project`;
  const req = () => pool.request().input("project", sql.NVarChar(200), `%${project}%`);

  const summary = (await req().query(`
    SELECT ISNULL(ep.name, '(no project)') AS Project, COUNT(*) AS Cancelled,
           SUM(CASE WHEN ISNULL(daa.ProgressPercent, 0) > 0 THEN 1 ELSE 0 END) AS WithProgress,
           SUM(CASE WHEN eng.N = 0 THEN 1 ELSE 0 END) AS NoEngineer,
           SUM(CASE WHEN daa.PreCancelStatus = 'APPROVED' THEN 1 ELSE 0 END) AS WasApproved
    ${FROM.replace("WHERE daa.IsCurrent", "OUTER APPLY (SELECT COUNT(*) AS N FROM dbo.DependencyActivityEngineer e WHERE e.AssignmentId = daa.Id) eng WHERE daa.IsCurrent")}
    GROUP BY ep.name ORDER BY COUNT(*) DESC`)).recordset;

  if (!summary.length) { console.log("No Cancelled activities found."); process.exit(0); }
  console.log(`${"Project".padEnd(40)} ${"Cancelled".padStart(9)} ${"Progress>0".padStart(10)} ${"NoEngineer".padStart(10)} ${"WasApproved".padStart(11)}`);
  const t = { c: 0, p: 0, n: 0, a: 0 };
  for (const r of summary) {
    console.log(`${String(r.Project).slice(0, 40).padEnd(40)} ${String(r.Cancelled).padStart(9)} ${String(r.WithProgress).padStart(10)} ${String(r.NoEngineer).padStart(10)} ${String(r.WasApproved).padStart(11)}`);
    t.c += r.Cancelled; t.p += r.WithProgress; t.n += r.NoEngineer; t.a += r.WasApproved;
  }
  console.log(`${"TOTAL".padEnd(40)} ${String(t.c).padStart(9)} ${String(t.p).padStart(10)} ${String(t.n).padStart(10)} ${String(t.a).padStart(11)}`);

  if (!apply) {
    console.log("\nPreview only. Re-run with APPLY=1 to set these to Allocated at 0%.");
    process.exit(0);
  }

  const res = await req().query(`
    UPDATE daa
    SET Status = 'ALLOCATED', ProgressPercent = 0, PreCancelStatus = NULL, FirstReportedAt = NULL, ResumedAt = NULL
    ${FROM}`);
  console.log(`\nUpdated ${res.rowsAffected[0]} activities to Allocated at 0%.`);
  try { await require("../redis").bumpCacheVersion("dependency-activity-scope"); } catch { /* cache expires on its own */ }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
