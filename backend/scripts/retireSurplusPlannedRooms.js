// Retires (IsActive = 0, never deletes) surplus rooms whose only "work" is a
// PLANNED DPR chain that was never started — plus that chain. A room is
// surplus when its unit has more active rooms of that category than its
// effective layout (layout + overrides) wants.
//
// A room is only touched when ALL hold (checked live, not assumed):
//   - no DailyLabourEntry, no blueprint, no ActivityBlueprintAnnotation
//   - every chain on it has 0 assignments (no step ever started)
// Anything else is listed and left alone. Of several surplus candidates in a
// category, the highest-numbered room goes first so "Bedroom 1" etc. stay.
//
//   node scripts/retireSurplusPlannedRooms.js --project "Luxuria"          # dry run
//   node scripts/retireSurplusPlannedRooms.js --project "Luxuria" --apply

const { connectDB, getPool, sql, closeDB } = require("../db");
const L = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");

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
  const hasCol = async (t, c) => (await q(pool, "SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID(@t) AND name = @c", { t: [sql.NVarChar(200), `dbo.${t}`], c: [sql.NVarChar(128), c] })).length > 0;
  const stamp = async (t) => ((await hasCol(t, "UpdatedAt")) ? ", UpdatedAt = SYSDATETIME()" : "");
  const roomStamp = await stamp("RoomMaster"), chainStamp = await stamp("DependencyMaster");

  const proj = await q(pool, "SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), PROJECT] });
  if (proj.length !== 1) throw new Error(`${proj.length} projects named "${PROJECT}"`);
  const units = await q(pool, "SELECT Id, ProjectId, BlockId, FloorNo, UnitName, LayoutTypeId FROM dbo.UnitMaster WHERE ProjectId = @p AND IsActive = 1 AND LayoutTypeId IS NOT NULL ORDER BY UnitName", { p: [sql.Int, proj[0].id] });

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj[0].name}\n`);
  const cache = new Map();
  const totals = { roomsRetired: 0, chainsRetired: 0, skippedRealWork: 0, problems: 0 };
  for (const u of units) {
    const layout = await L.resolveLayoutType(pool, { layoutTypeId: u.LayoutTypeId });
    const { composition } = await L.getEffectiveComposition(pool, u, layout, cache);
    const want = new Map(composition.map((c) => [c.categoryId, c.quantity]));
    const rooms = await q(pool, `
      SELECT r.Id, r.RoomName, r.RoomCategoryId,
        (SELECT COUNT(*) FROM dbo.DailyLabourEntry d WHERE d.RoomId = r.Id) AS Labour,
        CASE WHEN r.BlueprintFileData IS NULL THEN 0 ELSE 1 END AS Blueprint,
        (SELECT COUNT(*) FROM dbo.ActivityBlueprintAnnotation a WHERE a.RoomId = r.Id) AS Annotations,
        (SELECT COUNT(*) FROM dbo.DependencyMaster dm JOIN dbo.DependencyMasterActivity x ON x.DependencyMasterId = dm.Id
           JOIN dbo.DependencyActivityAssignment a ON a.DependencyMasterActivityId = x.Id WHERE dm.RoomId = r.Id) AS Started
      FROM dbo.RoomMaster r WHERE r.UnitId = @u AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL`, { u: [sql.Int, u.Id] });
    const byCat = new Map();
    for (const r of rooms) (byCat.get(r.RoomCategoryId) || byCat.set(r.RoomCategoryId, []).get(r.RoomCategoryId)).push(r);
    for (const [cat, rs] of byCat) {
      const excess = rs.length - (want.get(cat) || 0);
      if (excess <= 0) continue;
      const planned = rs.filter((r) => !r.Labour && !r.Blueprint && !r.Annotations && !r.Started)
        .sort((a, b) => b.RoomName.localeCompare(a.RoomName, undefined, { numeric: true }));
      const real = rs.filter((r) => !planned.includes(r));
      for (const r of planned.slice(0, excess)) {
        const tx = pool.transaction();
        await tx.begin();
        try {
          const ch = await tx.request().input("r", sql.Int, r.Id).query(`UPDATE dbo.DependencyMaster SET IsActive = 0${chainStamp} WHERE RoomId = @r AND IsActive = 1`);
          await tx.request().input("r", sql.Int, r.Id).query(`UPDATE dbo.RoomMaster SET IsActive = 0${roomStamp} WHERE Id = @r`);
          if (APPLY) await tx.commit(); else await tx.rollback();
          totals.roomsRetired++; totals.chainsRetired += ch.rowsAffected[0] || 0;
          console.log(`   ${u.UnitName}: retire room #${r.Id} "${r.RoomName}" + ${ch.rowsAffected[0] || 0} unstarted chain(s)`);
        } catch (e) {
          try { await tx.rollback(); } catch (_) { /* ignore */ }
          console.log(`   !! ${u.UnitName} room #${r.Id}: ${e.message}`); totals.problems++;
        }
      }
      if (planned.length < excess) {
        totals.skippedRealWork += excess - planned.length;
        console.log(`   ${u.UnitName}: ${excess - planned.length} surplus room(s) have REAL work — left for a person: ${real.map((r) => `#${r.Id} ${r.RoomName}`).join(", ")}`);
      }
    }
  }
  if (APPLY) { try { await L.bumpFlatMasterCaches(); } catch (_) { /* best-effort */ } }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("retireSurplusPlannedRooms failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
