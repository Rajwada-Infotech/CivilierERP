const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const rateLimit = require("express-rate-limit");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
router.use(authMiddleware);

const PERMISSION_MODULE = "SalesAutomation";
const PERMISSION_SUBMODULE = "Ads";

bumpCacheVersion("sa-ads").catch(() => {});

// GET /
router.get(
  "/",
  requirePageRight("sa-ads", "view"),
  cache("sa-ads", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const campaignId = parseInt(req.query.campaignId, 10);

      const r = pool.request();
      let where = "1=1";
      if (Number.isFinite(campaignId) && campaignId > 0) {
        where = "a.CampaignId = @CampaignId";
        r.input("CampaignId", sql.Int, campaignId);
      }

      const result = await r.query(`
        WITH lead_stats AS (
          SELECT
            l.AdId,
            COUNT(*) AS TotalLeadsGenerated,
            SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS BookingCount,
            SUM(COALESCE(fb.TotalValue, fb.BookingAmount, 0)) AS RevenueGenerated
          FROM dbo.SaLead l
          LEFT JOIN dbo.FollowupBookings fb
            ON fb.Id = l.BookingId
           AND ISNULL(fb.IsDeleted, 0) = 0
          WHERE l.IsActive = 1
          GROUP BY l.AdId
        ),
        invoice_stats AS (
          SELECT
            i.AdId,
            COUNT(*) AS InvoiceCount,
            SUM(i.TotalAmount) AS InvoiceSpend
          FROM dbo.SaMarketingInvoice i
          WHERE i.IsActive = 1
            AND i.AdId IS NOT NULL
            AND i.PaymentStatus <> 'Cancelled'
          GROUP BY i.AdId
        )
        SELECT
          a.Id,
          a.CampaignId,
          c.Name AS CampaignName,
          a.Name,
          a.CreativeRef,
          a.AdType,
          a.Budget,
          a.DailySpend,
          a.Spent,
          a.Status,
          a.RunningSince,
          a.IsActive,
          a.CreatedAt,
          a.UpdatedAt,
          ISNULL(ls.TotalLeadsGenerated, 0) AS TotalLeadsGenerated,
          CASE
            WHEN ISNULL(ls.TotalLeadsGenerated, 0) > 0
              THEN CAST(COALESCE(inv.InvoiceSpend, a.Spent, 0) AS FLOAT) / ls.TotalLeadsGenerated
            ELSE 0
          END AS CostPerLead,
          CASE
            WHEN ISNULL(ls.TotalLeadsGenerated, 0) > 0
              THEN CAST(ISNULL(ls.BookingCount, 0) AS FLOAT) / ls.TotalLeadsGenerated * 100
            ELSE 0
          END AS ConversionRate,
          ISNULL(ls.BookingCount, 0) AS BookingCount,
          COALESCE(ls.RevenueGenerated, 0) AS RevenueGenerated,
          COALESCE(inv.InvoiceSpend, a.Spent, 0) AS CostSpent,
          ISNULL(inv.InvoiceCount, 0) AS InvoiceCount,
          CASE
            WHEN COALESCE(inv.InvoiceSpend, a.Spent, 0) > 0
              THEN (COALESCE(ls.RevenueGenerated, 0) - COALESCE(inv.InvoiceSpend, a.Spent, 0))
                / COALESCE(inv.InvoiceSpend, a.Spent, 0) * 100
            ELSE 0
          END AS ROI
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
        LEFT JOIN lead_stats ls ON ls.AdId = a.Id
        LEFT JOIN invoice_stats inv ON inv.AdId = a.Id
        WHERE ${where}
        ORDER BY a.CreatedAt DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-ads] GET error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /dropdown
router.get(
  "/dropdown",
  requirePageRight("sa-ads", "view"),
  cache("sa-ads-dropdown", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const campaignId = parseInt(req.query.campaignId, 10);
      const r = pool.request();
      let where = "a.IsActive = 1";
      if (Number.isFinite(campaignId) && campaignId > 0) {
        where += " AND a.CampaignId = @CampaignId";
        r.input("CampaignId", sql.Int, campaignId);
      }
      const result = await r.query(`
        SELECT a.Id, a.Name, a.CampaignId, c.CampaignCode, c.Name AS CampaignName
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
        WHERE ${where}
        ORDER BY c.CampaignCode, a.Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-ads] GET /dropdown error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /campaigns (dropdown)
router.get(
  "/campaigns",
  requirePageRight("sa-ads", "view"),
  cache("sa-ads-campaigns", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT Id, Name, CampaignCode
        FROM dbo.SaCampaign
        WHERE IsActive = 1
        ORDER BY Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-ads] GET /campaigns error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /
router.post(
  "/",
  requirePageRight("sa-ads", "create"),
  async (req, res) => {
    const {
      CampaignId,
      Name,
      CreativeRef,
      AdType,
      Budget,
      DailySpend,
      Spent,
      Status,
      RunningSince,
      IsActive,
    } = req.body;
    const createdBy = req.user?.userId || null;

    if (!CampaignId) {
      return res.status(400).json({ error: "CampaignId is required" });
    }
    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("CampaignId", sql.Int, parseInt(CampaignId, 10))
        .input("Name", sql.NVarChar(200), Name)
        .input("CreativeRef", sql.NVarChar(500), CreativeRef || null)
        .input("AdType", sql.NVarChar(50), AdType || null)
        .input("Budget", sql.Decimal(18, 2), Budget || 0)
        .input("DailySpend", sql.Decimal(18, 2), DailySpend || 0)
        .input("Spent", sql.Decimal(18, 2), Spent || 0)
        .input("Status", sql.NVarChar(20), Status || "Active")
        .input("RunningSince", sql.Date, RunningSince || null)
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
          INSERT INTO dbo.SaAd
            (CampaignId, Name, CreativeRef, AdType, Budget, DailySpend, Spent,
             Status, RunningSince, IsActive, CreatedBy, CreatedAt)
          VALUES
            (@CampaignId, @Name, @CreativeRef, @AdType, @Budget, @DailySpend, @Spent,
             @Status, @RunningSince, @IsActive, @CreatedBy, @CreatedAt)
        `);
      await bumpCacheVersion("sa-ads");
      res.json({ message: "Ad added successfully" });
    } catch (err) {
      console.error("[sa-ads] POST error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /:id
router.put(
  "/:id",
  requirePageRight("sa-ads", "edit"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const {
      CampaignId,
      Name,
      CreativeRef,
      AdType,
      Budget,
      DailySpend,
      Spent,
      Status,
      RunningSince,
      IsActive,
    } = req.body;
    const updatedBy = req.user?.userId || null;

    if (!CampaignId) {
      return res.status(400).json({ error: "CampaignId is required" });
    }
    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("Id", sql.Int, id)
        .input("CampaignId", sql.Int, parseInt(CampaignId, 10))
        .input("Name", sql.NVarChar(200), Name)
        .input("CreativeRef", sql.NVarChar(500), CreativeRef || null)
        .input("AdType", sql.NVarChar(50), AdType || null)
        .input("Budget", sql.Decimal(18, 2), Budget || 0)
        .input("DailySpend", sql.Decimal(18, 2), DailySpend || 0)
        .input("Spent", sql.Decimal(18, 2), Spent || 0)
        .input("Status", sql.NVarChar(20), Status || "Active")
        .input("RunningSince", sql.Date, RunningSince || null)
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("UpdatedBy", sql.Int, updatedBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.SaAd SET
            CampaignId   = @CampaignId,
            Name         = @Name,
            CreativeRef  = @CreativeRef,
            AdType       = @AdType,
            Budget       = @Budget,
            DailySpend   = @DailySpend,
            Spent        = @Spent,
            Status       = @Status,
            RunningSince = @RunningSince,
            IsActive     = @IsActive,
            UpdatedBy    = @UpdatedBy,
            UpdatedAt    = @UpdatedAt
          WHERE Id = @Id
        `);
      await bumpCacheVersion("sa-ads");
      res.json({ message: "Ad updated successfully" });
    } catch (err) {
      console.error("[sa-ads] PUT error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE /:id
router.delete(
  "/:id",
  requirePageRight("sa-ads", "delete"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    try {
      const pool = getPool();

      const existing = await pool
        .request()
        .input("Id", sql.Int, id)
        .query("SELECT Name FROM dbo.SaAd WHERE Id = @Id");

      if (!existing.recordset.length) {
        return res.status(404).json({ error: "Ad not found" });
      }

      const { Name } = existing.recordset[0];

      await pool
        .request()
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.SaAd WHERE Id = @Id");

      await bumpCacheVersion("sa-ads");
      res.json({ message: `Ad "${Name}" deleted successfully` });
    } catch (err) {
      console.error("[sa-ads] DELETE error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
