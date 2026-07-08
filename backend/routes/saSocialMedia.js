const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const rateLimit = require("express-rate-limit");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);

bumpCacheVersion("sa-social-media").catch(() => {});

const PLATFORM_SELECT = `
  SELECT
    p.Id, p.Name, p.PlatformType, p.AccountDetails, p.Notes, p.IsActive,
    p.ApiConfigId, p.AdAccountId, p.PixelId, p.ApiEnabled,
    -- Mask token fields; never return raw tokens to the client
    CASE WHEN p.AccessToken IS NOT NULL AND LEN(p.AccessToken) > 0 THEN 1 ELSE 0 END AS HasAccessToken,
    CASE WHEN p.RefreshToken IS NOT NULL AND LEN(p.RefreshToken) > 0 THEN 1 ELSE 0 END AS HasRefreshToken,
    p.TokenExpiresAt, p.CreatedAt, p.UpdatedAt,
    ic.Label AS ApiConfigLabel,
    ic.ChannelKey AS ApiConfigKey,
    (SELECT COUNT(*) FROM dbo.SaCampaign c WHERE c.PlatformId = p.Id) AS CampaignCount,
    (SELECT COUNT(*) FROM dbo.SaCampaign c
       JOIN dbo.SaAd a ON a.CampaignId = c.Id
       WHERE c.PlatformId = p.Id AND a.IsActive = 1) AS ActiveAdCount
  FROM dbo.SaSocialMediaPlatform p
  LEFT JOIN dbo.IntegrationChannels ic ON ic.Id = p.ApiConfigId
`;

// GET /
router.get(
  "/",
  requirePageRight("sa-social-media", "view"),
  cache("sa-social-media", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`${PLATFORM_SELECT} ORDER BY p.Name`);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-social-media] GET error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /api-configs — available integration channels for dropdown
router.get("/api-configs", requirePageRight("sa-social-media", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, ChannelKey, Label
      FROM dbo.IntegrationChannels
      WHERE IsActive = 1
      ORDER BY Label
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-social-media] GET /api-configs error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /:id — single platform with full details (including sync stats)
router.get("/:id", requirePageRight("sa-social-media", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request()
      .input("Id", sql.Int, id)
      .query(`${PLATFORM_SELECT} WHERE p.Id = @Id`);
    if (!result.recordset[0]) return res.status(404).json({ error: "Platform not found" });

    // Count ads synced / pending
    const syncStats = await pool.request()
      .input("PlatformId", sql.Int, id)
      .query(`
        SELECT
          COUNT(*) AS TotalAds,
          SUM(CASE WHEN a.SyncStatus = 'Synced' THEN 1 ELSE 0 END) AS SyncedAds,
          SUM(CASE WHEN a.SyncStatus = 'Pending' THEN 1 ELSE 0 END) AS PendingAds,
          SUM(CASE WHEN a.SyncStatus = 'Failed' THEN 1 ELSE 0 END) AS FailedAds,
          MAX(a.LastSyncedAt) AS LastSyncAt
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
        WHERE c.PlatformId = @PlatformId AND a.IsActive = 1
      `);

    res.json({ platform: result.recordset[0], syncStats: syncStats.recordset[0] || {} });
  } catch (err) {
    console.error("[sa-social-media] GET /:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/test-connection — validate API connection
router.post("/:id/test-connection", requirePageRight("sa-social-media", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const platResult = await pool.request()
      .input("Id", sql.Int, id)
      .query("SELECT AccessToken, AdAccountId, PlatformType, ApiEnabled, AccountDetails, PixelId FROM dbo.SaSocialMediaPlatform WHERE Id = @Id");
    if (!platResult.recordset[0]) return res.status(404).json({ error: "Platform not found" });
    const plat = platResult.recordset[0];
    if (!plat.AccessToken || !plat.ApiEnabled) {
      return res.status(400).json({ error: "Platform has no access token or API is disabled" });
    }

    // Basic connectivity test — try a simple API call based on platform type
    const { testPlatformConnection } = require("../services/saAdPlatformService");
    const result = await testPlatformConnection(plat.PlatformType, plat.AccessToken, plat.AdAccountId, plat);
    res.json(result);
  } catch (err) {
    console.error("[sa-social-media] POST /:id/test-connection error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /
router.post(
  "/",
  requirePageRight("sa-social-media", "create"),
  async (req, res) => {
    const { Name, PlatformType, AccountDetails, Notes, IsActive } = req.body;
    const createdBy = req.user?.userId || null;

    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const pool = getPool();
      const inserted = await pool
        .request()
        .input("Name", sql.NVarChar(150), Name)
        .input("PlatformType", sql.NVarChar(50), PlatformType || null)
        .input("AccountDetails", sql.NVarChar(sql.MAX), AccountDetails || null)
        .input("Notes", sql.NVarChar(sql.MAX), Notes || null)
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("CreatedBy", sql.Int, createdBy)
        .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
          INSERT INTO dbo.SaSocialMediaPlatform
            (Name, PlatformType, AccountDetails, Notes, IsActive, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES
            (@Name, @PlatformType, @AccountDetails, @Notes, @IsActive, @CreatedBy, @CreatedAt)
        `);
      await bumpCacheVersion("sa-social-media");
      res.json({ message: "Social media platform added successfully", id: inserted.recordset[0]?.Id });
    } catch (err) {
      console.error("[sa-social-media] POST error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /:id
// PUT /:id/api-config — update only API-related fields
router.put(
  "/:id/api-config",
  requirePageRight("sa-social-media", "edit"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const { ApiConfigId, AdAccountId, AccessToken, RefreshToken, TokenExpiresAt, PixelId, ApiEnabled } = req.body;
    const updatedBy = req.user?.userId || null;

    try {
      const pool = getPool();
      await pool.request()
        .input("Id",              sql.Int,            id)
        .input("ApiConfigId",     sql.Int,            ApiConfigId || null)
        .input("AdAccountId",     sql.NVarChar(200),  AdAccountId || null)
        .input("AccessToken",     sql.NVarChar(sql.MAX), AccessToken || null)
        .input("RefreshToken",    sql.NVarChar(sql.MAX), RefreshToken || null)
        .input("TokenExpiresAt",  sql.DateTime2(3),   TokenExpiresAt || null)
        .input("PixelId",         sql.NVarChar(200),  PixelId || null)
        .input("ApiEnabled",      sql.Bit,            ApiEnabled !== false ? 1 : 0)
        .input("UpdatedBy",       sql.Int,            updatedBy)
        .query(`
          UPDATE dbo.SaSocialMediaPlatform SET
            ApiConfigId    = @ApiConfigId,
            AdAccountId    = @AdAccountId,
            AccessToken    = COALESCE(@AccessToken, AccessToken),
            RefreshToken   = COALESCE(@RefreshToken, RefreshToken),
            TokenExpiresAt = @TokenExpiresAt,
            PixelId        = @PixelId,
            ApiEnabled     = @ApiEnabled,
            UpdatedBy      = @UpdatedBy,
            UpdatedAt      = SYSDATETIME()
          WHERE Id = @Id
        `);
      await bumpCacheVersion("sa-social-media");
      res.json({ message: "API configuration updated" });
    } catch (err) {
      console.error("[sa-social-media] PUT /api-config error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /:id — full platform update (basic fields)
router.put(
  "/:id",
  requirePageRight("sa-social-media", "edit"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const { Name, PlatformType, AccountDetails, Notes, IsActive } = req.body;
    const updatedBy = req.user?.userId || null;

    if (!Name || !String(Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const pool = getPool();
      await pool
        .request()
        .input("Id", sql.Int, id)
        .input("Name", sql.NVarChar(150), Name)
        .input("PlatformType", sql.NVarChar(50), PlatformType || null)
        .input("AccountDetails", sql.NVarChar(sql.MAX), AccountDetails || null)
        .input("Notes", sql.NVarChar(sql.MAX), Notes || null)
        .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
        .input("UpdatedBy", sql.Int, updatedBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.SaSocialMediaPlatform SET
            Name           = @Name,
            PlatformType   = @PlatformType,
            AccountDetails = @AccountDetails,
            Notes          = @Notes,
            IsActive       = @IsActive,
            UpdatedBy      = @UpdatedBy,
            UpdatedAt      = @UpdatedAt
          WHERE Id = @Id
        `);
      await bumpCacheVersion("sa-social-media");
      res.json({ message: "Social media platform updated successfully" });
    } catch (err) {
      console.error("[sa-social-media] PUT error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /:id
router.delete(
  "/:id",
  requirePageRight("sa-social-media", "delete"),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    try {
      const pool = getPool();

      const existing = await pool.request().input("Id", sql.Int, id)
        .query("SELECT Name FROM dbo.SaSocialMediaPlatform WHERE Id = @Id");
      if (!existing.recordset.length) return res.status(404).json({ error: "Platform not found" });
      const { Name } = existing.recordset[0];

      // Check for linked campaigns and deactivate atomically to avoid TOCTOU.
      const result = await pool.request().input("Id", sql.Int, id).query(`
        IF EXISTS (SELECT 1 FROM dbo.SaCampaign WHERE PlatformId = @Id AND IsActive = 1)
          SELECT 'linked' AS outcome;
        ELSE BEGIN
          UPDATE dbo.SaSocialMediaPlatform SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @Id;
          SELECT 'deleted' AS outcome;
        END
      `);

      if (result.recordset[0]?.outcome === "linked") {
        return res.status(400).json({ error: "Cannot delete - one or more campaigns reference this platform" });
      }

      await bumpCacheVersion("sa-social-media");
      res.json({ message: `Platform "${Name}" deleted successfully` });
    } catch (err) {
      console.error("[sa-social-media] DELETE error:", err.message);
      res.status(500).json({ error: "Failed to delete platform" });
    }
  },
);

module.exports = router;
