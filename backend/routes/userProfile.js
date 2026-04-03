const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET user profile by id
router.get("/:id/profile", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT id, name, email, role, created_datetime, discontinue,
               department, last_login
        FROM dbo.users
        WHERE id = @id
      `);
    if (!result.recordset.length) return res.status(404).json({ error: "User not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - update user profile (self-service: name only)
router.patch("/:id/profile", async (req, res) => {
  const { name } = req.body;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("name", sql.NVarChar, name)
      .query("UPDATE dbo.users SET name=@name WHERE id=@id");
    res.json({ message: "Profile updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - change own password
router.post("/:id/change-password", async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Both current and new password required" });
  }
  try {
    const pool = getPool();
    // Verify current password
    const check = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("pwd", sql.NVarChar, current_password)
      .query("SELECT id FROM dbo.users WHERE id=@id AND password=@pwd");
    if (!check.recordset.length) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    // Update password
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("new_pwd", sql.NVarChar, new_password)
      .query("UPDATE dbo.users SET password=@new_pwd WHERE id=@id");
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET user's page permissions
router.get("/:id/permissions", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT p.page_key, p.actions
        FROM dbo.user_page_permissions p
        WHERE p.user_id = @id
      `);
    res.json(result.recordset);
  } catch (err) {
    // Graceful fallback if table doesn't exist yet
    res.json([]);
  }
});

// GET user activity log
router.get("/:id/activity", async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("limit", sql.Int, parseInt(limit))
      .query(`
        SELECT TOP (@limit)
          id, user_id, action, module, page_key, action_time, ip_address
        FROM dbo.user_activity_log
        WHERE user_id = @id
        ORDER BY action_time DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.json([]);
  }
});

module.exports = router;
