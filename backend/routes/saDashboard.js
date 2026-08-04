const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

// Simple in-memory cache: { key: { data, expiresAt } }
const _cache = {};
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function cacheGet(key) {
  const entry = _cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete _cache[key]; return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache[key] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
}

// GET /api/sa/dashboard/marketing
router.get("/marketing", requirePageRight("sa-campaigns", "view"), async (req, res) => {
  const cached = cacheGet("dashboard:marketing");
  if (cached) return res.json(cached);
  try {
    const pool = getPool();

    const totals = await pool.request().query(`
      WITH ad_spend AS (
        SELECT SUM(COALESCE(inv.InvoiceSpend, a.Spent, 0)) AS MarketingSpend
        FROM dbo.SaAd a
        OUTER APPLY (
          SELECT SUM(i.TotalAmount) AS InvoiceSpend
          FROM dbo.SaMarketingInvoice i
          WHERE i.AdId = a.Id
            AND i.IsActive = 1
            AND i.PaymentStatus <> 'Cancelled'
        ) inv
      ),
      booking_revenue AS (
        SELECT
          COUNT(*) AS BookingCount,
          SUM(COALESCE(fb.TotalValue, fb.BookingAmount, 0)) AS RevenueGenerated
        FROM dbo.SaLead l
        LEFT JOIN dbo.CrmBooking fb
          ON fb.Id = l.CrmBookingId
         AND ISNULL(fb.IsActive, 1) = 1
        WHERE l.CrmBookingId IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*) FROM dbo.SaCampaign WHERE IsActive = 1) AS TotalCampaigns,
        (SELECT COUNT(*) FROM dbo.SaAd WHERE IsActive = 1 AND Status = 'Active') AS ActiveAds,
        (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1) AS TotalLeads,
        ISNULL((SELECT MarketingSpend FROM ad_spend), 0) AS MarketingSpend,
        (SELECT ISNULL(SUM(TotalAmount), 0) FROM dbo.SaMarketingInvoice WHERE IsActive = 1 AND PaymentStatus = 'Paid') AS InvoicedPaid,
        ISNULL((SELECT BookingCount FROM booking_revenue), 0) AS BookingCount,
        ISNULL((SELECT RevenueGenerated FROM booking_revenue), 0) AS RevenueGenerated
    `);

    const t = totals.recordset[0];
    const costPerLead = t.TotalLeads > 0 ? (t.MarketingSpend / t.TotalLeads) : 0;
    const roi = t.MarketingSpend > 0 ? ((t.RevenueGenerated - t.MarketingSpend) / t.MarketingSpend) * 100 : 0;

    const bestCampaign = await pool.request().query(`
      SELECT TOP 1 c.Id, c.Name, c.CampaignCode, COUNT(l.Id) AS LeadCount
      FROM dbo.SaCampaign c
      LEFT JOIN dbo.SaLead l ON l.CampaignId = c.Id AND l.IsActive = 1
      WHERE c.IsActive = 1
      GROUP BY c.Id, c.Name, c.CampaignCode
      ORDER BY COUNT(l.Id) DESC
    `);

    const bestAd = await pool.request().query(`
      SELECT TOP 1 a.Id, a.Name, COUNT(l.Id) AS LeadCount
      FROM dbo.SaAd a
      LEFT JOIN dbo.SaLead l ON l.AdId = a.Id AND l.IsActive = 1
      WHERE a.IsActive = 1
      GROUP BY a.Id, a.Name
      ORDER BY COUNT(l.Id) DESC
    `);

    const payload = {
      totalCampaigns: t.TotalCampaigns,
      activeAds: t.ActiveAds,
      totalLeads: t.TotalLeads,
      marketingSpend: t.MarketingSpend,
      costPerLead: Math.round(costPerLead * 100) / 100,
      invoicedPaid: t.InvoicedPaid,
      revenueGenerated: t.RevenueGenerated,
      roi: Math.round(roi * 100) / 100,
      bookingsGenerated: t.BookingCount,
      bestCampaign: bestCampaign.recordset[0] || null,
      bestAd: bestAd.recordset[0] || null,
    };
    cacheSet("dashboard:marketing", payload);
    res.json(payload);
  } catch (err) {
    console.error("[sa-dashboard/marketing] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sa/dashboard/sales
router.get("/sales", requirePageRight("sa-leads", "view"), async (req, res) => {
  const cached = cacheGet("dashboard:sales");
  if (cached) return res.json(cached);
  try {
    const pool = getPool();

    const statusCounts = await pool.request().query(`
      SELECT Status, COUNT(*) AS Cnt
      FROM dbo.SaLead
      WHERE IsActive = 1
      GROUP BY Status
    `);

    const classCounts = await pool.request().query(`
      SELECT Classification, COUNT(*) AS Cnt
      FROM dbo.SaLead
      WHERE IsActive = 1 AND Classification IS NOT NULL
      GROUP BY Classification
    `);

    const visits = await pool.request().query(`
      SELECT
        SUM(CASE WHEN Status IN ('Scheduled','Confirmed','Rescheduled') THEN 1 ELSE 0 END) AS Scheduled,
        SUM(CASE WHEN Status = 'Completed' THEN 1 ELSE 0 END) AS Completed
      FROM dbo.SaSiteVisit
      WHERE IsActive = 1
    `);

    const totalLeads = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE IsActive = 1`);
    const bookings = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE CrmBookingId IS NOT NULL`);

    const statusMap = {};
    statusCounts.recordset.forEach((r) => { statusMap[r.Status] = r.Cnt; });
    const classMap = {};
    classCounts.recordset.forEach((r) => { classMap[r.Classification] = r.Cnt; });

    const total = totalLeads.recordset[0].Cnt;
    const bookingCount = bookings.recordset[0].Cnt;
    const conversionPct = total > 0 ? (bookingCount / total) * 100 : 0;

    const salesPayload = {
      totalLeads: total,
      pendingLeads: statusMap["New"] || 0,
      assignedLeads: statusMap["Assigned"] || 0,
      contactedLeads: statusMap["Contacted"] || 0,
      hotLeads: classMap["Hot"] || 0,
      warmLeads: classMap["Warm"] || 0,
      coldLeads: classMap["Cold"] || 0,
      siteVisitsScheduled: visits.recordset[0].Scheduled || 0,
      siteVisitsCompleted: visits.recordset[0].Completed || 0,
      bookingsGenerated: bookingCount,
      conversionPercentage: Math.round(conversionPct * 100) / 100,
    };
    cacheSet("dashboard:sales", salesPayload);
    res.json(salesPayload);
  } catch (err) {
    console.error("[sa-dashboard/sales] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sa/dashboard/team-lead
router.get("/team-lead", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  const actorUserId = req.user?.userId;
  const actorRole   = req.user?.role;
  const isSP = actorRole === "sales_person";
  const isTL = actorRole === "sales_team_lead";
  const cached = cacheGet(`dashboard:team-lead:${actorUserId}`);
  if (cached) return res.json(cached);
  try {
    const pool   = getPool();
    const userId = actorUserId ? parseInt(actorUserId) : null;

    // Helper: build a parameterised request with ActorUserId pre-bound when needed.
    const makeReq = () => {
      const r = pool.request();
      if (userId && (isSP || isTL)) r.input("ActorUserId", sql.Int, userId);
      return r;
    };

    // SP scope: own leads only. TL scope: leads assigned to this TL. Admin: all.
    const scopeClause = isSP
      ? "AND AssignedSalespersonId = @ActorUserId"
      : isTL
        ? "AND AssignedTeamLeadId = @ActorUserId"
        : "";

    const received           = await makeReq().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE AssignedTeamLeadId IS NOT NULL ${scopeClause}`);
    const assignedToSp       = await makeReq().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE AssignedSalespersonId IS NOT NULL ${scopeClause}`);
    const pendingDistribution = await makeReq().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE AssignedTeamLeadId IS NOT NULL AND AssignedSalespersonId IS NULL ${scopeClause}`);

    // Per-salesperson performance: TL sees only their own team members.
    const spFilter = isSP
      ? "AND u.id = @ActorUserId"
      : isTL
        ? "AND EXISTS (SELECT 1 FROM dbo.SaSalesTeam st WHERE st.TeamLeadUserId = @ActorUserId AND st.MemberUserId = u.id AND st.IsActive = 1)"
        : "";

    const perPerson = await makeReq().query(`
      SELECT
        u.id AS UserId, u.name AS UserName,
        COUNT(DISTINCT l.Id) AS LeadsAssigned,
        COUNT(DISTINCT c.Id) AS CallsMade,
        COUNT(DISTINCT v.Id) AS SiteVisits,
        SUM(CASE WHEN l.CrmBookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings
      FROM dbo.Users u
      LEFT JOIN dbo.SaLead l ON l.AssignedSalespersonId = u.id
      LEFT JOIN dbo.SaInquiryCall c ON c.SalespersonId = u.id
      LEFT JOIN dbo.SaSiteVisit v ON v.ExecutiveId = u.id
      WHERE u.id IN (SELECT DISTINCT AssignedSalespersonId FROM dbo.SaLead WHERE AssignedSalespersonId IS NOT NULL)
        ${spFilter}
      GROUP BY u.id, u.name
      ORDER BY LeadsAssigned DESC
    `);

    const tlPayload = {
      leadsReceived: received.recordset[0].Cnt,
      leadsAssigned: assignedToSp.recordset[0].Cnt,
      pendingDistribution: pendingDistribution.recordset[0].Cnt,
      salespersonPerformance: perPerson.recordset.map((r) => ({
        userId: r.UserId,
        userName: r.UserName,
        leadsAssigned: r.LeadsAssigned,
        callsMade: r.CallsMade,
        siteVisits: r.SiteVisits,
        bookings: r.Bookings,
        conversionRate: r.LeadsAssigned > 0 ? Math.round((r.Bookings / r.LeadsAssigned) * 10000) / 100 : 0,
      })),
    };
    cacheSet(`dashboard:team-lead:${actorUserId}`, tlPayload);
    res.json(tlPayload);
  } catch (err) {
    console.error("[sa-dashboard/team-lead] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /trends — monthly lead counts for the last 6 completed months + current
router.get("/trends", async (req, res) => {
  const cached = cacheGet("dashboard:trends");
  if (cached) return res.json(cached);
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        FORMAT(CAST(ISNULL(DateGenerated, CreatedAt) AS DATE), 'yyyy-MM') AS Month,
        COUNT(*) AS LeadCount
      FROM dbo.SaLead
      WHERE IsActive = 1
        AND CAST(ISNULL(DateGenerated, CreatedAt) AS DATE)
            >= DATEFROMPARTS(YEAR(DATEADD(MONTH, -5, SYSDATETIME())), MONTH(DATEADD(MONTH, -5, SYSDATETIME())), 1)
      GROUP BY FORMAT(CAST(ISNULL(DateGenerated, CreatedAt) AS DATE), 'yyyy-MM')
      ORDER BY Month
    `);
    const data = result.recordset.map((r) => ({ month: r.Month, count: r.LeadCount }));
    cacheSet("dashboard:trends", data);
    res.json(data);
  } catch (err) {
    console.error("[sa-dashboard/trends] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;