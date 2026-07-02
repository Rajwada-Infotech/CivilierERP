const { requirePageRight } = require("../middleware/requirePageRight");
const allowRoles = require("../middleware/role");
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { checkPermission } = require("../middleware/permissions");

// ─── Sanitizer ───────────────────────────────────────────────────────────────
const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

// ─── GET /options ─────────────────────────────────────────────────────────────
// Used by dropdowns in Work Orders, Purchase Orders, Material Expense Booking
router.get("/options", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        CtId    AS id,
        CtCode  AS code,
        CtName  AS name
      FROM dbo.ContractorCategoryType
      WHERE CtIsActive = 1
      ORDER BY CtName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ContractorCategory /options error:", err);
    res.status(500).json({ error: "Failed to fetch contractor categories" });
  }
});

// ─── GET / (full list with all columns — for the management table UI) ─────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        CtId        AS id,
        CtCode      AS code,
        CtName      AS name,
        CtIsActive  AS isActive,
        CtCreatedBy AS createdBy,
        CtCreatedAt AS createdAt,
        CtUpdatedBy AS updatedBy,
        CtUpdatedAt AS updatedAt
      FROM dbo.ContractorCategoryType
      ORDER BY CtName ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("ContractorCategory / error:", err);
    res.status(500).json({ error: "Failed to fetch contractor categories" });
  }
});

// ─── POST /create ─────────────────────────────────────────────────────────────
router.post("/create", authMiddleware, requirePageRight("contractor-category", "create"), async (req, res) => {
  const { code, name, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  const ctCode = cleanStr(code, 50);
  const ctName = cleanStr(name, 255);

  if (!ctCode) return res.status(400).json({ error: "Code is required" });
  if (!ctName) return res.status(400).json({ error: "Name is required" });

  try {
    const pool = await getPool();

    // Check for duplicate code
    const dup = await pool.request()
      .input("code", sql.NVarChar, ctCode)
      .query(`
        SELECT CtId FROM dbo.ContractorCategoryType
        WHERE CtCode = @code
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "A category with this code already exists" });
    }

    const result = await pool.request()
      .input("code",      sql.NVarChar,  ctCode)
      .input("name",      sql.NVarChar,  ctName)
      .input("isActive",  sql.Bit,       isActive ? 1 : 0)
      .input("createdBy", sql.NVarChar,  actor)
      .query(`
        INSERT INTO dbo.ContractorCategoryType
          (CtCode, CtName, CtIsActive, CtCreatedBy, CtCreatedAt)
        OUTPUT INSERTED.CtId AS id
        VALUES
          (@code, @name, @isActive, @createdBy, GETDATE())
      `);

    res.status(201).json({
      success: true,
      id: result.recordset[0].id,
      message: "Contractor category created successfully"
    });
  } catch (err) {
    console.error("ContractorCategory /create error:", err);
    res.status(500).json({ error: "Failed to create contractor category" });
  }
});

// ─── PUT /update/:id ──────────────────────────────────────────────────────────
router.put("/update/:id", authMiddleware, requirePageRight("contractor-category", "edit"), async (req, res) => {
  const { id } = req.params;
  const { code, name, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";

  const ctId   = parseInt(id, 10);
  const ctCode = cleanStr(code, 50);
  const ctName = cleanStr(name, 255);

  if (isNaN(ctId))  return res.status(400).json({ error: "Invalid ID" });
  if (!ctCode)      return res.status(400).json({ error: "Code is required" });
  if (!ctName)      return res.status(400).json({ error: "Name is required" });

  try {
    const pool = await getPool();

    // Check record exists
    const existing = await pool.request()
      .input("id", sql.Int, ctId)
      .query(`SELECT CtId FROM dbo.ContractorCategoryType WHERE CtId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Contractor category not found" });
    }

    // Check duplicate code (excluding self)
    const dup = await pool.request()
      .input("code", sql.NVarChar, ctCode)
      .input("id",   sql.Int,      ctId)
      .query(`
        SELECT CtId FROM dbo.ContractorCategoryType
        WHERE CtCode = @code AND CtId != @id
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "Another category with this code already exists" });
    }

    await pool.request()
      .input("id",        sql.Int,      ctId)
      .input("code",      sql.NVarChar, ctCode)
      .input("name",      sql.NVarChar, ctName)
      .input("isActive",  sql.Bit,      isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.ContractorCategoryType SET
          CtCode      = @code,
          CtName      = @name,
          CtIsActive  = @isActive,
          CtUpdatedBy = @updatedBy,
          CtUpdatedAt = GETDATE()
        WHERE CtId = @id
      `);

    res.json({ success: true, message: "Contractor category updated successfully" });
  } catch (err) {
    console.error("ContractorCategory /update error:", err);
    res.status(500).json({ error: "Failed to update contractor category" });
  }
});

// ─── DELETE /delete/:id ───────────────────────────────────────────────────────
// Soft delete — sets CtIsActive = 0, does NOT remove the row.
// Hard deleting category records breaks FK references in historical Work Orders / POs.
router.delete("/delete/:id", authMiddleware, requirePageRight("contractor-category", "delete"), async (req, res) => {
  const { id } = req.params;
  const actor = req.user?.email || req.user?.name || "system";
  const ctId  = parseInt(id, 10);

  if (isNaN(ctId)) return res.status(400).json({ error: "Invalid ID" });

  try {
    const pool = await getPool();

    const existing = await pool.request()
      .input("id", sql.Int, ctId)
      .query(`SELECT CtId FROM dbo.ContractorCategoryType WHERE CtId = @id`);
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Contractor category not found" });
    }

    await pool.request()
      .input("id",        sql.Int,      ctId)
      .input("updatedBy", sql.NVarChar, actor)
      .query(`
        UPDATE dbo.ContractorCategoryType SET
          CtIsActive  = 0,
          CtUpdatedBy = @updatedBy,
          CtUpdatedAt = GETDATE()
        WHERE CtId = @id
      `);

    res.json({ success: true, message: "Contractor category deactivated successfully" });
  } catch (err) {
    console.error("ContractorCategory /delete error:", err);
    res.status(500).json({ error: "Failed to deactivate contractor category" });
  }
});

module.exports = router;



