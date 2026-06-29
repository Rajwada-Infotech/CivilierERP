const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// GET /api/sa/dashboard/marketing
router.get("/marketing", requirePageRight("sa-campaigns", "view"), async (req, res) => {
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
        LEFT JOIN dbo.FollowupBookings fb
          ON fb.Id = l.BookingId
         AND ISNULL(fb.IsDeleted, 0) = 0
        WHERE l.BookingId IS NOT NULL
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

    res.json({
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
    });
  } catch (err) {
    console.error("[sa-dashboard/marketing] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sa/dashboard/sales
router.get("/sales", requirePageRight("sa-leads", "view"), async (req, res) => {
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
    const bookings = await pool.request().query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE BookingId IS NOT NULL`);

    const statusMap = {};
    statusCounts.recordset.forEach((r) => { statusMap[r.Status] = r.Cnt; });
    const classMap = {};
    classCounts.recordset.forEach((r) => { classMap[r.Classification] = r.Cnt; });

    const total = totalLeads.recordset[0].Cnt;
    const bookingCount = bookings.recordset[0].Cnt;
    const conversionPct = total > 0 ? (bookingCount / total) * 100 : 0;

    res.json({
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
    });
  } catch (err) {
    console.error("[sa-dashboard/sales] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sa/dashboard/team-lead
router.get("/team-lead", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  try {
    const pool = getPool();

    const received = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE AssignedTeamLeadId IS NOT NULL
    `);
    const assignedToSp = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.SaLead WHERE AssignedSalespersonId IS NOT NULL
    `);
    const pendingDistribution = await pool.request().query(`
      SELECT COUNT(*) AS Cnt FROM dbo.SaLead
      WHERE AssignedTeamLeadId IS NOT NULL AND AssignedSalespersonId IS NULL
    `);

    const perPerson = await pool.request().query(`
      SELECT
        u.id AS UserId, u.name AS UserName,
        COUNT(DISTINCT l.Id) AS LeadsAssigned,
        COUNT(DISTINCT c.Id) AS CallsMade,
        COUNT(DISTINCT v.Id) AS SiteVisits,
        SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS Bookings
      FROM dbo.Users u
      LEFT JOIN dbo.SaLead l ON l.AssignedSalespersonId = u.id
      LEFT JOIN dbo.SaInquiryCall c ON c.SalespersonId = u.id
      LEFT JOIN dbo.SaSiteVisit v ON v.ExecutiveId = u.id
      WHERE u.id IN (SELECT DISTINCT AssignedSalespersonId FROM dbo.SaLead WHERE AssignedSalespersonId IS NOT NULL)
      GROUP BY u.id, u.name
      ORDER BY LeadsAssigned DESC
    `);

    res.json({
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
    });
  } catch (err) {
    console.error("[sa-dashboard/team-lead] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
