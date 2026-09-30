// READ-ONLY. Prints every project > block > floor > unit exactly as stored,
// so real data can be compared against an external list before any change.
// Units that anything references (bookings, applications, rooms, DPR chains,
// resale, lineage, ... — found via this DB's own foreign keys) are marked
// "*" so they're never renamed/removed blindly.
//
// Usage:
//   node scripts/exportProjectStructure.js              # all projects
//   node scripts/exportProjectStructure.js --project 12 # one project

const { connectDB, getPool, closeDB } = require("../db");

const pIdx = process.argv.indexOf("--project");
const ONLY = pIdx >= 0 ? parseInt(process.argv[pIdx + 1], 10) : null;

async function main() {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;

  const refs = await q(`
    SELECT OBJECT_NAME(fk.parent_object_id) AS t, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS c
    FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    WHERE fk.referenced_object_id = OBJECT_ID('dbo.UnitMaster')`);
  const usedSql = refs.length
    ? `CASE WHEN ${refs.map((r) => `EXISTS (SELECT 1 FROM dbo.[${r.t}] x WHERE x.[${r.c}] = u.Id)`).join(" OR ")} THEN 1 ELSE 0 END`
    : "0";
  const col = async (t, c) => (await q(`SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID('dbo.${t}') AND name = '${c}'`)).length > 0;
  const has = {};
  for (const c of ["UnitKind", "Facing", "AreaSqFt", "CarpetAreaSqFt", "SuperBuiltUpAreaSqFt", "BuiltUpAreaSqFt", "OpenTerraceAreaSqFt"]) has[c] = await col("UnitMaster", c);
  const pick = (c) => (has[c] ? `u.${c}` : `NULL AS ${c}`);

  const projects = await q(`
    SELECT e.id, e.name, ISNULL(e.discontinue, 0) AS discontinued
    FROM dbo.enterprise e
    WHERE e.business_type = 'P' ${ONLY ? `AND e.id = ${ONLY}` : ""}
      AND (EXISTS (SELECT 1 FROM dbo.BlockMaster b WHERE b.ProjectId = e.id) OR EXISTS (SELECT 1 FROM dbo.UnitMaster u WHERE u.ProjectId = e.id))
    ORDER BY e.name`);
  const blocks = await q(`SELECT Id, ProjectId, BlockName, IsActive FROM dbo.BlockMaster ORDER BY ProjectId, BlockName`);
  const floors = (await q("SELECT OBJECT_ID('dbo.CrmProjectAutoSetupFloor') AS id"))[0].id
    ? await q(`SELECT BlockId, FloorNo, FloorLabel, UnitCount, IsActive FROM dbo.CrmProjectAutoSetupFloor`)
    : [];
  const units = await q(`
    SELECT u.Id, u.ProjectId, u.BlockId, u.UnitName, u.FloorNo, u.IsActive, u.UnitType,
           ${pick("UnitKind")}, ${pick("Facing")}, ${pick("AreaSqFt")}, ${pick("CarpetAreaSqFt")},
           ${pick("SuperBuiltUpAreaSqFt")}, ${pick("BuiltUpAreaSqFt")}, ${pick("OpenTerraceAreaSqFt")},
           ${usedSql} AS Used
    FROM dbo.UnitMaster u`);

  const n = (v) => (v == null || v === "" ? "-" : Number(v) === Math.round(Number(v)) ? String(Math.round(Number(v))) : String(v));
  const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

  console.log(`Legend: unit = Name[type|kind|facing|area/carpet/SBU/builtup/OT]  * = referenced (booking/room/DPR/...)  (x) = inactive\n`);
  let total = 0;
  for (const p of projects) {
    const pUnits = units.filter((u) => u.ProjectId === p.id);
    total += pUnits.length;
    console.log(`${"=".repeat(90)}\nPROJECT #${p.id} "${p.name}"${p.discontinued ? " [DISCONTINUED]" : ""} — ${pUnits.filter((u) => u.IsActive).length} active units (${pUnits.length} total)`);
    const pBlocks = blocks.filter((b) => b.ProjectId === p.id);
    const orphan = pUnits.filter((u) => !pBlocks.some((b) => b.Id === u.BlockId));
    for (const b of pBlocks) {
      const bUnits = pUnits.filter((u) => u.BlockId === b.Id);
      console.log(`  BLOCK #${b.Id} "${b.BlockName}"${b.IsActive ? "" : " (x)"} — ${bUnits.filter((u) => u.IsActive).length} active units`);
      const bFloors = floors.filter((f) => f.BlockId === b.Id);
      const floorNos = [...new Set([...bUnits.map((u) => (u.FloorNo == null ? -1 : u.FloorNo)), ...bFloors.map((f) => f.FloorNo)])].sort((a, c) => a - c);
      for (const fn of floorNos) {
        const fr = bFloors.find((f) => f.FloorNo === fn);
        const fu = bUnits.filter((u) => (u.FloorNo == null ? -1 : u.FloorNo) === fn).sort((a, c) => cmp(a.UnitName, c.UnitName));
        const label = fn === -1 ? "No floor" : fn === 0 ? "G" : `F${fn}`;
        const fInfo = fr ? `floorRow:"${fr.FloorLabel}" count=${fr.UnitCount}${fr.IsActive ? "" : " (x)"}` : "NO floorRow";
        console.log(`    ${label.padEnd(8)} [${fInfo}] ${fu.length} unit(s)`);
        for (const u of fu) {
          const areas = [u.AreaSqFt, u.CarpetAreaSqFt, u.SuperBuiltUpAreaSqFt, u.BuiltUpAreaSqFt, u.OpenTerraceAreaSqFt].map(n).join("/");
          console.log(`      #${u.Id} ${u.UnitName}${u.Used ? "*" : ""}${u.IsActive ? "" : " (x)"}  [${u.UnitType || "-"}|${u.UnitKind || "-"}|${u.Facing || "-"}|${areas}]`);
        }
      }
    }
    if (orphan.length) console.log(`  !! ${orphan.length} unit(s) with no matching block: ${orphan.map((u) => `#${u.Id} ${u.UnitName}`).join(", ")}`);
  }
  console.log(`\n${projects.length} project(s), ${total} unit row(s). READ-ONLY — nothing was changed.`);
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("exportProjectStructure failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
