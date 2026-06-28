const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");

bumpCacheVersion("room-master").catch(() => {});

// GET all rooms
router.get("/", cache("room-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        r.Id,
        r.ProjectId,
        ep.name   AS ProjectName,
        r.BlockId,
        b.BlockName,
        r.UnitId,
        u.UnitName,
        r.RoomName,
        r.Floor,
        r.IsActive,
        r.CreatedAt,
        r.UpdatedAt
      FROM dbo.RoomMaster r
      LEFT JOIN dbo.enterprise  ep ON ep.id = r.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  b ON b.Id  = r.BlockId
      LEFT JOIN dbo.UnitMaster   u ON u.Id  = r.UnitId
      ORDER BY ep.name, b.BlockName, u.UnitName, r.RoomName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects dropdown (enterprise where business_type = P)
router.get("/projects", cache("room-master-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET units dropdown — filtered by projectId query param.
// Each unit carries its BlockId + BlockName so the frontend can show which
// block the unit (and therefore the room) belongs to, without letting the
// user pick the block directly.
router.get("/units", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT
        u.Id,
        u.UnitName AS Name,
        u.ProjectId,
        u.BlockId,
        b.BlockName
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
      WHERE u.IsActive = 1
    `;
    if (Number.isFinite(projectId) && projectId > 0) {
      request.input("ProjectId", sql.Int, projectId);
      query += ` AND u.ProjectId = @ProjectId`;
    }
    query += ` ORDER BY u.UnitName`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-master] GET /units error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add room
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, UnitId, RoomName, Floor, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Block is never chosen by the user — derive it from the selected unit.
    const unitRow = await pool
      .request()
      .input("UnitId", sql.Int, parseInt(UnitId))
      .query("SELECT BlockId FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const BlockId = unitRow.recordset[0].BlockId;

    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockId, @UnitId, @RoomName, @Floor, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("room-master");
    res.json({ message: "Room added successfully" });
  } catch (err) {
    console.error("[room-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update room
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, UnitId, RoomName, Floor, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();

    const unitRow = await pool
      .request()
      .input("UnitId", sql.Int, parseInt(UnitId))
      .query("SELECT BlockId FROM dbo.UnitMaster WHERE Id = @UnitId");
    if (!unitRow.recordset.length)
      return res.status(400).json({ error: "Selected unit not found" });
    const BlockId = unitRow.recordset[0].BlockId;

    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId)
      .input("UnitId",    sql.Int, parseInt(UnitId))
      .input("RoomName",  sql.NVarChar(100), RoomName)
      .input("Floor",     sql.NVarChar(50), Floor || null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.RoomMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitId    = @UnitId,
          RoomName  = @RoomName,
          Floor     = @Floor,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("room-master");
    res.json({ message: "Room updated successfully" });
  } catch (err) {
    console.error("[room-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT RoomName FROM dbo.RoomMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Room not found" });
    const { RoomName } = existing.recordset[0];
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.RoomMaster WHERE Id = @Id");
    await bumpCacheVersion("room-master");
    res.json({ message: `Room "${RoomName}" deleted successfully` });
  } catch (err) {
    console.error("[room-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
