// Loads villa types' rooms-by-floor from a spec file (e.g. a brochure
// reading) — the same thing Plot Master > Villa types > Rooms saves by hand.
// Creates any room categories the spec names that don't exist yet, then saves
// each listed villa type's plan (services/villaComposition.savePlan), which
// builds the type's own layout. Villas ALREADY BUILT are left exactly as they
// are — the plan applies to villas converted from now on. --update-villas
// also brings existing villas of each type in line (normally not wanted).
// One transaction; dry run by default.
//
//   node scripts/loadVillaPlans.js --spec scripts/silverwoods_villa_plans.json            # dry run
//   node scripts/loadVillaPlans.js --spec scripts/silverwoods_villa_plans.json --apply
//   ... --apply --update-villas   # also re-cut villas already built (normally NOT wanted)
const fs = require("fs");
const { connectDB, getPool, closeDB, sql } = require("../db");
const { savePlan, applyStoreys } = require("../services/villaComposition");
const { syncUnitRooms } = require("../services/unitLayout");

const APPLY = process.argv.includes("--apply");
const UPDATE_VILLAS = process.argv.includes("--update-villas");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const spec = JSON.parse(fs.readFileSync(arg("--spec"), "utf8"));
  await connectDB();
  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const q = (text, inputs = {}) => { const r = tx.request(); for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v); return r.query(text); };
    const project = (await q("SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), spec.project] })).recordset;
    if (project.length !== 1) throw new Error(`${project.length} projects named "${spec.project}"`);
    const pid = project[0].id;
    console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${spec.project} (#${pid}) — ${spec.source || ""}\n`);

    // Room categories
    const existing = new Map((await q("SELECT Id, CategoryName, IsActive FROM dbo.RoomCategoryMaster")).recordset.map((c) => [String(c.CategoryName).toUpperCase(), c]));
    const maxSort = (await q("SELECT ISNULL(MAX(SortOrder), 0) AS m FROM dbo.RoomCategoryMaster")).recordset[0].m;
    let sort = maxSort;
    for (const c of spec.categories || []) {
      const hit = existing.get(c.name.toUpperCase());
      if (hit && hit.IsActive) continue;
      if (hit && !hit.IsActive) {
        console.log(`  REACTIVATE room type ${c.name}`);
        await q("UPDATE dbo.RoomCategoryMaster SET IsActive = 1 WHERE Id = @id", { id: [sql.Int, hit.Id] });
        continue;
      }
      sort += 10;
      const id = (await q("INSERT INTO dbo.RoomCategoryMaster (CategoryName, Alias, IsActive, SortOrder, CreatedBy) OUTPUT INSERTED.Id VALUES (@n, @a, 1, @s, N'loadVillaPlans')",
        { n: [sql.NVarChar(100), c.name], a: [sql.NVarChar(150), c.alias], s: [sql.Int, sort] })).recordset[0].Id;
      existing.set(c.name.toUpperCase(), { Id: id, CategoryName: c.name, IsActive: true });
      console.log(`  CREATE room type ${c.name} ("${c.alias}")`);
    }

    // Villa types
    const types = new Map((await q("SELECT Id, Code, Name FROM dbo.VillaTypeMaster WHERE ProjectId = @p AND IsActive = 1", { p: [sql.Int, pid] })).recordset.map((t) => [t.Code.toUpperCase(), t]));
    const totals = { types: 0, rooms: 0, villas: 0, roomsAdded: 0, problems: 0 };
    for (const [code, floors] of Object.entries(spec.types || {})) {
      const t = types.get(code.toUpperCase());
      if (!t) { console.log(`  !! villa type ${code} not found in ${spec.project} — skipped`); totals.problems++; continue; }
      const rooms = [];
      for (const [storey, cats] of Object.entries(floors)) {
        for (const [catName, qty] of Object.entries(cats)) {
          const c = existing.get(catName.toUpperCase());
          if (!c) { console.log(`  !! ${code}: room type ${catName} unknown — add it to "categories"`); totals.problems++; continue; }
          rooms.push({ storey, categoryId: c.Id, quantity: qty });
        }
      }
      const saved = await savePlan(tx, t.Id, rooms, "loadVillaPlans");
      // Villas already built keep their rooms unless --update-villas is given.
      const built = (await q("SELECT Id, UnitName FROM dbo.UnitMaster WHERE VillaTypeId = @v AND IsActive = 1", { v: [sql.Int, t.Id] })).recordset;
      const villas = !UPDATE_VILLAS ? [] : (await q(`UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = @l, UpdatedAt = SYSDATETIME() OUTPUT INSERTED.Id, INSERTED.UnitName
                               WHERE VillaTypeId = @v AND IsActive = 1`,
        { lt: [sql.Int, saved.layoutTypeId], l: [sql.NVarChar(50), saved.label], v: [sql.Int, t.Id] })).recordset;
      let added = 0;
      for (const v of villas) {
        const s = await syncUnitRooms(tx, v.Id, { removeUnused: false });
        added += s.created + (s.reactivated || 0);
        await applyStoreys(tx, v.Id);
      }
      const perFloor = Object.entries(floors).sort(([a], [b]) => require("../services/villaComposition").storeyOrder(a) - require("../services/villaComposition").storeyOrder(b)).map(([f, cats]) => `${f}: ${Object.values(cats).reduce((a, b) => a + b, 0)}`).join(", ");
      const keptNote = !UPDATE_VILLAS && built.length ? ` — ${built.length} built villa(s) left as they are: ${built.map((v) => v.UnitName).join(", ")}` : "";
      console.log(`  ${code} ${t.Name}: ${saved.roomCount} rooms (${perFloor})${villas.length ? ` — ${villas.length} villa(s) updated, ${added} room(s) added: ${villas.map((v) => v.UnitName).join(", ")}` : keptNote}`);
      totals.types++; totals.rooms += saved.roomCount; totals.villas += villas.length; totals.roomsAdded += added;
    }

    console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
    if (APPLY) await tx.commit(); else { await tx.rollback(); console.log("Dry run — rolled back, nothing was written."); }
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* ignore */ }
    throw e;
  }
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("loadVillaPlans failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
