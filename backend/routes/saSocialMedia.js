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
const PERMISSION_SUBMODULE = "SocialMedia";

bumpCacheVersion("sa-social-media").catch(() => {});

// GET /
router.get(
  "/",
  requirePageRight("sa-social-media", "view"),
  cache("sa-social-media", 300),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT
          p.Id,
          p.Name,
          p.PlatformType,
          p.AccountDetails,
          p.Notes,
          p.IsActive,
          p.CreatedAt,
          p.UpdatedAt,
          (SELECT COUNT(*) FROM dbo.SaCampaign c WHERE c.PlatformId = p.Id) AS CampaignCount,
          (SELECT COUNT(*) FROM dbo.SaCampaign c
             JOIN dbo.SaAd a ON a.CampaignId = c.Id
             WHERE c.PlatformId = p.Id AND a.IsActive = 1) AS ActiveAdCount
        FROM dbo.SaSocialMediaPlatform p
        ORDER BY p.Name
      `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[sa-social-media] GET error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

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
      await pool
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
          VALUES
            (@Name, @PlatformType, @AccountDetails, @Notes, @IsActive, @CreatedBy, @CreatedAt)
        `);
      await bumpCacheVersion("sa-social-media");
      res.json({ message: "Social media platform added successfully" });
    } catch (err) {
      console.error("[sa-social-media] POST error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// PUT /:id
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
      res.status(500).json({ error: err.message });
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

      const linked = await pool
        .request()
        .input("Id", sql.Int, id)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.SaCampaign WHERE PlatformId = @Id");

      if (linked.recordset[0].Cnt > 0) {
        return res.status(400).json({
          error: "Cannot delete - one or more campaigns reference this platform",
        });
      }

      const existing = await pool
        .request()
        .input("Id", sql.Int, id)
        .query("SELECT Name FROM dbo.SaSocialMediaPlatform WHERE Id = @Id");

      if (!existing.recordset.length) {
        return res.status(404).json({ error: "Platform not found" });
      }

      const { Name } = existing.recordset[0];

      await pool
        .request()
        .input("Id", sql.Int, id)
        .query("DELETE FROM dbo.SaSocialMediaPlatform WHERE Id = @Id");

      await bumpCacheVersion("sa-social-media");
      res.json({ message: `Platform "${Name}" deleted successfully` });
    } catch (err) {
      console.error("[sa-social-media] DELETE error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;