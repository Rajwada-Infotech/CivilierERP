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
// NOTE: TotalLeadsGenerated / CostPerLead / ConversionRate / BookingCount /
// ROI / RevenueGenerated depend on dbo.SaLead (Phase 2) and the Booking
// handoff (Phase 4). Returned as null until those exist.
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
          NULL AS TotalLeadsGenerated,
          NULL AS CostPerLead,
          NULL AS ConversionRate,
          NULL AS BookingCount,
          NULL AS ROI,
          NULL AS RevenueGenerated
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
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