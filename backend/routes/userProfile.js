const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, getPoolStats, sql } = require("../db");
const bcrypt = require("bcrypt");
const logger = require("../logger");
const { normalizeRole } = require("../middleware/role");

const SALT_ROUNDS = 12;

function isSelfOrAdmin(req) {
  const requestedId = parseInt(req.params.id, 10);
  const callerId = req.user?.userId || req.user?.id;
  const callerRole = normalizeRole(req.user?.role);
  if (["admin", "super_admin", "dba"].includes(callerRole)) return true;
  return parseInt(callerId, 10) === requestedId;
}

// ── GET profile ──────────────────────────────────────────────────────────────
router.get("/:id/profile", async (req, res) => {
  const routeStart = req.timing?.startStage();

  const accessStart = req.timing?.startStage();
  if (!isSelfOrAdmin(req)) {
    if (accessStart) req.timing.mark("profile.access_check", accessStart);
    return res.status(403).json({ error: "Forbidden" });
  }
  if (accessStart) req.timing.mark("profile.access_check", accessStart);

  try {
    const poolStart = req.timing?.startStage();
    const pool = getPool();
    if (poolStart) req.timing.mark("profile.db_pool_get", poolStart);

    const queryStart = req.timing?.startStage();
    const poolStatsBefore = getPoolStats(pool);
    const query = `
        SELECT
          u.id,
          u.name,
          u.email,
          u.RoleId,
          u.avatar_url,
          ISNULL(u.ShowLoginReminders, 1) AS ShowLoginReminders,
          r.RName        AS roleName,
          u.created_datetime,
          u.discontinue
        FROM dbo.users u
        LEFT JOIN dbo.Role r ON u.RoleId = r.RId
        WHERE u.id = @id
      `;
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(query);
    const queryDurationMs = queryStart
      ? req.timing.mark("profile.db_query", queryStart, {
          queryHash: "userProfile.profileById.v1",
          rows: result.recordset.length,
          poolBefore: poolStatsBefore,
          poolAfter: getPoolStats(pool),
        })
      : null;

    if (queryDurationMs && queryDurationMs > 1000) {
      logger.warn(
        {
          event: "PROFILE_QUERY_SLOW",
          requestId: req.id,
          userId: req.user?.userId || req.user?.id,
          requestedUserId: req.params.id,
          durationMs: queryDurationMs,
          rows: result.recordset.length,
          poolBefore: poolStatsBefore,
          poolAfter: getPoolStats(pool),
          queryHash: "userProfile.profileById.v1",
        },
        "Slow profile query",
      );
    }

    if (!result.recordset.length)
      return res.status(404).json({ error: "User not found" });

    const row = result.recordset[0];
    const serializeStart = req.timing?.startStage();
    const payload = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: normalizeRole(row.roleName),
      roleName: row.roleName,
      roleId: row.RoleId,
      created_datetime: row.created_datetime,
      discontinue: !!row.discontinue,
      avatar_url: row.avatar_url || null,
    };
    if (serializeStart) req.timing.mark("profile.serialize", serializeStart);
    if (routeStart) req.timing.mark("profile.total", routeStart);

    res.json(payload);
  } catch (err) {
    logger.error(
      {
        event: "PROFILE_GET_ERROR",
        requestId: req.id,
        err,
        requestedUserId: req.params.id,
      },
      "GET /user-profile/:id/profile error",
    );
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

// ── PATCH preferences (login reminders popup toggle) ─────────────────────────
router.patch("/:id/preferences", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { showLoginReminders } = req.body;
  if (typeof showLoginReminders !== "boolean")
    return res.status(400).json({ error: "showLoginReminders must be a boolean" });

  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("val", sql.Bit, showLoginReminders ? 1 : 0)
      .query("UPDATE dbo.users SET ShowLoginReminders = @val WHERE id = @id");
    res.json({ message: "Preferences updated", showLoginReminders });
  } catch (err) {
    console.error("PATCH /user-profile/:id/preferences error:", err);
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
// FIX Bug #4: was querying non-existent dbo.user_page_permissions
// Repointed to dbo.UserPageRightsJson which is the actual table (migration 014)
router.get("/:id/permissions", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, req.params.id)
      .query(`
        SELECT RightsJson
        FROM dbo.UserPageRightsJson
        WHERE UserId = @id AND IsActive = 1
      `);

    const row = result.recordset[0];
    let rightsJson = [];
    try {
      rightsJson = row?.RightsJson ? JSON.parse(row.RightsJson) : [];
    } catch {
      rightsJson = [];
    }

    res.json(rightsJson);
  } catch (err) {
    console.error("GET /user-profile/:id/permissions error:", err);
    res.json([]);
  }
});

// ── GET activity log ─────────────────────────────────────────────────────────
// FIX Bug #5: was querying dbo.user_activity_log (wrong casing + wrong columns)
// Corrected to dbo.UserActivityLog with actual column names from migration 003
router.get("/:id/activity", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.NVarChar(50), String(req.params.id))
      .input("limit", sql.Int, limit).query(`
        SELECT TOP (@limit)
          Id, UserId, UserName, UserEmail, UserRole,
          EventType, ActionType, Resource,
          IpAddress, SessionId, CreatedAt
        FROM dbo.UserActivityLog
        WHERE UserId = @id
        ORDER BY CreatedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /user-profile/:id/activity error:", err);
    res.json([]);
  }
});

// ── POST upload-avatar ───────────────────────────────────────────────────────
router.post("/:id/upload-avatar", async (req, res) => {
  if (!isSelfOrAdmin(req)) return res.status(403).json({ error: "Forbidden" });

  const { avatar } = req.body;
  if (!avatar)
    return res.status(400).json({ error: "No avatar data provided" });

  if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(avatar)) {
    return res
      .status(400)
      .json({ error: "Invalid image format. Supported: JPEG, PNG, WebP, GIF" });
  }

  if (avatar.length > 550_000) {
    return res
      .status(413)
      .json({ error: "Image too large. Please use an image under 400 KB." });
  }

  try {
    const pool = getPool();
    await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("avatar_url", sql.NVarChar(sql.MAX), avatar)
      .query("UPDATE dbo.users SET avatar_url = @avatar_url WHERE id = @id");
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




