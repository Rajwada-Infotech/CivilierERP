cd /home/administrator/CivilierERP
cat > /tmp/flatmasterCheck.js << 'FMCHECK_EOF'
// READ-ONLY: shows exactly what the Flat Master page loads, straight from the DB.
const { connectDB, getPool, closeDB } = require("../db");
const out = (s = "") => console.log(s);
(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (t) => (await pool.request().query(t)).recordset;
  out("FLATMASTER-CHECK (read-only)");

  out("\n=== 1. DROPDOWNS: Project -> Block -> Floor -> Unit (same source as the Add Room form) ===");
  for (const r of await q(`
    SELECT e.name AS project, b.BlockName AS block, COUNT(DISTINCT u.FloorNo) AS floors, COUNT(*) AS units,
      SUM(CASE WHEN u.UnitType IS NULL THEN 1 ELSE 0 END) AS noType
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    LEFT JOIN dbo.enterprise e ON e.id = u.ProjectId
    WHERE u.IsActive = 1
    GROUP BY e.name, b.BlockName ORDER BY e.name, b.BlockName`)) {
    out(`  ${String(r.project).trim().padEnd(14)} block ${String(r.block).padEnd(10)} floors ${String(r.floors).padStart(3)}  units ${String(r.units).padStart(4)}  noType ${r.noType}`);
  }

  out("\n=== 2. ROOM CONFIGURATION BOX: one sample unit per type ===");
  const samples = await q(`
    SELECT x.Id, x.UnitName, x.UnitType, x.LayoutTypeId, x.project FROM (
      SELECT u.Id, u.UnitName, u.UnitType, u.LayoutTypeId, e.name AS project,
        ROW_NUMBER() OVER (PARTITION BY u.LayoutTypeId ORDER BY u.Id) AS rn
      FROM dbo.UnitMaster u LEFT JOIN dbo.enterprise e ON e.id = u.ProjectId WHERE u.IsActive = 1) x
    WHERE x.rn = 1 ORDER BY x.UnitType`);
  for (const s of samples) {
    const tpl = await q(`
      SELECT cat.Alias, rc.Quantity FROM dbo.UnitRoomConfig c
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = c.Id AND rc.Quantity > 0
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId AND cat.IsActive = 1
      WHERE c.LayoutTypeId = ${s.LayoutTypeId ?? -1} AND c.IsActive = 1 ORDER BY cat.SortOrder`);
    const rooms = await q(`SELECT RoomName, Floor, RoomCategoryId FROM dbo.RoomMaster WHERE UnitId = ${s.Id} AND IsActive = 1 ORDER BY RoomName`);
    out(`  ${s.UnitName}  (${String(s.project).trim()})  type ${s.UnitType}`);
    out(`    layout : ${tpl.map((t) => `${t.Alias} x${t.Quantity}`).join(", ") || "NONE"}`);
    out(`    rooms  : ${rooms.map((r) => r.RoomName).join(", ") || "NONE"}  [${rooms.length}]  floor=${[...new Set(rooms.map((r) => r.Floor))].join("/")}`);
  }

  out("\n=== 3. ROOM RECORDS LIST (grouped by unit, as on the page) ===");
  const [c] = await q(`SELECT COUNT(*) AS rooms, COUNT(DISTINCT UnitId) AS units FROM dbo.RoomMaster WHERE IsActive = 1`);
  out(`  ${c.rooms} room records across ${c.units} units`);
  for (const r of await q(`
    SELECT TOP 5 u.UnitName, u.UnitType, COUNT(*) AS rooms, STRING_AGG(r.RoomName, ', ') WITHIN GROUP (ORDER BY r.RoomName) AS names
    FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId
    WHERE r.IsActive = 1 GROUP BY u.UnitName, u.UnitType ORDER BY u.UnitName`)) out(`  ${r.UnitName} (${r.UnitType}) ${r.rooms}: ${r.names}`);

  out("\nEND OF FLATMASTER-CHECK");
  await closeDB();
  process.exit(0);
})().catch(async (e) => { console.error("FLATMASTER-CHECK FAILED:", e.message); try { await closeDB(); } catch { /* ignore */ } process.exit(1); });
FMCHECK_EOF
docker cp /tmp/flatmasterCheck.js civiliererp-backend-1:/app/scripts/flatmasterCheck_tmp.js
docker compose exec backend node scripts/flatmasterCheck_tmp.js 2>&1 | grep -v '"level":30'
docker compose exec backend rm -f scripts/flatmasterCheck_tmp.js
