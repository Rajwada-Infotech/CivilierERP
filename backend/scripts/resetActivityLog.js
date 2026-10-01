// Resets ONE activity (rung) back to its pristine, never-touched state —
// deletes its current DependencyActivityAssignment row (cascades to
// DependencyActivityEngineer/DependencyActivityMaterial per their own FK
// ON DELETE CASCADE), plus DependencyActivityProgressLog (no cascade),
// ActivityPhoto, WorkerActivityRoster and WorkerAttendance rows for that
// rung — then re-inserts a fresh stub assignment (Status defaults to
// PENDING), the exact same shape dependencyMaster.js's own creation route
// gives every new rung.
//
// Scoped to exactly one rung, identified the same way as
// diagnoseActivityForReset.js (--alias + --activity), or directly by
// --rungId if you already have it.
//
// Dry-run by default. Usage:
//   node backend/scripts/resetActivityLog.js --alias="EMP/3/1C/Master Bedroom" --activity="Hacking" [--apply]
//   node backend/scripts/resetActivityLog.js --rungId=1234 [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const aliasArg = process.argv.find((a) => a.startsWith("--alias="));
const activityArg = process.argv.find((a) => a.startsWith("--activity="));
const rungIdArg = process.argv.find((a) => a.startsWith("--rungId="));
const ALIAS = aliasArg ? aliasArg.split("=")[1].replace(/^"|"$/g, "") : null;
const ACTIVITY = activityArg ? activityArg.split("=")[1].replace(/^"|"$/g, "") : null;
const RUNG_ID = rungIdArg ? parseInt(rungIdArg.split("=")[1], 10) : null;

async function main() {
  if (!RUNG_ID && !(ALIAS && ACTIVITY)) {
    console.error('Usage: --rungId=1234  OR  --alias="EMP/3/1C/Master Bedroom" --activity="Hacking"');
    process.exit(1);
  }
  await connectDB();
  const pool = getPool();

  let rung;
  if (RUNG_ID) {
    const r = await pool.request().input("id", sql.Int, RUNG_ID).query(`
      SELECT dma.Id AS rungId, dma.SequenceNo, am.activity_name AS activityName, dm.Alias
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      WHERE dma.Id = @id
    `);
    if (!r.recordset.length) {
      console.error(`No rung with id ${RUNG_ID}.`);
      await closeDB();
      process.exit(1);
    }
    rung = r.recordset[0];
  } else {
    const r = await pool.request()
      .input("alias", sql.NVarChar(200), `%${ALIAS}%`)
      .input("activity", sql.NVarChar(200), `%${ACTIVITY}%`).query(`
        SELECT dma.Id AS rungId, dma.SequenceNo, am.activity_name AS activityName, dm.Alias
        FROM dbo.DependencyMasterActivity dma
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        WHERE dm.Alias LIKE @alias AND am.activity_name LIKE @activity
      `);
    if (r.recordset.length !== 1) {
      console.error(`Expected exactly one match, found ${r.recordset.length}:`);
      r.recordset.forEach((x) => console.error(`  rungId ${x.rungId} — ${x.Alias} — ${x.SequenceNo}. ${x.activityName}`));
      await closeDB();
      process.exit(1);
    }
    rung = r.recordset[0];
  }

  console.log(`Target: rungId ${rung.rungId} — "${rung.Alias}" — ${rung.SequenceNo}. ${rung.activityName}`);

  const assignRes = await pool.request().input("rungId", sql.Int, rung.rungId).query(`
    SELECT Id, Status, ProgressPercent, Remarks FROM dbo.DependencyActivityAssignment
    WHERE DependencyMasterActivityId = @rungId
  `);
  const assignmentIds = assignRes.recordset.map((a) => a.Id);
  console.log(`Current assignment: ${assignmentIds.length ? `Id ${assignmentIds[0]} — Status=${assignRes.recordset[0].Status}, Progress=${assignRes.recordset[0].ProgressPercent}%` : "(none)"}`);

  const counts = {};
  if (assignmentIds.length) {
    const ids = assignmentIds.join(",");
    counts.engineers = (await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityEngineer WHERE AssignmentId IN (${ids})`)).recordset[0].c;
    counts.materials = (await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityMaterial WHERE AssignmentId IN (${ids})`)).recordset[0].c;
    counts.progressLog = (await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.DependencyActivityProgressLog WHERE AssignmentId IN (${ids})`)).recordset[0].c;
  }
  counts.photos = (await pool.request().input("rungId", sql.Int, rung.rungId).query(`SELECT COUNT(*) AS c FROM dbo.ActivityPhoto WHERE DependencyMasterActivityId = @rungId`)).recordset[0].c;
  counts.roster = (await pool.request().input("rungId", sql.Int, rung.rungId).query(`SELECT COUNT(*) AS c FROM dbo.WorkerActivityRoster WHERE DependencyMasterActivityId = @rungId`)).recordset[0].c;
  counts.attendance = (await pool.request().input("rungId", sql.Int, rung.rungId).query(`SELECT COUNT(*) AS c FROM dbo.WorkerAttendance WHERE DependencyMasterActivityId = @rungId`)).recordset[0].c;

  console.log("Will delete:");
  console.log(`  Engineer links: ${counts.engineers ?? 0} (cascades with assignment)`);
  console.log(`  Material links: ${counts.materials ?? 0} (cascades with assignment)`);
  console.log(`  Progress log rows: ${counts.progressLog ?? 0}`);
  console.log(`  Photos: ${counts.photos}`);
  console.log(`  Worker roster rows: ${counts.roster}`);
  console.log(`  Attendance rows: ${counts.attendance}`);
  console.log("Then re-insert a fresh PENDING stub assignment.");

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    await closeDB();
    return;
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    if (assignmentIds.length) {
      const ids = assignmentIds.join(",");
      await tx.request().query(`DELETE FROM dbo.DependencyActivityProgressLog WHERE AssignmentId IN (${ids})`);
      await tx.request().query(`DELETE FROM dbo.DependencyActivityAssignment WHERE Id IN (${ids})`);
    }
    await tx.request().input("rungId", sql.Int, rung.rungId).query(`DELETE FROM dbo.ActivityPhoto WHERE DependencyMasterActivityId = @rungId`);
    await tx.request().input("rungId", sql.Int, rung.rungId).query(`DELETE FROM dbo.WorkerAttendance WHERE DependencyMasterActivityId = @rungId`);
    await tx.request().input("rungId", sql.Int, rung.rungId).query(`DELETE FROM dbo.WorkerActivityRoster WHERE DependencyMasterActivityId = @rungId`);
    await tx.request()
      .input("rungId", sql.Int, rung.rungId)
      .input("by", sql.NVarChar(200), "resetActivityLog.js").query(`
        INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
        VALUES (@rungId, @by)
      `);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  console.log("\nDone — activity reset to a fresh PENDING state.");
  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
