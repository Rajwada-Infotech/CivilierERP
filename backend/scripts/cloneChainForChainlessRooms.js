// Gives each active room that has NO DPR chain — in a unit whose other rooms
// do have chains (the project's pattern) — a copy of the chain of its closest
// identical sibling: same block, same flat letter, same room name/category,
// nearest floor. Written exactly as POST /dependency-master writes a chain:
//   DependencyMaster row -> one DependencyMasterActivity rung per step
//   (donor's order, ActivityId, WorkType) -> one stub DependencyActivityAssignment
//   per rung (Status defaults to PENDING, migration 487).
// Nothing is typed here: steps come from the donor chain; ProjectId / TowerId /
// Floor / FlatId are copied from a chain already on the target unit (the
// project's own stored format); the Alias follows the donor's "<unit>/<room>"
// shape, and a room that already has a chain is refused like the route does.
//
//   node scripts/cloneChainForChainlessRooms.js --project "Luxuria"          # dry run
//   node scripts/cloneChainForChainlessRooms.js --project "Luxuria" --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const ACTOR = "cloneChainForChainlessRooms";

async function main() {
  const PROJECT = arg("--project");
  if (!PROJECT) throw new Error('pass --project "<name>"');
  await connectDB();
  const pool = getPool();
  const q = async (db, s, p = {}) => {
    const r = db.request();
    for (const [k, [t, v]] of Object.entries(p)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };
  const proj = await q(pool, "SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), PROJECT] });
  if (proj.length !== 1) throw new Error(`${proj.length} projects named "${PROJECT}"`);
  const pid = proj[0].id;

  const rooms = await q(pool, `
    SELECT r.Id, r.UnitId, r.RoomName, r.RoomCategoryId, u.UnitName, u.BlockId, u.FloorNo,
      (SELECT TOP 1 dm.Id FROM dbo.DependencyMaster dm WHERE dm.RoomId = r.Id) AS ChainId
    FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId AND u.IsActive = 1
    WHERE r.ProjectId = @p AND r.IsActive = 1`, { p: [sql.Int, pid] });
  const chainedUnits = new Set(rooms.filter((r) => r.ChainId).map((r) => r.UnitId));
  const letter = (n) => (String(n).split("/").pop().match(/\d([A-Z])$/) || [])[1];
  const targets = rooms.filter((r) => !r.ChainId && chainedUnits.has(r.UnitId));

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj[0].name}: ${targets.length} chainless room(s) in units that follow the chain pattern\n`);
  const totals = { chainsCreated: 0, rungsCreated: 0, noDonor: 0, problems: 0 };
  for (const t of targets) {
    const donors = rooms.filter((d) => d.ChainId && d.BlockId === t.BlockId && d.RoomCategoryId === t.RoomCategoryId && d.RoomName === t.RoomName && letter(d.UnitName) === letter(t.UnitName))
      .sort((a, b) => Math.abs(a.FloorNo - t.FloorNo) - Math.abs(b.FloorNo - t.FloorNo) || a.FloorNo - b.FloorNo);
    const donor = donors[0];
    if (!donor) { totals.noDonor++; console.log(`   ${t.UnitName}/${t.RoomName}: no identical sibling with a chain — left for Dependency Master`); continue; }
    const dm = (await q(pool, "SELECT Id, Alias, WorkType FROM dbo.DependencyMaster WHERE Id = @i", { i: [sql.Int, donor.ChainId] }))[0];
    const rungs = await q(pool, "SELECT ActivityId, SequenceNo, WorkType FROM dbo.DependencyMasterActivity WHERE DependencyMasterId = @i ORDER BY SequenceNo", { i: [sql.Int, dm.Id] });
    const ref = (await q(pool, "SELECT TOP 1 ProjectId, TowerId, Floor, FlatId FROM dbo.DependencyMaster WHERE FlatId = @f AND IsActive = 1", { f: [sql.Int, t.UnitId] }))[0];
    const alias = dm.Alias === `${donor.UnitName}/${donor.RoomName}` ? `${t.UnitName}/${t.RoomName}` : null;
    if (!alias) { totals.problems++; console.log(`   !! ${t.UnitName}/${t.RoomName}: donor alias "${dm.Alias}" isn't "<unit>/<room>" — left for Dependency Master`); continue; }
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Same guard as the route: one chain per room.
      const dupe = await tx.request().input("r", sql.Int, t.Id).query("SELECT TOP 1 Id FROM dbo.DependencyMaster WHERE RoomId = @r");
      if (dupe.recordset.length) throw new Error("room already has a chain");
      const ins = await tx.request().input("P", sql.Int, ref.ProjectId).input("T", sql.Int, ref.TowerId).input("Fl", sql.NVarChar(50), ref.Floor)
        .input("F", sql.Int, ref.FlatId).input("R", sql.Int, t.Id).input("A", sql.NVarChar(200), alias).input("W", sql.NVarChar(20), dm.WorkType).input("By", sql.NVarChar(300), ACTOR)
        .query(`INSERT INTO dbo.DependencyMaster (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
                OUTPUT INSERTED.Id AS id VALUES (@P, @T, @Fl, @F, @R, @A, @W, @By, SYSDATETIME())`);
      const newId = ins.recordset[0].id;
      for (const g of rungs) {
        const ri = await tx.request().input("D", sql.Int, newId).input("Ac", sql.Int, g.ActivityId).input("S", sql.Int, g.SequenceNo).input("W", sql.NVarChar(20), g.WorkType)
          .query(`INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType) OUTPUT INSERTED.Id AS id VALUES (@D, @Ac, @S, @W)`);
        await tx.request().input("rungId", sql.Int, ri.recordset[0].id).input("by", sql.NVarChar(200), ACTOR)
          .query("INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy) VALUES (@rungId, @by)");
      }
      if (APPLY) await tx.commit(); else await tx.rollback();
      totals.chainsCreated++; totals.rungsCreated += rungs.length;
      console.log(`   ${alias}: copy of chain #${dm.Id} "${dm.Alias}" (${rungs.length} steps, PENDING stubs)`);
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      totals.problems++; console.log(`   !! ${t.UnitName}/${t.RoomName}: ${e.message}`);
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("cloneChainForChainlessRooms failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
