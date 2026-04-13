const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const authMiddleware = require("../middleware/auth");

// Middleware: Admin/Super Admin/DBA only
router.use(authMiddleware);
router.use(allowRoles("admin", "super_admin", "dba"));

// ====================== HELPERS ======================
const cleanStr = (v, len = 255) => {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
};

function generateRoleCode(rName) {
  if (!rName) return null;
  const words = rName.trim().split(/\s+/).filter(w => w);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
}

// ====================== GET ALL ROLES ======================
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT RId, RName, RCode, RDesc, RCreatedBy, RCreatedAt,
             RUpdatedBy, RUpdatedAt, RApprovedBy, RApprovedAt
      FROM dbo.Role
      ORDER BY RId DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET ROLES ERROR:", err);
    res.status(500).json({ error: "Failed to fetch roles", message: err.message });
  }
});

// ====================== CREATE ROLE ======================
router.post("/", async (req, res) => {
  const { RName, RDesc } = req.body;

  if (!RName?.trim()) {
    return res.status(400).json({ error: "Role Name is required" });
  }

  try {
    const pool = getPool();
    const userId = req.user?.id || req.user?.userId || "system";
    const cleanName = RName.trim();
    const rCode = generateRoleCode(cleanName);

    // Check uniqueness
    const existing = await pool.request()
      .input("RName", sql.NVarChar(100), cleanName)
      .query("SELECT COUNT(*) as cnt FROM dbo.Role WHERE RName = @RName");
    
    if (existing.recordset[0].cnt > 0) {
      return res.status(400).json({ error: "Role Name must be unique" });
    }

    const result = await pool.request()
      .input("RName", sql.NVarChar(100), cleanName)
      .input("RCode", sql.NVarChar(20), rCode)
      .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
      .input("RCreatedBy", sql.NVarChar(50), String(userId))
      .query(`
        INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
        OUTPUT INSERTED.*
        VALUES (@RName, @RCode, @RDesc, @RCreatedBy)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    console.error("CREATE ROLE ERROR:", err);
    res.status(500).json({ error: "Failed to create role", message: err.message });
  }
});

// ====================== UPDATE ROLE ======================
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { RName, RDesc } = req.body;
  const userId = req.user?.id || req.user?.userId || "system";

  try {
    const pool = getPool();

    if (RName?.trim()) {
      const cleanName = RName.trim();
      // Check uniqueness (exclude self)
      const existing = await pool.request()
        .input("RName", sql.NVarChar(100), cleanName)
        .input("id", sql.Int, parseInt(id))
        .query("SELECT COUNT(*) as cnt FROM dbo.Role WHERE RName = @RName AND RId != @id");
      
      if (existing.recordset[0].cnt > 0) {
        return res.status(400).json({ error: "Role Name must be unique" });
      }

      const rCode = generateRoleCode(cleanName);

      await pool.request()
        .input("RId", sql.Int, parseInt(id))
        .input("RName", sql.NVarChar(100), cleanName)
        .input("RCode", sql.NVarChar(20), rCode)
        .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
        .input("RUpdatedBy", sql.NVarChar(50), String(userId))
        .query(`
          UPDATE dbo.Role SET
            RName = @RName,
            RCode = @RCode,
            RDesc = @RDesc,
            RUpdatedBy = @RUpdatedBy,
            RUpdatedAt = SYSDATETIME()
          WHERE RId = @RId
        `);
    } else if (RDesc !== undefined) {
      // Only update desc if name not provided
      await pool.request()
        .input("RId", sql.Int, parseInt(id))
        .input("RDesc", sql.NVarChar(255), cleanStr(RDesc))
        .input("RUpdatedBy", sql.NVarChar(50), String(userId))
        .query(`
          UPDATE dbo.Role SET
            RDesc = @RDesc,
            RUpdatedBy = @RUpdatedBy,
            RUpdatedAt = SYSDATETIME()
          WHERE RId = @RId
        `);
    }

    res.json({ success: true, message: "Role updated successfully" });
  } catch (err) {
    console.error("UPDATE ROLE ERROR:", err);
    res.status(500).json({ error: "Failed to update role", message: err.message });
  }
});

// ====================== DELETE ROLE ======================
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("RId", sql.Int, parseInt(req.params.id))
      .query("DELETE FROM dbo.Role WHERE RId = @RId");

    res.json({ success: true, message: "Role deleted successfully" });
  } catch (err) {
    console.error("DELETE ROLE ERROR:", err);
    res.status(500).json({ error: "Failed to delete role", message: err.message });
  }
});

module.exports = router;

