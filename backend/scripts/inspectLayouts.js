// READ-ONLY. Before entering flat types / areas / rooms from floor plans:
//   1. every room category (Room Master)
//   2. every layout type and its composition (which rooms, how many)
//   3. layout overrides that apply to the project
//   4. per block: each flat letter's current type, area and active room count,
//      grouped by floor ranges, so plan vs DB differences are visible
//
// Usage: node scripts/inspectLayouts.js --project "Royal Garden"

const { connectDB, getPool, closeDB } = require("../db");
const { getLayoutComposition } = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const PROJECT = arg("--project");

async function main() {
  if (!PROJECT) throw new Error('pass --project "<name>"');
  await connectDB();
  const pool = getPool();
  const q = async (s, p = {}) => {
    const r = pool.request();
    for (const [k, v] of Object.entries(p)) r.input(k, v);
    return (await r.query(s)).recordset;
  };
  const col = async (t, c) => (await q(`SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${t}') AND name = '${c}'`)).length > 0;

  console.log("== 1. ROOM CATEGORIES ==");
  const cats = await q("SELECT Id, Alias, IsActive FROM dbo.RoomCategoryMaster ORDER BY SortOrder, Alias");
  console.log(cats.map((c) => `#${c.Id} ${c.Alias}${c.IsActive ? "" : "(x)"}`).join(", "));

  console.log("\n== 2. LAYOUT TYPES + COMPOSITION ==");
  const types = await q("SELECT Id, TypeKey, Label, IsActive FROM dbo.RoomLayoutType ORDER BY SortOrder, Label");
  const inUse = await q("SELECT LayoutTypeId AS id, COUNT(*) AS n FROM dbo.UnitMaster WHERE IsActive = 1 AND LayoutTypeId IS NOT NULL GROUP BY LayoutTypeId");
  for (const t of types) {
    const comp = await getLayoutComposition(pool, t.Id);
    const n = inUse.find((u) => u.id === t.Id)?.n || 0;
    console.log(`#${t.Id} "${t.Label}" key=${t.TypeKey}${t.IsActive ? "" : " (x)"}  units=${n}`);
    console.log(`     ${comp.length ? comp.map((c) => `${c.alias} x${c.quantity}`).join(", ") : "(no composition)"}`);
  }

  const proj = await q("SELECT id, name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: PROJECT });
  if (proj.length !== 1) throw new Error(`${proj.length} projects named "${PROJECT}"`);
  const pid = proj[0].id;

  console.log("\n== 3. LAYOUT OVERRIDES FOR THIS PROJECT ==");
  if ((await q("SELECT OBJECT_ID('dbo.RoomLayoutOverride') AS id"))[0].id) {
    const ov = await q("SELECT * FROM dbo.RoomLayoutOverride WHERE ProjectId = @p", { p: pid });
    console.log(ov.length ? ov.map((o) => JSON.stringify(o)).join("\n") : "(none)");
  } else console.log("(table not present)");

  console.log(`\n== 4. FLATS — "${proj[0].name}" (type | area | active rooms) ==`);
  const areaCols = [];
  for (const c of ["AreaSqFt", "CarpetAreaSqFt", "SuperBuiltUpAreaSqFt", "BuiltUpAreaSqFt"]) if (await col("UnitMaster", c)) areaCols.push(c);
  const units = await q(`
    SELECT b.BlockName, u.Id, u.UnitName, u.FloorNo, u.UnitType, u.LayoutTypeId, u.IsActive,
      ${areaCols.map((c) => `u.${c}`).join(", ") || "NULL AS none"},
      (SELECT COUNT(*) FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1) AS Rooms
    FROM dbo.UnitMaster u JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE u.ProjectId = @p ORDER BY b.BlockName, u.FloorNo, u.UnitName`, { p: pid });
  const f = (v) => (v == null ? "-" : Math.round(Number(v)));
  const blocks = [...new Set(units.map((u) => u.BlockName))];
  for (const bn of blocks) {
    const bu = units.filter((u) => u.BlockName === bn);
    const floors = [...new Set(bu.map((u) => u.FloorNo))].sort((a, b) => a - b);
    console.log(`BLOCK ${bn}: floors ${floors[0]}–${floors[floors.length - 1]}, ${bu.filter((u) => u.IsActive).length} active`);
    // Group consecutive floors whose per-letter signature is identical.
    let runStart = null, runSig = null, prev = null;
    const flush = () => runSig != null && console.log(`   floors ${runStart}${prev !== runStart ? `–${prev}` : ""}: ${runSig}`);
    for (const fl of floors) {
      const sig = bu.filter((u) => u.FloorNo === fl)
        .map((u) => `${String(u.UnitName).split("/").pop().replace(/^\d+/, "")}[${u.UnitType || "-"}|${areaCols.map((c) => f(u[c])).join("/")}|${u.Rooms}r${u.IsActive ? "" : "|x"}]`)
        .join(" ");
      if (sig !== runSig) { flush(); runStart = fl; runSig = sig; }
      prev = fl;
    }
    flush();
  }
  console.log(`\nArea columns shown: ${areaCols.join("/") || "(none on this DB)"}. READ-ONLY — nothing was changed.`);
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("inspectLayouts failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
