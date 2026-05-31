const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const { redisGet, redisSet } = require("../redis");

// Cache key
const CACHE_KEY = "admin_dashboard";
const CACHE_TTL = 60; // seconds

// GET /api/admin-dashboard
router.get("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
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

