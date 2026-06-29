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
const PERMISSION_SUBMODULE = "Campaigns";

bumpCacheVersion("sa-campaigns").catch(() => {});

// GET /
// NOTE: TotalLeads / CostPerLead / ConversionPct depend on dbo.SaLead, which
// is introduced in Phase 2. Returned as null until then so the frontend can
// render a placeholder rather than a misleading 0.
router.get(
  "/",
  requirePageRight("sa-campaigns", "view"),
  cache("sa-campaigns", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
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
            SUM(CASE WHEN l.BookingId IS NOT NULL THEN 1 ELSE 0 END) AS BookingCount
          FROM dbo.SaLead l
          WHERE l.IsActive = 1
          GROUP BY l.CampaignId
        )
        SELECT
          c.Id,
          c.CampaignCode,
          c.Name,
          c.Objective,
          c.PlatformId,
          p.Name AS PlatformName,
          c.StartDate,
          c.EndDate,
          c.Budget,
          c.Status,
          c.MarketingManagerId,
          mgr.name AS MarketingManagerName,
          c.IsActive,
          c.CreatedAt,
          c.UpdatedAt,
          ISNULL(a.TotalAds, 0) AS TotalAds,
          ISNULL(a.CostSpent, 0) AS CostSpent,
          CASE
            WHEN c.EndDate IS NOT NULL THEN DATEDIFF(DAY, c.StartDate, c.EndDate)
            WHEN c.StartDate IS NOT NULL THEN DATEDIFF(DAY, c.StartDate, GETDATE())
            ELSE NULL
          END AS ActiveDays,
          ISNULL(l.TotalLeads, 0) AS TotalLeads,
          CASE WHEN ISNULL(l.TotalLeads, 0) > 0 THEN ISNULL(a.CostSpent, 0) / l.TotalLeads ELSE 0 END AS CostPerLead,
          CASE
            WHEN ISNULL(l.TotalLeads, 0) > 0
              THEN CAST(ISNULL(l.BookingCount, 0) AS FLOAT) / l.TotalLeads * 100
            ELSE 0
          END AS ConversionPct
        FROM dbo.SaCampaign c
        LEFT JOIN dbo.SaSocialMediaPlatform p ON p.Id = c.PlatformId
        LEFT JOIN dbo.Users mgr ON mgr.id = c.MarketingManagerId
        LEFT JOIN ad_stats a ON a.CampaignId = c.Id
        LEFT JOIN lead_stats l ON l.CampaignId = c.Id
        ORDER BY c.CreatedAt DESC
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-campaigns] GET error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /platforms (dropdown)
router.get(
  "/platforms",
  requirePageRight("sa-campaigns", "view"),
  cache("sa-campaigns-platforms", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT Id, Name
        FROM dbo.SaSocialMediaPlatform
        WHERE IsActive = 1
        ORDER BY Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-campaigns] GET /platforms error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /dropdown
router.get(
  "/dropdown",
  requirePageRight("sa-campaigns", "view"),
  cache("sa-campaigns-dropdown", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT Id, Name, CampaignCode, PlatformId
        FROM dbo.SaCampaign
        WHERE IsActive = 1
        ORDER BY CampaignCode, Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-campaigns] GET /dropdown error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /
router.post(
  "/",
  requirePageRight("sa-campaigns", "create"),
  async (req, res) => {
    const {
      CampaignCode,
      Name,
      Objective,
      PlatformId,
      StartDate,
      EndDate,
      Budget,
      Status,
      MarketingManagerId,
      IsActive,
    } = req.body;
    const createdBy = req.user?.userId || null;

    if (!CampaignCode || !String(CampaignCode).trim()) {
      return res.status(400).json({ error: "CampaignCode is required" });
    }
    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!PlatformId) {
      return res.status(400).json({ error: "PlatformId is required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("CampaignCode", sql.NVarChar(50), CampaignCode)
        .input("Name", sql.NVarChar(200), Name)
        .input("Objective", sql.NVarChar(sql.MAX), Objective || null)
        .input("PlatformId", sql.Int, parseInt(PlatformId, 10))
        .input("StartDate", sql.Date, StartDate || null)
        .input("EndDate", sql.Date, EndDate || null)
        .input("Budget", sql.Decimal(18, 2), Budget || 0)
        .input("Status", sql.NVarChar(20), Status || "Active")
        .input(
          "MarketingManagerId",
          sql.Int,
          MarketingManagerId ? parseInt(MarketingManagerId, 10) : null,
        )
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
          INSERT INTO dbo.SaCampaign
            (CampaignCode, Name, Objective, PlatformId, StartDate, EndDate,
             Budget, Status, MarketingManagerId, IsActive, CreatedBy, CreatedAt)
          VALUES
            (@CampaignCode, @Name, @Objective, @PlatformId, @StartDate, @EndDate,
             @Budget, @Status, @MarketingManagerId, @IsActive, @CreatedBy, @CreatedAt)
        `);
      await bumpCacheVersion("sa-campaigns");
      res.json({ message: "Campaign added successfully" });
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return res.status(400).json({ error: "Campaign code already exists" });
      }
      console.error("[sa-campaigns] POST error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /:id
router.put(
  "/:id",
  requirePageRight("sa-campaigns", "edit"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const {
      CampaignCode,
      Name,
      Objective,
      PlatformId,
      StartDate,
      EndDate,
      Budget,
      Status,
      MarketingManagerId,
      IsActive,
    } = req.body;
    const updatedBy = req.user?.userId || null;

    if (!CampaignCode || !String(CampaignCode).trim()) {
      return res.status(400).json({ error: "CampaignCode is required" });
    }
    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!PlatformId) {
      return res.status(400).json({ error: "PlatformId is required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("Id", sql.Int, id)
        .input("CampaignCode", sql.NVarChar(50), CampaignCode)
        .input("Name", sql.NVarChar(200), Name)
        .input("Objective", sql.NVarChar(sql.MAX), Objective || null)
        .input("PlatformId", sql.Int, parseInt(PlatformId, 10))
        .input("StartDate", sql.Date, StartDate || null)
        .input("EndDate", sql.Date, EndDate || null)
        .input("Budget", sql.Decimal(18, 2), Budget || 0)
        .input("Status", sql.NVarChar(20), Status || "Active")
        .input(
          "MarketingManagerId",
          sql.Int,
          MarketingManagerId ? parseInt(MarketingManagerId, 10) : null,
        )
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("UpdatedBy", sql.Int, updatedBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.SaCampaign SET
            CampaignCode       = @CampaignCode,
            Name               = @Name,
            Objective          = @Objective,
            PlatformId         = @PlatformId,
            StartDate          = @StartDate,
            EndDate            = @EndDate,
            Budget             = @Budget,
            Status             = @Status,
            MarketingManagerId = @MarketingManagerId,
            IsActive           = @IsActive,
            UpdatedBy          = @UpdatedBy,
            UpdatedAt          = @UpdatedAt
          WHERE Id = @Id
        `);
      await bumpCacheVersion("sa-campaigns");
      res.json({ message: "Campaign updated successfully" });
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return res.status(400).json({ error: "Campaign code already exists" });
      }
      console.error("[sa-campaigns] PUT error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// DELETE /:id
router.delete(
  "/:id",
  requirePageRight("sa-campaigns", "delete"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    try {
      const pool = getPool();

      const linked = await pool
        .request()
        .input("Id", sql.Int, id)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.SaAd WHERE CampaignId = @Id");

      if (linked.recordset[0].Cnt > 0) {
        return res.status(400).json({
          error: "Cannot delete - one or more ads reference this campaign",
        });
      }

      const existing = await pool
        .request()
        .input("Id", sql.Int, id)
        .query("SELECT Name FROM dbo.SaCampaign WHERE Id = @Id");

      if (!existing.recordset.length) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      const { Name } = existing.recordset[0];

      await pool
        .request()
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.SaCampaign WHERE Id = @Id");

      await bumpCacheVersion("sa-campaigns");
      res.json({ message: `Campaign "${Name}" deleted successfully` });
    } catch (err) {
      console.error("[sa-campaigns] DELETE error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
