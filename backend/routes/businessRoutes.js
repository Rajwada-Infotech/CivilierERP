const express = require("express");
const router = express.Router();
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
      SELECT id, name
      FROM dbo.enterprise
      WHERE business_type = 'P'
      ORDER BY name
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
