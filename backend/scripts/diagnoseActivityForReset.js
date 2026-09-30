// Read-only: locates the exact rung/assignment for "EMP/3/1C > Master
// Bedroom > 1.1 Hacking" (Emporis > Block 3 > Floor 1) and shows everything
// that would be touched by a reset — assignment row(s), engineer/material
// links, progress log, photos, worker roster + attendance.
//
// Usage: node backend/scripts/diagnoseActivityForReset.js [--alias="EMP/3/1C/Master Bedroom"] [--activity="Hacking"]

const { connectDB, getPool, sql, closeDB } = require("../db");

const aliasArg = process.argv.find((a) => a.startsWith("--alias="));
const activityArg = process.argv.find((a) => a.startsWith("--activity="));
const ALIAS = aliasArg ? aliasArg.split("=")[1].replace(/^"|"$/g, "") : "EMP/3/1C/Master Bedroom";
const ACTIVITY = activityArg ? activityArg.split("=")[1].replace(/^"|"$/g, "") : "Hacking";

async function main() {
  await connectDB();
  const pool = getPool();

  const rungRes = await pool.request()
    .input("alias", sql.NVarChar(200), `%${ALIAS}%`)
    .input("activity", sql.NVarChar(200), `%${ACTIVITY}%`).query(`
      SELECT dma.Id AS rungId, dma.SequenceNo, am.activity_name AS activityName,
             dm.Id AS dependencyMasterId, dm.Alias, dm.WorkType,
             ep.name AS projectName
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.enterprise ep ON ep.id = dm.ProjectId
      WHERE dm.Alias LIKE @alias AND am.activity_name LIKE @activity
    `);

  if (!rungRes.recordset.length) {
    console.log(`No rung found matching alias LIKE "%${ALIAS}%" and activity LIKE "%${ACTIVITY}%".`);
    await closeDB();
    return;
  }
  if (rungRes.recordset.length > 1) {
    console.log(`${rungRes.recordset.length} matches — narrow with --alias/--activity:`);
    rungRes.recordset.forEach((r) => console.log(`  rungId ${r.rungId} — ${r.Alias} — ${r.SequenceNo}. ${r.activityName}`));
    await closeDB();
    return;
  }

  const rung = rungRes.recordset[0];
  console.log(`Rung: id ${rung.rungId} — "${rung.Alias}" — ${rung.SequenceNo}. ${rung.activityName} (${rung.WorkType}, project "${rung.projectName}")`);

  const assignRes = await pool.request().input("rungId", sql.Int, rung.rungId).query(`
    SELECT Id, Status, ProgressPercent, Remarks, StartDate, EndDate, Days, FirstReportedAt,
           LabourSource, MaterialSource, AttemptNo, IsCurrent, CreatedAt
    FROM dbo.DependencyActivityAssignment
    WHERE DependencyMasterActivityId = @rungId
    ORDER BY AttemptNo DESC
  `);
  console.log(`\nAssignment row(s): ${assignRes.recordset.length}`);
  assignRes.recordset.forEach((a) =>
    console.log(`  Id ${a.Id} | Status=${a.Status} | Progress=${a.ProgressPercent}% | IsCurrent=${a.IsCurrent} | AttemptNo=${a.AttemptNo} | Remarks="${a.Remarks || ""}"`),
  );
  const assignmentIds = assignRes.recordset.map((a) => a.Id);

  if (assignmentIds.length) {
    const ids = assignmentIds.join(",");
    const engRes = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityEngineer WHERE AssignmentId IN (${ids})`);
    console.log(`Engineer link rows: ${engRes.recordset[0].c}`);
    const matRes = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityMaterial WHERE AssignmentId IN (${ids})`);
    console.log(`Material link rows: ${matRes.recordset[0].c}`);
    const logRes = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityProgressLog WHERE AssignmentId IN (${ids})`);
    console.log(`Progress log rows: ${logRes.recordset[0].c}`);
  }

  const photoRes = await pool.request().input("rungId", sql.Int, rung.rungId).query(`
    SELECT COUNT(*) AS c FROM dbo.ActivityPhoto WHERE DependencyMasterActivityId = @rungId
  `);
  console.log(`Photo rows: ${photoRes.recordset[0].c}`);

  const rosterRes = await pool.request().input("rungId", sql.Int, rung.rungId).query(`
    SELECT COUNT(*) AS c FROM dbo.WorkerActivityRoster WHERE DependencyMasterActivityId = @rungId AND IsActive = 1
  `);
  console.log(`Active worker-roster rows: ${rosterRes.recordset[0].c}`);

  const attRes = await pool.request().input("rungId", sql.Int, rung.rungId).query(`
    SELECT COUNT(*) AS c FROM dbo.WorkerAttendance WHERE DependencyMasterActivityId = @rungId
  `);
  console.log(`Attendance rows: ${attRes.recordset[0].c}`);

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
