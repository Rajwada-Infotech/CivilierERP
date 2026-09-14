// Backfills dbo.DependencyActivityAssignment / dbo.DependencyActivityMaterial
// for every rung of the smoke-seeded Dependency Master chains
// (seedDependencyMasterSmokeData.js) that doesn't already have one, so the
// new Reporting page (and Work Reporting's "Saved Flow" list) has more than
// a single row to look at. Only touches smoke-seeded chains and only rungs
// with no assignment yet — a real assignment made through the UI popup is
// never overwritten. Idempotent: safe to re-run, it just skips rungs that
// already have an assignment (including ones this script created before).
//
//   node scripts/seedActivityAssignmentSmokeData.js
//   node scripts/seedActivityAssignmentSmokeData.js --clean

const { getPool, connectDB, sql } = require("../db");

const STATUSES = ["PENDING", "IN_PROGRESS", "HOLD", "CANCELLED", "APPROVED", "REWORK", "COMPLETED"];
// Real people over admin/sales/legal accounts — an "engineer" assignment
// should read like a field assignment, not point at Marketing Head.
const ENGINEER_NAMES = ["Sourav", "Kuntal", "Mainab", "Rohit", "Kasturi", "Rani", "Rima"];

function pick(arr, seed) {
  return arr[seed % arr.length];
}

async function main() {
  const clean = process.argv.includes("--clean");
  await connectDB();
  const pool = await getPool();

  if (clean) {
    await pool.request().query(`
      DELETE FROM dbo.DependencyActivityAssignment WHERE CreatedBy = 'smoke-seed'
    `);
    console.log("Cleaned smoke-seeded DependencyActivityAssignment rows (materials cascade with them).");
    process.exit(0);
  }

  const engRes = await pool.request().query(`
    SELECT id, name FROM dbo.users WHERE name IN (${ENGINEER_NAMES.map((n) => `'${n}'`).join(",")}) AND ISNULL(discontinue, 0) = 0
  `);
  const engineers = engRes.recordset;
  if (!engineers.length) {
    console.error("No matching engineer users found — aborting.");
    process.exit(1);
  }

  const rungsRes = await pool.request().query(`
    SELECT dma.Id AS rungId, dma.ActivityId AS activityId
    FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    WHERE dm.CreatedBy = 'smoke-seed'
      AND dma.Id NOT IN (SELECT DependencyMasterActivityId FROM dbo.DependencyActivityAssignment)
    ORDER BY dma.Id
  `);
  const rungs = rungsRes.recordset;
  if (!rungs.length) {
    console.log("Nothing to backfill — every smoke rung already has an assignment.");
    process.exit(0);
  }

  let created = 0;
  for (let i = 0; i < rungs.length; i++) {
    const { rungId, activityId } = rungs[i];
    const engineer = pick(engineers, i);
    const status = pick(STATUSES, i);
    // Spread across a real-looking window: some already started in the
    // past, some queued for the next couple of weeks.
    const dayOffset = (i % 15) - 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + dayOffset);

    const inserted = await pool
      .request()
      .input("rungId", sql.Int, rungId)
      .input("engineerId", sql.Int, engineer.id)
      .input("startDate", sql.Date, startDate)
      .input("status", sql.NVarChar(20), status)
      .input("createdBy", sql.NVarChar(200), "smoke-seed")
      .query(`
        INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, EngineerId, StartDate, Status, CreatedBy)
        OUTPUT INSERTED.Id AS id
        VALUES (@rungId, @engineerId, @startDate, @status, @createdBy)
      `);
    const assignmentId = inserted.recordset[0].id;

    const itemsRes = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT ItemId FROM dbo.ActivityItems WHERE ActivityId = @activityId
    `);
    for (const item of itemsRes.recordset) {
      const quantity = 5 + ((i * 3 + item.ItemId.charCodeAt(0)) % 20);
      await pool
        .request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("itemId", sql.UniqueIdentifier, item.ItemId)
        .input("quantity", sql.Decimal(18, 2), quantity)
        .query(`
          INSERT INTO dbo.DependencyActivityMaterial (AssignmentId, ItemId, Quantity)
          VALUES (@assignmentId, @itemId, @quantity)
        `);
    }

    created++;
  }

  console.log(`Backfilled ${created} assignments across ${rungs.length} rungs.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
