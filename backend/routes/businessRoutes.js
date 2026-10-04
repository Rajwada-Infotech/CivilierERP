const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");

router.use(authMiddleware);
router.use(apiRateLimit);

router.get("/dropdown", async (req, res) => {
  try {
    const pool = getPool();

    const companies = await pool.request().query(`
      SELECT id, name
      FROM dbo.enterprise
      WHERE business_type = 'C' AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);

    // company_ids includes the project's primary company plus every company
    // it's tagged to via dbo.ProjectCompanies (migration 451) — a project
    // can be authorized to transact against more than one company without
    // changing which company actually owns it. Was previously just the
    // single company_id re-cast to text; CrmCompanyProjectBlockFilter now
    // checks membership in this list rather than exact equality.
    const projects = await pool.request().query(`
      SELECT
          p.id,
          p.name,
          p.company_id,
          CONCAT(
            CAST(p.company_id AS NVARCHAR(20)),
            ISNULL(',' + (SELECT STRING_AGG(CAST(pc.CompanyId AS NVARCHAR(20)), ',')
                          FROM dbo.ProjectCompanies pc WHERE pc.ProjectId = p.id), '')
          ) AS company_ids
        FROM dbo.enterprise p
        WHERE p.business_type = 'P' AND ISNULL(p.discontinue, 0) = 0
        ORDER BY p.name
    `);

    res.json({
      companies: companies.recordset,
      projects: projects.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch dropdown data" });
  }
});

module.exports = router;