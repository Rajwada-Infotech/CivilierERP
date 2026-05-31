// backend/routes/appVersion.js
// Serves the current application version from dbo.Version.
// GET /api/app-version — returns the latest version_name for the tenant.
//
// tenant_id is read from req.user if present (auth middleware sets it),
// falling back to tenant_id = 1 so unauthenticated / single-tenant setups
// still work without breaking anything.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");

router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    // Use tenant_id from the JWT payload if available; default to 1
    const tenantId = req.user?.tenantId ?? req.user?.tenant_id ?? 1;

    const result = await pool.request().input("tenantId", sql.Int, tenantId)
      .query(`
        SELECT TOP 1
          version_name   AS version,
          created_date   AS releasedAt
        FROM dbo.Version
        WHERE tenant_id = @tenantId
        ORDER BY created_date DESC, version_id DESC
      `);

    if (!result.recordset.length) {
      // No row yet for this tenant — return a safe fallback
      return res.json({ version: "—", releasedAt: null });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

