const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const authMiddleware = require("../middleware/auth");

const CACHE_NS = "approval-workflows";

function parseJson(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// GET /api/approval-workflows[?module=X]
router.get("/", authMiddleware, cache(CACHE_NS, 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, Name AS name, type,
             modules, LevelsJson AS levels,
             active,
             CreatedAt AS createdAt, CreatedBy AS createdBy
      FROM dbo.ApprovalWorkflows
      ORDER BY CreatedAt DESC
    `);

    let rows = result.recordset.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type || "sequential",
      modules: parseJson(r.modules),
      levels: parseJson(r.levels),
      active: !!r.active,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
    }));

    if (req.query.module) {
      rows = rows.filter((r) => r.modules.includes(req.query.module));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/approval-workflows
router.post("/", authMiddleware, async (req, res) => {
  const {
    name,
    type = "sequential",
    modules = [],
    levels = [],
    active = true,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!modules.length)
    return res.status(400).json({ error: "At least one module is required" });
  if (!levels.length)
    return res.status(400).json({ error: "At least one level is required" });

  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(255), name.trim())
      .input("type", sql.NVarChar(50), type)
      .input("modules", sql.NVarChar(sql.MAX), JSON.stringify(modules))
      .input("LevelsJson", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("CreatedBy", sql.NVarChar(100), req.user?.name || null).query(`
        INSERT INTO dbo.ApprovalWorkflows
          (Name, type, modules, LevelsJson, active, CreatedBy, CreatedAt)
        OUTPUT
          INSERTED.Id, INSERTED.Name, INSERTED.type,
          INSERTED.modules, INSERTED.LevelsJson,
          INSERTED.active, INSERTED.CreatedAt
        VALUES
          (@Name, @type, @modules, @LevelsJson, @active, @CreatedBy, SYSDATETIME())
      `);

    await bumpCacheVersion(CACHE_NS);
    const row = result.recordset[0];
    res.status(201).json({
      id: row.Id,
      name: row.Name,
      type: row.type,
      modules: parseJson(row.modules),
      levels: parseJson(row.LevelsJson),
      active: !!row.active,
      createdAt: row.CreatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/approval-workflows/:id
router.put("/:id", authMiddleware, async (req, res) => {
  const {
    name,
    type = "sequential",
    modules = [],
    levels = [],
    active,
  } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .input("Name", sql.NVarChar(255), name?.trim() || null)
      .input("type", sql.NVarChar(50), type)
      .input("modules", sql.NVarChar(sql.MAX), JSON.stringify(modules))
      .input("LevelsJson", sql.NVarChar(sql.MAX), JSON.stringify(levels))
      .input("active", sql.Bit, active ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null).query(`
        UPDATE dbo.ApprovalWorkflows SET
          Name       = @Name,
          type       = @type,
          modules    = @modules,
          LevelsJson = @LevelsJson,
          active     = @active,
          UpdatedBy  = @UpdatedBy,
          UpdatedAt  = SYSDATETIME()
        WHERE Id = @Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/approval-workflows/:id/toggle
router.patch("/:id/toggle", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .input("UpdatedBy", sql.NVarChar(100), req.user?.name || null).query(`
        UPDATE dbo.ApprovalWorkflows SET
          active    = CASE WHEN active = 1 THEN 0 ELSE 1 END,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/approval-workflows/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(req.params.id, 10))
      .query("DELETE FROM dbo.ApprovalWorkflows WHERE Id = @Id");

    await bumpCacheVersion(CACHE_NS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
