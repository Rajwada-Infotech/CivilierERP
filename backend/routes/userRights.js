const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const adminOnly = allowRoles("admin", "super_admin", "dba");

// GET non-admin users for dropdown
// NOTE: role column was dropped in migration 006; now derived via RoleId → dbo.Role join
router.get("/users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.name, r.RName AS role
      FROM dbo.users u
      LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      WHERE LOWER(r.RName) NOT IN ('super_admin', 'admin', 'dba')
      ORDER BY u.name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET permissions
router.get("/:userId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("UserId", sql.Int, parseInt(req.params.userId)).query(`
        SELECT RightsJson
        FROM dbo.UserPageRightsJson
        WHERE UserId = @UserId AND IsActive = 1
      `);

    const row = result.recordset[0];
    let rightsJson = [];
    try {
      rightsJson = row?.RightsJson ? JSON.parse(row.RightsJson) : [];
    } catch (e) {}

    res.json({ rightsJson });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

// SAVE permissions
router.put("/:userId", authMiddleware, adminOnly, async (req, res) => {
  const { rightsJson } = req.body;
  if (!Array.isArray(rightsJson)) {
    return res.status(400).json({ error: "rightsJson must be an array" });
  }

  try {
    const pool = getPool();
    const jsonString = JSON.stringify(rightsJson);

    await pool
      .request()
      .input("UserId", sql.Int, parseInt(req.params.userId))
      .input("RightsJson", sql.NVarChar(sql.MAX), jsonString).query(`
        MERGE dbo.UserPageRightsJson AS target
        USING (VALUES (@UserId, @RightsJson)) AS source (UserId, RightsJson)
        ON target.UserId = source.UserId
        WHEN MATCHED THEN
          UPDATE SET RightsJson = source.RightsJson, UpdatedAt = GETDATE(), IsActive = 1
        WHEN NOT MATCHED THEN
          INSERT (UserId, RightsJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (source.UserId, source.RightsJson, 1, GETDATE(), GETDATE());
      `);

    res.json({ success: true, message: "Permissions saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save permissions" });
  }
});

module.exports = router;
