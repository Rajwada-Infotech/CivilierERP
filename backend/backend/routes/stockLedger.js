const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Material", "StockLedger"));

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

// ─── Schema cache (probed once on first request, reused thereafter) ───────────
let _schemaCache = null;

async function getSchema(pool) {
  if (_schemaCache) return _schemaCache;
  const [hasCreatedDate, hasEntryDate, hasUom, hasDocNo, hasGodownID] =
    await Promise.all([
      hasColumn(pool, "dbo.StockLedger", "CreatedDate"),
      hasColumn(pool, "dbo.StockLedger", "EntryDate"),
      hasColumn(pool, "dbo.StockLedger", "UOM"),
      hasColumn(pool, "dbo.StockLedger", "DocNo"),
      hasColumn(pool, "dbo.StockLedger", "GodownID"),
    ]);
  _schemaCache = { hasCreatedDate, hasEntryDate, hasUom, hasDocNo, hasGodownID };
  return _schemaCache;
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

// hasDocNo must be passed so the search clause never references sl.DocNo
// when that column doesn't exist in this DB's StockLedger schema.
function buildWhere(filters, ledgerDateExpr, hasGodownID, hasDocNo) {
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
  if (hasGodownID && filters.godownId != null) {
    clauses.push("sl.GodownID = @godownId");
  }
  if (filters.search) {
    // Only include sl.DocNo in the search predicate when the column exists.
    const docNoClause = hasDocNo ? "\n      OR sl.DocNo LIKE @search" : "";
    clauses.push(`(
      img.M_Name LIKE @search
      OR img.M_Description LIKE @search
      OR grn.GRNNo LIKE @search
      OR po.PurchaseOrderNo LIKE @search
      OR CONVERT(NVARCHAR(50), sl.ItemID) LIKE @search${docNoClause}
    )`);
  }

  return `WHERE ${clauses.join(" AND ")}`;
}

// ================= GET STOCK LEDGER =================
router.get("/", cache("stock-ledger", 120), async (req, res) => {
  try {
    const pool = getPool();

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    // Allow up to 2000 rows so the Stock Summary report (which sends limit=500)
    // gets a complete picture. The internal ledger view still defaults to 10.
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      2000,
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
      // Godown filter: optional — omit to get all godowns
      godownId: req.query.godownId ? parseInt(req.query.godownId, 10) : null,
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
    if (req.query.godownId && !Number.isFinite(filters.godownId)) {
      return res.status(400).json({ error: "godownId must be a number" });
    }

    // ── Schema probing (cached after first request) ───────────────────────────
    const { hasCreatedDate, hasEntryDate, hasUom, hasDocNo, hasGodownID } =
      await getSchema(pool);

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

    // Godown join — only when the column exists in the schema
    const godownJoin = hasGodownID
      ? "LEFT JOIN dbo.Godowns gd ON gd.GodownID = sl.GodownID"
      : "";
    const godownIdSelect = hasGodownID ? "sl.GodownID" : "NULL";
    const godownNameSelect = hasGodownID
      ? "ISNULL(gd.GodownName, 'Main Godown')"
      : "'Main Godown'";
    // Include GodownID in GROUP BY only when the column exists
    const godownGroupBy = hasGodownID ? ", sl.GodownID, gd.GodownName" : "";

    // StockLedger.ItemID is NVarChar storing a GUID string that matches
    // Item_Master_Group.M_Id (uniqueidentifier).
    // TRY_CAST to UNIQUEIDENTIFIER is the correct cast — never INT.
    // Non-GUID rows yield NULL and the LEFT JOIN produces no match; the SELECT
    // falls back to COALESCE(img.M_Name, CONVERT(NVARCHAR(50), sl.ItemID)).
    const fromJoin = `
      FROM dbo.StockLedger sl
      LEFT JOIN dbo.Item_Master_Group img
        ON img.M_Id = TRY_CAST(sl.ItemID AS UNIQUEIDENTIFIER)
      LEFT JOIN dbo.Item_Master_Group parent
        ON parent.M_Id = img.Parent_Id
      ${uomJoin}
      ${godownJoin}
      LEFT JOIN dbo.GoodsReceiptNotes grn
        ON sl.RefType = 'GRN' AND grn.GRNID = sl.RefID
      LEFT JOIN dbo.PurchaseOrders po
        ON grn.POID = po.PurchaseOrderID
      LEFT JOIN dbo.MaterialIssues iss
        ON sl.RefType = 'ISS' AND iss.IssueId = sl.RefID
    `;

    const where = buildWhere(filters, ledgerDateExpr, hasGodownID, hasDocNo);

    // ── Bind helper — includes godownId when present ──────────────────────────
    function bindAll(request) {
      bindFilters(request, filters);
      if (hasGodownID && filters.godownId != null) {
        request.input("godownId", sql.Int, filters.godownId);
      }
      return request;
    }

    // ── COUNT ─────────────────────────────────────────────────────────────────
    const countResult = await bindAll(pool.request()).query(`
      SELECT COUNT(*) AS total
      ${fromJoin}
      ${where}
    `);
    const total = Number(countResult.recordset[0].total || 0);

    // ── PAGINATED DETAIL ROWS ─────────────────────────────────────────────────
    const dataReq = bindAll(pool.request());
    dataReq.input("offset", sql.Int, offset);
    dataReq.input("limit", sql.Int, limit);
    const dataResult = await dataReq.query(`
      SELECT
        sl.StockID,
        CONVERT(NVARCHAR(50), sl.ItemID) AS ItemID,
        COALESCE(img.M_Name, CONVERT(NVARCHAR(50), sl.ItemID)) AS ItemName,
        parent.M_Name AS ItemGroupName,
        sl.Qty,
        sl.Type,
        CASE WHEN sl.Type = 'IN' THEN sl.Qty ELSE -sl.Qty END AS SignedQty,
        ${uomSelect} AS UOM,
        ${uomNameSelect} AS UOMName,
        ${uomSymbolSelect} AS UOMSymbol,
        ${godownIdSelect} AS GodownID,
        ${godownNameSelect} AS GodownName,
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

    // ── OVERALL SUMMARY ───────────────────────────────────────────────────────
    const summaryResult = await bindAll(pool.request()).query(`
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

    // ── BY-ITEM SUMMARY (one row per item × godown) ───────────────────────────
    // GodownID is included in GROUP BY so the Report page sees per-godown
    // balances rather than a collapsed total that hides where stock actually is.
    const itemResult = await bindAll(pool.request()).query(`
      SELECT
        CONVERT(NVARCHAR(50), sl.ItemID) AS ItemID,
        COALESCE(img.M_Name, CONVERT(NVARCHAR(50), sl.ItemID)) AS ItemName,
        parent.M_Name AS ItemGroupName,
        ${uomSelect} AS UOM,
        ${uomNameSelect} AS UOMName,
        ${uomSymbolSelect} AS UOMSymbol,
        ${godownIdSelect} AS GodownID,
        ${godownNameSelect} AS GodownName,
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
        ${godownGroupBy}
      ORDER BY img.M_Name, CONVERT(NVARCHAR(50), sl.ItemID)
    `);

    // ── GODOWN LIST (for filter dropdowns) ────────────────────────────────────
    // Return every godown that has at least one ledger entry so the UI can
    // offer a "filter by godown" control without a separate API call.
    let godowns = [];
    if (hasGodownID) {
      const godownListResult = await pool.request().query(`
        SELECT DISTINCT
          gd.GodownID,
          ISNULL(gd.GodownName, 'Main Godown') AS GodownName,
          gd.GodownCode,
          ISNULL(gd.IsMain, 0) AS IsMain
        FROM dbo.StockLedger sl
        INNER JOIN dbo.Godowns gd ON gd.GodownID = sl.GodownID
        WHERE gd.IsDeleted = 0 OR gd.IsDeleted IS NULL
        ORDER BY gd.IsMain DESC, gd.GodownName ASC
      `);
      godowns = godownListResult.recordset;
    }

    res.json({
      data: dataResult.recordset,
      summary,
      byItem: itemResult.recordset,
      godowns,
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

// Evict any stale cached 500 responses that may have been written before this
// fix was deployed. Fire-and-forget — never block the route from loading.
bumpCacheVersion("stock-ledger").catch(() => {});

module.exports = router;