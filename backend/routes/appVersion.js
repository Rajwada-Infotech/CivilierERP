// backend/routes/appVersion.js
// Serves the current application version from dbo.Version.
// GET /api/app-version — returns the latest db_version and application_version for the tenant.
//
// tenant_id is read from req.user if present (auth middleware sets it),
// falling back to tenant_id = 1 so unauthenticated / single-tenant setups
// still work without breaking anything.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");

router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const tableCheck = await pool.request().query(
      "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.Version')"
    );
    if (!tableCheck.recordset[0]) {
      return res.json({ dbVersion: "—", appVersion: "—", releasedAt: null });
    }

    // Use tenant_id from the JWT payload if available; default to 1
    const tenantId = req.user?.tenantId ?? req.user?.tenant_id ?? 1;

    const result = await pool.request().input("tenantId", sql.Int, tenantId)
      .query(`
        SELECT TOP 1
          db_version          AS dbVersion,
          application_version AS appVersion,
          created_date        AS releasedAt
        FROM dbo.Version
        WHERE tenant_id = @tenantId
        ORDER BY created_date DESC, version_id DESC
      `);

    if (!result.recordset.length) {
      return res.json({ dbVersion: "—", appVersion: "—", releasedAt: null });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
