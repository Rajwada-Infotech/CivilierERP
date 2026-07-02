const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

router.get("/dropdown", async (req, res) => {
  try {
    const pool = getPool();

    const companies = await pool.request().query(`
      SELECT id, name
      FROM dbo.enterprise
      WHERE business_type = 'C' AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);

    const projects = await pool.request().query(`
      SELECT
          p.id,
          p.name,
          p.company_id,
          CAST(p.company_id AS NVARCHAR(20)) AS company_ids
        FROM dbo.enterprise p
        WHERE p.business_type = 'P' AND ISNULL(p.discontinue, 0) = 0
        ORDER BY p.name
    `);

    res.json({
      companies: companies.recordset,
      projects: projects.recordset,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Failed to fetch dropdown data" });
  }
});

module.exports = router;