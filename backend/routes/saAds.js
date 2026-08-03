const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const express = require("express");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const rateLimit = require("express-rate-limit");
const {
  syncAdToPlatform,
  normalizeImportedLeads,
  providerLabel,
} = require("../services/saAdPlatformService");
const { getNextDocNumber } = require("../services/docNumber");

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

bumpCacheVersion("sa-ads").catch(() => {});

const UPLOAD_DIR = path.join(__dirname, "../uploads/sa-ad-creatives");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const creativeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const uploadCreative = multer({
  storage: creativeStorage,
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm"];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only image (jpeg/png/webp/gif) or video (mp4/mov/webm) files are allowed"));
  },
});

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
            SUM(CASE WHEN l.CrmBookingId IS NOT NULL THEN 1 ELSE 0 END) AS BookingCount,
            SUM(COALESCE(fb.TotalValue, fb.BookingAmount, 0)) AS RevenueGenerated
          FROM dbo.SaLead l
          LEFT JOIN dbo.CrmBooking fb
            ON fb.Id = l.CrmBookingId
           AND ISNULL(fb.IsActive, 1) = 1
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
          a.AdCode,
          a.CampaignId,
          c.Name AS CampaignName,
          a.Name,
          a.CreativeRef,
          a.AdType,
          -- Creative / copy
          a.Headline, a.Description, a.CtaText, a.ImageUrl, a.VideoUrl, a.MediaUrls, a.Keypoints,
          -- Targeting
          a.TargetAgeMin, a.TargetAgeMax, a.TargetGender,
          a.TargetLocations, a.TargetRadiusKm, a.TargetInterests,
          a.TargetBehaviors, a.TargetLanguages,
          -- Scheduling & placement
          a.ScheduledStartAt, a.ScheduledEndAt,
          a.PlatformPlacement, a.Objective, a.OptimizationGoal,
          a.BidStrategy, a.DestinationUrl, a.UtmParameters,
          -- Budget & status
          a.Budget, a.DailySpend, a.Spent, a.Status, a.RunningSince, a.IsActive,
          a.CreatedAt, a.UpdatedAt,
          -- External platform sync
          a.ExternalAdId, a.ExternalAdSetId, a.LastSyncedAt, a.SyncStatus,
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
      res.status(500).json({ error: "Internal server error" });
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
        SELECT a.Id, a.AdCode, a.Name, a.CampaignId, c.CampaignCode, c.Name AS CampaignName,
               c.PlatformId, p.Name AS PlatformName
        FROM dbo.SaAd a
        JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
        LEFT JOIN dbo.SaSocialMediaPlatform p ON p.Id = c.PlatformId
        WHERE ${where}
        ORDER BY c.CampaignCode, a.Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-ads] GET /dropdown error:", err.message);
      res.status(500).json({ error: "Internal server error" });
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
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /
router.post(
  "/",
  requirePageRight("sa-ads", "create"),
  async (req, res) => {
    const b = req.body;
    const createdBy = req.user?.userId || null;

    if (!b.CampaignId) {
      return res.status(400).json({ error: "CampaignId is required" });
    }
    if (!b.Name || !String(b.Name).trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const pool = getPool();
      const adCode = await getNextDocNumber(pool, "AD", "AD");
      await pool.request()
        .input("AdCode",              sql.NVarChar(30),   adCode)
        .input("CampaignId",          sql.Int,            parseInt(b.CampaignId, 10))
        .input("Name",                sql.NVarChar(200),  b.Name)
        .input("CreativeRef",         sql.NVarChar(2000), b.CreativeRef || null)
        .input("AdType",              sql.NVarChar(50),   b.AdType || null)
        // Creative
        .input("Headline",            sql.NVarChar(300),  b.Headline || null)
        .input("Description",         sql.NVarChar(sql.MAX), b.Description || null)
        .input("CtaText",             sql.NVarChar(100),  b.CtaText || null)
        .input("ImageUrl",            sql.NVarChar(2000), b.ImageUrl || null)
        .input("VideoUrl",            sql.NVarChar(2000), b.VideoUrl || null)
        .input("MediaUrls",           sql.NVarChar(sql.MAX), b.MediaUrls || null)
        .input("Keypoints",           sql.NVarChar(sql.MAX), b.Keypoints || null)
        // Targeting
        .input("TargetAgeMin",        sql.Int,            b.TargetAgeMin || null)
        .input("TargetAgeMax",        sql.Int,            b.TargetAgeMax || null)
        .input("TargetGender",        sql.NVarChar(20),   b.TargetGender || null)
        .input("TargetLocations",     sql.NVarChar(sql.MAX), b.TargetLocations || null)
        .input("TargetRadiusKm",      sql.Decimal(10, 2), b.TargetRadiusKm || null)
        .input("TargetInterests",     sql.NVarChar(sql.MAX), b.TargetInterests || null)
        .input("TargetBehaviors",     sql.NVarChar(sql.MAX), b.TargetBehaviors || null)
        .input("TargetLanguages",     sql.NVarChar(500),  b.TargetLanguages || null)
        // Scheduling
        .input("ScheduledStartAt",    sql.DateTime2(3),   b.ScheduledStartAt || null)
        .input("ScheduledEndAt",      sql.DateTime2(3),   b.ScheduledEndAt || null)
        .input("PlatformPlacement",   sql.NVarChar(500),  b.PlatformPlacement || null)
        .input("Objective",           sql.NVarChar(100),  b.Objective || null)
        .input("OptimizationGoal",    sql.NVarChar(100),  b.OptimizationGoal || null)
        .input("BidStrategy",         sql.NVarChar(100),  b.BidStrategy || null)
        .input("DestinationUrl",      sql.NVarChar(2000), b.DestinationUrl || null)
        .input("UtmParameters",       sql.NVarChar(sql.MAX), b.UtmParameters || null)
        // Budget
        .input("Budget",              sql.Decimal(18, 2), b.Budget || 0)
        .input("DailySpend",          sql.Decimal(18, 2), b.DailySpend || 0)
        .input("Spent",               sql.Decimal(18, 2), b.Spent || 0)
        .input("Status",              sql.NVarChar(20),   b.Status || "Active")
        .input("RunningSince",        sql.Date,           b.RunningSince || null)
        .input("IsActive",            sql.Bit,            b.IsActive !== false ? 1 : 0)
        // External
        .input("ExternalAdId",        sql.NVarChar(200),  b.ExternalAdId || null)
        .input("ExternalAdSetId",     sql.NVarChar(200),  b.ExternalAdSetId || null)
        .input("SyncStatus",          sql.NVarChar(30),   b.SyncStatus || null)
        .input("CreatedBy",           sql.Int,            createdBy)
        .query(`
          INSERT INTO dbo.SaAd
            (AdCode, CampaignId, Name, CreativeRef, AdType,
             Headline, Description, CtaText, ImageUrl, VideoUrl, MediaUrls, Keypoints,
             TargetAgeMin, TargetAgeMax, TargetGender, TargetLocations, TargetRadiusKm,
             TargetInterests, TargetBehaviors, TargetLanguages,
             ScheduledStartAt, ScheduledEndAt, PlatformPlacement, Objective,
             OptimizationGoal, BidStrategy, DestinationUrl, UtmParameters,
             Budget, DailySpend, Spent, Status, RunningSince, IsActive,
             ExternalAdId, ExternalAdSetId, SyncStatus,
             CreatedBy, CreatedAt)
          VALUES
            (@AdCode, @CampaignId, @Name, @CreativeRef, @AdType,
             @Headline, @Description, @CtaText, @ImageUrl, @VideoUrl, @MediaUrls, @Keypoints,
             @TargetAgeMin, @TargetAgeMax, @TargetGender, @TargetLocations, @TargetRadiusKm,
             @TargetInterests, @TargetBehaviors, @TargetLanguages,
             @ScheduledStartAt, @ScheduledEndAt, @PlatformPlacement, @Objective,
             @OptimizationGoal, @BidStrategy, @DestinationUrl, @UtmParameters,
             @Budget, @DailySpend, @Spent, @Status, @RunningSince, @IsActive,
             @ExternalAdId, @ExternalAdSetId, @SyncStatus,
             @CreatedBy, SYSDATETIME())
        `);
      await bumpCacheVersion("sa-ads");
      res.json({ message: "Ad added successfully", AdCode: adCode });
    } catch (err) {
      console.error("[sa-ads] POST error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

async function getAdWithPlatform(pool, adId) {
  const result = await pool.request()
    .input("AdId", sql.Int, adId)
    .query(`
      SELECT
        a.*,
        c.Name AS CampaignName,
        c.PlatformId,
        p.Name AS PlatformName,
        p.PlatformType,
        p.ApiEnabled,
        p.AdAccountId,
        p.AccessToken,
        p.ApiConfigId,
        p.AccountDetails,
        p.PixelId
      FROM dbo.SaAd a
      JOIN dbo.SaCampaign c ON c.Id = a.CampaignId
      LEFT JOIN dbo.SaSocialMediaPlatform p ON p.Id = c.PlatformId
      WHERE a.Id = @AdId AND a.IsActive = 1
    `);
  return result.recordset[0] || null;
}

function parseUtmParameters(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// GET /:id/sync-log
router.get("/:id/sync-log", requirePageRight("sa-ads", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request()
      .input("AdId", sql.Int, id)
      .query(`
        SELECT TOP 50 Id, SaAdId, PlatformId, PlatformName, ExternalAdId,
               SyncType, Direction, Status, Impressions, Clicks, Spend,
               Conversions, LeadsGenerated, Ctr, Cpc, Cpm, Reach, Frequency,
               CostPerLead, ErrorMessage, ErrorCode, SyncStartedAt, SyncEndedAt,
               SyncDurationMs, CreatedAt
        FROM dbo.SaAdSyncLog
        WHERE SaAdId = @AdId
        ORDER BY SyncStartedAt DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-ads] GET /sync-log error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/sync - prepare/push an ad payload to the configured ad platform
router.post("/:id/sync", requirePageRight("sa-ads", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const createdBy = req.user?.userId || null;
  const startedAt = Date.now();
  try {
    const pool = getPool();
    const ad = await getAdWithPlatform(pool, id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    if (!ad.PlatformId) return res.status(400).json({ error: "Ad campaign is not linked to a platform" });

    const sync = await syncAdToPlatform(ad, ad, req.body?.Mode || "Preview");
    const status = sync.status === "Success" ? "Synced" : sync.status;
    const duration = Date.now() - startedAt;

    await pool.request()
      .input("SaAdId", sql.Int, id)
      .input("PlatformId", sql.Int, ad.PlatformId)
      .input("PlatformName", sql.NVarChar(100), ad.PlatformName || providerLabel(ad.PlatformType))
      .input("ExternalAdId", sql.NVarChar(200), sync.externalAdId || ad.ExternalAdId || null)
      .input("SyncType", sql.NVarChar(30), req.body?.Mode === "Push" ? "Export" : "Preview")
      .input("Direction", sql.NVarChar(10), "Export")
      .input("Status", sql.NVarChar(20), sync.status === "Success" ? "Success" : "Pending")
      .input("RawResponse", sql.NVarChar(sql.MAX), JSON.stringify(sync.rawResponse || {}))
      .input("ErrorMessage", sql.NVarChar(sql.MAX), sync.status === "Failed" ? sync.message : null)
      .input("SyncDurationMs", sql.Int, duration)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.SaAdSyncLog
          (SaAdId, PlatformId, PlatformName, ExternalAdId, SyncType, Direction,
           Status, RawResponse, ErrorMessage, SyncEndedAt, SyncDurationMs, CreatedBy)
        VALUES
          (@SaAdId, @PlatformId, @PlatformName, @ExternalAdId, @SyncType, @Direction,
           @Status, @RawResponse, @ErrorMessage, SYSDATETIME(), @SyncDurationMs, @CreatedBy)
      `);

    await pool.request()
      .input("Id", sql.Int, id)
      .input("ExternalAdId", sql.NVarChar(200), sync.externalAdId || null)
      .input("SyncStatus", sql.NVarChar(30), status)
      .query(`
        UPDATE dbo.SaAd SET
          ExternalAdId = COALESCE(@ExternalAdId, ExternalAdId),
          SyncStatus = @SyncStatus,
          LastSyncedAt = SYSDATETIME(),
          UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);

    await bumpCacheVersion("sa-ads");
    res.json({ success: true, ...sync });
  } catch (err) {
    console.error("[sa-ads] POST /sync error:", err.message);
    res.status(500).json({ error: err.message || "Sync failed" });
  }
});

// POST /:id/import-leads - import normalized ad leads into SaLead
router.post("/:id/import-leads", requirePageRight("sa-leads", "create"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const ad = await getAdWithPlatform(pool, id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    const incoming = Array.isArray(req.body?.Leads) ? req.body.Leads : [];
    const normalized = await normalizeImportedLeads(ad, ad, incoming);
    const utm = parseUtmParameters(ad.UtmParameters);
    let inserted = 0;
    let skipped = 0;

    for (const lead of normalized) {
      if (!lead.Mobile && !lead.Email) {
        skipped += 1;
        continue;
      }
      const uid = `LEAD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const sourcePayload = JSON.stringify(lead.SourcePayload || {});
      const result = await pool.request()
        .input("LeadUid", sql.NVarChar(50), uid)
        .input("ExternalLeadId", sql.NVarChar(200), lead.ExternalLeadId)
        .input("CustomerName", sql.NVarChar(200), lead.CustomerName)
        .input("Mobile", sql.NVarChar(20), lead.Mobile)
        .input("Email", sql.NVarChar(200), lead.Email)
        .input("PlatformId", sql.Int, ad.PlatformId)
        .input("CampaignId", sql.Int, ad.CampaignId)
        .input("AdId", sql.Int, ad.Id)
        .input("LeadFormName", sql.NVarChar(200), lead.LeadFormName)
        .input("SourceCampaignName", sql.NVarChar(200), ad.CampaignName)
        .input("SourceAdName", sql.NVarChar(200), ad.Name)
        .input("SourcePlacement", sql.NVarChar(200), ad.PlatformPlacement)
        .input("LeadCaptureUrl", sql.NVarChar(2000), ad.DestinationUrl)
        .input("UtmSource", sql.NVarChar(100), utm.utm_source || utm.source || null)
        .input("UtmMedium", sql.NVarChar(100), utm.utm_medium || utm.medium || null)
        .input("UtmCampaign", sql.NVarChar(200), utm.utm_campaign || utm.campaign || ad.CampaignName || null)
        .input("UtmContent", sql.NVarChar(200), utm.utm_content || utm.content || ad.Name || null)
        .input("UtmTerm", sql.NVarChar(200), utm.utm_term || utm.term || null)
        .input("CapturedAt", sql.DateTime2(3), lead.CapturedAt || null)
        .input("SourcePayload", sql.NVarChar(sql.MAX), sourcePayload)
        .input("CreatedBy", sql.Int, createdBy)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.SaLead
            WHERE (ExternalLeadId = @ExternalLeadId AND @ExternalLeadId IS NOT NULL)
               OR ((Mobile = @Mobile AND @Mobile IS NOT NULL) AND AdId = @AdId)
          )
          BEGIN
            INSERT INTO dbo.SaLead
              (LeadUid, ExternalLeadId, CustomerName, Mobile, Email, PlatformId, CampaignId, AdId,
               SourceType, LeadFormName, SourceCampaignName, SourceAdName, SourcePlacement,
               LeadCaptureUrl, UtmSource, UtmMedium, UtmCampaign, UtmContent, UtmTerm, CapturedAt, SourcePayload,
               DateGenerated, Status, IsActive, CreatedBy, CreatedAt)
            VALUES
              (@LeadUid, @ExternalLeadId, @CustomerName, @Mobile, @Email, @PlatformId, @CampaignId, @AdId,
               'Ad', @LeadFormName, @SourceCampaignName, @SourceAdName, @SourcePlacement,
               @LeadCaptureUrl, @UtmSource, @UtmMedium, @UtmCampaign, @UtmContent, @UtmTerm, @CapturedAt, @SourcePayload,
               CAST(SYSDATETIME() AS DATE), 'New', 1, @CreatedBy, SYSDATETIME());
            SELECT 1 AS Inserted;
          END
          ELSE SELECT 0 AS Inserted;
        `);
      if (result.recordset[0]?.Inserted) inserted += 1;
      else skipped += 1;
    }

    await pool.request()
      .input("SaAdId", sql.Int, id)
      .input("PlatformId", sql.Int, ad.PlatformId)
      .input("PlatformName", sql.NVarChar(100), ad.PlatformName || providerLabel(ad.PlatformType))
      .input("ExternalAdId", sql.NVarChar(200), ad.ExternalAdId || null)
      .input("SyncType", sql.NVarChar(30), "LeadImport")
      .input("Direction", sql.NVarChar(10), "Import")
      .input("Status", sql.NVarChar(20), "Success")
      .input("LeadsGenerated", sql.Int, inserted)
      .input("RawResponse", sql.NVarChar(sql.MAX), JSON.stringify({ received: incoming.length, inserted, skipped }))
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.SaAdSyncLog
          (SaAdId, PlatformId, PlatformName, ExternalAdId, SyncType, Direction,
           Status, LeadsGenerated, RawResponse, SyncEndedAt, CreatedBy)
        VALUES
          (@SaAdId, @PlatformId, @PlatformName, @ExternalAdId, @SyncType, @Direction,
           @Status, @LeadsGenerated, @RawResponse, SYSDATETIME(), @CreatedBy)
      `);

    res.json({ success: true, received: incoming.length, inserted, skipped });
  } catch (err) {
    console.error("[sa-ads] POST /import-leads error:", err.message);
    res.status(500).json({ error: err.message || "Lead import failed" });
  }
});

// PUT /:id
// PUT /:id/full — update all fields including creative/targeting/sync
router.put("/:id", requirePageRight("sa-ads", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const b = req.body;
  const updatedBy = req.user?.userId || null;

  try {
    const pool = getPool();
    await pool.request()
      .input("Id",                   sql.Int,            id)
      .input("CampaignId",           sql.Int,            b.CampaignId ? parseInt(b.CampaignId) : null)
      .input("Name",                 sql.NVarChar(200),  b.Name || null)
      .input("CreativeRef",          sql.NVarChar(2000), b.CreativeRef || null)
      .input("AdType",               sql.NVarChar(50),   b.AdType || null)
      .input("Headline",             sql.NVarChar(300),  b.Headline || null)
      .input("Description",          sql.NVarChar(sql.MAX), b.Description || null)
      .input("CtaText",              sql.NVarChar(100),  b.CtaText || null)
      .input("ImageUrl",             sql.NVarChar(2000), b.ImageUrl || null)
      .input("VideoUrl",             sql.NVarChar(2000), b.VideoUrl || null)
      .input("MediaUrls",            sql.NVarChar(sql.MAX), b.MediaUrls || null)
      .input("Keypoints",            sql.NVarChar(sql.MAX), b.Keypoints || null)
      .input("TargetAgeMin",         sql.Int,            b.TargetAgeMin || null)
      .input("TargetAgeMax",         sql.Int,            b.TargetAgeMax || null)
      .input("TargetGender",         sql.NVarChar(20),   b.TargetGender || null)
      .input("TargetLocations",      sql.NVarChar(sql.MAX), b.TargetLocations || null)
      .input("TargetRadiusKm",       sql.Decimal(10, 2), b.TargetRadiusKm || null)
      .input("TargetInterests",      sql.NVarChar(sql.MAX), b.TargetInterests || null)
      .input("TargetBehaviors",      sql.NVarChar(sql.MAX), b.TargetBehaviors || null)
      .input("TargetLanguages",      sql.NVarChar(500),  b.TargetLanguages || null)
      .input("ScheduledStartAt",     sql.DateTime2(3),   b.ScheduledStartAt || null)
      .input("ScheduledEndAt",       sql.DateTime2(3),   b.ScheduledEndAt || null)
      .input("PlatformPlacement",    sql.NVarChar(500),  b.PlatformPlacement || null)
      .input("Objective",            sql.NVarChar(100),  b.Objective || null)
      .input("OptimizationGoal",     sql.NVarChar(100),  b.OptimizationGoal || null)
      .input("BidStrategy",          sql.NVarChar(100),  b.BidStrategy || null)
      .input("DestinationUrl",       sql.NVarChar(2000), b.DestinationUrl || null)
      .input("UtmParameters",        sql.NVarChar(sql.MAX), b.UtmParameters || null)
      .input("Budget",               sql.Decimal(18, 2), b.Budget !== undefined ? b.Budget : null)
      .input("DailySpend",           sql.Decimal(18, 2), b.DailySpend !== undefined ? b.DailySpend : null)
      .input("Spent",                sql.Decimal(18, 2), b.Spent !== undefined ? b.Spent : null)
      .input("Status",               sql.NVarChar(20),   b.Status || null)
      .input("ExternalAdId",         sql.NVarChar(200),  b.ExternalAdId || null)
      .input("ExternalAdSetId",      sql.NVarChar(200),  b.ExternalAdSetId || null)
      .input("SyncStatus",           sql.NVarChar(30),   b.SyncStatus || null)
      .input("UpdatedBy",            sql.Int,            updatedBy)
      .query(`
        UPDATE dbo.SaAd SET
          CampaignId        = ISNULL(@CampaignId,        CampaignId),
          Name              = ISNULL(@Name,              Name),
          CreativeRef       = ISNULL(@CreativeRef,       CreativeRef),
          AdType            = ISNULL(@AdType,            AdType),
          Headline          = ISNULL(@Headline,          Headline),
          Description       = ISNULL(@Description,       Description),
          CtaText           = ISNULL(@CtaText,           CtaText),
          ImageUrl          = ISNULL(@ImageUrl,          ImageUrl),
          VideoUrl          = ISNULL(@VideoUrl,          VideoUrl),
          MediaUrls         = ISNULL(@MediaUrls,         MediaUrls),
          Keypoints         = ISNULL(@Keypoints,         Keypoints),
          TargetAgeMin      = @TargetAgeMin,
          TargetAgeMax      = @TargetAgeMax,
          TargetGender      = @TargetGender,
          TargetLocations   = @TargetLocations,
          TargetRadiusKm    = @TargetRadiusKm,
          TargetInterests   = @TargetInterests,
          TargetBehaviors   = @TargetBehaviors,
          TargetLanguages   = @TargetLanguages,
          ScheduledStartAt  = @ScheduledStartAt,
          ScheduledEndAt    = @ScheduledEndAt,
          PlatformPlacement = @PlatformPlacement,
          Objective         = @Objective,
          OptimizationGoal  = @OptimizationGoal,
          BidStrategy       = @BidStrategy,
          DestinationUrl    = @DestinationUrl,
          UtmParameters     = @UtmParameters,
          Budget            = ISNULL(@Budget,            Budget),
          DailySpend        = ISNULL(@DailySpend,        DailySpend),
          Spent             = ISNULL(@Spent,             Spent),
          Status            = ISNULL(@Status,            Status),
          ExternalAdId      = ISNULL(@ExternalAdId,      ExternalAdId),
          ExternalAdSetId   = ISNULL(@ExternalAdSetId,   ExternalAdSetId),
          SyncStatus        = ISNULL(@SyncStatus,        SyncStatus),
          UpdatedBy         = @UpdatedBy,
          UpdatedAt         = SYSDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("sa-ads");
    res.json({ message: "Ad updated successfully" });
  } catch (err) {
    console.error("[sa-ads] PUT error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
        .query("UPDATE dbo.SaAd SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @Id");

      await bumpCacheVersion("sa-ads");
      res.json({ message: `Ad "${Name}" deleted successfully` });
    } catch (err) {
      console.error("[sa-ads] DELETE error:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── Ad creatives (image/video upload) ────────────────────────────────────
// GET /:id/creatives — list uploaded creatives for an ad
router.get("/:id/creatives", requirePageRight("sa-ads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT c.Id, c.MediaType, c.Label, c.FileName, c.FileSize, c.MimeType, c.UploadedAt, u.name AS UploadedByName
      FROM dbo.SaAdCreative c
      LEFT JOIN dbo.Users u ON u.id = c.UploadedBy
      WHERE c.AdId = @id
      ORDER BY c.UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-ads] GET /:id/creatives error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/creatives — upload one or more image/video creatives
router.post("/:id/creatives", requirePageRight("sa-ads", "edit"), uploadCreative.array("files", 10), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    const inserted = [];
    for (const file of files) {
      const mediaType = file.mimetype.startsWith("video/") ? "Video" : "Image";
      const result = await pool.request()
        .input("aid",   sql.Int,           id)
        .input("type",  sql.NVarChar(20),  mediaType)
        .input("label", sql.NVarChar(200), req.body.Label || null)
        .input("fname", sql.NVarChar(300), file.originalname)
        .input("sname", sql.NVarChar(300), file.filename)
        .input("fsize", sql.Int,           file.size)
        .input("mime",  sql.NVarChar(150), file.mimetype)
        .input("cb",    sql.Int,           req.user?.userId || null)
        .query(`
          INSERT INTO dbo.SaAdCreative (AdId, MediaType, Label, FileName, StoredName, FileSize, MimeType, UploadedBy, UploadedAt)
          OUTPUT INSERTED.Id
          VALUES (@aid, @type, @label, @fname, @sname, @fsize, @mime, @cb, SYSDATETIME())
        `);
      inserted.push(result.recordset[0].Id);
    }
    res.status(201).json({ success: true, ids: inserted });
  } catch (e) {
    console.error("[sa-ads] POST /:id/creatives error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/creatives/file/:creativeId — stream/download a stored creative
router.get("/:id/creatives/file/:creativeId", requirePageRight("sa-ads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const creativeId = parseInt(req.params.creativeId);
    const result = await pool.request().input("id", sql.Int, creativeId)
      .query("SELECT StoredName, FileName, MimeType FROM dbo.SaAdCreative WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Creative not found" });
    const row = result.recordset[0];
    const resolvedPath = path.resolve(UPLOAD_DIR, row.StoredName);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return res.status(403).json({ error: "Access denied" });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found on disk" });
    res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.FileName.replace(/"/g, "")}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (e) {
    console.error("[sa-ads] GET /:id/creatives/file/:creativeId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id/creatives/:creativeId
router.delete("/:id/creatives/:creativeId", requirePageRight("sa-ads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const creativeId = parseInt(req.params.creativeId);
    const result = await pool.request().input("id", sql.Int, creativeId)
      .query("SELECT StoredName FROM dbo.SaAdCreative WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Creative not found" });
    await pool.request().input("id", sql.Int, creativeId).query("DELETE FROM dbo.SaAdCreative WHERE Id = @id");
    const resolvedPath = path.resolve(UPLOAD_DIR, result.recordset[0].StoredName);
    if (resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.unlink(resolvedPath, () => {});
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-ads] DELETE /:id/creatives/:creativeId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
