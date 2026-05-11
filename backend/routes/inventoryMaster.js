const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function hasColumn(pool, tableName, columnName) {
  const result = await pool
    .request()
    .input("tableName", sql.NVarChar(128), tableName)
    .input("columnName", sql.NVarChar(128), columnName).query(`
      SELECT COUNT(1) AS cnt
      FROM sys.columns
      WHERE object_id = OBJECT_ID(@tableName)
        AND name = @columnName
    `);
  return result.recordset[0].cnt > 0;
}

/**
 * GET /api/inventory-master
 *
 * Returns inventory master records for a given date (defaults to today).
 * Each row has:
 *  - AcquiringDate   : the date filter
 *  - ItemID / ItemName / ItemGroupName  : from Item_Master_Group
 *  - UOMID / UOMName / UOMCode / UOMSymbol : from UOMMaster (linked via M_UOM on item)
 *  - OpeningStock    : net qty in StockLedger BEFORE the given date
 *  - StockIn         : total IN qty on that date
 *  - StockOut        : total OUT qty on that date
 *  - ClosingStock    : OpeningStock + StockIn - StockOut  (closing for the day)
 *
 * Query params:
 *  ?date=YYYY-MM-DD   (default: today)
 */
router.get("/", cache("inventory-master", 60), async (req, res) => {
  try {
    const pool = getPool();

    // ── Detect optional columns ──────────────────────────────────────────────
    const hasCreatedDate = await hasColumn(pool, "dbo.StockLedger", "CreatedDate");
    const hasEntryDate   = await hasColumn(pool, "dbo.StockLedger", "EntryDate");
    const hasUomCol      = await hasColumn(pool, "dbo.StockLedger", "UOM");
    const hasUomOnItem   = await hasColumn(pool, "dbo.Item_Master_Group", "M_UOM");

    const ledgerDateExpr =
      hasCreatedDate && hasEntryDate
        ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
        : hasCreatedDate
          ? "sl.CreatedDate"
          : hasEntryDate
            ? "sl.EntryDate"
            : "NULL";

    // ── Parse & validate date param ──────────────────────────────────────────
    const rawDate = req.query.date;
    const targetDate =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

    // ── UOM join strategy ────────────────────────────────────────────────────
    //   Prefer item-level UOM (M_UOM on Item_Master_Group → join UOMMaster on UOMCode).
    //   Fall back to StockLedger.UOM column if item doesn't carry UOM.
    const uomJoinClause = hasUomOnItem
      ? "LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = img.M_UOM"
      : hasUomCol
        ? `LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = (
             SELECT TOP 1 sl2.UOM FROM dbo.StockLedger sl2
             WHERE sl2.ItemID = img.M_Id
             ORDER BY sl2.StockID DESC
           )`
        : "";

    const uomSelect = `
      uom.Id        AS UOMID,
      uom.UOMName   AS UOMName,
      uom.UOMCode   AS UOMCode,
      uom.Symbol    AS UOMSymbol
    `;

    // ── Main query ───────────────────────────────────────────────────────────
    //  We aggregate per item:
    //    OpeningStock = SUM of all movements BEFORE targetDate
    //    StockIn      = SUM of IN movements ON targetDate
    //    StockOut     = SUM of OUT movements ON targetDate
    //    ClosingStock = OpeningStock + StockIn - StockOut

    const request = pool.request();
    request.input("targetDate", sql.Date, targetDate);

    const result = await request.query(`
      SELECT
        @targetDate                                        AS AcquiringDate,
        CONVERT(NVARCHAR(50), img.M_Id)                   AS ItemID,
        img.M_Name                                        AS ItemName,
        ISNULL(grp.M_Name, img.M_Group)                   AS ItemGroupName,
        ${uomSelect},
        ISNULL(SUM(
          CASE
            WHEN CAST(${ledgerDateExpr || "NULL"} AS DATE) < @targetDate
            THEN CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END
            ELSE 0
          END
        ), 0)                                             AS OpeningStock,
        ISNULL(SUM(
          CASE
            WHEN CAST(${ledgerDateExpr || "NULL"} AS DATE) = @targetDate
             AND sl.Type = 'IN'
            THEN sl.Qty ELSE 0
          END
        ), 0)                                             AS StockIn,
        ISNULL(SUM(
          CASE
            WHEN CAST(${ledgerDateExpr || "NULL"} AS DATE) = @targetDate
             AND sl.Type = 'OUT'
            THEN sl.Qty ELSE 0
          END
        ), 0)                                             AS StockOut
      FROM dbo.Item_Master_Group img
      LEFT JOIN dbo.Item_Master_Group grp
        ON grp.M_Id = img.Parent_Id
      ${uomJoinClause}
      LEFT JOIN dbo.StockLedger sl
        ON TRY_CONVERT(uniqueidentifier, CONVERT(NVARCHAR(50), sl.ItemID)) = img.M_Id
      WHERE img.Parent_Id IS NOT NULL        -- only leaf items, not groups
      GROUP BY
        img.M_Id, img.M_Name, img.M_Group, grp.M_Name,
        uom.Id, uom.UOMName, uom.UOMCode, uom.Symbol
      ORDER BY ItemGroupName, ItemName
    `);

    // ── Compute ClosingStock in JS (simpler than nested SQL) ─────────────────
    const rows = result.recordset.map((r) => ({
      ...r,
      OpeningStock: Number(r.OpeningStock || 0),
      StockIn:      Number(r.StockIn      || 0),
      StockOut:     Number(r.StockOut     || 0),
      ClosingStock: Number(r.OpeningStock || 0) + Number(r.StockIn || 0) - Number(r.StockOut || 0),
    }));

    res.json({
      date: targetDate,
      data: rows,
      total: rows.length,
    });
  } catch (err) {
    console.error("[inventory-master] GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch inventory master", message: err.message });
  }
});

/**
 * POST /api/inventory-master/cache-bust
 * Clears the cached inventory master data.
 */
router.post("/cache-bust", async (req, res) => {
  try {
    await bumpCacheVersion("inventory-master");
    res.json({ message: "Inventory master cache cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
