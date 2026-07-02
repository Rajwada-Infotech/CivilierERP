const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─── Sanitizer ───────────────────────────────────────────────────────────────
const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// ─── GET /options ─────────────────────────────────────────────────────────────
// Used by dropdowns elsewhere in the app (active only)
router.get("/options", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        DpId    AS id,
        DpCode  AS code,
        DpName  AS name
      FROM dbo.DependencyType
      WHERE DpIsActive = 1
      ORDER BY DpName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Dependency /options error:", err);
    res.status(500).json({ error: "Failed to fetch dependencies" });
  }
});

// ─── GET / (full list with all columns — for the management table UI) ─────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        DpId        AS id,
        DpCode      AS code,
        DpName      AS name,
        DpIsActive  AS isActive,
        DpCreatedBy AS createdBy,
        DpCreatedAt AS createdAt,
        DpUpdatedBy AS updatedBy,
        DpUpdatedAt AS updatedAt
      FROM dbo.DependencyType
      ORDER BY DpName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("Dependency / error:", err);
    res.status(500).json({ error: "Failed to fetch dependencies" });
  }
});

// ─── POST /create ─────────────────────────────────────────────────────────────
router.post("/create", authMiddleware, requirePageRight("dependency-master", "create"), async (req, res) => {
  const { code, name, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  const dpCode = cleanStr(code, 50);
  const dpName = cleanStr(name, 255);

  if (!dpCode) return res.status(400).json({ error: "Code is required" });
  if (!dpName) return res.status(400).json({ error: "Name is required" });

  try {
    const pool = await getPool();

    // Check for duplicate code
    const dup = await pool.request()
      .input("code", sql.NVarChar, dpCode)
      .query(`
        SELECT DpId FROM dbo.DependencyType
        WHERE DpCode = @code
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "A dependency with this code already exists" });
    }

    const result = await pool.request()
      .input("code",      sql.NVarChar,  dpCode)
      .input("name",      sql.NVarChar,  dpName)
      .input("isActive",  sql.Bit,       isActive ? 1 : 0)
      .input("createdBy", sql.NVarChar,  actor)
      .query(`
        INSERT INTO dbo.DependencyType
          (DpCode, DpName, DpIsActive, DpCreatedBy, DpCreatedAt)
        OUTPUT INSERTED.DpId AS id
        VALUES
          (@code, @name, @isActive, @createdBy, GETDATE())
      `);

    res.status(201).json({
      success: true,
      id: result.recordset[0].id,
      message: "Dependency created successfully"
    });
  } catch (err) {
    console.error("Dependency /create error:", err);
    res.status(500).json({ error: "Failed to create dependency" });
  }
});

// ─── PUT /update/:id ──────────────────────────────────────────────────────────
router.put("/update/:id", authMiddleware, requirePageRight("dependency-master", "edit"), async (req, res) => {
  const { id } = req.params;
  const { code, name, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  const dpId   = parseInt(id, 10);
  const dpCode = cleanStr(code, 50);
  const dpName = cleanStr(name, 255);

  if (isNaN(dpId))  return res.status(400).json({ error: "Invalid ID" });
  if (!dpCode)      return res.status(400).json({ error: "Code is required" });
  if (!dpName)      return res.status(400).json({ error: "Name is required" });

  try {
    const pool = await getPool();

    // Check record exists
    const existing = await pool.request()
      .input("id", sql.Int, dpId)
      .query(`SELECT DpId FROM dbo.DependencyType WHERE DpId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Dependency not found" });
    }

    // Check duplicate code (excluding self)
    const dup = await pool.request()
      .input("code", sql.NVarChar, dpCode)
      .input("id",   sql.Int,      dpId)
      .query(`
        SELECT DpId FROM dbo.DependencyType
        WHERE DpCode = @code AND DpId != @id
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "Another dependency with this code already exists" });
    }

    await pool.request()
      .input("id",        sql.Int,      dpId)
      .input("code",      sql.NVarChar, dpCode)
      .input("name",      sql.NVarChar, dpName)
      .input("isActive",  sql.Bit,      isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.DependencyType SET
          DpCode      = @code,
          DpName      = @name,
          DpIsActive  = @isActive,
          DpUpdatedBy = @updatedBy,
          DpUpdatedAt = GETDATE()
        WHERE DpId = @id
      `);

    res.json({ success: true, message: "Dependency updated successfully" });
  } catch (err) {
    console.error("Dependency /update error:", err);
    res.status(500).json({ error: "Failed to update dependency" });
  }
});

// ─── DELETE /delete/:id ───────────────────────────────────────────────────────
// Soft delete — sets DpIsActive = 0, does NOT remove the row.
// Hard deleting dependency records would break FK references in historical
// records that reference this master, the same reasoning used for
// Contractor Category.
router.delete("/delete/:id", authMiddleware, requirePageRight("dependency-master", "delete"), async (req, res) => {
  const { id } = req.params;
  const actor = req.user?.email || req.user?.name || "system";
  const dpId  = parseInt(id, 10);

  if (isNaN(dpId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input("id", sql.Int, dpId)
      .query(`SELECT DpId FROM dbo.DependencyType WHERE DpId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Dependency not found" });
    }

    await pool.request()
      .input("id",        sql.Int,      dpId)
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.DependencyType SET
          DpIsActive  = 0,
          DpUpdatedBy = @updatedBy,
          DpUpdatedAt = GETDATE()
        WHERE DpId = @id
      `);

    res.json({ success: true, message: "Dependency deactivated successfully" });
  } catch (err) {
    console.error("Dependency /delete error:", err);
    res.status(500).json({ error: "Failed to deactivate dependency" });
  }
});

module.exports = router;
