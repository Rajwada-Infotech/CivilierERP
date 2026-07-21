// backend/routes/itemUomAlternates.js
//
// Per-item alternate UOMs with their own conversion factor — see
// backend/migrations/221-240/236-item-uom-alternates.sql for why this is a
// separate table from UOMMaster's category/BaseFactor conversion.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    validate: false,
    message: { error: "Too many requests, please try again later." },
  }),
);
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");

// GET all alternates across every item — MR/PO load this once and group by
// ItemId client-side instead of firing one request per line item.
router.get("/", cache("item-uom-alternates", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT a.ItemId, a.UOMCode, a.ConversionFactor,
             u.UOMName, u.Symbol
      FROM dbo.ItemUOMAlternate a
      LEFT JOIN dbo.UOMMaster u ON u.UOMCode = a.UOMCode
      ORDER BY a.ItemId, u.UOMName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[item-uom-alternates] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET alternates for one item
router.get("/:itemId", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("ItemId", sql.UniqueIdentifier, req.params.itemId).query(`
        SELECT a.ItemId, a.UOMCode, a.ConversionFactor,
               u.UOMName, u.Symbol
        FROM dbo.ItemUOMAlternate a
        LEFT JOIN dbo.UOMMaster u ON u.UOMCode = a.UOMCode
        WHERE a.ItemId = @ItemId
        ORDER BY u.UOMName
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[item-uom-alternates] GET/:itemId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — replace the full alternate-UOM set for one item.
// Body: { rows: [{ UOMCode, ConversionFactor }, ...] }
router.put(
  "/:itemId",
  requirePageRight("item-master", "edit"),
  async (req, res) => {
    const { itemId } = req.params;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    for (const r of rows) {
      const factor = Number(r.ConversionFactor);
      if (!r.UOMCode || !Number.isFinite(factor) || factor <= 0) {
        return res.status(400).json({
          error: `Invalid row: UOMCode "${r.UOMCode}" needs a positive ConversionFactor`,
        });
      }
    }

    const pool = getPool();
    const tx = pool.transaction();
    try {
      await tx.begin();
      await tx
        .request()
        .input("ItemId", sql.UniqueIdentifier, itemId)
        .query("DELETE FROM dbo.ItemUOMAlternate WHERE ItemId = @ItemId");

      for (const r of rows) {
        await tx
          .request()
          .input("ItemId", sql.UniqueIdentifier, itemId)
          .input("UOMCode", sql.VarChar(10), r.UOMCode)
          .input("ConversionFactor", sql.Decimal(18, 6), Number(r.ConversionFactor))
          .query(`
            INSERT INTO dbo.ItemUOMAlternate (ItemId, UOMCode, ConversionFactor)
            VALUES (@ItemId, @UOMCode, @ConversionFactor)
          `);
      }

      await tx.commit();
      await bumpCacheVersion("item-uom-alternates");
      res.json({ message: "Alternate UOMs saved successfully" });
    } catch (err) {
      await tx.rollback().catch(() => {});
      console.error("[item-uom-alternates] PUT error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
