// After a unit-type correction, some units keep a SURPLUS room (its layout no
// longer wants it) that holds only an UNSTARTED DPR chain, while other units
// gained a room of the same category that has NO chain — unlike the rest of
// the project. This moves each unstarted chain from a surplus room to a
// chainless room of the same category, then lets the app's own room sync
// (syncUnitRooms, removeUnused) retire the now-empty surplus room.
//
// Everything follows existing data, nothing is typed here:
//   - "unstarted" = every step's assignments are the stub rows the app creates
//     with a chain (Status 'PENDING', 0 progress — migration 487), no worker
//     attendance / roster on its steps, no labour / blueprint on the room
//   - the chain is re-pointed exactly like PUT /dependency-master/:id does
//     (ProjectId, TowerId, Floor, FlatId, RoomId, Alias); TowerId / Floor /
//     FlatId are copied from an existing chain of the target unit when it has
//     one (so the stored format is the project's own), and the Alias keeps
//     the chain's current "<unit>/<room>" shape only if it has that shape
//   - target preference: same block + floor, then same block, then project
//
//   node scripts/moveUnstartedChains.js --project "Luxuria"          # dry run
//   node scripts/moveUnstartedChains.js --project "Luxuria" --apply

const { connectDB, getPool, sql, closeDB } = require("../db");
const L = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const ACTOR = "moveUnstartedChains";

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

  // Every table that references a chain step (found from this DB's own foreign
  // keys) counts as work — except the assignment table, whose stub rows are
  // judged by Status / progress below.
  const stepRefs = (await q(pool, `
    SELECT OBJECT_NAME(fk.parent_object_id) AS t, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS c
    FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.DependencyMasterActivity')
      AND fk.parent_object_id <> OBJECT_ID('dbo.DependencyActivityAssignment')`))
    .map((r) => `EXISTS (SELECT 1 FROM dbo.[${r.t}] w WHERE w.[${r.c}] = x.Id)`);
  console.log(`step references checked: ${stepRefs.length ? stepRefs.map((s) => s.match(/dbo\.\[(\w+)\]/)[1]).join(", ") : "(none)"}`);
  const started = `(SELECT COUNT(*) FROM dbo.DependencyMasterActivity x
      WHERE x.DependencyMasterId = dm.Id AND (
        EXISTS (SELECT 1 FROM dbo.DependencyActivityAssignment a WHERE a.DependencyMasterActivityId = x.Id
                AND (ISNULL(a.Status, 'PENDING') <> 'PENDING' OR ISNULL(a.ProgressPercent, 0) > 0))
        ${stepRefs.length ? "OR " + stepRefs.join(" OR ") : ""}))`;

  const units = await q(pool, "SELECT Id, ProjectId, BlockId, FloorNo, UnitName, LayoutTypeId FROM dbo.UnitMaster WHERE ProjectId = @p AND IsActive = 1 AND LayoutTypeId IS NOT NULL", { p: [sql.Int, pid] });
  const unitById = new Map(units.map((u) => [u.Id, u]));
  const rooms = await q(pool, `
    SELECT r.Id, r.UnitId, r.RoomName, r.RoomCategoryId,
      (SELECT COUNT(*) FROM dbo.DependencyMaster dm WHERE dm.RoomId = r.Id AND dm.IsActive = 1) AS Chains,
      (SELECT COUNT(*) FROM dbo.DailyLabourEntry d WHERE d.RoomId = r.Id) AS Labour,
      CASE WHEN r.BlueprintFileData IS NULL THEN 0 ELSE 1 END AS Blueprint,
      (SELECT COUNT(*) FROM dbo.ActivityBlueprintAnnotation an WHERE an.RoomId = r.Id) AS Annotations
    FROM dbo.RoomMaster r WHERE r.ProjectId = @p AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL`, { p: [sql.Int, pid] });

  // 1. surplus rooms per unit (effective layout = layout + overrides)
  const cache = new Map();
  const surplus = [];
  for (const u of units) {
    const layout = await L.resolveLayoutType(pool, { layoutTypeId: u.LayoutTypeId });
    const { composition } = await L.getEffectiveComposition(pool, u, layout, cache);
    const want = new Map(composition.map((c) => [c.categoryId, c.quantity]));
    const byCat = new Map();
    for (const r of rooms.filter((x) => x.UnitId === u.Id)) (byCat.get(r.RoomCategoryId) || byCat.set(r.RoomCategoryId, []).get(r.RoomCategoryId)).push(r);
    for (const [cat, rs] of byCat) {
      const excess = rs.length - (want.get(cat) || 0);
      if (excess <= 0 || rs.filter((r) => !r.Chains && !r.Labour && !r.Blueprint && !r.Annotations).length >= excess) continue;
      // highest-numbered rooms with work go first, so "… 1" names stay
      surplus.push(...rs.filter((r) => r.Chains).sort((a, b) => b.RoomName.localeCompare(a.RoomName, undefined, { numeric: true })).slice(0, excess));
    }
  }
  // 2. chainless rooms in units whose other rooms follow the chain pattern
  const chained = new Set(rooms.filter((r) => r.Chains).map((r) => r.UnitId));
  const targets = rooms.filter((r) => !r.Chains && chained.has(r.UnitId) && !surplus.includes(r));

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj[0].name}: ${surplus.length} surplus room(s) with chains, ${targets.length} chainless room(s) in chained units\n`);
  const totals = { chainsMoved: 0, roomsRetired: 0, leftRealWork: 0, leftNoTarget: 0, targetsStillChainless: 0, problems: 0 };
  const used = new Set();
  for (const s of surplus) {
    const su = unitById.get(s.UnitId);
    const chains = await q(pool, `SELECT dm.Id, dm.Alias, ${started} AS Started FROM dbo.DependencyMaster dm WHERE dm.RoomId = @r AND dm.IsActive = 1`, { r: [sql.Int, s.Id] });
    if (s.Labour || s.Blueprint || s.Annotations || chains.some((c) => c.Started)) {
      totals.leftRealWork++; console.log(`   ${su.UnitName} "${s.RoomName}": has REAL work — left for a person`); continue;
    }
    const cands = targets.filter((t) => !used.has(t.Id) && t.RoomCategoryId === s.RoomCategoryId);
    const rank = (t) => { const tu = unitById.get(t.UnitId); return (tu.BlockId === su.BlockId ? 0 : 2) + (tu.FloorNo === su.FloorNo ? 0 : 1); };
    const target = cands.sort((a, b) => rank(a) - rank(b) || a.RoomName.localeCompare(b.RoomName, undefined, { numeric: true }))[0];
    if (!target) { totals.leftNoTarget++; console.log(`   ${su.UnitName} "${s.RoomName}": no chainless ${"room"} of this category to move to — left as is`); continue; }
    used.add(target.Id);
    const tu = unitById.get(target.UnitId);
    // Scope columns in the project's own stored format: copy from a chain already on the target unit.
    const ref = (await q(pool, "SELECT TOP 1 ProjectId, TowerId, Floor, FlatId FROM dbo.DependencyMaster WHERE FlatId = @f AND IsActive = 1", { f: [sql.Int, tu.Id] }))[0];
    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const c of chains) {
        const alias = c.Alias === `${su.UnitName}/${s.RoomName}` ? `${tu.UnitName}/${target.RoomName}` : c.Alias;
        await tx.request().input("Id", sql.Int, c.Id).input("P", sql.Int, ref.ProjectId).input("T", sql.Int, ref.TowerId)
          .input("Fl", sql.NVarChar(50), ref.Floor).input("F", sql.Int, ref.FlatId).input("R", sql.Int, target.Id)
          .input("A", sql.NVarChar(200), alias).input("By", sql.NVarChar(300), ACTOR)
          .query(`UPDATE dbo.DependencyMaster SET ProjectId = @P, TowerId = @T, Floor = @Fl, FlatId = @F, RoomId = @R, Alias = @A,
                  UpdatedBy = @By, UpdatedAt = SYSDATETIME() WHERE Id = @Id`);
        totals.chainsMoved++;
        console.log(`   chain #${c.Id} "${c.Alias}" -> "${alias}"`);
      }
      // The surplus room is now empty: the app's own sync retires it (soft, IsActive = 0).
      const rs = await L.syncUnitRooms(tx, su.Id, { removeUnused: true, createdBy: null });
      totals.roomsRetired += rs.deactivated || 0;
      console.log(`      ${su.UnitName}: rooms retired by sync ${rs.deactivated || 0}${(rs.keptWithWork || []).length ? `, still kept(work) ${rs.keptWithWork.length}` : ""}`);
      if (APPLY) await tx.commit(); else await tx.rollback();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      totals.problems++; console.log(`   !! ${su.UnitName} "${s.RoomName}": ${e.message}`);
    }
  }
  const left = targets.filter((t) => !used.has(t.Id));
  totals.targetsStillChainless = left.length;
  if (left.length) console.log(`\nChainless rooms left (no surplus chain to move — create in Dependency Master): ${left.map((t) => `${unitById.get(t.UnitId).UnitName}/${t.RoomName}`).join(", ")}`);
  if (APPLY) { try { await L.bumpFlatMasterCaches(); } catch (_) { /* best-effort */ } }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("moveUnstartedChains failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
