// Bulk fill-in: for every active dbo.RoomMaster row under a given project
// that has NO Dependency Master chain yet, creates one — Alias built the
// same way fixStaleDependencyAliases.js's second pass does
// (UnitMaster.UnitName + "/" + RoomMaster.RoomName), WorkType/activities
// copied from the one clear per-category template chain (see
// diagnoseDependencyChainTemplates.js — every category currently has
// exactly one signature in use, so the template is unambiguous).
//
// Mirrors exactly what the UI's "Copy from existing chain" (CopyChainModal)
// does per room, just for every missing room under one project in one run.
// The DB's own one-chain-per-room rule (RoomId has no existing DependencyMaster
// row) is re-checked per room right before insert, so this is safe to re-run.
//
// Dry-run by default — prints what it WOULD create without writing. Pass
// --apply to actually insert. Pass --project="Luxuria" to target a
// different project (matched by name, case-insensitive).
//
// Usage:
//   node backend/scripts/bulkFillDependencyChains.js --project="Luxuria"
//   node backend/scripts/bulkFillDependencyChains.js --project="Luxuria" --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const projectArg = process.argv.find((a) => a.startsWith("--project="));
const PROJECT_NAME = projectArg ? projectArg.split("=")[1].replace(/^"|"$/g, "") : null;

async function main() {
  if (!PROJECT_NAME) {
    console.error('Usage: node bulkFillDependencyChains.js --project="Luxuria" [--apply]');
    process.exit(1);
  }

  await connectDB();
  const pool = getPool();

  const exactRes = await pool.request().input("name", sql.NVarChar(200), PROJECT_NAME).query(`
    SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LOWER(name) = LOWER(@name)
  `);
  let project = exactRes.recordset[0];
  if (!project) {
    // Don't guess — show what's actually there so the caller can pick the
    // real name instead of me assuming a match.
    const likeRes = await pool.request().input("name", sql.NVarChar(200), `%${PROJECT_NAME}%`).query(`
      SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND name LIKE @name ORDER BY name
    `);
    if (likeRes.recordset.length === 1) {
      project = likeRes.recordset[0];
      console.log(`No exact match for "${PROJECT_NAME}" — using the one close match: "${project.name}" (id ${project.id}).\n`);
    } else if (likeRes.recordset.length > 1) {
      console.error(`No exact project named "${PROJECT_NAME}" — ${likeRes.recordset.length} similar names found, re-run with the exact one:`);
      likeRes.recordset.forEach((r) => console.error(`  "${r.name}" (id ${r.id})`));
      await closeDB();
      process.exit(1);
    } else {
      console.error(`No project named or containing "${PROJECT_NAME}" found (business_type='P').`);
      await closeDB();
      process.exit(1);
    }
  }
  console.log(`Project: ${project.name} (id ${project.id})\n`);

  // One template chain per category — the same query diagnoseDependencyChainTemplates.js
  // used to confirm every category currently has exactly one signature.
  // Pulls the template's own header WorkType too — never assumed.
  const templatesRes = await pool.request().query(`
    SELECT rm.RoomCategoryId, MIN(dm.Id) AS TemplateDmId
    FROM dbo.DependencyMaster dm
    JOIN dbo.RoomMaster rm ON rm.Id = dm.RoomId
    WHERE dm.IsActive = 1 AND rm.RoomCategoryId IS NOT NULL
    GROUP BY rm.RoomCategoryId
  `);
  const templateByCategory = new Map(templatesRes.recordset.map((r) => [r.RoomCategoryId, r.TemplateDmId]));

  const templateChain = new Map(); // categoryId -> { workType, activities: [{ActivityId, SequenceNo, WorkType}] }
  for (const [categoryId, dmId] of templateByCategory) {
    const headRes = await pool.request().input("id", sql.Int, dmId).query(
      `SELECT WorkType FROM dbo.DependencyMaster WHERE Id = @id`,
    );
    const actRes = await pool.request().input("id", sql.Int, dmId).query(`
      SELECT ActivityId, SequenceNo, WorkType FROM dbo.DependencyMasterActivity WHERE DependencyMasterId = @id ORDER BY SequenceNo
    `);
    templateChain.set(categoryId, { workType: headRes.recordset[0].WorkType, activities: actRes.recordset });
  }

  // Every active room under this project with no chain yet.
  const roomsRes = await pool.request().input("projectId", sql.Int, project.id).query(`
    SELECT rm.Id AS RoomId, rm.ProjectId, rm.BlockId, rm.UnitId, rm.RoomName, rm.RoomCategoryId, rm.Floor,
           um.UnitName
    FROM dbo.RoomMaster rm
    JOIN dbo.UnitMaster um ON um.Id = rm.UnitId
    LEFT JOIN dbo.DependencyMaster dm ON dm.RoomId = rm.Id AND dm.IsActive = 1
    WHERE rm.IsActive = 1 AND rm.ProjectId = @projectId AND dm.Id IS NULL
    ORDER BY rm.Id
  `);

  const toCreate = [];
  const flagged = [];
  for (const room of roomsRes.recordset) {
    if (!room.RoomCategoryId || !templateChain.has(room.RoomCategoryId)) {
      flagged.push(`RoomId ${room.RoomId} "${room.RoomName}": no RoomCategoryId or no template chain for its category — skipped.`);
      continue;
    }
    if (room.Floor == null || String(room.Floor).trim() === "") {
      flagged.push(`RoomId ${room.RoomId} "${room.RoomName}": RoomMaster.Floor is not set — skipped, not guessing a floor.`);
      continue;
    }
    const template = templateChain.get(room.RoomCategoryId);
    if (!template.activities.length) {
      flagged.push(`RoomId ${room.RoomId} "${room.RoomName}": template chain has 0 activities — skipped.`);
      continue;
    }
    toCreate.push({
      roomId: room.RoomId,
      projectId: room.ProjectId,
      towerId: room.BlockId,
      flatId: room.UnitId,
      floor: room.Floor,
      alias: `${room.UnitName}/${room.RoomName}`,
      workType: template.workType,
      activities: template.activities,
    });
  }

  console.log(`${toCreate.length} room(s) will get a new Dependency Master chain (WorkType copied from each category's template chain).`);
  console.log(`${flagged.length} room(s) flagged/skipped.\n`);
  if (flagged.length) flagged.forEach((s) => console.log(`  ${s}`));

  // Per-category count + which template/WorkType each category is copying.
  const catCounts = new Map();
  for (const c of toCreate) {
    const room = roomsRes.recordset.find((r) => r.RoomId === c.roomId);
    const key = room.RoomCategoryId;
    catCounts.set(key, (catCounts.get(key) || 0) + 1);
  }
  console.log("By category:");
  for (const [catId, count] of catCounts) {
    const t = templateChain.get(catId);
    console.log(`  RoomCategoryId ${catId}: ${count} room(s) — WorkType ${t.workType}, ${t.activities.length} step(s) (from DependencyMasterId ${templateByCategory.get(catId)})`);
  }

  if (!APPLY) {
    console.log(toCreate.length ? "\nDry run. Re-run with --apply to write." : "\nNothing to do.");
    await closeDB();
    return;
  }

  const actor = "bulkFillDependencyChains.js";
  let created = 0;
  for (const c of toCreate) {
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Re-check right before insert — safe to re-run, and guards a room
      // that got a chain via the UI between the SELECT above and now.
      const dupe = await tx.request().input("RoomId", sql.Int, c.roomId).query(
        `SELECT TOP 1 Id FROM dbo.DependencyMaster WHERE RoomId = @RoomId`,
      );
      if (dupe.recordset.length) { await tx.rollback(); continue; }

      const insertRes = await tx.request()
        .input("ProjectId", sql.Int, c.projectId)
        .input("TowerId", sql.Int, c.towerId)
        .input("Floor", sql.NVarChar(50), String(c.floor))
        .input("FlatId", sql.Int, c.flatId)
        .input("RoomId", sql.Int, c.roomId)
        .input("Alias", sql.NVarChar(200), c.alias)
        .input("WorkType", sql.NVarChar(20), c.workType)
        .input("CreatedBy", sql.NVarChar(300), actor).query(`
          INSERT INTO dbo.DependencyMaster
            (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id AS id
          VALUES (@ProjectId, @TowerId, @Floor, @FlatId, @RoomId, @Alias, @WorkType, @CreatedBy, SYSDATETIME())
        `);
      const newId = insertRes.recordset[0].id;

      for (let i = 0; i < c.activities.length; i++) {
        const rungRes = await tx.request()
          .input("DependencyMasterId", sql.Int, newId)
          .input("ActivityId", sql.Int, c.activities[i].ActivityId)
          .input("SequenceNo", sql.Int, i + 1)
          .input("WorkType", sql.NVarChar(20), c.activities[i].WorkType).query(`
            INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
            OUTPUT INSERTED.Id AS id
            VALUES (@DependencyMasterId, @ActivityId, @SequenceNo, @WorkType)
          `);
        // A stub assignment row (Status defaults to PENDING) up front — same
        // as dependencyMaster.js's own POST / route does for a rung created
        // through the UI. Without this, the rung is invisible to Work
        // Reporting (its GET / INNER JOINs on this table), even though it
        // still shows up in Work Allocation's chain browser via that page's
        // own client-side "PENDING" fallback for a missing row — see
        // migration 487's comment, and backfillMissingActivityAssignments.js
        // which fixed the gap this left for Luxuria's first bulk run.
        await tx.request()
          .input("rungId", sql.Int, rungRes.recordset[0].id)
          .input("by", sql.NVarChar(200), actor).query(`
            INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
            VALUES (@rungId, @by)
          `);
      }
      await tx.commit();
      created++;
    } catch (err) {
      try { await tx.rollback(); } catch {}
      console.error(`  FAILED RoomId ${c.roomId}: ${err.message}`);
    }
  }
  console.log(`\nCreated ${created} of ${toCreate.length} chain(s).`);

  await closeDB();
}

main().catch((err) => {
  console.error("Bulk fill failed:", err);
  process.exit(1);
});
