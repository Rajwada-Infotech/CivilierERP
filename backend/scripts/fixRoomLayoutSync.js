// Brings every active unit's rooms back in line with its effective layout,
// using the app's own sync (services/unitLayout.js syncUnitRooms, the same
// code Room Master's "Generate" runs) — no hand-written room SQL.
//   - missing rooms: reactivated if an inactive one of that category exists, else created
//   - surplus rooms WITHOUT work: soft-deactivated (IsActive = 0, Id kept, reversible)
//   - surplus rooms WITH work (DPR entries / chains / blueprint): never touched, reported
//   - auto-named rooms renumbered ("Bedroom 1" -> "Bedroom" once it's the only one)
//
// Default is a DRY RUN: each unit is synced inside its own transaction and
// rolled back, so the report shows exactly what --apply would do.
//
// Usage:
//   node scripts/fixRoomLayoutSync.js                      # dry run, all projects
//   node scripts/fixRoomLayoutSync.js --project 83         # dry run, one project
//   node scripts/fixRoomLayoutSync.js --apply              # write the changes
//   node scripts/fixRoomLayoutSync.js --apply --project 83

const { connectDB, getPool, sql, closeDB } = require("../db");
const { syncUnitRooms, bumpFlatMasterCaches } = require("../services/unitLayout");

const APPLY = process.argv.includes("--apply");
const pIdx = process.argv.indexOf("--project");
const ONLY_PROJECT = pIdx >= 0 ? parseInt(process.argv[pIdx + 1], 10) : null;

async function main() {
  await connectDB();
  const pool = getPool();

  const req = pool.request();
  if (ONLY_PROJECT) req.input("pid", sql.Int, ONLY_PROJECT);
  const units = (await req.query(`
    SELECT u.Id, u.UnitName, e.name AS ProjectName, b.BlockName, u.FloorNo
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise e ON e.id = u.ProjectId
    LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE u.IsActive = 1 ${ONLY_PROJECT ? "AND u.ProjectId = @pid" : ""}
    ORDER BY e.name, b.BlockName, u.FloorNo, u.UnitName
  `)).recordset;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${units.length} active unit(s)${ONLY_PROJECT ? ` in project ${ONLY_PROJECT}` : ""}\n`);

  const cache = new Map();
  const totals = { changed: 0, created: 0, reactivated: 0, deactivated: 0, renamed: 0, keptWithWork: 0, failed: 0 };
  const perProject = new Map();

  for (const u of units) {
    // Capture the unit's active rooms before, to show exactly what changes.
    const before = (await pool.request().input("uid", sql.Int, u.Id)
      .query("SELECT Id, RoomName FROM dbo.RoomMaster WHERE UnitId = @uid AND IsActive = 1")).recordset;

    const tx = pool.transaction();
    await tx.begin();
    let r;
    let after;
    try {
      r = await syncUnitRooms(tx, u.Id, { removeUnused: true, createdBy: null, cache });
      after = (await tx.request().input("uid", sql.Int, u.Id)
        .query("SELECT Id, RoomName FROM dbo.RoomMaster WHERE UnitId = @uid AND IsActive = 1")).recordset;
      if (APPLY) await tx.commit(); else await tx.rollback();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      totals.failed++;
      console.log(`  FAILED  ${u.ProjectName} > ${u.BlockName} > ${u.UnitName}: ${e.message}`);
      continue;
    }

    // Older deployed versions of syncUnitRooms may not return every counter.
    r = { ...r, created: r.created || 0, reactivated: r.reactivated || 0, deactivated: r.deactivated || 0, renamed: r.renamed || 0, keptWithWork: r.keptWithWork || [] };
    const changes = r.created + r.reactivated + r.deactivated + r.renamed;
    if (r.keptWithWork.length) totals.keptWithWork += r.keptWithWork.length;
    if (!changes) continue;

    totals.changed++;
    totals.created += r.created;
    totals.reactivated += r.reactivated;
    totals.deactivated += r.deactivated;
    totals.renamed += r.renamed;
    perProject.set(u.ProjectName, (perProject.get(u.ProjectName) || 0) + 1);

    const beforeById = new Map(before.map((x) => [x.Id, x.RoomName]));
    const afterById = new Map(after.map((x) => [x.Id, x.RoomName]));
    const removed = before.filter((x) => !afterById.has(x.Id)).map((x) => x.RoomName);
    const added = after.filter((x) => !beforeById.has(x.Id)).map((x) => x.RoomName);
    const renamed = after.filter((x) => beforeById.has(x.Id) && beforeById.get(x.Id) !== x.RoomName)
      .map((x) => `${beforeById.get(x.Id)} -> ${x.RoomName}`);
    const parts = [];
    if (removed.length) parts.push(`deactivate: ${removed.join(", ")}`);
    if (added.length) parts.push(`add: ${added.join(", ")}`);
    if (renamed.length) parts.push(`rename: ${renamed.join(", ")}`);
    if (r.keptWithWork?.length) parts.push(`kept (has work): ${r.keptWithWork.join(", ")}`);
    console.log(`  ${u.ProjectName} > ${u.BlockName} > ${u.FloorNo ?? "-"} > ${u.UnitName}  [${before.length} -> ${after.length} rooms]  ${parts.join(" | ")}`);
  }

  console.log("\nUnits changed per project:");
  for (const [p, n] of perProject) console.log(`  ${p}: ${n}`);
  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${totals.changed} unit(s) — ${totals.deactivated} room(s) deactivated, ${totals.created} created, ${totals.reactivated} reactivated, ${totals.renamed} renamed.`);
  if (totals.keptWithWork) console.log(`${totals.keptWithWork} surplus room(s) kept because they have work — review those by hand.`);
  if (totals.failed) console.log(`${totals.failed} unit(s) failed — see FAILED lines above (nothing was written for them).`);

  if (APPLY && totals.changed) {
    await bumpFlatMasterCaches();
    console.log("Room Master caches refreshed.");
  }
  if (!APPLY) console.log(totals.changed ? "\nDry run — nothing was written. Re-run with --apply to make these changes." : "\nNothing to do.");

  await closeDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Fix failed:", err.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
