// Sets each flat's type + area from a floor-plan spec (JSON), then re-syncs
// its rooms to its layout, and optionally saves block-level room overrides.
// Everything goes through services/unitLayout (the same code Unit Master and
// Unit Composition use): types must be registered layout types, overrides use
// saveOverride, rooms use syncUnitRooms. Nothing about the project is
// hard-coded here — it all comes from the spec.
//
// Spec:
// { "project": "Royal Garden", "areaColumn": "BuiltUpAreaSqFt",
//   "blocks": [ { "name": "IRIS", "floors": [1,17],
//                 "flats": { "A": { "type": "3 BHK", "area": 1379,
//                                   "rooms": { "Balcony": 2, ... } }, ... } } ],
// A flat's optional "areas" = { UnitMaster column: value, ... } sets several
// area fields at once (e.g. carpet + super built-up); each column must exist.
// A flat's optional "rooms" = its full room list; when it differs from its
// layout's composition it is saved as a UNIT override (Unit Composition), so
// only that flat differs and the shared layout type is left alone.
//   "overrides": [ { "block": "DAFFODIL", "type": "4 BHK",
//                    "rooms": { "Bedroom": 3, "Master Bedroom": 1, ... } } ] }
//
// Only units whose letter is listed, on the listed floors, are touched.
// Rooms with work are never removed (syncUnitRooms keeps them and reports).
//
//   node scripts/applyFlatPlan.js --spec scripts/rg_plan.json          # dry run
//   node scripts/applyFlatPlan.js --spec scripts/rg_plan.json --apply

const fs = require("fs");
const { connectDB, getPool, sql, closeDB } = require("../db");
const L = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const ACTOR = "applyFlatPlan";

async function main() {
  const spec = JSON.parse(fs.readFileSync(arg("--spec"), "utf8"));
  await connectDB();
  const pool = getPool();
  const one = async (db, text, inputs = {}) => {
    const r = db.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };

  const areaCol = spec.areaColumn;
  if (areaCol && !(await one(pool, `SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = @c`, { c: [sql.NVarChar(128), areaCol] })).length) {
    throw new Error(`UnitMaster has no column ${areaCol}`);
  }
  const proj = await one(pool, "SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), spec.project] });
  if (proj.length !== 1) throw new Error(`${proj.length} projects named "${spec.project}"`);
  const pid = proj[0].id;
  const blocks = await one(pool, "SELECT Id, BlockName FROM dbo.BlockMaster WHERE ProjectId = @p AND IsActive = 1", { p: [sql.Int, pid] });
  const blockId = (name) => {
    const b = blocks.filter((x) => x.BlockName.trim().toUpperCase() === name.trim().toUpperCase());
    if (b.length !== 1) throw new Error(`block "${name}": ${b.length} matches`);
    return b[0].Id;
  };

  // Resolve every type in the spec up front through the app's own validator.
  const typeCache = new Map();
  const resolveType = async (label) => {
    if (!typeCache.has(label)) typeCache.set(label, await L.resolveUnitTypeInput(pool, { UnitType: label }, { requireComposition: true }));
    return typeCache.get(label);
  };

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj[0].name} (#${pid}), area column: ${areaCol || "(not set)"}\n`);
  const totals = { unitsChecked: 0, typeChanged: 0, areaChanged: 0, unchanged: 0, overridesSaved: 0, roomsAdded: 0, roomsRemoved: 0, roomsKeptWithWork: 0, problems: 0 };

  const toItems = (rooms) => Object.entries(rooms).map(([alias, qty]) => {
    const c = cats.find((x) => x.Alias.trim().toUpperCase() === alias.trim().toUpperCase());
    if (!c) throw new Error(`room category "${alias}" not found`);
    return { roomCategoryId: c.Id, quantity: qty };
  });
  const sameComp = (a, b) => JSON.stringify(a.map((c) => [c.categoryId, c.quantity])) === JSON.stringify(b.map((c) => [c.categoryId, c.quantity]));
  totals.unitOverrides = 0;

  // 1. Overrides first, so the room sync below already uses them.
  const cats = await one(pool, "SELECT Id, Alias FROM dbo.RoomCategoryMaster WHERE IsActive = 1");
  for (const o of spec.overrides || []) {
    const layout = await L.resolveLayoutType(pool, { unitType: o.type });
    if (!layout) { console.log(`!! override: layout type "${o.type}" not found`); totals.problems++; continue; }
    const items = [];
    for (const [alias, qty] of Object.entries(o.rooms)) {
      const c = cats.find((x) => x.Alias.trim().toUpperCase() === alias.trim().toUpperCase());
      if (!c) throw new Error(`room category "${alias}" not found`);
      items.push({ roomCategoryId: c.Id, quantity: qty });
    }
    const { composition, all } = await L.validateItems(pool, items);
    const s = { layout, ScopeLevel: "BLOCK", ProjectId: pid, BlockId: blockId(o.block), FloorFrom: null, FloorTo: null, UnitId: null };
    const pv = await L.previewOverrideChange(pool, s, composition);
    console.log(`OVERRIDE ${o.block} / ${layout.label}: ${composition.map((c) => `${c.alias} x${c.quantity}`).join(", ")}`);
    console.log(`   units in scope now: ${pv.unitsInScope}${pv.existingOverrideId ? ` (replaces override #${pv.existingOverrideId})` : ""}`);
    if (APPLY) { await L.saveOverride(pool, s, all, ACTOR); }
    totals.overridesSaved++;
  }

  const extraCols = [...new Set(spec.blocks.flatMap((b) => Object.values(b.flats).flatMap((f) => Object.keys(f.areas || {}))))];
  for (const c of extraCols) {
    if (!/^\w+$/.test(c) || !(await one(pool, "SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = @c", { c: [sql.NVarChar(128), c] })).length) throw new Error(`UnitMaster has no column ${c}`);
  }
  // 2. Types + areas, then rooms, one transaction per unit.
  for (const b of spec.blocks) {
    const bid = blockId(b.name);
    const [ff, ft] = b.floors;
    const units = await one(pool, `
      SELECT Id, UnitName, FloorNo, UnitType, LayoutTypeId${areaCol ? `, ${areaCol} AS Area` : ""}${extraCols.map((c) => `, ${c} AS x_${c}`).join("")}
      FROM dbo.UnitMaster WHERE BlockId = @b AND IsActive = 1 AND FloorNo BETWEEN @ff AND @ft`,
      { b: [sql.Int, bid], ff: [sql.Int, ff], ft: [sql.Int, ft] });
    const lines = [];
    let changed = 0;
    for (const u of units) {
      const letter = (String(u.UnitName).split("/").pop().match(/([A-Z])$/) || [])[1];
      const want = b.flats[letter];
      if (!want) continue;
      totals.unitsChecked++;
      const t = await resolveType(want.type);
      const typeDiff = u.LayoutTypeId !== t.layoutTypeId || u.UnitType !== t.unitType;
      const areaDiff = areaCol && want.area != null && Number(u.Area) !== Number(want.area);
      const extraAreas = Object.entries(want.areas || {}).filter(([c, v]) => Number(u[`x_${c}`]) !== Number(v));
      const extraNote = extraAreas.length ? ` areas{${extraAreas.map(([c, v]) => `${c}:${u[`x_${c}`] ?? "-"}->${v}`).join(", ")}}` : "";
      if (!typeDiff && !areaDiff && !extraAreas.length) { totals.unchanged++; }
      // Flat-specific rooms -> UNIT override, only when its effective rooms
      // (layout + any override already in force) differ from the plan.
      let ovrNote = "";
      if (want.rooms) {
        const layout = await L.resolveLayoutType(pool, { layoutTypeId: t.layoutTypeId });
        const { composition } = await L.validateItems(pool, toItems(want.rooms));
        const unitRef = { Id: u.Id, ProjectId: pid, BlockId: bid, FloorNo: u.FloorNo };
        const eff = await L.getEffectiveComposition(pool, unitRef, layout);
        const global = await L.getLayoutComposition(pool, layout.id);
        if (!sameComp(eff.composition, composition)) {
          if (sameComp(global, composition)) {
            ovrNote = " [plan rooms = standard layout; existing override left for review]";
          } else {
            ovrNote = ` [UNIT override: ${composition.map((c) => `${c.alias} x${c.quantity}`).join(", ")}]`;
            totals.unitOverrides++;
            if (APPLY) {
              const s = { layout, ScopeLevel: "UNIT", ProjectId: pid, BlockId: bid, FloorFrom: null, FloorTo: null, UnitId: u.Id };
              const { all } = await L.validateItems(pool, toItems(want.rooms));
              // saveOverride scopes by the unit's CURRENT layout, so the type
              // must already be the plan's before the override is saved.
              if (typeDiff) {
                await pool.request().input("id", sql.Int, u.Id).input("lt", sql.Int, t.layoutTypeId).input("t", sql.NVarChar(100), t.unitType)
                  .query("UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = @t WHERE Id = @id");
              }
              await L.saveOverride(pool, s, all, ACTOR);
            }
          }
        }
      }
      const tx = pool.transaction();
      await tx.begin();
      try {
        if (typeDiff || areaDiff || extraAreas.length) {
          const r = tx.request().input("id", sql.Int, u.Id).input("lt", sql.Int, t.layoutTypeId).input("t", sql.NVarChar(100), t.unitType);
          let set = "LayoutTypeId = @lt, UnitType = @t";
          if (areaDiff) { r.input("a", sql.Decimal(18, 2), want.area); set += `, ${areaCol} = @a`; }
          extraAreas.forEach(([c, v], i) => { r.input(`x${i}`, sql.Decimal(18, 2), v); set += `, ${c} = @x${i}`; });
          if (extraAreas.length) totals.extraAreasChanged = (totals.extraAreasChanged || 0) + 1;
          await r.query(`UPDATE dbo.UnitMaster SET ${set} WHERE Id = @id`);
        }
        // Always re-sync: an override saved above may change rooms even for
        // flats whose type/area were already right.
        const rs = await L.syncUnitRooms(tx, u.Id, { removeUnused: true, createdBy: null });
        totals.roomsAdded += (rs.created || 0) + (rs.reactivated || 0);
        totals.roomsRemoved += rs.deactivated || 0;
        totals.roomsKeptWithWork += (rs.keptWithWork || []).length;
        if (typeDiff) totals.typeChanged++;
        if (areaDiff) totals.areaChanged++;
        if (typeDiff || areaDiff || extraAreas.length || rs.created || rs.deactivated || ovrNote) {
          changed++;
          lines.push(`   ${u.UnitName}: ${u.UnitType || "-"}/${u.Area ?? "-"} -> ${t.unitType}/${want.area ?? "-"}  rooms +${(rs.created || 0) + (rs.reactivated || 0)} -${rs.deactivated || 0}${(rs.keptWithWork || []).length ? ` KEPT(work): ${rs.keptWithWork.length}` : ""}${extraNote}${ovrNote}`);
        }
        if (APPLY) await tx.commit(); else await tx.rollback();
      } catch (e) {
        try { await tx.rollback(); } catch (_) { /* ignore */ }
        lines.push(`   !! ${u.UnitName}: ${e.message}`);
        totals.problems++;
      }
    }
    console.log(`BLOCK ${b.name} floors ${ff}–${ft}: ${changed} flat(s) change`);
    if (lines.length) console.log(lines.join("\n"));
  }

  if (APPLY) { try { await L.bumpFlatMasterCaches(); await require("../redis").bumpCacheVersion("unit-master"); } catch (_) { /* best-effort */ } }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("applyFlatPlan failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
