const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");

function buildFilters(req, request, alias = "jv") {
  const { companyId, projectId, status, dateFrom, dateTo } = req.query;
  const conditions = [];

  if (companyId) {
    conditions.push(`${alias}.CompanyId = @companyId`);
    request.input("companyId", sql.Int, parseInt(companyId, 10));
  }
  if (projectId) {
    conditions.push(`${alias}.ProjectId = @projectId`);
    request.input("projectId", sql.Int, parseInt(projectId, 10));
  }
  if (status) {
    conditions.push(`${alias}.Status = @status`);
    request.input("status", sql.NVarChar(20), status);
  }
  if (dateFrom) {
    conditions.push(`${alias}.JVDate >= @dateFrom`);
    request.input("dateFrom", sql.Date, dateFrom);
  }
  if (dateTo) {
    conditions.push(`${alias}.JVDate <= @dateTo`);
    request.input("dateTo", sql.Date, dateTo);
  }
  return conditions;
}

// ── GET /summary — count + amount grouped by year, with optional filters ────
router.get("/summary", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = buildFilters(req, request);

    let query = `
      SELECT
        YEAR(jv.JVDate) AS Year,
        COUNT(*) AS JVCount,
        SUM(lines.TotalDebit) AS TotalAmount
      FROM dbo.JournalVoucher jv
      OUTER APPLY (
        SELECT SUM(DebitAmount) AS TotalDebit
        FROM dbo.JournalVoucherLines
        WHERE JVID = jv.JVID
      ) lines
    `;
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " GROUP BY YEAR(jv.JVDate) ORDER BY Year DESC";

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /list — flat filtered rows for drill-down ────────────────────────────
router.get("/list", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = buildFilters(req, request);

    let query = `
      SELECT jv.JVID, jv.JVNo, jv.JVDate, jv.Narration, jv.CompanyId, jv.ProjectId,
             jv.Status, jv.CreatedBy, jv.CreatedAt,
             (SELECT SUM(DebitAmount) FROM dbo.JournalVoucherLines WHERE JVID = jv.JVID) AS TotalAmount
      FROM dbo.JournalVoucher jv
    `;
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY jv.JVDate DESC, jv.JVID DESC";

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
