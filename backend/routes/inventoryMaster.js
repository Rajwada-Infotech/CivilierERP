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
 * Returns inventory master records for a given date and godown.
 *
 * Query params:
 *  ?date=YYYY-MM-DD      (default: today)
 *  ?godownId=<int>       (default: Main Godown)
 */
router.get("/", cache("inventory-master", 60), async (req, res) => {
  try {
    const pool = getPool();

    // ── Detect optional columns ──────────────────────────────────────────────
    const hasCreatedDate = await hasColumn(
      pool,
      "dbo.StockLedger",
      "CreatedDate",
    );
    const hasEntryDate = await hasColumn(pool, "dbo.StockLedger", "EntryDate");
    const hasUomCol = await hasColumn(pool, "dbo.StockLedger", "UOM");
    const hasUomOnItem = await hasColumn(
      pool,
      "dbo.Item_Master_Group",
      "M_UOM",
    );
    const hasGodownCol = await hasColumn(pool, "dbo.StockLedger", "GodownID");

    const ledgerDateExpr =
      hasCreatedDate && hasEntryDate
        ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
        : hasCreatedDate
          ? "sl.CreatedDate"
          : hasEntryDate
            ? "sl.EntryDate"
            : "NULL";

    // ── Parse & validate params ───────────────────────────────────────────────
    const rawDate = req.query.date;
    const targetDate =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

    const rawGodownId = req.query.godownId;
    let godownId = rawGodownId ? parseInt(rawGodownId, 10) : null;

    // If no godownId supplied, resolve Main Godown ID from DB
    if (!godownId) {
      try {
        const mainRes = await pool
          .request()
          .query(
            "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE IsMain=1 AND IsDeleted=0",
          );
        godownId = mainRes.recordset[0]?.GodownID || null;
      } catch {
        godownId = null;
      }
    }

    // ── UOM join strategy ────────────────────────────────────────────────────
    //
    // FIX (root cause of 0 rows + 500 error):
    //   Item_Master_Group.M_Id is a UniqueIdentifier (UUID), not an INT.
    //   The old code used TRY_CAST(sl.ItemID AS INT) which always returns NULL
    //   for UUID strings, so the JOIN never matched. The old UOM subquery used
    //   bare equality (sl2.ItemID = img.M_Id) causing the type clash error.
    //   The correct pattern (used in materialRequests.js) is:
    //     CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
    //
    const uomJoinClause = hasUomOnItem
      ? "LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = img.M_UOM"
      : hasUomCol
        ? `LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = (
             SELECT TOP 1 sl2.UOM FROM dbo.StockLedger sl2
             WHERE CONVERT(NVARCHAR(50), sl2.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
             ORDER BY sl2.StockID DESC
           )`
        : "";

    const uomSelect = `
      uom.Id        AS UOMID,
      uom.UOMName   AS UOMName,
      uom.UOMCode   AS UOMCode,
      uom.Symbol    AS UOMSymbol
    `;

    // ── Godown filter clause for StockLedger ─────────────────────────────────
    //
    // FIX (NULL bleed): Old clause was OR sl.GodownID IS NULL which caused
    //   rows without a godown to count in every godown's balance.
    //   Migration 061 back-fills all NULLs to Main Godown, so IS NULL is gone.
    //
    // FIX (SQL injection): godownId is now a typed @godownId parameter,
    //   not string-interpolated directly into the query.
    //
    let godownFilter = "";
    if (hasGodownCol && godownId) {
      godownFilter = "AND sl.GodownID = @godownId";
    }

    const request = pool.request();
    request.input("targetDate", sql.Date, targetDate);

    // Only bind @godownId when it is actually used in the query
    if (hasGodownCol && godownId) {
      request.input("godownId", sql.Int, godownId);
    }

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
        ON CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
        ${godownFilter}
      WHERE img.Parent_Id IS NOT NULL
      GROUP BY
        img.M_Id, img.M_Name, img.M_Group, grp.M_Name,
        uom.Id, uom.UOMName, uom.UOMCode, uom.Symbol
      ORDER BY ItemGroupName, ItemName
    `);

    const rows = result.recordset.map((r) => ({
      ...r,
      OpeningStock: Number(r.OpeningStock || 0),
      StockIn: Number(r.StockIn || 0),
      StockOut: Number(r.StockOut || 0),
      ClosingStock:
        Number(r.OpeningStock || 0) +
        Number(r.StockIn || 0) -
        Number(r.StockOut || 0),
    }));

    res.json({
      date: targetDate,
      godownId: godownId,
      data: rows,
      total: rows.length,
    });
  } catch (err) {
    console.error("[inventory-master] GET error:", err.message);
    res.status(500).json({
      error: "Failed to fetch inventory master",
      message: err.message,
    });
  }
});

/**
 * POST /api/inventory-master/cache-bust
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
