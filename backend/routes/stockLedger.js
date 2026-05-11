const express = require("express");
const router = express.Router();

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");

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

function bindFilters(request, filters) {
  if (filters.itemId) {
    request.input("itemId", sql.NVarChar(50), String(filters.itemId));
  }
  if (filters.type) {
    request.input("type", sql.NVarChar(10), String(filters.type).toUpperCase());
  }
  if (filters.refType) {
    request.input("refType", sql.NVarChar(20), String(filters.refType));
  }
  if (filters.refId) {
    request.input("refId", sql.Int, parseInt(filters.refId, 10));
  }
  if (filters.dateFrom) {
    request.input("dateFrom", sql.Date, filters.dateFrom);
  }
  if (filters.dateTo) {
    request.input("dateTo", sql.Date, filters.dateTo);
  }
  if (filters.search) {
    request.input("search", sql.NVarChar(200), `%${filters.search}%`);
  }
}

function buildWhere(filters, ledgerDateExpr) {
  const clauses = ["1=1"];

  if (filters.itemId) {
    clauses.push("CONVERT(NVARCHAR(50), sl.ItemID) = @itemId");
  }
  if (filters.type) {
    clauses.push("sl.Type = @type");
  }
  if (filters.refType) {
    clauses.push("sl.RefType = @refType");
  }
  if (filters.refId) {
    clauses.push("sl.RefID = @refId");
  }
  if (filters.dateFrom) {
    clauses.push(`${ledgerDateExpr} >= @dateFrom`);
  }
  if (filters.dateTo) {
    clauses.push(`${ledgerDateExpr} < DATEADD(day, 1, @dateTo)`);
  }
  if (filters.search) {
    clauses.push(`(
      img.M_Name LIKE @search
      OR img.M_Description LIKE @search
      OR grn.GRNNo LIKE @search
      OR po.PurchaseOrderNo LIKE @search
      OR CONVERT(NVARCHAR(50), sl.ItemID) LIKE @search
      OR sl.DocNo LIKE @search
    )`);
  }

  return `WHERE ${clauses.join(" AND ")}`;
}

// ================= GET STOCK LEDGER =================
router.get("/", cache("stock-ledger", 120), async (req, res) => {
  try {
    const pool = getPool();

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      100,
    );
    const offset = (page - 1) * limit;

    const filters = {
      itemId: req.query.itemId,
      type: req.query.type,
      refType: req.query.refType,
      refId: req.query.refId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      search: req.query.search ? String(req.query.search).trim() : "",
    };

    if (
      filters.type &&
      !["IN", "OUT"].includes(String(filters.type).toUpperCase())
    ) {
      return res.status(400).json({ error: "type must be IN or OUT" });
    }
    if (filters.refId && !Number.isFinite(parseInt(filters.refId, 10))) {
      return res.status(400).json({ error: "refId must be a number" });
    }

    const hasCreatedDate = await hasColumn(
      pool,
      "dbo.StockLedger",
      "CreatedDate",
    );
    const hasEntryDate = await hasColumn(pool, "dbo.StockLedger", "EntryDate");
    const hasUom = await hasColumn(pool, "dbo.StockLedger", "UOM");
    const hasDocNo = await hasColumn(pool, "dbo.StockLedger", "DocNo");

    const ledgerDateExpr =
      hasCreatedDate && hasEntryDate
        ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
        : hasCreatedDate
          ? "sl.CreatedDate"
          : hasEntryDate
            ? "sl.EntryDate"
            : "NULL";
    const ledgerOrderExpr =
      hasCreatedDate || hasEntryDate
        ? `${ledgerDateExpr} DESC, sl.StockID DESC`
        : "sl.StockID DESC";

    const uomSelect = hasUom ? "sl.UOM" : "NULL";
    const uomNameSelect = hasUom ? "uom.UOMName" : "NULL";
    const uomSymbolSelect = hasUom ? "uom.Symbol" : "NULL";
    const uomGroupBy = hasUom ? ", sl.UOM, uom.UOMName, uom.Symbol" : "";
    const uomJoin = hasUom
      ? "LEFT JOIN dbo.UOMMaster uom ON uom.UOMCode = sl.UOM"
      : "";

    const fromJoin = `
      FROM dbo.StockLedger sl
      LEFT JOIN dbo.Item_Master_Group img
        ON img.M_Id = TRY_CONVERT(uniqueidentifier, CONVERT(NVARCHAR(50), sl.ItemID))
      LEFT JOIN dbo.Item_Master_Group parent
        ON parent.M_Id = img.Parent_Id
      ${uomJoin}
      LEFT JOIN dbo.GoodsReceiptNotes grn
        ON sl.RefType = 'GRN' AND grn.GRNID = sl.RefID
      LEFT JOIN dbo.PurchaseOrders po
        ON grn.POID = po.PurchaseOrderID
      LEFT JOIN dbo.MaterialIssues iss
        ON sl.RefType = 'ISS' AND iss.IssueId = sl.RefID
    `;
    const where = buildWhere(filters, ledgerDateExpr);

    const countReq = pool.request();
    bindFilters(countReq, filters);
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      ${fromJoin}
      ${where}
    `);
    const total = Number(countResult.recordset[0].total || 0);

    const dataReq = pool.request();
    bindFilters(dataReq, filters);
    dataReq.input("offset", sql.Int, offset);
    dataReq.input("limit", sql.Int, limit);
    const dataResult = await dataReq.query(`
      SELECT
        sl.StockID,
        CONVERT(NVARCHAR(50), sl.ItemID) AS ItemID,
        COALESCE(sl.ItemName, img.M_Name) AS ItemName,
        parent.M_Name AS ItemGroupName,
        sl.Qty,
        sl.Type,
        CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END AS SignedQty,
        ${uomSelect} AS UOM,
        ${uomNameSelect} AS UOMName,
        ${uomSymbolSelect} AS UOMSymbol,
        sl.RefType,
        sl.RefID,
        ${hasDocNo ? "sl.DocNo" : "COALESCE(grn.DocNo, iss.DocNo)"} AS DocNo,
        grn.GRNNo,
        grn.GRNDate,
        po.PurchaseOrderNo,
        iss.IssueNo,
        ${ledgerDateExpr} AS LedgerDate
      ${fromJoin}
      ${where}
      ORDER BY ${ledgerOrderExpr}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    const summaryReq = pool.request();
    bindFilters(summaryReq, filters);
    const summaryResult = await summaryReq.query(`
      SELECT
        ISNULL(SUM(CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE 0 END), 0) AS stockIn,
        ISNULL(SUM(CASE WHEN sl.Type = 'OUT' THEN sl.Qty ELSE 0 END), 0) AS stockOut,
        ISNULL(SUM(CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END), 0) AS balance,
        COUNT(*) AS transactionCount
      ${fromJoin}
      ${where}
    `);
    const summary = summaryResult.recordset[0] || {
      stockIn: 0,
      stockOut: 0,
      balance: 0,
      transactionCount: 0,
    };

    const itemReq = pool.request();
    bindFilters(itemReq, filters);
    const itemResult = await itemReq.query(`
      SELECT
        CONVERT(NVARCHAR(50), sl.ItemID) AS ItemID,
        img.M_Name AS ItemName,
        parent.M_Name AS ItemGroupName,
        ${uomSelect} AS UOM,
        ${uomNameSelect} AS UOMName,
        ${uomSymbolSelect} AS UOMSymbol,
        ISNULL(SUM(CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE 0 END), 0) AS stockIn,
        ISNULL(SUM(CASE WHEN sl.Type = 'OUT' THEN sl.Qty ELSE 0 END), 0) AS stockOut,
        ISNULL(SUM(CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END), 0) AS balance
      ${fromJoin}
      ${where}
      GROUP BY
        CONVERT(NVARCHAR(50), sl.ItemID),
        img.M_Name,
        parent.M_Name
        ${uomGroupBy}
      ORDER BY img.M_Name, CONVERT(NVARCHAR(50), sl.ItemID)
    `);

    res.json({
      data: dataResult.recordset,
      summary,
      byItem: itemResult.recordset,
      balance: Number(summary.balance || 0),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      filters,
    });
  } catch (err) {
    console.error("StockLedger error:", err);
    res.status(500).json({
      error: "Failed to fetch stock ledger",
      message: err.message,
    });
  }
});

module.exports = router;
