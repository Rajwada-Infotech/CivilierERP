const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12;

// Helper: enforce that the requesting user can only touch their own record.
// Admins and super_admins may access any profile.
function isSelfOrAdmin(req) {
  const requestedId = parseInt(req.params.id, 10);
  const callerId = req.user?.userId || req.user?.id;
  const callerRole = req.user?.role || "";
  if (["admin", "super_admin", "dba"].includes(callerRole)) return true;
  return parseInt(callerId, 10) === requestedId;
}

// GET user profile by id
router.get("/:id/profile", async (req, res) => {
  // Fix: no ownership check existed — any authenticated user could read any other user's profile
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT id, name, email, role, created_datetime, discontinue,
               department, last_login
        FROM dbo.users
        WHERE id = @id
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "User not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH — update user profile (name only)
router.patch("/:id/profile", async (req, res) => {
  // Fix: no ownership check existed — any authenticated user could overwrite any other user's name
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

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

// POST — change own password (bcrypt verify + hash new)
router.post("/:id/change-password", async (req, res) => {
  // Fix: no ownership check — any authenticated user could change any other user's password
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res
      .status(400)
      .json({ error: "Both current and new password required" });
  if (new_password.length < 8)
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters" });
  try {
    const pool = getPool();
    // Fetch stored hash
    const check = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT password FROM dbo.users WHERE id=@id");
    if (!check.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const storedHash = check.recordset[0].password;
    const match = await bcrypt.compare(current_password, storedHash);
    if (!match)
      return res.status(401).json({ error: "Current password is incorrect" });

    // Hash and store new password
    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("new_pwd", sql.NVarChar, newHash)
      .query("UPDATE dbo.users SET password=@new_pwd WHERE id=@id");
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET user's page permissions
router.get("/:id/permissions", async (req, res) => {
  // Fix: no ownership check — any user could read any other user's permission set
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT p.page_key, p.actions
        FROM dbo.user_page_permissions p
        WHERE p.user_id = @id
      `);
    res.json(result.recordset);
  } catch (err) {
    res.json([]);
  }
});

// GET user activity log
router.get("/:id/activity", async (req, res) => {
  // Fix: no ownership check — any user could read any other user's activity log
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { limit = 50 } = req.query;
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("limit", sql.Int, parseInt(limit)).query(`
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
