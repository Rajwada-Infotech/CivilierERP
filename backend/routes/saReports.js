const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { isSaAdmin, isSaTeamLead, actorId, applyLeadScope } = require("../services/saAccess");

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

function dateRangeFilter(req, column) {
  // Validate date format before interpolating to prevent SQL injection
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const clauses = [];
  if (req.query.from && ISO_DATE.test(req.query.from)) clauses.push(`${column} >= '${req.query.from}'`);
  if (req.query.to && ISO_DATE.test(req.query.to)) clauses.push(`${column} <= '${req.query.to}'`);
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
      WITH ad_stats AS (
        SELECT
          a.CampaignId,
          COUNT(*) AS TotalAds,
          SUM(COALESCE(inv.InvoiceSpend, a.Spent, 0)) AS CostSpent
        FROM dbo.SaAd a
        OUTER APPLY (
          SELECT SUM(i.TotalAmount) AS InvoiceSpend
          FROM dbo.SaMarketingInvoice i
          WHERE i.AdId = a.Id
            AND i.IsActive = 1
            AND i.PaymentStatus <> 'Cancelled'
        ) inv
        GROUP BY a.CampaignId
      ),
      lead_stats AS (
        SELECT
          l.CampaignId,
          COUNT(*) AS TotalLeads,
          SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings
        FROM dbo.SaLead l
        WHERE l.IsActive = 1
        GROUP BY l.CampaignId
      )
      SELECT c.Id, c.CampaignCode, c.Name, c.Budget, c.Status,
        ISNULL(a.TotalAds, 0) AS TotalAds,
        ISNULL(l.TotalLeads, 0) AS TotalLeads,
        ISNULL(a.CostSpent, 0) AS CostSpent,
        ISNULL(l.Bookings, 0) AS Bookings,
        CASE WHEN ISNULL(l.TotalLeads, 0) > 0
          THEN CAST(ISNULL(l.Bookings, 0) AS FLOAT) / l.TotalLeads * 100
          ELSE 0 END AS ConversionPct
      FROM dbo.SaCampaign c
      LEFT JOIN ad_stats a ON a.CampaignId = c.Id
      LEFT JOIN lead_stats l ON l.CampaignId = c.Id
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
      WITH lead_stats AS (
        SELECT
          l.AdId,
          COUNT(*) AS LeadsGenerated,
          SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
          SUM(COALESCE(fb.TotalValue, fb.BookingAmount, 0)) AS RevenueGenerated
        FROM dbo.SaLead l
        LEFT JOIN dbo.FollowupBookings fb
          ON fb.Id = l.BookingId
         AND ISNULL(fb.IsDeleted, 0) = 0
        WHERE l.IsActive = 1
        GROUP BY l.AdId
      ),
      invoice_stats AS (
        SELECT AdId, SUM(TotalAmount) AS InvoiceSpend
        FROM dbo.SaMarketingInvoice
        WHERE IsActive = 1
          AND AdId IS NOT NULL
          AND PaymentStatus <> 'Cancelled'
        GROUP BY AdId
      )
      SELECT a.Id, a.Name, a.Status, a.Budget,
        COALESCE(i.InvoiceSpend, a.Spent, 0) AS Spent,
        c.Name AS CampaignName,
        ISNULL(l.LeadsGenerated, 0) AS LeadsGenerated,
        ISNULL(l.Bookings, 0) AS Bookings,
        CASE WHEN ISNULL(l.LeadsGenerated, 0) > 0
          THEN CAST(COALESCE(i.InvoiceSpend, a.Spent, 0) AS FLOAT) / l.LeadsGenerated
          ELSE 0 END AS CostPerLead,
        CASE WHEN ISNULL(l.LeadsGenerated, 0) > 0
          THEN CAST(ISNULL(l.Bookings, 0) AS FLOAT) / l.LeadsGenerated * 100
          ELSE 0 END AS ConversionRate,
        ISNULL(l.RevenueGenerated, 0) AS RevenueGenerated,
        CASE WHEN COALESCE(i.InvoiceSpend, a.Spent, 0) > 0
          THEN (ISNULL(l.RevenueGenerated, 0) - COALESCE(i.InvoiceSpend, a.Spent, 0))
            / COALESCE(i.InvoiceSpend, a.Spent, 0) * 100
          ELSE 0 END AS RoiPercent
      FROM dbo.SaAd a
      LEFT JOIN dbo.SaCampaign c ON a.CampaignId = c.Id
      LEFT JOIN lead_stats l ON l.AdId = a.Id
      LEFT JOIN invoice_stats i ON i.AdId = a.Id
      ORDER BY LeadsGenerated DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3b. Daily Ad Performance Report — day-by-day reach(leads)/cost/cost-per-lead
// per ad. "Reach" here is lead count for that day (matches how the workflow
// spec itself defines it: "DAILY REACH(LEADS)"), not a platform impressions
// metric — those require a live Google/Meta metrics pull (saAdPlatformService
// .fetchAdMetrics), which needs real provider credentials this report
// doesn't depend on. Cost is the ad's own DailySpend rate (already a
// per-day field on SaAd), applied to whichever days actually generated a
// lead — a real day with zero leads for an ad has no meaningful CPL and is
// omitted, matching every other report in this file (grouped rows, not a
// zero-filled calendar).
router.get("/daily-ad-performance", requirePageRight("sa-ads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(l.DateGenerated AS DATE)") || `WHERE l.DateGenerated >= DATEADD(DAY, -30, SYSDATETIME())`;
    const r = await pool.request().query(`
      SELECT
        CAST(l.DateGenerated AS DATE) AS ReportDate,
        a.Id AS AdId, a.Name AS AdName, c.Name AS CampaignName,
        COUNT(l.Id) AS DailyReach,
        MAX(ISNULL(a.DailySpend, 0)) AS DailyCost,
        CASE WHEN COUNT(l.Id) > 0 THEN MAX(ISNULL(a.DailySpend, 0)) / COUNT(l.Id) ELSE 0 END AS CostPerLead
      FROM dbo.SaLead l
      JOIN dbo.SaAd a ON a.Id = l.AdId
      LEFT JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
      ${where.replace("WHERE", "WHERE l.IsActive = 1 AND l.AdId IS NOT NULL AND")}
      GROUP BY CAST(l.DateGenerated AS DATE), a.Id, a.Name, c.Name
      ORDER BY ReportDate DESC, DailyReach DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Cost Per Lead Report
router.get("/cost-per-lead", requirePageRight("sa-campaigns", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      WITH campaign_spend AS (
        SELECT
          a.CampaignId,
          SUM(COALESCE(inv.InvoiceSpend, a.Spent, 0)) AS TotalSpent
        FROM dbo.SaAd a
        OUTER APPLY (
          SELECT SUM(i.TotalAmount) AS InvoiceSpend
          FROM dbo.SaMarketingInvoice i
          WHERE i.AdId = a.Id
            AND i.IsActive = 1
            AND i.PaymentStatus <> 'Cancelled'
        ) inv
        GROUP BY a.CampaignId
      ),
      campaign_leads AS (
        SELECT CampaignId, COUNT(*) AS TotalLeads
        FROM dbo.SaLead
        WHERE IsActive = 1
        GROUP BY CampaignId
      )
      SELECT c.Name AS CampaignName, c.CampaignCode,
        ISNULL(s.TotalSpent, 0) AS TotalSpent,
        ISNULL(l.TotalLeads, 0) AS TotalLeads,
        CASE WHEN ISNULL(l.TotalLeads, 0) > 0 THEN ISNULL(s.TotalSpent, 0) / l.TotalLeads ELSE 0 END AS CostPerLead
      FROM dbo.SaCampaign c
      LEFT JOIN campaign_spend s ON s.CampaignId = c.Id
      LEFT JOIN campaign_leads l ON l.CampaignId = c.Id
      ORDER BY CostPerLead ASC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Sales Performance Report
router.get("/sales-performance", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const filter = dateRangeFilter(req, "l.CreatedAt");
    const whereClause = filter ? filter.replace("WHERE ", "AND ") : "";

    const r2 = pool.request();
    let userScope = "";
    if (!isSaAdmin(req)) {
      const uid = actorId(req);
      if (!uid) return res.json([]);
      r2.input("ActorUserId", sql.Int, uid);
      if (isSaTeamLead(req)) {
        // TL sees their own salespersons only
        userScope = "AND u.id IN (SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @ActorUserId AND IsActive = 1)";
      } else {
        // salesperson sees only themselves
        userScope = "AND u.id = @ActorUserId";
      }
    }

    const r = await r2.query(`
      SELECT u.id AS UserId, u.name AS SalespersonName,
        COUNT(DISTINCT l.Id) AS LeadsHandled,
        COUNT(DISTINCT c.Id) AS CallsMade,
        COUNT(DISTINCT v.Id) AS SiteVisits,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings
      FROM dbo.Users u
      INNER JOIN dbo.SaLead l ON l.AssignedSalespersonId = u.id AND l.IsActive = 1 ${whereClause}
      LEFT JOIN dbo.SaInquiryCall c ON c.SalespersonId = u.id
      LEFT JOIN dbo.SaSiteVisit v ON v.ExecutiveId = u.id
      WHERE 1=1 ${userScope}
      GROUP BY u.id, u.name
      ORDER BY Bookings DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Team Leader Performance Report (admin + marketing_head only)
router.get("/team-leader-performance", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  // Only admins and marketing_head see all TLs; TL sees only themselves; SP sees nothing here.
  if (!isSaAdmin(req) && !isSaTeamLead(req)) return res.json([]);
  try {
    const pool = getPool();
    const filter = dateRangeFilter(req, "l.CreatedAt");
    const whereClause = filter ? filter.replace("WHERE ", "AND ") : "";

    const r2 = pool.request();
    let userScope = "";
    if (!isSaAdmin(req)) {
      const uid = actorId(req);
      if (!uid) return res.json([]);
      r2.input("ActorUserId", sql.Int, uid);
      userScope = "AND u.id = @ActorUserId";
    }

    const r = await r2.query(`
      SELECT u.id AS UserId, u.name AS TeamLeadName,
        COUNT(DISTINCT l.Id) AS LeadsReceived,
        SUM(CASE WHEN l.AssignedSalespersonId IS NOT NULL THEN 1 ELSE 0 END) AS LeadsDistributed,
        SUM(CASE WHEN l.AssignedSalespersonId IS NULL THEN 1 ELSE 0 END) AS PendingDistribution,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS TeamBookings
      FROM dbo.Users u
      INNER JOIN dbo.SaLead l ON l.AssignedTeamLeadId = u.id AND l.IsActive = 1 ${whereClause}
      WHERE 1=1 ${userScope}
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
    const filter = dateRangeFilter(req, "l.CreatedAt");
    const extra = filter ? filter.replace("WHERE ", "AND ") : "";
    const scopeReq = pool.request();
    const scopeClause = applyLeadScope(scopeReq, req, "l");
    const r = await scopeReq.query(`
      SELECT l.Status, COUNT(*) AS Cnt
      FROM dbo.SaLead l
      WHERE l.IsActive = 1 AND ${scopeClause} ${extra}
      GROUP BY l.Status
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

// 9. Site Visit Report
router.get("/site-visit", requirePageRight("sa-site-visits", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const filter = dateRangeFilter(req, "v.PreferredDate");
    const extra = filter ? filter.replace("WHERE ", "AND ") : "";
    const scopeReq = pool.request();
    const scopeClause = applyLeadScope(scopeReq, req, "l");
    const r = await scopeReq.query(`
      SELECT v.Id, v.ProjectName, v.PreferredDate, v.Status,
        ex.name AS ExecutiveName
      FROM dbo.SaSiteVisit v
      JOIN dbo.SaLead l ON v.LeadId = l.Id
      LEFT JOIN dbo.Users ex ON v.ExecutiveId = ex.id
      WHERE ${scopeClause} ${extra}
      ORDER BY v.PreferredDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
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
      WITH campaign_spend AS (
        SELECT
          a.CampaignId,
          SUM(COALESCE(inv.InvoiceSpend, a.Spent, 0)) AS TotalSpent
        FROM dbo.SaAd a
        OUTER APPLY (
          SELECT SUM(i.TotalAmount) AS InvoiceSpend
          FROM dbo.SaMarketingInvoice i
          WHERE i.AdId = a.Id
            AND i.IsActive = 1
            AND i.PaymentStatus <> 'Cancelled'
        ) inv
        GROUP BY a.CampaignId
      ),
      campaign_leads AS (
        SELECT
          l.CampaignId,
          COUNT(*) AS TotalLeads,
          SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings,
          SUM(COALESCE(fb.TotalValue, fb.BookingAmount, 0)) AS RevenueGenerated
        FROM dbo.SaLead l
        LEFT JOIN dbo.FollowupBookings fb
          ON fb.Id = l.BookingId
         AND ISNULL(fb.IsDeleted, 0) = 0
        WHERE l.IsActive = 1
        GROUP BY l.CampaignId
      )
      SELECT c.Name AS CampaignName, c.CampaignCode, c.Budget,
        ISNULL(s.TotalSpent, 0) AS TotalSpent,
        ISNULL(l.TotalLeads, 0) AS TotalLeads,
        ISNULL(l.Bookings, 0) AS Bookings,
        ISNULL(l.RevenueGenerated, 0) AS RevenueGenerated,
        CASE WHEN ISNULL(s.TotalSpent, 0) > 0
          THEN (ISNULL(l.RevenueGenerated, 0) - ISNULL(s.TotalSpent, 0)) / ISNULL(s.TotalSpent, 0) * 100
          ELSE 0 END AS RoiPercent
      FROM dbo.SaCampaign c
      LEFT JOIN campaign_spend s ON s.CampaignId = c.Id
      LEFT JOIN campaign_leads l ON l.CampaignId = c.Id
      ORDER BY RoiPercent DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
