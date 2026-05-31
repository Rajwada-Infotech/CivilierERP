const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { validateBody } = require("../middleware/validateRequest");
const { grnBodySchema } = require("../validation/financialRouteSchemas");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  resolveGRNPrefix,
  previewNextDocNumber,
} = require("../utils/docNumberLock");

router.use(checkPermissionForMethod("Material", "GRN"));

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

function parseGRNItems(grnItems) {
  if (Array.isArray(grnItems)) return grnItems;
  if (typeof grnItems === "string" && grnItems.trim())
    return JSON.parse(grnItems);
  return [];
}

/** Sum rate × quantity for every line item, falling back to stored totalAmount. */
function computeGRNTotal(grnItems) {
  const items = parseGRNItems(grnItems);
  return items.reduce((sum, item) => {
    const lineTotal =
      Number(item.totalAmount) > 0
        ? Number(item.totalAmount)
        : Number(item.rate || 0) * Number(item.quantity || 0);
    return sum + lineTotal;
  }, 0);
}

// Normalise the GRNItems field on a raw DB row so the client always
// receives a parsed array, never a raw JSON string. This prevents the
// frontend from needing to double-parse and avoids issues with truncated
// strings returned by some MSSQL NVARCHAR(MAX) driver configurations.
function normaliseGRNRow(row) {
  if (!row) return row;
  try {
    row.GRNItems = parseGRNItems(row.GRNItems);
  } catch {
    row.GRNItems = [];
  }
  // Parse the parent PO's GST JSON so the frontend can auto-fill GST rates
  if (row.ParentGST && typeof row.ParentGST === "string") {
    try {
      row.ParentGST = JSON.parse(row.ParentGST);
    } catch {
      row.ParentGST = null;
    }
  }
  return row;
}

async function resolveMainGodownId(pool) {
  try {
    const res = await pool
      .request()
      .query(
        "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE IsMain = 1 AND IsDeleted = 0 ORDER BY GodownID",
      );
    return res.recordset[0]?.GodownID || null;
  } catch {
    return null;
  }
}

async function insertStockLedgerEntries(
  transaction,
  grnId,
  grnItems,
  docNo,
  godownId,
) {
  const items = parseGRNItems(grnItems);

  for (const item of items) {
    if (item.itemId && Number(item.receivedQty) > 0) {
      await transaction
        .request()
        .input("ItemID", sql.NVarChar(50), item.itemId)
        .input("Qty", sql.Decimal(18, 2), Number(item.receivedQty))
        .input("UOM", sql.NVarChar(20), item.uom || null)
        .input("Type", sql.NVarChar(10), "IN")
        .input("RefType", sql.NVarChar(20), "GRN")
        .input("RefID", sql.Int, grnId)
        .input("DocNo", sql.NVarChar(100), docNo || null)
        .input("GodownID", sql.Int, godownId || null).query(`
          INSERT INTO StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, DocNo, GodownID, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, @DocNo, @GodownID, GETDATE())
        `);
    }
  }
}

// GET /grn-gst-data?grnId=<id>
// Returns a fully computed GST breakdown for an Expense Booking against a GRN.
// Reads receivedQty + rate from GRNItems JSON, HSN/GST% from ItemMaster,
// vendor/company states from the linked PO + supplier + enterprise tables.
// Must be declared before /:id to avoid being swallowed by the param route.
router.get("/grn-gst-data", async (req, res) => {
  const grnId = parseInt(req.query.grnId, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "grnId is required" });

  try {
    const pool = await getPool();

    // ── 1. Fetch GRN header + linked PO/supplier/company context ────────────
    const headerResult = await pool.request().input("GRNID", sql.Int, grnId)
      .query(`
        SELECT
          grn.GRNID,
          grn.GRNNo,
          grn.GRNItems,
          grn.POID,
          grn.SupplierID,
          p.PurchaseOrderNo  AS PONo,
          s.LHeadName        AS SupplierName,
          s.LGSTState        AS VendorState,
          company.state      AS CompanyState,
          p.CompanyId
        FROM GoodsReceiptNotes grn
        LEFT JOIN PurchaseOrders        p       ON p.PurchaseOrderID = grn.POID
        LEFT JOIN dbo.AccountHeadMaster s       ON s.LHeadId        = grn.SupplierID
        LEFT JOIN dbo.enterprise        company ON company.id        = p.CompanyId
        WHERE grn.GRNID = @GRNID
      `);

    if (headerResult.recordset.length === 0)
      return res.status(404).json({ error: "GRN not found" });

    const hdr = headerResult.recordset[0];
    const grnItems = parseGRNItems(hdr.GRNItems);

    if (grnItems.length === 0)
      return res.json({
        grnId,
        grnNo: hdr.GRNNo,
        poId: hdr.POID || null,
        poNo: hdr.PONo || null,
        supplierId: hdr.SupplierID || null,
        supplierName: hdr.SupplierName || null,
        companyId: hdr.CompanyId || null,
        vendorState: hdr.VendorState || "",
        companyState: hdr.CompanyState || "",
        taxMode: "cgst_sgst",
        gstPercent: 0,
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 0,
        totals: {
          taxableAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          gstAmount: 0,
          netAmount: 0,
          receivedQty: 0,
        },
        lines: [],
      });

    // ── 2. Determine tax mode (intra vs inter state) ─────────────────────────
    const vendorState = (hdr.VendorState || "").trim().toLowerCase();
    const companyState = (hdr.CompanyState || "").trim().toLowerCase();
    const taxMode =
      vendorState && companyState && vendorState === companyState
        ? "cgst_sgst"
        : "igst";

    // ── 3. Fetch HSN/GST% for every itemId present in GRN items ─────────────
    //    Items store GST% directly when saved, but we re-fetch from ItemMaster
    //    as the authoritative source for accuracy.
    const itemIds = [...new Set(grnItems.map((i) => i.itemId).filter(Boolean))];

    let hsnMap = {}; // itemId → { hsnCode, gstPercent }
    if (itemIds.length > 0) {
      // Build parameterised list  @p0, @p1, …
      const req2 = pool.request();
      const placeholders = itemIds.map((id, idx) => {
        req2.input(`p${idx}`, sql.NVarChar(50), String(id));
        return `@p${idx}`;
      });
      const hsnResult = await req2.query(`
        SELECT ItemId, HSNCode, GSTPercent
        FROM   dbo.ItemMaster
        WHERE  ItemId IN (${placeholders.join(",")})
      `);
      for (const row of hsnResult.recordset) {
        hsnMap[String(row.ItemId)] = {
          hsnCode: row.HSNCode || null,
          gstPercent: Number(row.GSTPercent) || 0,
        };
      }
    }

    // ── 4. Compute per-line GST ──────────────────────────────────────────────
    let dominantGstPct = 0;
    const lines = grnItems.map((item, idx) => {
      const receivedQty = Number(item.receivedQty || item.quantity || 0);
      const orderedQty = Number(item.orderedQty || item.quantity || 0);
      const unitRate = Number(item.unitRate || item.rate || 0);
      const itemId = item.itemId ? String(item.itemId) : null;

      // GST%: prefer ItemMaster lookup; fall back to what was saved on the item
      const hsnInfo = itemId ? hsnMap[itemId] || {} : {};
      const gstPercent = Number(hsnInfo.gstPercent ?? item.gstPercent ?? 0);
      const hsnCode = hsnInfo.hsnCode ?? item.hsnCode ?? null;

      if (gstPercent > dominantGstPct) dominantGstPct = gstPercent;

      const taxableAmount = receivedQty * unitRate;
      const gstAmount = taxableAmount * (gstPercent / 100);

      let cgstRate = 0,
        sgstRate = 0,
        igstRate = 0;
      let cgstAmount = 0,
        sgstAmount = 0,
        igstAmount = 0;

      if (taxMode === "cgst_sgst") {
        cgstRate = gstPercent / 2;
        sgstRate = gstPercent / 2;
        cgstAmount = gstAmount / 2;
        sgstAmount = gstAmount / 2;
      } else {
        igstRate = gstPercent;
        igstAmount = gstAmount;
      }

      const netAmount = taxableAmount + gstAmount;

      return {
        lineNo: idx + 1,
        itemId,
        itemName: item.itemName || item.name || `Item ${idx + 1}`,
        orderedQty,
        receivedQty,
        uom: item.uom || "",
        unitRate,
        hsnCode,
        gstPercent,
        taxableAmount: Math.round(taxableAmount * 100) / 100,
        cgstRate,
        sgstRate,
        igstRate,
        cgstAmount: Math.round(cgstAmount * 100) / 100,
        sgstAmount: Math.round(sgstAmount * 100) / 100,
        igstAmount: Math.round(igstAmount * 100) / 100,
        gstAmount: Math.round(gstAmount * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
      };
    });

    // ── 5. Aggregate totals ──────────────────────────────────────────────────
    const totals = lines.reduce(
      (acc, l) => ({
        taxableAmount: acc.taxableAmount + l.taxableAmount,
        cgstAmount: acc.cgstAmount + l.cgstAmount,
        sgstAmount: acc.sgstAmount + l.sgstAmount,
        igstAmount: acc.igstAmount + l.igstAmount,
        gstAmount: acc.gstAmount + l.gstAmount,
        netAmount: acc.netAmount + l.netAmount,
        receivedQty: acc.receivedQty + l.receivedQty,
      }),
      {
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        gstAmount: 0,
        netAmount: 0,
        receivedQty: 0,
      },
    );
    // Round totals
    for (const k of Object.keys(totals))
      totals[k] = Math.round(totals[k] * 100) / 100;

    const halfGst = dominantGstPct / 2;

    return res.json({
      grnId,
      grnNo: hdr.GRNNo,
      poId: hdr.POID || null,
      poNo: hdr.PONo || null,
      supplierId: hdr.SupplierID || null,
      supplierName: hdr.SupplierName || null,
      companyId: hdr.CompanyId || null,
      vendorState: hdr.VendorState || "",
      companyState: hdr.CompanyState || "",
      taxMode,
      gstPercent: dominantGstPct,
      cgstRate: taxMode === "cgst_sgst" ? halfGst : 0,
      sgstRate: taxMode === "cgst_sgst" ? halfGst : 0,
      igstRate: taxMode === "igst" ? dominantGstPct : 0,
      totals,
      lines,
    });
  } catch (err) {
    console.error("GET /grn-gst-data ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to compute GRN GST data", message: err.message });
  }
});

// GET all GRNs
// GET suppliers list for GRN filtering.
// Must be declared before /filtered and /:id.
router.get("/suppliers", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS label
      FROM dbo.AccountHeadMaster
      WHERE IsActive = 1
      ORDER BY LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /filtered ─────────────────────────────────────────────────────────────
// Filter GRNs by supplierId, projectId, companyId.
// We join via PurchaseOrders for company/project filters because GRN itself
// does not carry those columns directly.
// Also includes GRNs where POID is NULL by only applying PO-based filters
// when the corresponding parameter is provided.
// GET /next-number - preview the next GRN DocNo without locking it.
router.get("/next-number", async (req, res) => {
  try {
    const pool = getPool();
    const parentDocNo = req.query.parentDocNo || null;
    const prefix = resolveGRNPrefix(parentDocNo);
    const docTypeId = await resolveDocTypeId(pool, sql, prefix);
    const preview = await previewNextDocNumber(pool, sql, docTypeId);
    res.json(preview);
  } catch (err) {
    console.error("GRN next-number error:", err.message);
    res.status(500).json({ error: "Failed to preview next GRN number" });
  }
});

router.get("/filtered", async (req, res) => {
  const supplierId = parseInt(req.query.supplierId, 10) || null;
  const projectId = parseInt(req.query.projectId, 10) || null;
  const companyId = parseInt(req.query.companyId, 10) || null;
  try {
    const pool = getPool();
    const request = pool.request();
    let whereClause = "WHERE 1=1";
    if (supplierId) {
      request.input("SupplierID", sql.Int, supplierId);
      whereClause += " AND grn.SupplierID = @SupplierID";
    }
    if (projectId) {
      request.input("ProjectId", sql.Int, projectId);
      whereClause += " AND (p.ProjectId = @ProjectId OR grn.POID IS NULL)";
    }
    if (companyId) {
      request.input("CompanyId", sql.Int, companyId);
      whereClause += " AND (p.CompanyId = @CompanyId OR grn.POID IS NULL)";
    }
    const result = await request.query(`
      SELECT grn.GRNID, grn.GRNNo, grn.GRNDate, grn.SupplierID, grn.POID,
             grn.Status, grn.Remarks, grn.DocNo,
             s.LHeadName AS SupplierName,
             p.PurchaseOrderNo AS PONumber,
             p.POType,
             p.SourceWODocNo,
             p.SourceMRDocNo,
             p.SourceWDDocNo,
             p.ProjectId, p.CompanyId,
             p.GST AS ParentGST
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      ${whereClause}
      ORDER BY grn.GRNID DESC
    `);
    res.json(result.recordset.map(normaliseGRNRow));
  } catch (err) {
    console.error("GET filtered GRNs ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET all GRNs
// NOTE: GRNItems is intentionally NOT normalised here — the list endpoint
// returns raw strings (or null) which is fine for picker row counts.
// The frontend always re-fetches GET /:id for authoritative item data.
router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = await getPool();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 500);
    const offset = (page - 1) * limit;

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
      SELECT
        grn.GRNID,
        grn.GRNNo,
        grn.GRNDate,
        grn.SupplierID,
        grn.POID,
        p.GST AS ParentGST,
        grn.Status,
        grn.Remarks,
        grn.CreatedDate,
        grn.DocTypeId,
        grn.DocNo,
        grn.TotalAmount,
        grn.DocYear,
        -- Derive a FinYear string so the expense-booking picker can filter correctly.
        -- Dash-format GRNs store the calendar year of GRN date in DocYear (e.g. 2026).
        -- Indian FY runs Apr–Mar: if GRN month >= 4 the FY starts that year, else previous year.
        CASE
          WHEN grn.DocYear IS NOT NULL THEN
            CASE
              WHEN MONTH(grn.GRNDate) >= 4
                THEN CAST(grn.DocYear AS NVARCHAR(4)) + '-' + CAST(grn.DocYear + 1 AS NVARCHAR(4))
              ELSE CAST(grn.DocYear - 1 AS NVARCHAR(4)) + '-' + CAST(grn.DocYear AS NVARCHAR(4))
            END
          ELSE NULL
        END AS FinYear,
        s.LHeadName AS SupplierName,
        p.PurchaseOrderNo AS PONumber,
        p.POType,
        p.SourceWODocNo,
        p.SourceMRDocNo,
        p.SourceWDDocNo,
        p.ProjectId,
        p.CompanyId,
        td.Prefix AS DocTypePrefix,
        td.Description AS DocTypeDescription,
        COUNT(*) OVER() AS _total
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
      ORDER BY grn.GRNID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const total = result.recordset[0]?._total ?? 0;

    res.json({
      data: result.recordset.map((r) => {
        const { _total, ...rest } = r;
        return normaliseGRNRow(rest);
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to fetch GRNs",
      message: err.message,
    });
  }
});

// GET single GRN by ID
// This is the authoritative endpoint used by the expense booking form to load
// GRN items. GRNItems is normalised to a parsed array before returning so the
// frontend never has to deal with raw JSON strings or truncation.
router.get("/:id", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });

  try {
    const pool = await getPool();
    const result = await pool.request().input("GRNID", sql.Int, grnId).query(`
        SELECT
          grn.GRNID,
          grn.GRNNo,
          grn.GRNDate,
          grn.SupplierID,
          grn.POID,
          grn.GRNItems,
          grn.Status,
          grn.Remarks,
          grn.CreatedDate,
          grn.DocTypeId,
          grn.DocNo,
          grn.TotalAmount,
          s.LHeadName AS SupplierName,
          p.PurchaseOrderNo AS PONumber,
          p.POType,
          p.SourceWODocNo,
          p.SourceMRDocNo,
          p.SourceWDDocNo,
          p.ProjectId,
          p.CompanyId,
          p.GST AS ParentGST,
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
        LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
        WHERE grn.GRNID = @GRNID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "GRN not found" });

    // FIX: normalise GRNItems to a parsed array so the client always receives
    // an array, not a raw JSON string. This prevents double-parsing issues on
    // the frontend and handles cases where the NVARCHAR(MAX) column is returned
    // as a truncated string by some mssql driver versions.
    res.json(normaliseGRNRow(result.recordset[0]));
  } catch (err) {
    console.error("GET GRN by ID ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch GRN", message: err.message });
  }
});

// POST - Create GRN + Stock Ledger Entries
router.post("/", validateBody(grnBodySchema), async (req, res) => {
  const {
    grnNo,
    grnDate,
    supplierId,
    poId,
    grnItems,
    status,
    remarks,
    docTypeId: clientDocTypeId,
    docNo,
    finYear,
    parentDocNo = null, // DocNo of the parent PO or WO
    rootExBDocNo = null, // Root ExB DocNo when raised under Expense Booking
  } = req.body;

  if (!grnDate || !supplierId) {
    return res
      .status(400)
      .json({ error: "GRNDate and SupplierID are required" });
  }

  const pool = await getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    let resolvedDocTypeId = clientDocTypeId
      ? parseInt(clientDocTypeId, 10)
      : null;

    // ── Auto-resolve GRN prefix from parent chain ────────────────────────────
    // If no explicit docTypeId was passed but we have a parentDocNo, derive the
    // correct prefix automatically:
    //   parent starts with ExB-PO-  →  ExB-PO-GRN
    //   parent starts with ExB-WO-  →  ExB-WO-GRN
    //   parent starts with ExB-     →  ExB-GRN
    //   otherwise                   →  GRN
    if (!resolvedDocTypeId) {
      const grnPrefix = resolveGRNPrefix(parentDocNo);
      resolvedDocTypeId = await resolveDocTypeId(pool, sql, grnPrefix);
    }

    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId: resolvedDocTypeId,
      finYear,
      tableName: "GoodsReceiptNotes",
      docNoColumn: "DocNo",
      issuedBy: req.user?.email || req.user?.name || null,
      parentDocNo,
      rootExBDocNo,
    });

    // Parse year + serial for storage
    const parts = (finalDocNo || "").split("-");
    const docYear =
      parts.length >= 2 ? parseInt(parts[parts.length - 2], 10) || null : null;
    const docSerial =
      parts.length >= 1 ? parseInt(parts[parts.length - 1], 10) || null : null;

    const grnResult = await transaction
      .request()
      .input("GRNNo", sql.NVarChar(50), finalDocNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId || null)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems || []))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("DocTypeId", sql.Int, resolvedDocTypeId || null)
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("DocYear", sql.SmallInt, docYear)
      .input("DocSerial", sql.Int, docSerial)
      .input("ParentDocNo", sql.NVarChar(100), parentDocNo)
      .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo)
      .input("TotalAmount", sql.Decimal(18, 2), computeGRNTotal(grnItems))
      .input("CreatedDate", sql.DateTime2, new Date()).query(`
        INSERT INTO GoodsReceiptNotes
          (GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks,
           DocTypeId, DocNo, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
           TotalAmount, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES
          (@GRNNo, @GRNDate, @SupplierID, @POID, @GRNItems, @Status, @Remarks,
           @DocTypeId, @DocNo, @DocYear, @DocSerial, @ParentDocNo, @RootExBDocNo,
           @TotalAmount, @CreatedDate)
      `);

    const grnId = grnResult.recordset[0].GRNID;

    await backPatchRecordId(pool, sql, finalDocNo, "GoodsReceiptNotes", grnId);

    const mainGodownId = await resolveMainGodownId(pool);
    await insertStockLedgerEntries(
      transaction,
      grnId,
      grnItems,
      finalDocNo,
      mainGodownId,
    );

    await transaction.commit();

    // ── Update parent PO status ───────────────────────────────────────────────
    // Check if all ordered quantities are now received; set status accordingly.
    if (poId) {
      try {
        const poCheck = await pool
          .request()
          .input("POID", sql.Int, parseInt(poId, 10)).query(`
            SELECT
              po.Status AS POStatus,
              po.POItems,
              ISNULL(SUM(grn.TotalAmount), 0) AS TotalReceived,
              COUNT(grn.GRNID) AS GRNCount
            FROM PurchaseOrders po
            LEFT JOIN GoodsReceiptNotes grn ON grn.POID = po.PurchaseOrderID
              AND grn.Status != 'Rejected'
            WHERE po.PurchaseOrderID = @POID
            GROUP BY po.Status, po.POItems
          `);

        if (poCheck.recordset.length > 0) {
          const poRow = poCheck.recordset[0];
          const poItems = (() => {
            try {
              return JSON.parse(poRow.POItems || "[]");
            } catch {
              return [];
            }
          })();
          const totalOrdered = poItems.reduce(
            (s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0),
            0,
          );
          // Only promote PO to "Received" when all items are fully received.
          // Never write "Partially Received" back to PO — that belongs on GRN.
          const newPOStatus =
            poRow.GRNCount > 0 &&
            totalOrdered > 0 &&
            poRow.TotalReceived >= totalOrdered
              ? "Received"
              : null;

          if (
            newPOStatus &&
            newPOStatus !== poRow.POStatus &&
            ["Approved"].includes(poRow.POStatus)
          ) {
            await pool
              .request()
              .input("POID", sql.Int, parseInt(poId, 10))
              .input("Status", sql.NVarChar(50), newPOStatus)
              .query(
                `UPDATE PurchaseOrders SET Status = @Status WHERE PurchaseOrderID = @POID`,
              );
            await bumpCacheVersion("purchase-orders");
          }
        }
      } catch (poErr) {
        // Non-fatal — GRN was saved; PO status update is best-effort
        console.warn(
          "PO status update after GRN failed (non-fatal):",
          poErr.message,
        );
      }
    }
    await bumpCacheVersion("stock-ledger");
    await bumpCacheVersion("grns");

    // Auto-submit: transition Draft → Pending immediately after creation.
    try {
      await transition(
        "goods-receipt",
        grnId,
        "Pending",
        req.user?.email,
        req.user?.role,
      );
    } catch (submitErr) {
      console.warn("GRN auto-submit failed (non-fatal):", submitErr.message);
    }

    res.status(201).json({
      message: "GRN created successfully",
      grnId,
      grnNo: finalDocNo,
      docNo: finalDocNo,
      status: "Pending",
    });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("CREATE GRN FULL ERROR:", err);
    res.status(500).json({
      error: "Failed to create GRN",
      message: err.message,
      detail: err.originalError?.info || null,
    });
  }
});

// PUT - Update GRN
router.put("/:id", validateBody(grnBodySchema), async (req, res) => {
  try {
    await guardEdit("goods-receipt", req.params.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const {
    grnNo,
    grnDate,
    supplierId,
    poId,
    grnItems,
    status,
    remarks,
    docTypeId,
    docNo,
  } = req.body;
  const grnId = parseInt(req.params.id, 10);

  const pool = await getPool();
  const transaction = pool.transaction();
  try {
    await transaction.begin();

    const result = await transaction
      .request()
      .input("GRNID", sql.Int, grnId)
      .input("GRNNo", sql.NVarChar(50), grnNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId || null)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems || []))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("DocTypeId", sql.Int, docTypeId ? parseInt(docTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), docNo || null)
      .input("TotalAmount", sql.Decimal(18, 2), computeGRNTotal(grnItems))
      .input("UpdatedDate", sql.DateTime2, new Date()).query(`
        UPDATE GoodsReceiptNotes
        SET GRNNo = @GRNNo,
            GRNDate = @GRNDate,
            SupplierID = @SupplierID,
            POID = @POID,
            GRNItems = @GRNItems,
            Status = @Status,
            Remarks = @Remarks,
            DocTypeId = @DocTypeId,
            DocNo = @DocNo,
            TotalAmount = @TotalAmount
        WHERE GRNID = @GRNID
      `);

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "GRN not found" });
    }

    await transaction
      .request()
      .input("RefID", sql.Int, grnId)
      .query(
        "DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID",
      );

    const mainGodownId = await resolveMainGodownId(pool);
    await insertStockLedgerEntries(
      transaction,
      grnId,
      grnItems,
      docNo,
      mainGodownId,
    );
    await transaction.commit();

    await bumpCacheVersion("grns");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "GRN updated successfully" });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("UPDATE GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to update GRN",
      message: err.message,
    });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  const pool = await getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    await transaction
      .request()
      .input("RefID", sql.Int, grnId)
      .query(
        "DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID",
      );

    const result = await transaction
      .request()
      .input("GRNID", sql.Int, grnId)
      .query("DELETE FROM GoodsReceiptNotes WHERE GRNID = @GRNID");

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "GRN not found" });
    }

    await transaction.commit();

    await bumpCacheVersion("grns");
    await bumpCacheVersion("expense-booking-options");
    await bumpCacheVersion("stock-ledger");
    res.json({ message: "GRN deleted successfully" });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("DELETE GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to delete GRN",
      message: err.message,
    });
  }
});

// ── PUT /:id/submit — Draft/Partially Received → Pending ──────────────────────
router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "goods-receipt",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("grns");
    await bumpCacheVersion("expense-booking-options");
    res.json({ message: "GRN submitted for approval", ...result });
  } catch (err) {
    console.error("GRN submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "goods-receipt",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("grns");
    await bumpCacheVersion("expense-booking-options");
    res.json({ message: "GRN approved", ...result });
  } catch (err) {
    console.error("GRN approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ──────────────────────────────────────
router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition(
      "goods-receipt",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("grns");
    await bumpCacheVersion("expense-booking-options");
    res.json({ message: "GRN rejected", ...result });
  } catch (err) {
    console.error("GRN reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /:id/gst-breakdown ────────────────────────────────────────────────────
// Returns GRN items enriched with HSN code + CGST/SGST rates from Item_Master_Group.
// Each item has: itemId, itemName, uom, receivedQty, rate, totalAmountInclGST,
//               hsnCode, cgstRate, sgstRate, baseAmount, cgstAmount, sgstAmount, gstAmount
// Totals: totalBase, totalCGST, totalSGST, totalGST, totalInclGST
router.get("/:id/gst-breakdown", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });

  try {
    const pool = await getPool();

    // Fetch GRN row for its items JSON
    const grnResult = await pool
      .request()
      .input("GRNID", sql.Int, grnId)
      .query("SELECT GRNItems FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID");

    if (!grnResult.recordset.length)
      return res.status(404).json({ error: "GRN not found" });

    const rawItems = parseGRNItems(grnResult.recordset[0].GRNItems);
    const receivedItems = rawItems.filter(
      (it) => Number(it.receivedQty || it.ReceivedQty || 0) > 0,
    );

    if (receivedItems.length === 0)
      return res.json({
        items: [],
        totals: {
          totalBase: 0,
          totalCGST: 0,
          totalSGST: 0,
          totalGST: 0,
          totalInclGST: 0,
        },
      });

    // Build itemId list for a single batch lookup against Item_Master_Group
    const itemIds = receivedItems
      .map((it) => String(it.itemId || it.ItemId || "").trim())
      .filter(Boolean);

    let masterMap = {};
    if (itemIds.length > 0) {
      const masterReq = pool.request();
      const placeholders = itemIds
        .map((id, i) => {
          masterReq.input(`iid${i}`, sql.NVarChar(100), id);
          return `@iid${i}`;
        })
        .join(",");

      const masterRes = await masterReq.query(`
        SELECT
          CONVERT(NVARCHAR(100), M_Id) AS M_Id,
          M_HSN,
          ISNULL(M_CGST, 0) AS M_CGST,
          ISNULL(M_SGST, 0) AS M_SGST
        FROM dbo.Item_Master_Group
        WHERE CONVERT(NVARCHAR(100), M_Id) IN (${placeholders})
      `);

      for (const row of masterRes.recordset) {
        const gst = parseFloat(row.GSTPercent) || 0;
        masterMap[row.M_Id] = {
          hsnCode: row.M_HSN || "",
          cgstRate: parseFloat(row.M_CGST) || 0,
          sgstRate: parseFloat(row.M_SGST) || 0,
        };
      }
    }

    let totalBase = 0,
      totalCGST = 0,
      totalSGST = 0,
      totalInclGST = 0;

    const items = receivedItems.map((it) => {
      const itemId = String(it.itemId || it.ItemId || "");
      const receivedQty = Number(it.receivedQty || it.ReceivedQty || 0);
      const rate = Number(it.rate || it.Rate || 0);
      // totalAmount stored in GRN = receivedQty × rate (inclusive of GST)
      const inclGST =
        Number(it.totalAmount) > 0
          ? Number(it.totalAmount)
          : receivedQty * rate;

      const master = masterMap[itemId] || {
        hsnCode: "",
        gstPercent: 0,
        cgstRate: 0,
        sgstRate: 0,
      };
      const totalGSTRate = master.cgstRate + master.sgstRate;

      // Back-calculate base from inclusive amount
      const baseAmount =
        totalGSTRate > 0 ? inclGST / (1 + totalGSTRate / 100) : inclGST;
      const cgstAmount = (baseAmount * master.cgstRate) / 100;
      const sgstAmount = (baseAmount * master.sgstRate) / 100;
      const gstAmount = cgstAmount + sgstAmount;

      totalBase += baseAmount;
      totalCGST += cgstAmount;
      totalSGST += sgstAmount;
      totalInclGST += inclGST;

      return {
        itemId,
        itemName: it.itemName || it.ItemName || "",
        uom: it.uom || it.UOM || "",
        orderedQty: Number(it.orderedQty || 0),
        receivedQty,
        remainingQty: Number(it.remainingQty || 0),
        rate,
        totalAmountInclGST: Math.round(inclGST * 100) / 100,
        hsnCode: master.hsnCode,
        cgstRate: master.cgstRate,
        sgstRate: master.sgstRate,
        baseAmount: Math.round(baseAmount * 100) / 100,
        cgstAmount: Math.round(cgstAmount * 100) / 100,
        sgstAmount: Math.round(sgstAmount * 100) / 100,
        gstAmount: Math.round(gstAmount * 100) / 100,
      };
    });

    res.json({
      items,
      totals: {
        totalBase: Math.round(totalBase * 100) / 100,
        totalCGST: Math.round(totalCGST * 100) / 100,
        totalSGST: Math.round(totalSGST * 100) / 100,
        totalGST: Math.round((totalCGST + totalSGST) * 100) / 100,
        totalInclGST: Math.round(totalInclGST * 100) / 100,
      },
    });
  } catch (err) {
    console.error("GRN GST breakdown error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

