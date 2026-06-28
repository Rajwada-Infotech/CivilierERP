const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

function dateRangeFilter(req, column) {
  const clauses = [];
  if (req.query.from) clauses.push(`${column} >= '${req.query.from}'`);
  if (req.query.to) clauses.push(`${column} <= '${req.query.to}'`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

// 1. Lead Source Report
router.get("/lead-source", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT p.Name AS Platform, COUNT(l.Id) AS TotalLeads,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
        SUM(CASE WHEN l.Status = 'Lost' THEN 1 ELSE 0 END) AS Lost
      FROM dbo.SaSocialMediaPlatform p
      LEFT JOIN dbo.SaLead l ON l.PlatformId = p.Id
      GROUP BY p.Name
      ORDER BY TotalLeads DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Campaign Performance Report
router.get("/campaign-performance", requirePageRight("sa-campaigns", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT c.Id, c.CampaignCode, c.Name, c.Budget, c.Status,
        COUNT(DISTINCT a.Id) AS TotalAds,
        COUNT(DISTINCT l.Id) AS TotalLeads,
        ISNULL(SUM(DISTINCT a.Spent), 0) AS CostSpent,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
        CASE WHEN COUNT(DISTINCT l.Id) > 0
          THEN CAST(SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(DISTINCT l.Id) * 100
          ELSE 0 END AS ConversionPct
      FROM dbo.SaCampaign c
      LEFT JOIN dbo.SaAd a ON a.CampaignId = c.Id
      LEFT JOIN dbo.SaLead l ON l.CampaignId = c.Id
      GROUP BY c.Id, c.CampaignCode, c.Name, c.Budget, c.Status
      ORDER BY TotalLeads DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Advertisement Performance Report
router.get("/ad-performance", requirePageRight("sa-ads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT a.Id, a.Name, a.Status, a.Budget, a.Spent, c.Name AS CampaignName,
        COUNT(l.Id) AS LeadsGenerated,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
        CASE WHEN COUNT(l.Id) > 0 THEN a.Spent / COUNT(l.Id) ELSE 0 END AS CostPerLead,
        CASE WHEN COUNT(l.Id) > 0
          THEN CAST(SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(l.Id) * 100
          ELSE 0 END AS ConversionRate
      FROM dbo.SaAd a
      LEFT JOIN dbo.SaCampaign c ON a.CampaignId = c.Id
      LEFT JOIN dbo.SaLead l ON l.AdId = a.Id
      GROUP BY a.Id, a.Name, a.Status, a.Budget, a.Spent, c.Name
      ORDER BY LeadsGenerated DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Cost Per Lead Report
router.get("/cost-per-lead", requirePageRight("sa-campaigns", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT c.Name AS CampaignName, c.CampaignCode,
        ISNULL(SUM(a.Spent), 0) AS TotalSpent,
        COUNT(l.Id) AS TotalLeads,
        CASE WHEN COUNT(l.Id) > 0 THEN ISNULL(SUM(a.Spent), 0) / COUNT(l.Id) ELSE 0 END AS CostPerLead
      FROM dbo.SaCampaign c
      LEFT JOIN dbo.SaAd a ON a.CampaignId = c.Id
      LEFT JOIN dbo.SaLead l ON l.CampaignId = c.Id
      GROUP BY c.Name, c.CampaignCode
      ORDER BY CostPerLead ASC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Sales Performance Report
router.get("/sales-performance", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS UserId, u.name AS SalespersonName,
        COUNT(DISTINCT l.Id) AS LeadsHandled,
        COUNT(DISTINCT c.Id) AS CallsMade,
        COUNT(DISTINCT v.Id) AS SiteVisits,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings
      FROM dbo.Users u
      INNER JOIN dbo.SaLead l ON l.AssignedSalespersonId = u.id
      LEFT JOIN dbo.SaInquiryCall c ON c.SalespersonId = u.id
      LEFT JOIN dbo.SaSiteVisit v ON v.ExecutiveId = u.id
      GROUP BY u.id, u.name
      ORDER BY Bookings DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Team Leader Performance Report
router.get("/team-leader-performance", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS UserId, u.name AS TeamLeadName,
        COUNT(DISTINCT l.Id) AS LeadsReceived,
        SUM(CASE WHEN l.AssignedSalespersonId IS NOT NULL THEN 1 ELSE 0 END) AS LeadsDistributed,
        SUM(CASE WHEN l.AssignedSalespersonId IS NULL THEN 1 ELSE 0 END) AS PendingDistribution,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS TeamBookings
      FROM dbo.Users u
      INNER JOIN dbo.SaLead l ON l.AssignedTeamLeadId = u.id
      GROUP BY u.id, u.name
      ORDER BY TeamBookings DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Executive Performance Report (site-visit executives)
router.get("/executive-performance", requirePageRight("sa-site-visits", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS UserId, u.name AS ExecutiveName,
        COUNT(v.Id) AS VisitsAssigned,
        SUM(CASE WHEN v.Status = 'Completed' THEN 1 ELSE 0 END) AS VisitsCompleted,
        SUM(CASE WHEN v.Status = 'Cancelled' THEN 1 ELSE 0 END) AS VisitsCancelled
      FROM dbo.Users u
      INNER JOIN dbo.SaSiteVisit v ON v.ExecutiveId = u.id
      WHERE v.IsActive = 1
      GROUP BY u.id, u.name
      ORDER BY VisitsCompleted DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Inquiry Status Report
router.get("/inquiry-status", requirePageRight("sa-inquiry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT l.Status, COUNT(*) AS Cnt
      FROM dbo.SaLead l
      WHERE l.IsActive = 1
      GROUP BY l.Status
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Site Visit Report
router.get("/site-visit", requirePageRight("sa-site-visits", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const filter = dateRangeFilter(req, "v.PreferredDate");
    const r = await pool.request().query(`
      SELECT v.Id, v.ProjectName, v.PreferredDate, v.Status, l.CustomerName, l.Mobile,
        ex.name AS ExecutiveName
      FROM dbo.SaSiteVisit v
      JOIN dbo.SaLead l ON v.LeadId = l.Id
      LEFT JOIN dbo.Users ex ON v.ExecutiveId = ex.id
      ${filter}
      ORDER BY v.PreferredDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. Booking Conversion Report
router.get("/booking-conversion", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT c.Name AS CampaignName, c.CampaignCode,
        COUNT(l.Id) AS TotalLeads,
        SUM(CASE WHEN l.Status = 'VisitScheduled' OR l.Status = 'Visited' THEN 1 ELSE 0 END) AS Visited,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Booked,
        CASE WHEN COUNT(l.Id) > 0
          THEN CAST(SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT) / COUNT(l.Id) * 100
          ELSE 0 END AS ConversionPct
      FROM dbo.SaCampaign c
      LEFT JOIN dbo.SaLead l ON l.CampaignId = c.Id
      GROUP BY c.Name, c.CampaignCode
      ORDER BY ConversionPct DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. Marketing ROI Report
router.get("/marketing-roi", requirePageRight("sa-campaigns", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT c.Name AS CampaignName, c.CampaignCode, c.Budget,
        ISNULL(SUM(a.Spent), 0) AS TotalSpent,
        COUNT(DISTINCT l.Id) AS TotalLeads,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
        CASE WHEN ISNULL(SUM(a.Spent), 0) > 0
          THEN (SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) * 100000.0 - ISNULL(SUM(a.Spent), 0)) / ISNULL(SUM(a.Spent), 0) * 100
          ELSE 0 END AS RoiPercent
      FROM dbo.SaCampaign c
      LEFT JOIN dbo.SaAd a ON a.CampaignId = c.Id
      LEFT JOIN dbo.SaLead l ON l.CampaignId = c.Id
      GROUP BY c.Name, c.CampaignCode, c.Budget
      ORDER BY RoiPercent DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;