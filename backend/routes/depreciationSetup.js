const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests" } }));

const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");

router.use(authenticateToken);

// GET / — all records (optionally ?status=Active)
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `SELECT * FROM dbo.DepreciationSetup`;
    if (req.query.status) {
      query += ` WHERE Status = @Status`;
      request.input("Status", sql.NVarChar(20), req.query.status);
    }
    query += ` ORDER BY AssetCategory`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /active — only Active records (used by Fixed Asset form dropdown)
router.get("/active", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT SetupId, AssetCategory, DepreciationType, DepreciationRate, EffectiveFrom
      FROM dbo.DepreciationSetup
      WHERE Status = 'Active'
      ORDER BY AssetCategory
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create
router.post("/", requirePageRight("depreciation-setup", "create"), async (req, res) => {
  const { assetCategory, depreciationType, depreciationRate, effectiveFrom, status } = req.body;
  if (!assetCategory || depreciationRate == null || !effectiveFrom)
    return res.status(400).json({ error: "assetCategory, depreciationRate and effectiveFrom are required" });

  try {
    const pool = getPool();
    // Duplicate check: only one Active record per category
    const dup = await pool.request()
      .input("Cat", sql.NVarChar(100), assetCategory)
      .query(`SELECT 1 FROM dbo.DepreciationSetup WHERE AssetCategory = @Cat AND Status = 'Active'`);
    if (dup.recordset.length)
      return res.status(409).json({ error: `An active depreciation record for "${assetCategory}" already exists` });

    await pool.request()
      .input("AssetCategory",    sql.NVarChar(100), assetCategory)
      .input("DepreciationType", sql.NVarChar(50),  depreciationType || "SLM")
      .input("DepreciationRate", sql.Decimal(5, 2), parseFloat(depreciationRate))
      .input("EffectiveFrom",    sql.Date,          effectiveFrom)
      .input("Status",           sql.NVarChar(20),  status || "Active")
      .input("CreatedBy",        sql.NVarChar(200), req.user?.email || null)
      .query(`
        INSERT INTO dbo.DepreciationSetup
          (AssetCategory, DepreciationType, DepreciationRate, EffectiveFrom, Status, CreatedBy, CreatedAt)
        VALUES
          (@AssetCategory, @DepreciationType, @DepreciationRate, @EffectiveFrom, @Status, @CreatedBy, SYSDATETIME())
      `);

    await bumpCacheVersion("depreciation-setup");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update
router.put("/:id", requirePageRight("depreciation-setup", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { assetCategory, depreciationType, depreciationRate, effectiveFrom, status } = req.body;

  try {
    const pool = getPool();
    // Duplicate check (exclude self)
    if (assetCategory) {
      const dup = await pool.request()
        .input("Cat", sql.NVarChar(100), assetCategory)
        .input("Id",  sql.Int,           id)
        .query(`SELECT 1 FROM dbo.DepreciationSetup WHERE AssetCategory = @Cat AND Status = 'Active' AND SetupId <> @Id`);
      if (dup.recordset.length)
        return res.status(409).json({ error: `An active depreciation record for "${assetCategory}" already exists` });
    }

    await pool.request()
      .input("SetupId",          sql.Int,           id)
      .input("AssetCategory",    sql.NVarChar(100), assetCategory || null)
      .input("DepreciationType", sql.NVarChar(50),  depreciationType || null)
      .input("DepreciationRate", sql.Decimal(5, 2), depreciationRate != null ? parseFloat(depreciationRate) : null)
      .input("EffectiveFrom",    sql.Date,          effectiveFrom || null)
      .input("Status",           sql.NVarChar(20),  status || null)
      .input("UpdatedBy",        sql.NVarChar(200), req.user?.email || null)
      .query(`
        UPDATE dbo.DepreciationSetup SET
          AssetCategory    = ISNULL(@AssetCategory,    AssetCategory),
          DepreciationType = ISNULL(@DepreciationType, DepreciationType),
          DepreciationRate = ISNULL(@DepreciationRate, DepreciationRate),
          EffectiveFrom    = ISNULL(@EffectiveFrom,    EffectiveFrom),
          Status           = ISNULL(@Status,           Status),
          UpdatedBy        = @UpdatedBy,
          UpdatedAt        = SYSDATETIME()
        WHERE SetupId = @SetupId
      `);

    await bumpCacheVersion("depreciation-setup");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — hard delete (only if not referenced)
router.delete("/:id", requirePageRight("depreciation-setup", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const inUse = await pool.request()
      .input("Id", sql.Int, id)
      .query(`SELECT TOP 1 1 FROM dbo.FixedAssetRecord WHERE DepreciationSetupId = @Id`);
    if (inUse.recordset.length)
      return res.status(409).json({ error: "Cannot delete — this depreciation rate is used by existing assets" });

    await pool.request().input("SetupId", sql.Int, id).query(`DELETE FROM dbo.DepreciationSetup WHERE SetupId = @SetupId`);
    await bumpCacheVersion("depreciation-setup");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
