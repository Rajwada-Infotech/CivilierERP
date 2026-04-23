const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12;

// Role normalizer (mirrors users.js)
const normalizeRole = (role) => {
  if (!role || typeof role !== "string") return "user";
  const r = role.trim().toLowerCase();
  const roleMap = {
    sa: "super_admin",
    "super admin": "super_admin",
    superadmin: "super_admin",
    super_admin: "super_admin",
    dba: "dba",
    "db admin": "dba",
    "database admin": "dba",
    db_admin: "dba",
    admin: "admin",
    administrator: "admin",
  };
  return roleMap[r] || r.replace(/\s+/g, "_");
};

// Helper: only the user themselves, or admin/super_admin/dba, can access a profile
function isSelfOrAdmin(req) {
  const requestedId = parseInt(req.params.id, 10);
  const callerId = req.user?.userId || req.user?.id;
  const callerRole = req.user?.role || "";
  if (["admin", "super_admin", "dba"].includes(callerRole)) return true;
  return parseInt(callerId, 10) === requestedId;
}

// ── GET profile ──────────────────────────────────────────────────────────────
router.get("/:id/profile", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.RoleId,
          u.avatar_url,
          r.RName        AS roleName,
          u.created_datetime,
          u.discontinue
        FROM dbo.users u
        LEFT JOIN dbo.Role r ON u.RoleId = r.RId
        WHERE u.id = @id
      `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const row = result.recordset[0];
    res.json({
      id: row.id,
      name: row.name,
      email: row.email,
      role: normalizeRole(row.roleName),
      roleName: row.roleName,
      roleId: row.RoleId,
      created_datetime: row.created_datetime,
      discontinue: !!row.discontinue,
      avatar_url: row.avatar_url || null,
    });
  } catch (err) {
    console.error("GET /user-profile/:id/profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH profile (name only) ────────────────────────────────────────────────
router.patch("/:id/profile", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { name } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: "Name is required" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("name", sql.NVarChar, name.trim())
      .query("UPDATE dbo.users SET name = @name WHERE id = @id");
    res.json({ message: "Profile updated" });
  } catch (err) {
    console.error("PATCH /user-profile/:id/profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST change-password ─────────────────────────────────────────────────────
router.post("/:id/change-password", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res
      .status(400)
      .json({ error: "Both current and new password required" });
  if (new_password.length < 6)
    return res
      .status(400)
      .json({ error: "New password must be at least 6 characters" });

  try {
    const pool = getPool();
    const check = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT password FROM dbo.users WHERE id = @id");

    if (!check.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const match = await bcrypt.compare(
      current_password,
      check.recordset[0].password,
    );
    if (!match)
      return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("new_pwd", sql.NVarChar, newHash)
      .query("UPDATE dbo.users SET password = @new_pwd WHERE id = @id");

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("POST /user-profile/:id/change-password error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET permissions ──────────────────────────────────────────────────────────
router.get("/:id/permissions", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT page_key, actions
        FROM dbo.user_page_permissions
        WHERE user_id = @id
      `);
    res.json(result.recordset);
  } catch (err) {
    // Silently return empty — permissions table may not exist yet
    res.json([]);
  }
});

// ── GET activity log ─────────────────────────────────────────────────────────
router.get("/:id/activity", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("limit", sql.Int, limit).query(`
        SELECT TOP (@limit)
          id, user_id, action, module, page_key, action_time, ip_address
        FROM dbo.user_activity_log
        WHERE user_id = @id
        ORDER BY action_time DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    // Activity log table may not exist — return empty gracefully
    res.json([]);
  }
});

// ── POST upload-avatar ───────────────────────────────────────────────────────
// Accepts a base64-encoded data URI (image/jpeg, image/png, image/webp, image/gif)
// Max decoded size: ~400 KB (base64 string <= ~550 000 chars)
router.post("/:id/upload-avatar", async (req, res) => {
  console.log(
    "AVATAR UPLOAD HIT — id:",
    req.params.id,
    "| body keys:",
    Object.keys(req.body),
    "| avatar length:",
    req.body?.avatar?.length ?? "N/A",
  );

  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { avatar } = req.body; // expects a data URI, e.g. "data:image/jpeg;base64,..."
  if (!avatar)
    return res.status(400).json({ error: "No avatar data provided" });

  // Validate it looks like a supported data URI
  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(avatar)) {
    return res
      .status(400)
      .json({ error: "Invalid image format. Supported: JPEG, PNG, WebP, GIF" });
  }

  // Rough size guard: base64 string > 550 000 chars ≈ > ~400 KB decoded
  if (avatar.length > 550_000) {
    return res
      .status(413)
      .json({ error: "Image too large. Please use an image under 400 KB." });
  }

  try {
    const pool = getPool();
    console.log("AVATAR — pool acquired, running UPDATE...");
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("avatar_url", sql.NVarChar(sql.MAX), avatar)
      .query("UPDATE dbo.users SET avatar_url = @avatar_url WHERE id = @id");
    console.log("AVATAR — UPDATE success");
    res.json({ message: "Avatar updated", avatar_url: avatar });
  } catch (err) {
    console.error("POST /user-profile/:id/upload-avatar error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE avatar ────────────────────────────────────────────────────────────
router.delete("/:id/avatar", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("UPDATE dbo.users SET avatar_url = NULL WHERE id = @id");
    res.json({ message: "Avatar removed" });
  } catch (err) {
    console.error("DELETE /user-profile/:id/avatar error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
