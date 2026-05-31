const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

bumpCacheVersion("unit-master").catch(() => {});

// GET all units
router.get("/", cache("unit-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        u.Id,
        u.ProjectId,
        ep.name   AS ProjectName,
        u.BlockId,
        b.BlockName,
        u.UnitName,
        u.IsActive,
        u.CreatedAt,
        u.UpdatedAt
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise  ep ON ep.id = u.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  b ON b.Id  = u.BlockId
      ORDER BY ep.name, b.BlockName, u.UnitName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects dropdown (enterprise where business_type = P)
router.get("/projects", cache("unit-master-projects", 600), async (req, res) => {
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
    console.error("[unit-master] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET blocks dropdown — filtered by projectId query param
router.get("/blocks", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT Id, BlockName AS Name, ProjectId
      FROM dbo.BlockMaster
      WHERE IsActive = 1
    `;
    if (Number.isFinite(projectId) && projectId > 0) {
      request.input("ProjectId", sql.Int, projectId);
      query += ` AND ProjectId = @ProjectId`;
    }
    query += ` ORDER BY BlockName`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add unit
router.post("/", async (req, res) => {
  const { ProjectId, BlockId, UnitName, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockId, @UnitName, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("unit-master");
    res.json({ message: "Unit added successfully" });
  } catch (err) {
    console.error("[unit-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update unit
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, UnitName, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.UnitMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitName  = @UnitName,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("unit-master");
    res.json({ message: "Unit updated successfully" });
  } catch (err) {
    console.error("[unit-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Unit not found" });
    const { UnitName } = existing.recordset[0];
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.UnitMaster WHERE Id = @Id");
    await bumpCacheVersion("unit-master");
    res.json({ message: `Unit "${UnitName}" deleted successfully` });
  } catch (err) {
    console.error("[unit-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

