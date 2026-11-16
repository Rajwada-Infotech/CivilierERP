// The floors of a project, as the Floor Master (Civil Work DPR setup) shows them and the BOQ Floor dropdown offers them.
// Sources, merged on floor number per block:
//   - Auto Project Setup: dbo.CrmProjectAutoSetupFloor (the synthetic FloorNo -1 "Unassigned" bucket is left out)
//   - Floor Master:       dbo.DprFloorMaster, for one block or (BlockId NULL) every block of the project
//   - Unit Master:        floors already used by units of the block (older projects set up before the wizard)
// Ground (0) is always offered.
const { sql } = require("../db");

const floorName = (no, label) => {
  const l = label != null ? String(label).trim() : "";
  if (Number(no) === 0 && (!l || /^(g|ground)$/i.test(l))) return "Ground floor";
  if (!l || l === String(no)) return `Floor ${no}`;
  return l;
};

// Until migration 663 has run there is no DprFloorMaster; the list then comes from setup and units alone.
let hasFloorMaster = false;
async function floorMasterExists(pool) {
  if (!hasFloorMaster) {
    const r = await pool.request().query("SELECT OBJECT_ID('dbo.DprFloorMaster', 'U') AS id");
    hasFloorMaster = r.recordset[0]?.id != null;
  }
  return hasFloorMaster;
}

// [{ value: "0", label: "Ground floor" }, ...] sorted by floor number.
async function floorsForBlock(pool, projectId, blockId) {
  const added = (await floorMasterExists(pool)) ? `
    SELECT FloorNo, FloorLabel, 2 FROM dbo.DprFloorMaster
      WHERE ProjectId = @P AND IsActive = 1 AND (BlockId = @B OR BlockId IS NULL)
    UNION ALL` : "";
  const r = await pool.request().input("P", sql.Int, projectId).input("B", sql.Int, blockId).query(`
    SELECT FloorNo, FloorLabel, 1 AS Pri FROM dbo.CrmProjectAutoSetupFloor
      WHERE BlockId = @B AND IsActive = 1 AND FloorNo >= 0
    UNION ALL${added}
    SELECT DISTINCT FloorNo, NULL, 3 FROM dbo.UnitMaster
      WHERE BlockId = @B AND IsActive = 1 AND FloorNo IS NOT NULL`);
  const byNo = new Map([[0, { no: 0, label: null, pri: 9 }]]);
  for (const row of r.recordset) {
    const no = Number(row.FloorNo);
    if (!Number.isFinite(no)) continue;
    const cur = byNo.get(no);
    if (!cur || row.Pri < cur.pri) byNo.set(no, { no, label: row.FloorLabel, pri: row.Pri });
  }
  return [...byNo.values()].sort((a, b) => a.no - b.no).map((f) => ({ value: String(f.no), label: floorName(f.no, f.label) }));
}

module.exports = { floorsForBlock, floorName };
