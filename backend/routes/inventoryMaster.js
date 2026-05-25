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
 * ?date=YYYY-MM-DD  (default: today)
 * ?godownId=<int>   (default: Main Godown)
 */
router.get("/", cache("inventory-master", 60), async (req, res) => {
  try {
    const pool = getPool();

    // ── Detect optional columns ──────────────────────────────────────────────
    const [
      hasCreatedDate,
      hasEntryDate,
      hasUomCol,
      hasUomOnItem,
      hasGodownCol,
    ] = await Promise.all([
      hasColumn(pool, "dbo.StockLedger", "CreatedDate"),
      hasColumn(pool, "dbo.StockLedger", "EntryDate"),
      hasColumn(pool, "dbo.StockLedger", "UOM"),
      hasColumn(pool, "dbo.Item_Master_Group", "M_UOM"),
      hasColumn(pool, "dbo.StockLedger", "GodownID"),
    ]);

    const ledgerDateExpr =
      hasCreatedDate && hasEntryDate
        ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
        : hasCreatedDate
          ? "sl.CreatedDate"
          : hasEntryDate
            ? "sl.EntryDate"
            : null;

    // ── Parse params ─────────────────────────────────────────────────────────
    const rawDate = req.query.date;
    const targetDate =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

    const rawGodownId = req.query.godownId;
    let godownId = rawGodownId ? parseInt(rawGodownId, 10) : null;

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
    // Prefer M_UOM on item table; fall back to last UOM in StockLedger.
    // When neither exists, return NULLs for UOM columns (no join at all).
    let uomJoinClause = "";
    let uomSelect =
      "NULL AS UOMID, NULL AS UOMName, NULL AS UOMCode, NULL AS UOMSymbol";
    let uomGroupBy = "";

    if (hasUomOnItem) {
      uomJoinClause = "LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = img.M_UOM";
      uomSelect =
        "uom.Id AS UOMID, uom.UOMName AS UOMName, uom.UOMCode AS UOMCode, uom.Symbol AS UOMSymbol";
      uomGroupBy = ", uom.Id, uom.UOMName, uom.UOMCode, uom.Symbol";
    } else if (hasUomCol) {
      uomJoinClause = `LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = (
        SELECT TOP 1 sl2.UOM FROM dbo.StockLedger sl2
        WHERE CONVERT(NVARCHAR(50), sl2.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
        ORDER BY sl2.StockID DESC
      )`;
      uomSelect =
        "uom.Id AS UOMID, uom.UOMName AS UOMName, uom.UOMCode AS UOMCode, uom.Symbol AS UOMSymbol";
      uomGroupBy = ", uom.Id, uom.UOMName, uom.UOMCode, uom.Symbol";
    }

    // ── Godown filter ────────────────────────────────────────────────────────
    let godownFilter = "";
    if (hasGodownCol && godownId) {
      godownFilter = "AND sl.GodownID = @godownId";
    }

    // ── Date filter expressions ──────────────────────────────────────────────
    const openingExpr = ledgerDateExpr
      ? `ISNULL(SUM(CASE
           WHEN CAST(${ledgerDateExpr} AS DATE) < @targetDate
           THEN CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END
           ELSE 0
         END), 0)`
      : "0";

    const stockInExpr = ledgerDateExpr
      ? `ISNULL(SUM(CASE
           WHEN CAST(${ledgerDateExpr} AS DATE) = @targetDate AND sl.Type = 'IN'
           THEN sl.Qty ELSE 0
         END), 0)`
      : "0";

    const stockOutExpr = ledgerDateExpr
      ? `ISNULL(SUM(CASE
           WHEN CAST(${ledgerDateExpr} AS DATE) = @targetDate AND sl.Type = 'OUT'
           THEN sl.Qty ELSE 0
         END), 0)`
      : "0";

    const dateRangeFilter = ledgerDateExpr
      ? `AND (${ledgerDateExpr} IS NULL OR CAST(${ledgerDateExpr} AS DATE) <= @targetDate)`
      : "";

    // ── Build & run query ────────────────────────────────────────────────────
    const request = pool.request().input("targetDate", sql.Date, targetDate);
    if (hasGodownCol && godownId) {
      request.input("godownId", sql.Int, godownId);
    }

    // ── Godown name + IsMain ────────────────────────────────────────────────────
    // Fetch once — the entire query is already scoped to a single godownId.
    let godownName = "Main Godown";
    let isMainGodown = true;
    if (hasGodownCol && godownId) {
      try {
        const gdRes = await pool
          .request()
          .input("gid", sql.Int, godownId)
          .query(
            "SELECT TOP 1 GodownName, ISNULL(IsMain,0) AS IsMain FROM dbo.Godowns WHERE GodownID=@gid",
          );
        if (gdRes.recordset.length) {
          godownName = gdRes.recordset[0].GodownName ?? "Main Godown";
          isMainGodown = !!gdRes.recordset[0].IsMain;
        }
      } catch {
        // non-fatal: defaults stay
      }
    }

    const result = await request.query(`
      SELECT
        CONVERT(NVARCHAR(50), img.M_Id)          AS ItemID,
        img.M_Name                               AS ItemName,
        ISNULL(grp.M_Name, img.M_Group)          AS ItemGroupName,
        ${uomSelect},
        ${openingExpr}                           AS OpeningStock,
        ${stockInExpr}                           AS StockIn,
        ${stockOutExpr}                          AS StockOut
      FROM dbo.Item_Master_Group img
      LEFT JOIN dbo.Item_Master_Group grp
        ON grp.M_Id = img.Parent_Id
      ${uomJoinClause}
      LEFT JOIN dbo.StockLedger sl
        ON CONVERT(NVARCHAR(50), sl.ItemID) = CONVERT(NVARCHAR(50), img.M_Id)
        ${godownFilter}
        ${dateRangeFilter}
      WHERE img.Parent_Id IS NOT NULL
      GROUP BY
        img.M_Id, img.M_Name, img.M_Group, grp.M_Name
        ${uomGroupBy}
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
      GodownName: godownName,
      IsMainGodown: isMainGodown,
    }));

    res.json({
      date: targetDate,
      godownId,
      godownName,
      isMainGodown,
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
