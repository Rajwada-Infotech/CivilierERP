// READ-ONLY. For every unit whose active rooms exceed its effective layout
// (layout + overrides) in a category, lists the SURPLUS rooms that carry work
// and exactly what that work is, so a person can decide what to do with it:
//   - DPR chains on the room (DependencyMaster) with their step count and the
//     current attempts by status / best progress
//   - daily labour entries, blueprint, blueprint annotations
// "Has work" uses the same rule as syncUnitRooms (services/unitLayout).
//
// Usage: node scripts/inspectSurplusWork.js --project "Luxuria"

const { connectDB, getPool, sql, closeDB } = require("../db");
const L = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const PROJECT = arg("--project");
  if (!PROJECT) throw new Error('pass --project "<name>"');
  await connectDB();
  const pool = getPool();
  const q = async (s, p = {}) => {
    const r = pool.request();
    for (const [k, [t, v]] of Object.entries(p)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };
  const col = async (t, c) => (await q("SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID(@t) AND name = @c", { t: [sql.NVarChar(200), `dbo.${t}`], c: [sql.NVarChar(128), c] })).length > 0;

  const proj = await q("SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), PROJECT] });
  if (proj.length !== 1) throw new Error(`${proj.length} projects named "${PROJECT}"`);
  const pid = proj[0].id;
  const cur = (await col("DependencyActivityAssignment", "IsCurrent")) ? "AND a.IsCurrent = 1" : "";

  const units = await q("SELECT Id, ProjectId, BlockId, FloorNo, UnitName, UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE ProjectId = @p AND IsActive = 1 AND LayoutTypeId IS NOT NULL ORDER BY UnitName", { p: [sql.Int, pid] });
  const cache = new Map();
  const totals = { unitsWithSurplusWork: 0, surplusRooms: 0, chains: 0, stepsStarted: 0, labourEntries: 0, blueprints: 0 };
  for (const u of units) {
    const layout = await L.resolveLayoutType(pool, { layoutTypeId: u.LayoutTypeId });
    const { composition } = await L.getEffectiveComposition(pool, u, layout, cache);
    const want = new Map(composition.map((c) => [c.categoryId, c.quantity]));
    const rooms = await q(`
      SELECT r.Id, r.RoomName, r.RoomCategoryId, c.Alias, ${L.ROOM_HAS_WORK} AS HasWork
      FROM dbo.RoomMaster r LEFT JOIN dbo.RoomCategoryMaster c ON c.Id = r.RoomCategoryId
      WHERE r.UnitId = @u AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL ORDER BY r.RoomName`, { u: [sql.Int, u.Id] });
    const byCat = new Map();
    for (const r of rooms) (byCat.get(r.RoomCategoryId) || byCat.set(r.RoomCategoryId, []).get(r.RoomCategoryId)).push(r);
    const surplus = [];
    for (const [cat, rs] of byCat) {
      const excess = rs.length - (want.get(cat) || 0);
      if (excess > 0 && rs.filter((r) => !r.HasWork).length < excess) {
        // same rule as the sync: rooms without work go first, the rest are kept
        surplus.push(...rs.filter((r) => r.HasWork).slice(0, excess - rs.filter((r) => !r.HasWork).length));
      }
    }
    if (!surplus.length) continue;
    totals.unitsWithSurplusWork++;
    console.log(`${u.UnitName} [${u.UnitType}] layout wants: ${composition.map((c) => `${c.alias} x${c.quantity}`).join(", ")}`);
    for (const r of surplus) {
      totals.surplusRooms++;
      const chains = await q(`
        SELECT d.Id, d.Alias, d.IsActive,
          (SELECT COUNT(*) FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d.Id) AS Steps,
          (SELECT COUNT(*) FROM dbo.DependencyMasterActivity x JOIN dbo.DependencyActivityAssignment a ON a.DependencyMasterActivityId = x.Id ${cur}
             WHERE x.DependencyMasterId = d.Id) AS Attempts,
          (SELECT STRING_AGG(CONCAT(a.Status, ':', ISNULL(a.ProgressPercent,0), '%'), ', ') FROM dbo.DependencyMasterActivity x
             JOIN dbo.DependencyActivityAssignment a ON a.DependencyMasterActivityId = x.Id ${cur} WHERE x.DependencyMasterId = d.Id) AS Work
        FROM dbo.DependencyMaster d WHERE d.RoomId = @r`, { r: [sql.Int, r.Id] });
      const labour = (await q("SELECT COUNT(*) AS n FROM dbo.DailyLabourEntry WHERE RoomId = @r", { r: [sql.Int, r.Id] }))[0].n;
      const bp = (await q("SELECT CASE WHEN BlueprintFileData IS NULL THEN 0 ELSE 1 END AS b, (SELECT COUNT(*) FROM dbo.ActivityBlueprintAnnotation WHERE RoomId = @r) AS ann FROM dbo.RoomMaster WHERE Id = @r", { r: [sql.Int, r.Id] }))[0];
      totals.chains += chains.length; totals.labourEntries += labour; totals.blueprints += bp.b;
      totals.stepsStarted += chains.reduce((s, c) => s + c.Attempts, 0);
      console.log(`   surplus room #${r.Id} "${r.RoomName}" (${r.Alias}): labour entries ${labour}, blueprint ${bp.b ? "yes" : "no"}, annotations ${bp.ann}`);
      for (const c of chains) {
        console.log(`      chain #${c.Id} "${c.Alias}"${c.IsActive ? "" : " (inactive)"}: ${c.Steps} steps, ${c.Attempts} started${c.Work ? ` — ${c.Work}` : " — no work logged"}`);
      }
    }
  }
  console.log(`\n${JSON.stringify(totals)}\nREAD-ONLY — nothing was changed.`);
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("inspectSurplusWork failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
