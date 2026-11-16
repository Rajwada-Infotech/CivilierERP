const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
// A user limited to some projects can't read or change another project's floors.
const { setupScopeGuard, projectAllowed } = require("../services/projectScope");
setupScopeGuard(router, {});
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { floorName } = require("../services/projectFloors");

// Floor Master (Civil Work DPR setup). Lists a project's floors: those from Auto Project Setup (read-only here —
// they're changed in the setup wizard) and those added for the project in dbo.DprFloorMaster (migration 663).
// The BOQ Floor dropdown offers both (services/projectFloors.js).

const actorOf = (req) => req.user?.email || req.user?.name || "system";
const cleanLabel = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

// GET /?projectId= — { blocks, floors }: the project's blocks, and every floor of it by block then floor number.
router.get("/", authMiddleware, requirePageRight("dpr-floor-master", "view"), async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10) || null;
  if (!projectId) return res.json({ blocks: [], floors: [] });
  try {
    const pool = getPool();
    const r = await pool.request().input("P", sql.Int, projectId).query(`
      SELECT 'setup' AS source, f.Id AS id, f.BlockId AS blockId, b.BlockName AS blockName, f.FloorNo AS floorNo,
             f.FloorLabel AS floorLabel, f.UnitCount AS unitCount, CAST(NULL AS NVARCHAR(200)) AS createdBy
      FROM dbo.CrmProjectAutoSetupFloor f
      JOIN dbo.BlockMaster b ON b.Id = f.BlockId AND b.IsActive = 1
      WHERE f.ProjectId = @P AND f.IsActive = 1 AND f.FloorNo >= 0
      UNION ALL
      SELECT 'manual', m.Id, m.BlockId, b.BlockName, m.FloorNo, m.FloorLabel, NULL, m.CreatedBy
      FROM dbo.DprFloorMaster m
      LEFT JOIN dbo.BlockMaster b ON b.Id = m.BlockId
      WHERE m.ProjectId = @P AND m.IsActive = 1`);
    const rows = r.recordset
      .map((x) => ({ ...x, name: floorName(x.floorNo, x.floorLabel) }))
      .sort((a, b) => String(a.blockName ?? "").localeCompare(String(b.blockName ?? ""), undefined, { numeric: true })
        || a.floorNo - b.floorNo || (a.source === "setup" ? -1 : 1));
    const blocks = (await pool.request().input("P", sql.Int, projectId).query(
      "SELECT Id AS id, BlockName AS name FROM dbo.BlockMaster WHERE ProjectId = @P AND IsActive = 1 ORDER BY BlockName")).recordset;
    res.json({ blocks, floors: rows });
  } catch (err) {
    console.error("[dpr-floor-master] GET error:", err.message);
    res.status(500).json({ error: "Could not load floors" });
  }
});

// The same floor number already on this block (from setup or added here), or, for an all-blocks floor, on any
// block of the project. Returns a short description of the clash, or null.
async function clashOf(pool, { projectId, blockId, floorNo, excludeId }) {
  const r = await pool.request().input("P", sql.Int, projectId).input("B", sql.Int, blockId).input("F", sql.Int, floorNo)
    .input("X", sql.Int, excludeId || 0).query(`
      SELECT TOP 1 b.BlockName AS blockName, 'Auto Project Setup' AS src
      FROM dbo.CrmProjectAutoSetupFloor f JOIN dbo.BlockMaster b ON b.Id = f.BlockId
      WHERE f.ProjectId = @P AND f.IsActive = 1 AND f.FloorNo = @F AND (@B IS NULL OR f.BlockId = @B)
      UNION ALL
      SELECT TOP 1 b.BlockName, 'Floor Master'
      FROM dbo.DprFloorMaster m LEFT JOIN dbo.BlockMaster b ON b.Id = m.BlockId
      WHERE m.ProjectId = @P AND m.IsActive = 1 AND m.FloorNo = @F AND m.Id <> @X
        AND (@B IS NULL OR m.BlockId IS NULL OR m.BlockId = @B)`);
  const c = r.recordset[0];
  return c ? `${c.blockName ? `${c.blockName} already has` : "All blocks already have"} this floor (${c.src})` : null;
}

async function validate(pool, body) {
  const projectId = parseInt(body?.projectId, 10) || null;
  const blockId = intOrNull(body?.blockId);
  const floorNo = intOrNull(body?.floorNo);
  const floorLabel = cleanLabel(body?.floorLabel) || (floorNo === 0 ? "Ground" : floorNo != null ? String(floorNo) : "");
  if (!projectId) return { error: "Select the project" };
  if (Number.isNaN(blockId)) return { error: "Invalid block" };
  if (floorNo == null || Number.isNaN(floorNo) || floorNo < -10 || floorNo > 300) return { error: "Floor number must be a whole number from -10 to 300" };
  if (blockId != null) {
    const b = await pool.request().input("B", sql.Int, blockId).input("P", sql.Int, projectId)
      .query("SELECT 1 AS x FROM dbo.BlockMaster WHERE Id = @B AND ProjectId = @P AND IsActive = 1");
    if (!b.recordset.length) return { error: "That block isn't in this project" };
  }
  return { projectId, blockId, floorNo, floorLabel };
}

// Live BOQs on a floor added here: it can't be renumbered or removed while they point at it.
async function boqsOn(pool, row) {
  const r = await pool.request().input("P", sql.Int, row.ProjectId).input("B", sql.Int, row.BlockId).input("F", sql.NVarChar(20), String(row.FloorNo))
    .query(`SELECT COUNT(*) AS n FROM dbo.BOQ WHERE ProjectId = @P AND FloorNo = @F AND (@B IS NULL OR BlockId = @B)
              AND ISNULL(Status, '') NOT IN ('Rejected', 'Cancelled')`);
  return r.recordset[0].n;
}

// POST / — add a floor to the project { projectId, blockId (null = all blocks), floorNo, floorLabel }
router.post("/", authMiddleware, requirePageRight("dpr-floor-master", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const v = await validate(pool, req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const clash = await clashOf(pool, v);
    if (clash) return res.status(409).json({ error: clash });
    const ins = await pool.request().input("P", sql.Int, v.projectId).input("B", sql.Int, v.blockId).input("F", sql.Int, v.floorNo)
      .input("L", sql.NVarChar(50), v.floorLabel).input("by", sql.NVarChar(200), actorOf(req))
      .query("INSERT INTO dbo.DprFloorMaster (ProjectId, BlockId, FloorNo, FloorLabel, CreatedBy) OUTPUT INSERTED.Id AS id VALUES (@P, @B, @F, @L, @by)");
    res.status(201).json({ id: ins.recordset[0].id, message: "Floor added" });
  } catch (err) {
    console.error("[dpr-floor-master] POST error:", err.message);
    res.status(500).json({ error: "Could not add the floor" });
  }
});

// PUT /:id — rename; the number and block change only while no BOQ is on the floor.
router.put("/:id", authMiddleware, requirePageRight("dpr-floor-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const row = (await pool.request().input("Id", sql.Int, id).query("SELECT * FROM dbo.DprFloorMaster WHERE Id = @Id AND IsActive = 1")).recordset[0];
    if (!row) return res.status(404).json({ error: "Floor not found" });
    if (!projectAllowed(req.projectScope, row.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const v = await validate(pool, { ...req.body, projectId: row.ProjectId });
    if (v.error) return res.status(400).json({ error: v.error });
    const moved = v.floorNo !== row.FloorNo || (v.blockId ?? null) !== (row.BlockId ?? null);
    if (moved) {
      const n = await boqsOn(pool, row);
      if (n) return res.status(409).json({ error: `${n} BOQ${n === 1 ? " is" : "s are"} on this floor, so only its name can change` });
      const clash = await clashOf(pool, { ...v, excludeId: id });
      if (clash) return res.status(409).json({ error: clash });
    }
    await pool.request().input("Id", sql.Int, id).input("B", sql.Int, v.blockId).input("F", sql.Int, v.floorNo)
      .input("L", sql.NVarChar(50), v.floorLabel).input("by", sql.NVarChar(200), actorOf(req))
      .query("UPDATE dbo.DprFloorMaster SET BlockId = @B, FloorNo = @F, FloorLabel = @L, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @Id");
    res.json({ message: "Floor updated" });
  } catch (err) {
    console.error("[dpr-floor-master] PUT error:", err.message);
    res.status(500).json({ error: "Could not update the floor" });
  }
});

// DELETE /:id — remove a floor added here (refused while a BOQ is on it).
router.delete("/:id", authMiddleware, requirePageRight("dpr-floor-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const row = (await pool.request().input("Id", sql.Int, id).query("SELECT * FROM dbo.DprFloorMaster WHERE Id = @Id AND IsActive = 1")).recordset[0];
    if (!row) return res.status(404).json({ error: "Floor not found" });
    if (!projectAllowed(req.projectScope, row.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const n = await boqsOn(pool, row);
    if (n) return res.status(409).json({ error: `${n} BOQ${n === 1 ? " is" : "s are"} on this floor, so it can't be removed` });
    await pool.request().input("Id", sql.Int, id).input("by", sql.NVarChar(200), actorOf(req))
      .query("UPDATE dbo.DprFloorMaster SET IsActive = 0, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @Id");
    res.json({ message: "Floor removed" });
  } catch (err) {
    console.error("[dpr-floor-master] DELETE error:", err.message);
    res.status(500).json({ error: "Could not remove the floor" });
  }
});

module.exports = router;
