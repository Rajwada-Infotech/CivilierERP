const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool } = require("../db");

router.get("/dropdown", async (req, res) => {
  try {
    const pool = getPool();

    const companies = await pool.request().query(`
      SELECT id, name
      FROM dbo.enterprise
      WHERE business_type = 'C'
      ORDER BY name
    `);

    const projects = await pool.request().query(`
      SELECT
          p.id,
          p.name,
          COALESCE(p.company_id, pc.PrimaryCompanyId) AS company_id,
          pc.CompanyIds AS company_ids
        FROM dbo.enterprise p
        OUTER APPLY (
          SELECT
            MIN(x.cid) AS PrimaryCompanyId,
            STRING_AGG(CAST(x.cid AS NVARCHAR(20)), ',')
              WITHIN GROUP (ORDER BY x.cid) AS CompanyIds
          FROM (
            SELECT p.company_id AS cid WHERE p.company_id IS NOT NULL
            UNION
            SELECT pc2.CompanyId FROM dbo.ProjectCompanies pc2 WHERE pc2.ProjectId = p.id
          ) x
        ) pc
        WHERE p.business_type = 'P'
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




