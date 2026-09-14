const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// GET /options — active categories for dropdowns/composition builder,
// ordered by SortOrder so the builder and the Work Done Room dropdown both
// present them the same way.
router.get("/options", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, CategoryName AS categoryName, Alias AS alias, SortOrder AS sortOrder
      FROM dbo.RoomCategoryMaster
      WHERE IsActive = 1
      ORDER BY SortOrder ASC, Alias ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-category-master] GET /options error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET / — full list for the management UI (active + inactive)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT Id AS id, CategoryName AS categoryName, Alias AS alias, SortOrder AS sortOrder,
             IsActive AS isActive, CreatedBy AS createdBy, CreatedAt AS createdAt,
             UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
      FROM dbo.RoomCategoryMaster
      ORDER BY SortOrder ASC, Alias ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[room-category-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST / — create. CategoryName is the stable internal reference (never
// edited again once composition rows exist against it) — Alias is the only
// thing the edit screen should ever change day-to-day.
router.post("/", authMiddleware, requirePageRight("room-category-master", "create"), async (req, res) => {
  const { categoryName, alias, sortOrder = 0, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const cName = cleanStr(categoryName, 100)?.toUpperCase().replace(/\s+/g, "_");
  const cAlias = cleanStr(alias, 150);
  if (!cName) return res.status(400).json({ error: "Category Name is required" });
  if (!cAlias) return res.status(400).json({ error: "Alias is required" });

  try {
    const pool = await getPool();
    const dup = await pool.request()
      .input("name", sql.NVarChar(100), cName)
      .query(`SELECT Id FROM dbo.RoomCategoryMaster WHERE CategoryName = @name`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "A category with this name already exists" });

    const result = await pool.request()
      .input("name",      sql.NVarChar(100), cName)
      .input("alias",     sql.NVarChar(150), cAlias)
      .input("sortOrder", sql.Int,           parseInt(sortOrder, 10) || 0)
      .input("isActive",  sql.Bit,           isActive ? 1 : 0)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.RoomCategoryMaster (CategoryName, Alias, SortOrder, IsActive, CreatedBy)
        OUTPUT INSERTED.Id AS id
        VALUES (@name, @alias, @sortOrder, @isActive, @createdBy)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: "A category with this name already exists" });
    }
    console.error("[room-category-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update. Only Alias/SortOrder/IsActive are meant to change day-
// to-day — CategoryName can still be corrected here (e.g. a typo before
// anything real is linked to it), same as every other master's edit form.
router.put("/:id", authMiddleware, requirePageRight("room-category-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { categoryName, alias, sortOrder, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const cName = cleanStr(categoryName, 100)?.toUpperCase().replace(/\s+/g, "_");
  const cAlias = cleanStr(alias, 150);
  if (!cName) return res.status(400).json({ error: "Category Name is required" });
  if (!cAlias) return res.status(400).json({ error: "Alias is required" });

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT Id FROM dbo.RoomCategoryMaster WHERE Id = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Category not found" });

    const dup = await pool.request()
      .input("name", sql.NVarChar(100), cName)
      .input("id",   sql.Int,           id)
      .query(`SELECT Id FROM dbo.RoomCategoryMaster WHERE CategoryName = @name AND Id != @id`);
    if (dup.recordset.length > 0)
      return res.status(409).json({ error: "Another category with this name already exists" });

    await pool.request()
      .input("id",        sql.Int,            id)
      .input("name",      sql.NVarChar(100),  cName)
      .input("alias",     sql.NVarChar(150),  cAlias)
      .input("sortOrder", sql.Int,            parseInt(sortOrder, 10) || 0)
      .input("isActive",  sql.Bit,            isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("updatedBy", sql.NVarChar(200),  actor)
      .query(`
        UPDATE dbo.RoomCategoryMaster SET
          CategoryName = @name, Alias = @alias, SortOrder = @sortOrder, IsActive = @isActive,
          UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: "Another category with this name already exists" });
    }
    console.error("[room-category-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — soft delete only. Deactivating a category must never
// remove or orphan RoomComposition rows already saved against it — those
// stay exactly as they are, this just hides the category from new
// selections (composition builder's /options call, and the Work Done
// Room-dropdown generator, both already filter to IsActive = 1).
router.delete("/:id", authMiddleware, requirePageRight("room-category-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const existing = await pool.request().input("id", sql.Int, id)
      .query(`SELECT Id FROM dbo.RoomCategoryMaster WHERE Id = @id`);
    if (!existing.recordset.length) return res.status(404).json({ error: "Category not found" });

    await pool.request()
      .input("id",        sql.Int,           id)
      .input("updatedBy", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.RoomCategoryMaster SET IsActive = 0, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[room-category-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
