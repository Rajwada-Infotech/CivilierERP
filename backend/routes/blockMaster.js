const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { validateBody } = require("../middleware/validateBody");
const { blockBodySchema } = require("../validation/masterDataSchemas");

bumpCacheVersion("block-master").catch(() => {});

// GET all blocks
router.get("/", cache("block-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id,
        b.ProjectId,
        e.name  AS ProjectName,
        b.BlockName,
        b.IsActive,
        b.CreatedAt,
        b.UpdatedAt
      FROM dbo.BlockMaster b
      LEFT JOIN dbo.enterprise e
        ON e.id = b.ProjectId AND e.business_type = 'P'
      ORDER BY e.name, b.BlockName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[block-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects for dropdown (enterprise where business_type = P)
router.get(
  "/projects",
  cache("block-master-projects", 600),
  async (req, res) => {
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
      console.error("[block-master] GET /projects error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST — add block
router.post("/", validateBody(blockBodySchema), async (req, res) => {
  const { ProjectId, BlockName, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockName, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("block-master");
    res.json({ message: "Block added successfully" });
  } catch (err) {
    console.error("[block-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update block
router.put("/:id", validateBody(blockBodySchema), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockName, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.BlockMaster SET
          ProjectId = @ProjectId,
          BlockName = @BlockName,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("block-master");
    res.json({ message: "Block updated successfully" });
  } catch (err) {
    console.error("[block-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — safe delete
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT BlockName FROM dbo.BlockMaster WHERE Id = @Id");

    if (!existing.recordset.length)
      return res.status(404).json({ error: "Block not found" });

    const { BlockName } = existing.recordset[0];

    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.BlockMaster WHERE Id = @Id");

    await bumpCacheVersion("block-master");
    res.json({ message: `Block "${BlockName}" deleted successfully` });
  } catch (err) {
    console.error("[block-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;