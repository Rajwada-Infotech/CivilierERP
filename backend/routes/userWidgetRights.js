/**
 * routes/userWidgetRights.js
 *
 * Manages widget visibility stored in dbo.UserWidgetRights (per-user) and
 * dbo.RoleWidgetRights (role baseline). Completely separate from
 * userRights.js (page/action permissions).
 *
 * Resolution order for "what can this user see": a per-user row, if one
 * exists, is the definitive answer for that user — it fully overrides the
 * role. If no per-user row exists, the role's row (if any) is used. If
 * neither exists, everything active in WidgetCatalog is shown (the
 * original all-open default, unchanged for anyone never configured).
 *
 * Routes:
 *   GET  /api/user-widget-rights/my              — logged-in user fetches own widgets
 *   GET  /api/user-widget-rights/users           — admin: list of non-admin users
 *   GET  /api/user-widget-rights/:userId         — admin: get a user's effective widget rights
 *   PUT  /api/user-widget-rights/:userId         — admin: save a user's widget rights
 *   GET  /api/user-widget-rights/role/:roleId    — admin: get a role's baseline widget rights
 *   PUT  /api/user-widget-rights/role/:roleId    — admin: save a role's baseline widget rights
 */

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");

const adminOnly = allowRoles("admin", "super_admin", "dba");

// ── All known widget keys — single source of truth ──────────────────────────
async function getActiveWidgetKeys(pool) {
  const result = await pool.request().query(`
    SELECT WidgetKey
    FROM dbo.WidgetCatalog
    WHERE IsActive = 1
    ORDER BY SortOrder ASC, Label ASC
  `);
  return result.recordset.map((row) => row.WidgetKey);
}

async function getRoleWidgetsJson(pool, roleId) {
  if (!roleId) return null;
  const result = await pool
    .request()
    .input("RoleId", sql.Int, roleId)
    .query(`SELECT WidgetsJson FROM dbo.RoleWidgetRights WHERE RoleId = @RoleId AND IsActive = 1`);
  return result.recordset[0]?.WidgetsJson ?? null;
}

// Resolution order: per-user row > role row > all active widgets.
async function resolveEffectiveWidgets(pool, userId, roleId, allWidgets) {
  const userResult = await pool
    .request()
    .input("UserId", sql.Int, userId)
    .query(`SELECT WidgetsJson FROM dbo.UserWidgetRights WHERE UserId = @UserId AND IsActive = 1`);

  const userJson = userResult.recordset[0]?.WidgetsJson;
  if (userJson) {
    try {
      const parsed = JSON.parse(userJson);
      if (Array.isArray(parsed)) return parsed.filter((w) => allWidgets.includes(w));
    } catch {}
  }

  const roleJson = await getRoleWidgetsJson(pool, roleId);
  if (roleJson) {
    try {
      const parsed = JSON.parse(roleJson);
      if (Array.isArray(parsed)) return parsed.filter((w) => allWidgets.includes(w));
    } catch {}
  }

  return allWidgets;
}

// ── GET /my — any authenticated user fetches their own allowed widgets ────────
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const allowedWidgets = await resolveEffectiveWidgets(pool, parseInt(userId), req.user?.roleId, allWidgets);

    return res.json({ allowedWidgets, allWidgets });
  } catch (err) {
    console.error("[UserWidgetRights] GET /my error:", err.message);
    return res.status(500).json({ error: "Failed to fetch widget rights" });
  }
});

// ── GET /users — admin: non-admin users for the dropdown ─────────────────────
router.get("/users", authMiddleware, adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.name, u.email, r.RName AS role
      FROM dbo.users u
      LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      WHERE u.discontinue = 0
        AND LOWER(ISNULL(r.RName, '')) NOT IN ('super_admin', 'admin', 'dba')
      ORDER BY u.name
    `);

    return res.json(result.recordset);
  } catch (err) {
    console.error("[UserWidgetRights] GET /users error:", err.message);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ── GET /role/:roleId — admin: get a role's baseline widget rights ────────────
// Must be registered before "/:userId" below — otherwise Express would
// match "/role" as a userId value and this route would never be reached.
router.get("/role/:roleId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const roleId = parseInt(req.params.roleId);
    if (!roleId || isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid roleId" });
    }

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const roleJson = await getRoleWidgetsJson(pool, roleId);

    let allowedWidgets = allWidgets; // default: all if role has no row yet
    if (roleJson) {
      try {
        const parsed = JSON.parse(roleJson);
        if (Array.isArray(parsed)) allowedWidgets = parsed.filter((w) => allWidgets.includes(w));
      } catch {}
    }

    return res.json({ allowedWidgets, allWidgets });
  } catch (err) {
    console.error("[UserWidgetRights] GET /role/:roleId error:", err.message);
    return res.status(500).json({ error: "Failed to fetch role widget rights" });
  }
});

// ── PUT /role/:roleId — admin: save a role's baseline widget rights ───────────
router.put("/role/:roleId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const roleId = parseInt(req.params.roleId);
    if (!roleId || isNaN(roleId)) {
      return res.status(400).json({ error: "Invalid roleId" });
    }

    const { allowedWidgets } = req.body;
    if (!Array.isArray(allowedWidgets)) {
      return res.status(400).json({ error: "allowedWidgets must be an array" });
    }

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const valid = allowedWidgets.filter((w) => allWidgets.includes(w));
    const jsonStr = JSON.stringify(valid);

    await pool
      .request()
      .input("RoleId", sql.Int, roleId)
      .input("WidgetsJson", sql.NVarChar(sql.MAX), jsonStr).query(`
        MERGE dbo.RoleWidgetRights AS target
        USING (SELECT @RoleId AS RoleId) AS source ON target.RoleId = source.RoleId
        WHEN MATCHED THEN
          UPDATE SET WidgetsJson = @WidgetsJson, UpdatedAt = GETDATE(), IsActive = 1
        WHEN NOT MATCHED THEN
          INSERT (RoleId, WidgetsJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (@RoleId, @WidgetsJson, 1, GETDATE(), GETDATE());
      `);

    return res.json({ success: true, allowedWidgets: valid });
  } catch (err) {
    console.error("[UserWidgetRights] PUT /role/:roleId error:", err.message);
    return res.status(500).json({ error: "Failed to save role widget rights" });
  }
});

// ── GET /:userId — admin: get a specific user's effective widget rights ───────
router.get("/:userId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const roleRow = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`SELECT RoleId FROM dbo.users WHERE id = @UserId`);
    const roleId = roleRow.recordset[0]?.RoleId ?? null;

    const allowedWidgets = await resolveEffectiveWidgets(pool, userId, roleId, allWidgets);

    return res.json({ allowedWidgets, allWidgets });
  } catch (err) {
    console.error("[UserWidgetRights] GET /:userId error:", err.message);
    return res.status(500).json({ error: "Failed to fetch widget rights" });
  }
});

// ── PUT /:userId — admin: save a user's widget rights ────────────────────────
router.put("/:userId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const { allowedWidgets } = req.body;
    if (!Array.isArray(allowedWidgets)) {
      return res.status(400).json({ error: "allowedWidgets must be an array" });
    }

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const valid = allowedWidgets.filter((w) => allWidgets.includes(w));
    const jsonStr = JSON.stringify(valid);

    await pool
      .request()
      .input("UserId", sql.Int, userId)
      .input("WidgetsJson", sql.NVarChar(sql.MAX), jsonStr).query(`
        MERGE dbo.UserWidgetRights AS target
        USING (SELECT @UserId AS UserId) AS source ON target.UserId = source.UserId
        WHEN MATCHED THEN
          UPDATE SET WidgetsJson = @WidgetsJson, UpdatedAt = GETDATE(), IsActive = 1
        WHEN NOT MATCHED THEN
          INSERT (UserId, WidgetsJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (@UserId, @WidgetsJson, 1, GETDATE(), GETDATE());
      `);

    return res.json({ success: true, allowedWidgets: valid });
  } catch (err) {
    console.error("[UserWidgetRights] PUT /:userId error:", err.message);
    return res.status(500).json({ error: "Failed to save widget rights" });
  }
});

module.exports = router;




