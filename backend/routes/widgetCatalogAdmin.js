/**
 * routes/widgetCatalogAdmin.js
 *
 * Admin CRUD for dbo.WidgetCatalog.
 * Mounted at /api/widget-catalog (add to server.js ALL_ROUTES).
 *
 * Routes:
 *   GET    /api/widget-catalog          — list all widgets (incl. inactive)
 *   POST   /api/widget-catalog          — add a new widget
 *   PUT    /api/widget-catalog/:key     — update label/icon/category/desc/sortOrder
 *   PATCH  /api/widget-catalog/:key/toggle — toggle IsActive
 *   DELETE /api/widget-catalog/:key     — hard delete (only if no user rights reference it)
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const adminOnly = allowRoles("admin", "super_admin", "dba");

router.use(adminOnly);

const clean = (v, len = 255) =>
  v && String(v).trim() ? String(v).trim().slice(0, len) : null;

// ── GET / — all widgets including inactive ────────────────────────────────────
router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        WidgetKey   AS [key],
        Label       AS label,
        IconKey     AS iconKey,
        Category    AS category,
        ISNULL(Description, '') AS description,
        SortOrder   AS sortOrder,
        CAST(IsActive AS BIT) AS isActive,
        CreatedAt   AS createdAt,
        UpdatedAt   AS updatedAt
      FROM dbo.WidgetCatalog
      ORDER BY SortOrder ASC, Label ASC
    `);
    return res.json(result.recordset);
  } catch (err) {
    console.error("[WidgetCatalogAdmin] GET /:", err.message);
    return res.status(500).json({ error: "Failed to fetch widget catalog" });
  }
});

// ── POST / — add a new widget ─────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { key, label, iconKey, category, description, sortOrder = 0 } = req.body;

  const wKey  = clean(key, 100);
  const wLabel = clean(label, 100);
  const wIcon  = clean(iconKey, 50);
  const wCat   = clean(category, 50);
  const wDesc  = clean(description, 255);
  const wSort  = Number.isInteger(sortOrder) ? sortOrder : 0;

  if (!wKey)   return res.status(400).json({ error: "key is required" });
  if (!wLabel) return res.status(400).json({ error: "label is required" });
  if (!wIcon)  return res.status(400).json({ error: "iconKey is required" });
  if (!wCat)   return res.status(400).json({ error: "category is required" });

  try {
    const pool = getPool();

    const dup = await pool.request()
      .input("key", sql.NVarChar(100), wKey)
      .query(`SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = @key`);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "A widget with this key already exists" });
    }

    await pool.request()
      .input("key",         sql.NVarChar(100), wKey)
      .input("label",       sql.NVarChar(100), wLabel)
      .input("iconKey",     sql.NVarChar(50),  wIcon)
      .input("category",    sql.NVarChar(50),  wCat)
      .input("description", sql.NVarChar(255), wDesc)
      .input("sortOrder",   sql.Int,           wSort)
      .query(`
        INSERT INTO dbo.WidgetCatalog
          (WidgetKey, Label, IconKey, Category, Description, SortOrder, IsActive, CreatedAt)
        VALUES
          (@key, @label, @iconKey, @category, @description, @sortOrder, 1, SYSUTCDATETIME())
      `);

    return res.status(201).json({ success: true, key: wKey });
  } catch (err) {
    console.error("[WidgetCatalogAdmin] POST /:", err.message);
    return res.status(500).json({ error: "Failed to create widget" });
  }
});

// ── PUT /:key — update metadata ───────────────────────────────────────────────
router.put("/:key", async (req, res) => {
  const wKey = req.params.key;
  const { label, iconKey, category, description, sortOrder } = req.body;

  const wLabel = clean(label, 100);
  const wIcon  = clean(iconKey, 50);
  const wCat   = clean(category, 50);
  const wDesc  = clean(description, 255);

  if (!wLabel) return res.status(400).json({ error: "label is required" });
  if (!wIcon)  return res.status(400).json({ error: "iconKey is required" });
  if (!wCat)   return res.status(400).json({ error: "category is required" });

  try {
    const pool = getPool();

    const existing = await pool.request()
      .input("key", sql.NVarChar(100), wKey)
      .query(`SELECT 1 FROM dbo.WidgetCatalog WHERE WidgetKey = @key`);
    if (!existing.recordset.length) {
      return res.status(404).json({ error: "Widget not found" });
    }

    await pool.request()
      .input("key",         sql.NVarChar(100), wKey)
      .input("label",       sql.NVarChar(100), wLabel)
      .input("iconKey",     sql.NVarChar(50),  wIcon)
      .input("category",    sql.NVarChar(50),  wCat)
      .input("description", sql.NVarChar(255), wDesc)
      .input("sortOrder",   sql.Int,           Number.isInteger(sortOrder) ? sortOrder : 0)
      .query(`
        UPDATE dbo.WidgetCatalog SET
          Label       = @label,
          IconKey     = @iconKey,
          Category    = @category,
          Description = @description,
          SortOrder   = @sortOrder,
          UpdatedAt   = SYSUTCDATETIME()
        WHERE WidgetKey = @key
      `);

    return res.json({ success: true });
  } catch (err) {
    console.error("[WidgetCatalogAdmin] PUT /:key:", err.message);
    return res.status(500).json({ error: "Failed to update widget" });
  }
});

// ── PATCH /:key/toggle — flip IsActive ────────────────────────────────────────
router.patch("/:key/toggle", async (req, res) => {
  const wKey = req.params.key;
  try {
    const pool = getPool();

    const existing = await pool.request()
      .input("key", sql.NVarChar(100), wKey)
      .query(`SELECT IsActive FROM dbo.WidgetCatalog WHERE WidgetKey = @key`);
    if (!existing.recordset.length) {
      return res.status(404).json({ error: "Widget not found" });
    }

    const current = existing.recordset[0].IsActive;
    await pool.request()
      .input("key",      sql.NVarChar(100), wKey)
      .input("isActive", sql.Bit,           current ? 0 : 1)
      .query(`
        UPDATE dbo.WidgetCatalog SET
          IsActive  = @isActive,
          UpdatedAt = SYSUTCDATETIME()
        WHERE WidgetKey = @key
      `);

    return res.json({ success: true, isActive: !current });
  } catch (err) {
    console.error("[WidgetCatalogAdmin] PATCH /:key/toggle:", err.message);
    return res.status(500).json({ error: "Failed to toggle widget" });
  }
});

// ── DELETE /:key — hard delete, blocks if any user has this widget assigned ───
router.delete("/:key", async (req, res) => {
  const wKey = req.params.key;
  try {
    const pool = getPool();

    // Check if any user still has this widget key in their WidgetsJson
    const inUse = await pool.request()
      .input("key", sql.NVarChar(100), wKey)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.UserWidgetRights
        WHERE IsActive = 1
          AND WidgetsJson LIKE '%' + @key + '%'
      `);

    if (Number(inUse.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "Widget is still assigned to users. Deactivate it instead, or remove all user assignments first.",
      });
    }

    await pool.request()
      .input("key", sql.NVarChar(100), wKey)
      .query(`DELETE FROM dbo.WidgetCatalog WHERE WidgetKey = @key`);

    return res.json({ success: true });
  } catch (err) {
    console.error("[WidgetCatalogAdmin] DELETE /:key:", err.message);
    return res.status(500).json({ error: "Failed to delete widget" });
  }
});

module.exports = router;



