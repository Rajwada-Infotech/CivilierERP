const express = require("express");
const router = express.Router();
const rateLimit = require("../middleware/rateLimiter");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { redisGet, redisSet } = require("../redis");

// Cache key
const CACHE_KEY = "admin_dashboard";
const CACHE_TTL = 60; // seconds

// Control Center totals: admin-tier roles always, and any other role that has the "Admin Dashboard" page ticked in
// Menu Rights. The page itself opens for those roles (Admin pages follow Menu Rights), so the data behind it has to
// answer them too - it used to refuse with 403 and the page showed "Failed to load dashboard data". Read-only totals
// and the five newest users, nothing that changes anything.
const ADMIN_TIER = new Set(["admin", "super_admin", "dba"]);
const canViewAdminDashboard = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (ADMIN_TIER.has(role)) return next();
  return requirePageRight("admin-dashboard", "view")(req, res, next);
};

// GET /api/admin-dashboard
router.get("/", canViewAdminDashboard, async (req, res) => {
  try {
    // 1. Try cache first
    try {
      const cached = await redisGet(CACHE_KEY);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (cacheErr) {
      console.warn("Redis read failed:", cacheErr.message);
    }

    // 2. DB connection
    const pool = getPool();

    // 3. Run queries in parallel
    const [usersResult, rolesResult, activeUsersResult, recentUsersResult] =
      await Promise.all([
        pool.request().query(`
          SELECT COUNT(*) AS totalUsers
          FROM dbo.users
        `),

        pool.request().query(`
          SELECT COUNT(*) AS totalRoles
          FROM dbo.Role
        `),

        pool.request().query(`
          SELECT COUNT(*) AS activeUsers
          FROM dbo.users
          WHERE discontinue = 0
        `),

        pool.request().query(`
          SELECT TOP 5 id, name, email, created_datetime, discontinue
          FROM dbo.users
          ORDER BY created_datetime DESC
        `),
      ]);

    // 4. Build response
    const response = {
      success: true,
      stats: {
        totalUsers: usersResult.recordset[0]?.totalUsers || 0,
        totalRoles: rolesResult.recordset[0]?.totalRoles || 0,
        activeUsers: activeUsersResult.recordset[0]?.activeUsers || 0,
      },
      recentUsers: recentUsersResult.recordset || [],
      timestamp: new Date().toISOString(),
    };

    // 5. Cache response (non-blocking)
    try {
      await redisSet(CACHE_KEY, JSON.stringify(response), CACHE_TTL);
    } catch (cacheErr) {
      console.warn("Redis write failed:", cacheErr.message);
    }

    // 6. Send response
    res.json(response);
  } catch (err) {
    console.error("Admin Dashboard Error:", err.message, err.stack);

    res.status(500).json({
      success: false,
      message: "Failed to load admin dashboard",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

module.exports = router;




