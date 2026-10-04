// backend/routes/featureAnnouncement.js
// Serves the current "New: X just launched" badge for the Login page —
// GET /api/feature-announcement returns the latest dbo.FeatureAnnouncement
// row, but only while it's within the auto-hide window, so the badge
// disappears on its own instead of lingering forever if nobody clears it.
//
// Public (no auth) — same reasoning as appVersion.js: shown pre-login, and
// the announcement text itself is not sensitive.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

// A "new feature" badge older than this stops being genuinely new — auto-
// hides rather than requiring someone to remember to clear it.
const AUTO_HIDE_DAYS = 30;

router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const tableCheck = await pool.request().query(
      "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.FeatureAnnouncement')"
    );
    if (!tableCheck.recordset[0]) {
      return res.json({ title: null, launchedAt: null });
    }

    const result = await pool.request().input("days", sql.Int, AUTO_HIDE_DAYS).query(`
      SELECT TOP 1 Title AS title, LaunchedAt AS launchedAt
      FROM dbo.FeatureAnnouncement
      WHERE LaunchedAt >= DATEADD(day, -@days, SYSDATETIME())
      ORDER BY LaunchedAt DESC, AnnouncementId DESC
    `);

    if (!result.recordset.length) {
      return res.json({ title: null, launchedAt: null });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
