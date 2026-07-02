/**
 * routes/userWidgetRights.js
 *
 * Manages per-user widget visibility stored in dbo.UserWidgetRights.
 * Completely separate from userRights.js (page/action permissions).
 *
 * Routes:
 *   GET  /api/user-widget-rights/my           — logged-in user fetches own widgets
 *   GET  /api/user-widget-rights/users        — admin: list of non-admin users
 *   GET  /api/user-widget-rights/:userId      — admin: get a user's widget rights
 *   PUT  /api/user-widget-rights/:userId      — admin: save a user's widget rights
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

// ── GET /my — any authenticated user fetches their own allowed widgets ────────
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const result = await pool
      .request()
      .input("UserId", sql.Int, parseInt(userId))
      .query(
        `SELECT WidgetsJson FROM dbo.UserWidgetRights
         WHERE UserId = @UserId AND IsActive = 1`
      );

    const row = result.recordset[0];

    let allowedWidgets = allWidgets; // default: all enabled
    if (row?.WidgetsJson) {
      try {
        const parsed = JSON.parse(row.WidgetsJson);
        if (Array.isArray(parsed)) {
          allowedWidgets = parsed.filter((w) => allWidgets.includes(w));
        }
      } catch {}
    }

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

// ── GET /:userId — admin: get a specific user's widget rights ─────────────────
router.get("/:userId", authMiddleware, adminOnly, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const pool = getPool();
    const allWidgets = await getActiveWidgetKeys(pool);
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(
        `SELECT WidgetsJson FROM dbo.UserWidgetRights
         WHERE UserId = @UserId AND IsActive = 1`
      );

    const row = result.recordset[0];

    let allowedWidgets = allWidgets; // default: all if no record exists
    if (row?.WidgetsJson) {
      try {
        const parsed = JSON.parse(row.WidgetsJson);
        if (Array.isArray(parsed)) {
          allowedWidgets = parsed.filter((w) => allWidgets.includes(w));
        }
      } catch {}
    }

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




