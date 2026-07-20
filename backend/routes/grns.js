const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { validateBody } = require("../middleware/validateRequest");
const { grnBodySchema } = require("../validation/financialRouteSchemas");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
});
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
const {
  lockNextDocNumber,
  backPatchRecordId,
  resolveDocTypeId,
  resolveGRNPrefix,
  previewNextDocNumber,
} = require("../utils/docNumberLock");
const {
  assertVehicleInOutHasNoGRN,
  assertGRNQuantitiesWithinVehicleInOut,
  getDocumentChainForGRN,
} = require("../services/poVehicleGrnChain");

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

/**
 * Sum (base + GST) for every line item.
 * base     = rate ├ù billingQty  (or stored totalAmount when positive)
 * gstPct   = per-item GST % carried from PO ΓåÆ GRN line (field: gstPct)
 * The result is stored in GoodsReceiptNotes.TotalAmount (incl. GST) so
 * it can be directly compared with PurchaseOrders.TotalAmount (also incl. GST).
 */
function computeGRNTotal(grnItems) {
  const items = parseGRNItems(grnItems);
  return items.reduce((sum, item) => {
    const base =
      Number(item.totalAmount) > 0
        ? Number(item.totalAmount)
        : Number(item.rate || 0) * Number(item.quantity || 0);
    const gstPct = Number(item.gstPct || 0);
    const gstAmt = base * (gstPct / 100);
    return sum + base + gstAmt;
  }, 0);
}

/**
 * After any GRN create/update/delete: re-sum receivedQty per PO item
 * across all non-rejected GRNs and write it back to PurchaseOrderItems.ReceivedQty.
 * This keeps the PO line-item table accurate for the PO modal "Received" column.
 */
async function syncPOItemReceivedQty(pool, sql, poId) {
  if (!poId) return;
  try {
    const grns = await pool
      .request()
      .input("POID", sql.Int, parseInt(poId, 10))
      .query(
        "SELECT GRNItems FROM dbo.GoodsReceiptNotes WHERE POID = @POID AND Status != 'Rejected'",
      );

    // Sum receivedQty per itemId across all GRNs
    const sumByItem = {};
    for (const row of grns.recordset) {
      const items = parseGRNItems(row.GRNItems);
      for (const it of items) {
        const id = String(it.itemId || it.ItemId || "");
        if (!id) continue;
        sumByItem[id] =
          (sumByItem[id] || 0) + Number(it.receivedQty || it.ReceivedQty || 0);
      }
    }

    // Fetch all PO items to know their ItemIds
    const poItems = await pool
      .request()
      .input("POID2", sql.Int, parseInt(poId, 10))
      .query(
        "SELECT Id, ItemId FROM dbo.PurchaseOrderItems WHERE PurchaseOrderID = @POID2",
      );

    for (const poItem of poItems.recordset) {
      const itemId = String(poItem.ItemId || "");
      const received = sumByItem[itemId] ?? 0;
      await pool
        .request()
        .input("Id", sql.Int, poItem.Id)
        .input("ReceivedQty", sql.Decimal(18, 4), received)
        .query(
          "UPDATE dbo.PurchaseOrderItems SET ReceivedQty = @ReceivedQty WHERE Id = @Id",
        );
    }
  } catch (err) {
    console.warn("syncPOItemReceivedQty failed (non-fatal):", err.message);
  }
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

// Resolve the godown linked to a project (enterprise with business_type='P')
// Returns null if no project-specific godown exists (caller should fall back to Main)
async function resolveProjectGodownId(pool, projectId) {
  if (!projectId) return null;
  try {
    const res = await pool
      .request()
      .input("ProjectID", sql.Int, parseInt(projectId, 10))
      .query(
        "SELECT TOP 1 GodownID FROM dbo.Godowns WHERE ProjectID = @ProjectID AND IsDeleted = 0 ORDER BY GodownID",
      );
    return res.recordset[0]?.GodownID || null;
  } catch {
    return null;
  }
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
    const pool = getPool();

    // ΓöÇΓöÇ 1. Fetch GRN header + linked PO/supplier/company context ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    // ΓöÇΓöÇ 2. Determine tax mode (intra vs inter state) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const vendorState = (hdr.VendorState || "").trim().toLowerCase();
    const companyState = (hdr.CompanyState || "").trim().toLowerCase();
    const taxMode =
      vendorState && companyState && vendorState === companyState
        ? "cgst_sgst"
        : "igst";

    // ΓöÇΓöÇ 3. Fetch HSN/GST% for every itemId present in GRN items ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    //    Items store GST% directly when saved, but we re-fetch from ItemMaster
    //    as the authoritative source for accuracy.
    const itemIds = [...new Set(grnItems.map((i) => i.itemId).filter(Boolean))];

    let hsnMap = {}; // itemId ΓåÆ { hsnCode, gstPercent }
    if (itemIds.length > 0) {
      // Build parameterised list  @p0, @p1, ΓÇª
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

    // ΓöÇΓöÇ 4. Compute per-line GST ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    // ΓöÇΓöÇ 5. Aggregate totals ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

// ΓöÇΓöÇ GET /filtered ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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
             grn.SourceTransferID,
             grn.SourceTransferDocNo,
             s.LHeadName AS SupplierName,
             p.PurchaseOrderNo AS PONumber,
             p.POType,
             p.SourceWODocNo,
             p.SourceMRDocNo,
             p.SourceWDDocNo,
             p.ProjectId, p.CompanyId,
             p.GST AS ParentGST,
             p.TotalAmount    AS POTotalAmount,
             p.SubtotalAmount AS POSubtotalAmount
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
// NOTE: GRNItems is intentionally NOT normalised here ΓÇö the list endpoint
// returns raw strings (or null) which is fine for picker row counts.
// The frontend always re-fetches GET /:id for authoritative item data.
router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = getPool();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 500);
    const offset = (page - 1) * limit;
    const finYearFilter = req.query.finYear || null; // e.g. "2025-2026"

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit)
      .input("finYear", sql.NVarChar(20), finYearFilter).query(`
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
        grn.GRNItems,
        grn.TotalAmount,
        grn.DocYear,
        -- Derive a FinYear string so the expense-booking picker can filter correctly.
        -- Dash-format GRNs store the calendar year of GRN date in DocYear (e.g. 2026).
        -- Indian FY runs AprΓÇôMar: if GRN month >= 4 the FY starts that year, else previous year.
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
        co.name AS CompanyName,
        pr.name AS ProjectName,
        fyGrn.FName AS FinYearName,
        p.TotalAmount    AS POTotalAmount,
        p.SubtotalAmount AS POSubtotalAmount,
        td.Prefix AS DocTypePrefix,
        td.Description AS DocTypeDescription,
        grn.SourceTransferID,
        grn.SourceTransferDocNo,
        COUNT(*) OVER() AS _total
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      LEFT JOIN dbo.enterprise co ON co.id = p.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = p.ProjectId
      LEFT JOIN dbo.FinYear fyGrn ON fyGrn.FId = (
        SELECT TOP 1 fy.FId FROM dbo.FinYear fy
        WHERE grn.GRNDate >= fy.FStartDate AND grn.GRNDate <= fy.FEndDate
        ORDER BY fy.FId
      )
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
      WHERE (@finYear IS NULL OR (
        grn.DocYear IS NOT NULL AND (
          CASE
            WHEN MONTH(grn.GRNDate) >= 4
              THEN CAST(grn.DocYear AS NVARCHAR(4)) + '-' + CAST(grn.DocYear + 1 AS NVARCHAR(4))
            ELSE CAST(grn.DocYear - 1 AS NVARCHAR(4)) + '-' + CAST(grn.DocYear AS NVARCHAR(4))
          END
        ) = @finYear
      ))
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

// -- GET /by-po/:poId --
// Returns all GRNs created against a given PO, ordered newest-first.
// Used by the Expense Booking preview modal to fetch the GST breakdown for
// PO-linked bookings (eSourceType = 'PO' | 'WO_PO') \u2014 the GRN holds the
// actual received quantities and item-level GST rates, which are the
// authoritative source for the incl-GST amount shown in the breakdown.
// Must be declared before /:id to avoid route collision.
router.get("/by-po/:poId", async (req, res) => {
  const poId = parseInt(req.params.poId, 10);
  if (isNaN(poId) || poId <= 0)
    return res.status(400).json({ error: "Invalid PO ID" });

  try {
    const pool = getPool();
    const result = await pool.request().input("POID", sql.Int, poId).query(`
      SELECT
        grn.GRNID,
        grn.GRNNo,
        grn.DocNo,
        grn.GRNDate,
        grn.Status,
        grn.TotalAmount,
        s.LHeadName AS SupplierName
      FROM dbo.GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
      WHERE grn.POID = @POID
        AND (grn.Status IS NULL OR grn.Status != 'Rejected')
      ORDER BY grn.GRNID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET /by-po/:poId ERROR:", err.message);
    res.status(500).json({ error: err.message });
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
    const pool = getPool();
    const result = await pool.request().input("GRNID", sql.Int, grnId).query(`
        SELECT
          grn.GRNID,
          grn.GRNNo,
          grn.GRNDate,
          grn.DocDate,
          grn.SupplierID,
          grn.POID,
          grn.VehicleInOutID,
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
          co.name AS CompanyName,
          pr.name AS ProjectName,
          p.GST AS ParentGST,
          p.TotalAmount    AS POTotalAmount,
          p.SubtotalAmount AS POSubtotalAmount,
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
        LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
        LEFT JOIN dbo.enterprise co ON co.id = p.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = p.ProjectId
        WHERE grn.GRNID = @GRNID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "GRN not found" });

    // FIX: normalise GRNItems to a parsed array so the client always receives
    // an array, not a raw JSON string. This prevents double-parsing issues on
    // the frontend and handles cases where the NVARCHAR(MAX) column is returned
    // as a truncated string by some mssql driver versions.
    const grnRow = normaliseGRNRow(result.recordset[0]);
    const documentChain = await getDocumentChainForGRN(pool, grnId);
    res.json({ ...grnRow, documentChain });
  } catch (err) {
    console.error("GET GRN by ID ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch GRN", message: err.message });
  }
});

// POST - Create GRN + Stock Ledger Entries
async function createGRNInternal(pool, body, userEmail) {
    const {
      grnDate,
      // docDate is intentionally NOT read from the client — Doc Date is
      // always the server's "today" (set below at insert time), never
      // client-supplied, so it can't be backdated/postdated.
      supplierId,
      poId,
      vehicleInOutId = null,
      grnItems,
      status,
      remarks,
      docTypeId: clientDocTypeId,
      finYear,
      parentDocNo = null,
      rootExBDocNo = null,
      godownId = null,
      projectId = null,
    } = body;

    if (!grnDate || !supplierId) {
      throw new Error("GRNDate and SupplierID are required");
    }

    // ΓöÇΓöÇ Guard: a GRN can only be raised against an Approved PO ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (poId) {
      const poStatusCheck = await pool
        .request()
        .input("POID", sql.Int, parseInt(poId, 10))
        .query(
          "SELECT Status FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID",
        );

      if (poStatusCheck.recordset.length === 0) {
        throw Object.assign(new Error("Purchase Order not found"), { status: 404 });
      }

      const poStatus = poStatusCheck.recordset[0].Status;
      if (poStatus !== "Approved" && poStatus !== "Received") {
        throw Object.assign(new Error(`Cannot create a GRN: Purchase Order is "${poStatus}". Only Approved Purchase Orders can be used to raise a GRN.`), { status: 400 });
      }
    }

    // ── PO -> Vehicle In/Out -> GRN chain guards ─────────────────────────
    // One Vehicle In/Out document can only ever have one active GRN, and a
    // GRN can't confirm receipt of more than what that specific vehicle
    // lot actually brought in.
    if (vehicleInOutId) {
      const vioId = parseInt(vehicleInOutId, 10);
      await assertVehicleInOutHasNoGRN(pool, vioId);
      await assertGRNQuantitiesWithinVehicleInOut(pool, vioId, grnItems);
    }

    const transaction = pool.transaction();

    try {
      await transaction.begin();

      let resolvedDocTypeId = clientDocTypeId
        ? parseInt(clientDocTypeId, 10)
        : null;

      // ΓöÇΓöÇ Auto-resolve GRN prefix from parent chain ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      // If no explicit docTypeId was passed but we have a parentDocNo, derive the
      // correct prefix automatically:
      //   parent starts with ExB-PO-  ΓåÆ  ExB-PO-GRN
      //   parent starts with ExB-WO-  ΓåÆ  ExB-WO-GRN
      //   parent starts with ExB-     ΓåÆ  ExB-GRN
      //   otherwise                   ΓåÆ  GRN
      if (!resolvedDocTypeId) {
        const grnPrefix = resolveGRNPrefix(parentDocNo);
        resolvedDocTypeId = await resolveDocTypeId(pool, sql, grnPrefix);
      }

      const finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: resolvedDocTypeId,
        finYear,
        tableName: "GoodsReceiptNotes",
        docNoColumn: "DocNo",
        issuedBy: userEmail,
        parentDocNo,
        rootExBDocNo,
      });

      // Parse year + serial for storage
      const parts = (finalDocNo || "").split("-");
      const docYear =
        parts.length >= 2
          ? parseInt(parts[parts.length - 2], 10) || null
          : null;
      const docSerial =
        parts.length >= 1
          ? parseInt(parts[parts.length - 1], 10) || null
          : null;

      // Godown resolution priority (resolved BEFORE the insert so the row is
      // written correctly the first time):
      // 1. Explicit godownId from client
      // 2. Project's linked godown (when PO has a ProjectId)
      // 3. Main Godown fallback
      // NOTE: this used to run AFTER the insert, then patch GodownID via a
      // separate `pool.request()` UPDATE on the same row. That UPDATE ran on a
      // different pooled connection than the still-open `transaction`, which
      // already held an exclusive lock on this row from the INSERT below.
      // The UPDATE would block waiting on that lock, but the only thing that
      // could release the lock (transaction.commit()) was sequenced AFTER the
      // UPDATE ΓÇö a self-deadlock that hung until the client request timeout
      // fired (ETIMEOUT), every single time a GRN was created. Resolving the
      // godown first and inserting it directly removes the second statement
      // ΓÇö and the deadlock ΓÇö entirely.
      let resolvedGodownId = godownId ? parseInt(godownId, 10) : null;
      if (!resolvedGodownId) {
        // Try to get ProjectId from the PO if not provided in body
        let resolvedProjectId = projectId ? parseInt(projectId, 10) : null;
        if (!resolvedProjectId && poId) {
          const poRow = await pool
            .request()
            .input("POID", sql.Int, parseInt(poId, 10))
            .query(
              "SELECT TOP 1 ProjectId FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID",
            );
          resolvedProjectId = poRow.recordset[0]?.ProjectId || null;
        }
        if (resolvedProjectId) {
          resolvedGodownId = await resolveProjectGodownId(
            pool,
            resolvedProjectId,
          );
        }
        if (!resolvedGodownId) {
          resolvedGodownId = await resolveMainGodownId(pool);
        }
      }

      const grnResult = await transaction
        .request()
        .input("GRNNo", sql.NVarChar(50), finalDocNo)
        .input("GRNDate", sql.Date, grnDate)
        // Doc Date is always "today" — entries are dated when they're
        // actually made, not backdated/postdated (mirrors VehicleInOut).
        // Trust the server clock rather than whatever the client sends.
        .input("DocDate", sql.Date, new Date())
        .input("SupplierID", sql.Int, supplierId)
        .input("POID", sql.Int, poId || null)
        .input(
          "VehicleInOutID",
          sql.Int,
          vehicleInOutId ? parseInt(vehicleInOutId, 10) : null,
        )
        .input(
          "GRNItems",
          sql.NVarChar(sql.MAX),
          JSON.stringify(grnItems || []),
        )
        .input("Status", sql.NVarChar(50), status || "Draft")
        .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
        .input("DocTypeId", sql.Int, resolvedDocTypeId || null)
        .input("DocNo", sql.NVarChar(100), finalDocNo)
        .input("DocYear", sql.SmallInt, docYear)
        .input("DocSerial", sql.Int, docSerial)
        .input("ParentDocNo", sql.NVarChar(100), parentDocNo)
        .input("RootExBDocNo", sql.NVarChar(100), rootExBDocNo)
        .input("TotalAmount", sql.Decimal(18, 2), computeGRNTotal(grnItems))
        .input("GodownID", sql.Int, resolvedGodownId)
        .input("CreatedDate", sql.DateTime2, new Date()).query(`
        INSERT INTO GoodsReceiptNotes
          (GRNNo, GRNDate, DocDate, SupplierID, POID, VehicleInOutID, GRNItems, Status, Remarks,
           DocTypeId, DocNo, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
           TotalAmount, GodownID, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES
          (@GRNNo, @GRNDate, @DocDate, @SupplierID, @POID, @VehicleInOutID, @GRNItems, @Status, @Remarks,
           @DocTypeId, @DocNo, @DocYear, @DocSerial, @ParentDocNo, @RootExBDocNo,
           @TotalAmount, @GodownID, @CreatedDate)
      `);

      const grnId = grnResult.recordset[0].GRNID;
      await linkGRNAttachments(
        transaction,
        grnId,
        parseIdList(body.attachmentIds),
      );

      // Stock is intentionally NOT credited here — a freshly-created GRN
      // starts Draft/Pending and hasn't been vetted yet. StockLedger only
      // gets its IN rows once the GRN clears approval (postGRNApproval in
      // services/generalLedger.js), so available stock never counts goods
      // nobody has actually approved receipt of.
      await transaction.commit();

      // backPatchRecordId uses pool directly ΓÇö must run after commit
      await backPatchRecordId(
        pool,
        sql,
        finalDocNo,
        "GoodsReceiptNotes",
        grnId,
      );

      // ΓöÇΓöÇ Update parent PO status ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      // Check if all ordered quantities are now received; set status accordingly.
      if (poId) {
        try {
          const poCheck = await pool
            .request()
            .input("POID", sql.Int, parseInt(poId, 10)).query(`
            SELECT
              po.Status          AS POStatus,
              po.TotalAmount     AS POTotalAmount,
              ISNULL(SUM(grn.TotalAmount), 0) AS TotalReceived,
              COUNT(grn.GRNID)   AS GRNCount
            FROM PurchaseOrders po
            LEFT JOIN GoodsReceiptNotes grn ON grn.POID = po.PurchaseOrderID
              AND grn.Status != 'Rejected'
            WHERE po.PurchaseOrderID = @POID
            GROUP BY po.Status, po.TotalAmount
          `);

          if (poCheck.recordset.length > 0) {
            const poRow = poCheck.recordset[0];
            // Use PO's stored TotalAmount (incl. GST) as the ordered baseline,
            // because grn.TotalAmount is also stored inclusive of GST.
            // Previously this compared qty*rate (ex-GST) against GST-inclusive
            // GRN totals, causing POs to never be marked Received.
            const totalOrdered = Number(poRow.POTotalAmount || 0);
            // Only promote PO to "Received" when all items are fully received.
            // Never write "Partially Received" back to PO ΓÇö that belongs on GRN.
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
          // Non-fatal ΓÇö GRN was saved; PO status update is best-effort
          console.warn(
            "PO status update after GRN failed (non-fatal):",
            poErr.message,
          );
        }
        // Sync per-item ReceivedQty back to PurchaseOrderItems from all GRNs
        await syncPOItemReceivedQty(pool, sql, poId);
      }
      await bumpCacheVersion("stock-ledger");
      await bumpCacheVersion("grns");

    // PascalCase matching the actual column name, consistent with every
    // other internal creation function this session (PurchaseOrderID,
    // SaleOrderID, SaleInvoiceID, etc.) ΓÇö callers besides this route's own
    // POST / handler (e.g. the Inter-Company Stock Transfer orchestrator)
    // rely on this exact shape.
    return { GRNID: grnId, DocNo: finalDocNo };
  } catch (err) {
    await transaction.rollback().catch(() => {});
    throw err;
  }
}

router.post("/", requirePageRight("grn-master", "create"), validateBody(grnBodySchema), async (req, res) => {
  try {
    const userEmail = req.user?.email || req.user?.name || null;
    const pool = getPool();
    const { GRNID: grnId, DocNo: docNo } = await createGRNInternal(pool, req.body, userEmail);
    const grnNo = docNo;

    await bumpCacheVersion("stock-ledger");
    await bumpCacheVersion("grns");

    // Auto-submit: transition Draft ΓåÆ Pending immediately after creation.
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
      grnNo,
      docNo,
      status: "Pending",
    });
  } catch (err) {
    console.error("CREATE GRN FULL ERROR:", err);
    if (res.headersSent) return;
    res.status(500).json({
      error: "Failed to create GRN",
      message: err.message,
      detail: err.originalError?.info || null,
    });
  }
});

// PUT - Update GRN
router.put(
  "/:id",
  requirePageRight("grn-master", "edit"),
  validateBody(grnBodySchema),
  async (req, res) => {
    try {
      const allowPostApproval = await resolveAllowPostApproval(
        req,
        "grn-master",
      );
      await guardEdit("goods-receipt", req.params.id, { allowPostApproval });
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

    const pool = getPool();

    // ΓöÇΓöÇ Guard: a GRN can only be linked to an Approved PO ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (poId) {
      const poStatusCheck = await pool
        .request()
        .input("POID", sql.Int, parseInt(poId, 10))
        .query(
          "SELECT Status FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID",
        );

      if (poStatusCheck.recordset.length === 0) {
        return res.status(404).json({ error: "Purchase Order not found" });
      }

      const poStatus = poStatusCheck.recordset[0].Status;
      if (poStatus !== "Approved" && poStatus !== "Received") {
        return res.status(400).json({
          error: `Cannot update GRN: Purchase Order is "${poStatus}". Only Approved Purchase Orders can be used to raise a GRN.`,
        });
      }
    }

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
        .input(
          "GRNItems",
          sql.NVarChar(sql.MAX),
          JSON.stringify(grnItems || []),
        )
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

      // Stock only ever reflects an Approved GRN's items (see
      // postGRNApproval in services/generalLedger.js, which is what
      // normally credits StockLedger). Editing a Draft/Pending GRN has
      // nothing to resync since it was never counted. Editing an
      // already-Approved GRN (allowed via allowPostApproval) DOES need a
      // resync here, though, since transition() only fires its GL_POSTERS
      // hook on a fresh Draft/Pending -> Approved transition, not on a
      // same-status edit — this is the one path that has to redo it
      // directly rather than going through that hook.
      const resultingStatus = status || "Draft";
      await transaction
        .request()
        .input("RefID", sql.Int, grnId)
        .query(
          "DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID",
        );

      if (resultingStatus === "Approved") {
        // Preserve the godown that was set when the GRN was created.
        // Must read via `transaction`, not `pool` ΓÇö the UPDATE above is still
        // uncommitted and holds a lock on this row on the transaction's
        // connection. A read from a different pooled connection would block
        // waiting on that lock until transaction.commit() runs, but commit()
        // is sequenced after this read ΓÇö the same self-deadlock as the POST
        // handler's old GodownID UPDATE, just with a SELECT instead.
        const grnGodownRes = await transaction
          .request()
          .input("GID", sql.Int, grnId)
          .query(
            "SELECT TOP 1 GodownID FROM dbo.GoodsReceiptNotes WHERE GRNID = @GID",
          );
        const putGodownId =
          grnGodownRes.recordset[0]?.GodownID ??
          (await resolveMainGodownId(pool));
        await insertStockLedgerEntries(
          transaction,
          grnId,
          grnItems,
          docNo,
          putGodownId,
        );
      }
      await transaction.commit();
      await linkGRNAttachments(
        pool,
        grnId,
        parseIdList(req.body.attachmentIds),
      );

      await bumpCacheVersion("grns");
      await bumpCacheVersion("expense-booking-options");
      await bumpCacheVersion("stock-ledger");
      res.json({ message: "GRN updated successfully" });
    } catch (err) {
      await transaction.rollback().catch(() => {});
      console.error("UPDATE GRN ERROR:", err);
      if (res.headersSent) return; // timeout middleware already sent 503
      res.status(500).json({
        error: "Failed to update GRN",
        message: err.message,
      });
    }
  },
);

// GET /:id/can-delete ΓÇö check whether GRN can be safely deleted
// Chain: GRN ΓåÆ ExpenseBooking ΓåÆ NewPayment ΓåÆ BankReconciliation
router.get("/:id/can-delete", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (!Number.isFinite(grnId) || grnId <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();

    // ΓöÇΓöÇ 1. Linked expense bookings ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const expCheck = await pool.request().input("GRNID", sql.Int, grnId).query(`
        SELECT eb.Eid, eb.EDocNo, eb.EStatus
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = 'GRN' AND eb.ESourceId = @GRNID
          AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
      `);

    if (expCheck.recordset.length === 0) return res.json({ deletable: true });

    const expenseBookings = expCheck.recordset.map((e) => ({
      id: e.Eid,
      docNo: e.EDocNo,
      status: e.EStatus,
    }));

    const docNoList = expCheck.recordset.map((e) => e.EDocNo).filter(Boolean);

    // ΓöÇΓöÇ 2. BRS-cleared payments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    if (docNoList.length > 0) {
      const brsReq = pool.request();
      const brsParams = docNoList.map((d, i) => {
        brsReq.input(`dn${i}`, sql.NVarChar(100), d);
        return `@dn${i}`;
      });
      const brsCheck = await brsReq.query(`
        SELECT np.PPaymentID, np.PPaymentName, np.PAmount, brc.BRSID, eb.EDocNo
        FROM dbo.NewPayment np
        JOIN dbo.BankReconciliation brc
          ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID AND brc.IsMatched = 1
        JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
        WHERE np.PExpenseRef IN (${brsParams.join(",")})
      `);
      if (brsCheck.recordset.length > 0) {
        return res.json({
          deletable: false,
          reason: "brs_cleared",
          expenseBookings,
          clearedPayments: brsCheck.recordset.map((r) => ({
            paymentId: r.PPaymentID,
            paymentName: r.PPaymentName,
            amount: r.PAmount,
            brsId: r.BRSID,
            expenseDocNo: r.EDocNo,
          })),
        });
      }

      // ΓöÇΓöÇ 3. Uncleared payments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      const payReq = pool.request();
      const payParams = docNoList.map((d, i) => {
        payReq.input(`pdn${i}`, sql.NVarChar(100), d);
        return `@pdn${i}`;
      });
      const payCheck = await payReq.query(`
        SELECT np.PPaymentID, np.PPaymentName, np.PAmount, eb.EDocNo
        FROM dbo.NewPayment np
        JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
        WHERE np.PExpenseRef IN (${payParams.join(",")})
      `);
      if (payCheck.recordset.length > 0) {
        return res.json({
          deletable: false,
          reason: "has_payments",
          expenseBookings,
          linkedPayments: payCheck.recordset.map((r) => ({
            paymentId: r.PPaymentID,
            paymentName: r.PPaymentName,
            amount: r.PAmount,
            expenseDocNo: r.EDocNo,
          })),
        });
      }
    }

    // ΓöÇΓöÇ 4. Expense bookings exist but no payments yet ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    return res.json({
      deletable: false,
      reason: "has_expense",
      expenseBookings,
    });
  } catch (err) {
    console.error("GRN can-delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete(
  "/:id",
  requirePageRight("grn-master", "delete"),
  async (req, res) => {
    const grnId = parseInt(req.params.id, 10);
    const pool = getPool();

    // ΓöÇΓöÇ Guard: linked expense bookings ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const expGuard = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.ExpenseBooking eb
      WHERE eb.ESourceType = 'GRN' AND eb.ESourceId = @GRNID
        AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
    `);
    if (Number(expGuard.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_expense",
        message:
          "This GRN has linked Expense Booking(s). Delete the expense booking(s) first, then delete the GRN.",
      });
    }

    const transaction = pool.transaction();

    try {
      await transaction.begin();

      // Capture the linked POID before deleting so we can revert PO status after
      const grnMeta = await pool
        .request()
        .input("GRNID", sql.Int, grnId)
        .query("SELECT POID FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID");
      const linkedPOId = grnMeta.recordset[0]?.POID ?? null;

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

      // If this GRN was linked to a PO, recalculate PO status now that the GRN
      // is gone. If no active GRNs remain, revert PO to 'Approved' so a new GRN
      // can be raised. If GRNs remain but total received < PO total, also revert
      // (partial-receipt case where a GRN was deleted mid-way).
      if (linkedPOId) {
        try {
          const poRecheck = await pool
            .request()
            .input("POID", sql.Int, linkedPOId).query(`
            SELECT
              po.Status         AS POStatus,
              po.TotalAmount    AS POTotalAmount,
              ISNULL(SUM(grn.TotalAmount), 0) AS TotalReceived,
              COUNT(grn.GRNID)  AS GRNCount
            FROM dbo.PurchaseOrders po
            LEFT JOIN dbo.GoodsReceiptNotes grn
              ON grn.POID = po.PurchaseOrderID
              AND ISNULL(grn.Status, '') != 'Rejected'
            WHERE po.PurchaseOrderID = @POID
            GROUP BY po.Status, po.TotalAmount
          `);

          if (poRecheck.recordset.length > 0) {
            const poRow = poRecheck.recordset[0];
            const totalOrdered = Number(poRow.POTotalAmount || 0);
            const totalReceived = Number(poRow.TotalReceived || 0);
            const grnCount = Number(poRow.GRNCount || 0);

            // Revert to 'Approved' if: no GRNs left, or remaining GRNs don't
            // fully cover the PO total ΓÇö meaning it's no longer fully received.
            const shouldRevert =
              poRow.POStatus === "Received" &&
              (grnCount === 0 || totalReceived < totalOrdered);

            if (shouldRevert) {
              await pool
                .request()
                .input("POID", sql.Int, linkedPOId)
                .query(
                  "UPDATE dbo.PurchaseOrders SET Status = 'Approved', UpdatedAt = GETDATE() WHERE PurchaseOrderID = @POID AND Status = 'Received'",
                );
              await bumpCacheVersion("purchase-orders");
            }
          }
        } catch (poErr) {
          console.error(
            "PO status revert after GRN delete failed (non-fatal):",
            poErr.message,
          );
        }
        await syncPOItemReceivedQty(pool, sql, linkedPOId);
      }

      res.json({ message: "GRN deleted successfully" });
    } catch (err) {
      await transaction.rollback().catch(() => {});
      console.error("DELETE GRN ERROR:", err);
      res.status(500).json({
        error: "Failed to delete GRN",
        message: err.message,
      });
    }
  },
);

// ΓöÇΓöÇ PUT /:id/submit ΓÇö Draft/Partially Received ΓåÆ Pending ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.put(
  "/:id/submit",
  requirePageRight("grn-master", "edit"),
  async (req, res) => {
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
  },
);

// ΓöÇΓöÇ PUT /:id/approve ΓÇö Pending ΓåÆ Approved ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.put(
  "/:id/approve",
  requirePageRight("grns", "edit"),
  async (req, res) => {
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
      // On full approval, transition()'s GL_POSTERS hook already ran
      // postGRNApproval — the one place StockLedger gets credited for this
      // GRN (see services/generalLedger.js). Just bust the caches here.
      await bumpCacheVersion("grns");
      await bumpCacheVersion("stock-ledger");
      await bumpCacheVersion("expense-booking-options");
      res.json({ message: "GRN approved", ...result });
    } catch (err) {
      console.error("GRN approve error:", err.message);
      const status = err.message.includes("not authorized") ? 403 : 400;
      res.status(status).json({ error: err.message });
    }
  },
);

// ΓöÇΓöÇ PUT /:id/reject ΓÇö Pending ΓåÆ Rejected ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.put(
  "/:id/reject",
  requirePageRight("grns", "edit"),
  async (req, res) => {
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

      // Reversal — normally a no-op today (reject only fires from Pending,
      // and stock isn't credited until Approved), but this keeps the
      // Approved -> Rejected path safe too if that transition is ever
      // allowed, and guards against any stock rows a pre-approval-gate GRN
      // may still be carrying.
      await getPool()
        .request()
        .input("RefID", sql.Int, id)
        .query("DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID");
      await bumpCacheVersion("grns");
      await bumpCacheVersion("stock-ledger");
      await bumpCacheVersion("expense-booking-options");
      res.json({ message: "GRN rejected", ...result });
    } catch (err) {
      console.error("GRN reject error:", err.message);
      const status = err.message.includes("not authorized") ? 403 : 400;
      res.status(status).json({ error: err.message });
    }
  },
);

// ΓöÇΓöÇ GET /:id/gst-breakdown ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Returns GRN items enriched with HSN code + CGST/SGST rates from Item_Master_Group.
// Each item has: itemId, itemName, uom, receivedQty, rate, totalAmountInclGST,
//               hsnCode, cgstRate, sgstRate, baseAmount, cgstAmount, sgstAmount, gstAmount
// Totals: totalBase, totalCGST, totalSGST, totalGST, totalInclGST
router.get("/:id/gst-breakdown", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });

  try {
    const pool = getPool();

    // Fetch GRN row for its items JSON
    const grnResult = await pool
      .request()
      .input("GRNID", sql.Int, grnId)
      .query("SELECT GRNItems FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID");

    if (!grnResult.recordset.length)
      return res.status(404).json({ error: "GRN not found" });

    const rawItems = parseGRNItems(grnResult.recordset[0].GRNItems);
    const receivedItems = rawItems.filter((it) => {
      const receivedQty = Number(it.receivedQty || it.ReceivedQty || 0);
      const billingQty = Number(it.quantity || it.Quantity || 0);
      const amt = Number(it.totalAmount || 0);
      return receivedQty > 0 || billingQty > 0 || amt > 0;
    });

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
      // baseAmount stored in GRN = receivedQty ├ù rate (GST-exclusive),
      // mirroring computeGRNTotal's `base` for this line.
      const baseAmount =
        Number(it.totalAmount) > 0
          ? Number(it.totalAmount)
          : rate * Number(it.quantity || it.Quantity || receivedQty || 0);

      const master = masterMap[itemId] || {
        hsnCode: "",
        cgstRate: 0,
        sgstRate: 0,
      };

      // GST % for this line: prefer the rate carried on the GRN line itself
      // (gstPct, same value computeGRNTotal uses) so totals stay consistent
      // with GoodsReceiptNotes.TotalAmount. Fall back to master CGST+SGST
      // only if the line has no gstPct recorded.
      const lineGstPct = Number(it.gstPct ?? it.GstPct ?? NaN);
      const masterGstPct = master.cgstRate + master.sgstRate;
      const totalGSTRate = Number.isFinite(lineGstPct)
        ? lineGstPct
        : masterGstPct;

      // Split the line's total GST rate between CGST/SGST using the master's
      // ratio when available (defaults to a 50/50 split).
      let cgstShare = 0.5,
        sgstShare = 0.5;
      if (masterGstPct > 0) {
        cgstShare = master.cgstRate / masterGstPct;
        sgstShare = master.sgstRate / masterGstPct;
      }

      const gstAmount = baseAmount * (totalGSTRate / 100);
      const cgstAmount = gstAmount * cgstShare;
      const sgstAmount = gstAmount * sgstShare;
      const inclGST = baseAmount + gstAmount;

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
        cgstRate: Math.round(totalGSTRate * cgstShare * 100) / 100,
        sgstRate: Math.round(totalGSTRate * sgstShare * 100) / 100,
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

// -- GET /:id/posting -- preview the GRN journal entry (base, tax, cost centre, ledgers, posted status)
router.get("/:id/posting", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });
  try {
    const pool = getPool();

    // GRN row + linked PO cost centre
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT g.GRNID, g.GRNNo, g.GRNItems, g.POID,
             po.CompanyId, po.ProjectId, po.CostCenterId,
             cc.Name AS CostCenterName, cc.Code AS CostCenterCode
      FROM dbo.GoodsReceiptNotes g
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = g.POID
      LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = po.CostCenterId
      WHERE g.GRNID = @GRNID
    `);
    if (!grnRes.recordset.length) return res.status(404).json({ error: "GRN not found" });
    const grn = grnRes.recordset[0];

    // Compute base + tax totals (same algorithm as gst-breakdown)
    const rawItems = parseGRNItems(grn.GRNItems);
    const receivedItems = rawItems.filter((it) => {
      return Number(it.receivedQty || it.ReceivedQty || 0) > 0
        || Number(it.quantity || it.Quantity || 0) > 0
        || Number(it.totalAmount || 0) > 0;
    });

    let totalBase = 0, totalGST = 0;
    if (receivedItems.length > 0) {
      const itemIds = receivedItems.map((it) => String(it.itemId || it.ItemId || "").trim()).filter(Boolean);
      let masterMap = {};
      if (itemIds.length > 0) {
        const mReq = pool.request();
        const ph = itemIds.map((id, i) => { mReq.input(`iid${i}`, sql.NVarChar(100), id); return `@iid${i}`; }).join(",");
        const mRes = await mReq.query(`SELECT CONVERT(NVARCHAR(100), M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100), M_Id) IN (${ph})`);
        for (const row of mRes.recordset) masterMap[row.M_Id] = { cgstRate: parseFloat(row.M_CGST) || 0, sgstRate: parseFloat(row.M_SGST) || 0 };
      }
      for (const it of receivedItems) {
        const itemId = String(it.itemId || it.ItemId || "");
        const receivedQty = Number(it.receivedQty || it.ReceivedQty || 0);
        const rate = Number(it.rate || it.Rate || 0);
        const baseAmount = Number(it.totalAmount) > 0 ? Number(it.totalAmount) : rate * Number(it.quantity || it.Quantity || receivedQty || 0);
        const master = masterMap[itemId] || { cgstRate: 0, sgstRate: 0 };
        const lineGstPct = Number(it.gstPct ?? it.GstPct ?? NaN);
        const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate + master.sgstRate);
        totalBase += baseAmount;
        totalGST += baseAmount * (totalGSTRate / 100);
      }
    }
    totalBase = Math.round(totalBase * 100) / 100;
    totalGST = Math.round(totalGST * 100) / 100;
    const totalInclGST = Math.round((totalBase + totalGST) * 100) / 100;

    // System-generated ledgers
    const ledRes = await pool.request().query(`
      SELECT LHeadId, LHeadName, LHeadCode FROM dbo.AccountHeadMaster
      WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1
    `);
    const leds = ledRes.recordset;
    const findLed = (fn) => { const l = leds.find(fn); return l ? { id: l.LHeadId, name: l.LHeadName, code: l.LHeadCode } : null; };
    const purchaseLed   = findLed((l) => l.LHeadName.toLowerCase().includes("purchase"));
    const pgrnLed       = findLed((l) => l.LHeadName.toLowerCase().includes("pending"));
    const provisionalLed = findLed((l) => l.LHeadName.toLowerCase().includes("provisional") && l.LHeadName.toLowerCase().includes("credit"));

    // Check if already posted (GRNPosting source type in GL)
    const postedRes = await pool.request().input("SrcId", sql.Int, grnId).query(`
      SELECT TOP 1 EntryId, VoucherNo FROM dbo.GeneralLedgerEntry
      WHERE SourceType='GRNPosting' AND SourceId=@SrcId AND IsReversed=0
    `);
    const existingPost = postedRes.recordset[0];

    res.json({
      grnNo: grn.GRNNo,
      baseAmount: totalBase,
      taxAmount: totalGST,
      totalAmount: totalInclGST,
      costCentre: grn.CostCenterName ? { id: grn.CostCenterId, name: grn.CostCenterName, code: grn.CostCenterCode } : null,
      accounts: { purchase: purchaseLed, pgrn: pgrnLed, provisional: provisionalLed },
      isPosted: !!existingPost,
      jvNo: existingPost?.VoucherNo ?? null,
      jvId: existingPost?.EntryId ?? null,
    });
  } catch (err) {
    console.error("GRN posting preview error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- POST /:id/post-to-gl -- create JV + post GRN journal entry to GL
router.post("/:id/post-to-gl", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });
  const userEmail = req.user?.email || "system";
  try {
    const pool = getPool();
    const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");

    // Fetch posting preview (reuse endpoint logic via internal call)
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT g.GRNID, g.GRNNo, g.GRNItems, g.POID,
             po.CompanyId, po.ProjectId
      FROM dbo.GoodsReceiptNotes g
      LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = g.POID
      WHERE g.GRNID = @GRNID
    `);
    if (!grnRes.recordset.length) return res.status(404).json({ error: "GRN not found" });
    const grn = grnRes.recordset[0];

    // Check if already posted
    const alreadyPosted = await pool.request().input("SrcId", sql.Int, grnId).query(`
      SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType='GRNPosting' AND SourceId=@SrcId AND IsReversed=0
    `);
    if (alreadyPosted.recordset.length) return res.status(409).json({ error: "This GRN has already been posted to GL." });

    // Recompute totals
    const rawItems = parseGRNItems(grn.GRNItems);
    const receivedItems = rawItems.filter((it) => Number(it.receivedQty||it.ReceivedQty||0)>0||Number(it.quantity||it.Quantity||0)>0||Number(it.totalAmount||0)>0);
    let totalBase = 0, totalGST = 0;
    if (receivedItems.length > 0) {
      const itemIds = receivedItems.map((it)=>String(it.itemId||it.ItemId||"").trim()).filter(Boolean);
      let masterMap = {};
      if (itemIds.length > 0) {
        const mReq = pool.request();
        const ph = itemIds.map((id,i)=>{ mReq.input(`iid${i}`,sql.NVarChar(100),id); return `@iid${i}`; }).join(",");
        const mRes = await mReq.query(`SELECT CONVERT(NVARCHAR(100),M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100),M_Id) IN (${ph})`);
        for (const row of mRes.recordset) masterMap[row.M_Id]={ cgstRate:parseFloat(row.M_CGST)||0, sgstRate:parseFloat(row.M_SGST)||0 };
      }
      for (const it of receivedItems) {
        const itemId = String(it.itemId||it.ItemId||"");
        const receivedQty = Number(it.receivedQty||it.ReceivedQty||0);
        const rate = Number(it.rate||it.Rate||0);
        const baseAmount = Number(it.totalAmount)>0 ? Number(it.totalAmount) : rate*Number(it.quantity||it.Quantity||receivedQty||0);
        const master = masterMap[itemId]||{cgstRate:0,sgstRate:0};
        const lineGstPct = Number(it.gstPct??it.GstPct??NaN);
        const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate+master.sgstRate);
        totalBase += baseAmount;
        totalGST += baseAmount*(totalGSTRate/100);
      }
    }
    totalBase = Math.round(totalBase*100)/100;
    totalGST = Math.round(totalGST*100)/100;
    const totalInclGST = Math.round((totalBase+totalGST)*100)/100;

    if (totalBase <= 0) return res.status(400).json({ error: "GRN has no receivable amount to post." });

    // Get system ledger IDs
    const ledRes = await pool.request().query(`SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1`);
    const leds = ledRes.recordset;
    const findId = (fn) => leds.find(fn)?.LHeadId;
    const purchaseId   = findId((l)=>l.LHeadName.toLowerCase().includes("purchase"));
    const pgrnId       = findId((l)=>l.LHeadName.toLowerCase().includes("pending"));
    const provisionalId = findId((l)=>l.LHeadName.toLowerCase().includes("provisional")&&l.LHeadName.toLowerCase().includes("credit"));
    if (!purchaseId || !pgrnId || !provisionalId) return res.status(422).json({ error: "One or more required system ledgers (Purchase, PGRN, Provisional Credit) are not configured." });

    // JV lines: Debit Purchase (base) + Debit Provisional Credit (tax) = Credit PGRN (total incl GST)
    const lines = [
      { LHeadId: purchaseId,    DebitAmount: totalBase,    CreditAmount: 0, Narration: `GRN Posting: ${grn.GRNNo} — Purchase (base)` },
      { LHeadId: pgrnId,        DebitAmount: 0,             CreditAmount: totalInclGST, Narration: `GRN Posting: ${grn.GRNNo} — Provision for Pending GRN` },
      ...(totalGST > 0 ? [{ LHeadId: provisionalId, DebitAmount: totalGST, CreditAmount: 0, Narration: `GRN Posting: ${grn.GRNNo} — Provisional ITC` }] : []),
    ];

    // Create JV
    const dtId = await resolveDocTypeId(pool, sql, "JV").catch(() => null);
    const { finalDocNo } = await lockNextDocNumber(pool, sql, "JV", dtId, grn.CompanyId, grn.ProjectId).catch(() => ({ finalDocNo: null }));
    const insertHdr = await pool.request()
      .input("JVNo", sql.NVarChar(100), finalDocNo || null)
      .input("JVDate", sql.Date, new Date())
      .input("Narration", sql.NVarChar(500), `GRN Posting: ${grn.GRNNo}`)
      .input("CompanyId", sql.Int, grn.CompanyId || null)
      .input("ProjectId", sql.Int, grn.ProjectId || null)
      .input("DocTypeId", sql.Int, dtId || null)
      .input("CreatedBy", sql.NVarChar(150), userEmail)
      .query(`INSERT INTO dbo.JournalVoucher (JVNo,JVDate,Narration,CompanyId,ProjectId,Status,DocTypeId,CreatedBy) OUTPUT INSERTED.JVID VALUES (@JVNo,@JVDate,@Narration,@CompanyId,@ProjectId,'Approved',@DocTypeId,@CreatedBy)`);
    const jvId = insertHdr.recordset[0].JVID;

    let sortOrder = 0;
    for (const line of lines) {
      await pool.request()
        .input("JVID", sql.Int, jvId)
        .input("LHeadId", sql.Int, line.LHeadId)
        .input("DebitAmount", sql.Decimal(18,2), line.DebitAmount)
        .input("CreditAmount", sql.Decimal(18,2), line.CreditAmount)
        .input("Narration", sql.NVarChar(255), line.Narration)
        .input("SortOrder", sql.Int, sortOrder++)
        .query(`INSERT INTO dbo.JournalVoucherLines (JVID,LHeadId,DebitAmount,CreditAmount,Narration,SortOrder) VALUES (@JVID,@LHeadId,@DebitAmount,@CreditAmount,@Narration,@SortOrder)`);
    }
    if (finalDocNo) await backPatchRecordId(pool, sql, finalDocNo, "JournalVoucher", jvId);

    // Post to GL using GRNPosting source type so we can detect it later
    const { postVoucher } = require("../services/generalLedger");
    await postVoucher(pool, {
      voucherNo: finalDocNo || `JV-${jvId}`,
      voucherDate: new Date(),
      sourceType: "GRNPosting",
      sourceId: grnId,
      companyId: grn.CompanyId ?? null,
      projectId: grn.ProjectId ?? null,
      createdBy: userEmail,
      legs: lines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration })),
    });

    await bumpCacheVersion("journal-voucher");
    res.json({ jvId, jvNo: finalDocNo, message: "GRN posted to GL successfully." });
  } catch (err) {
    console.error("GRN post-to-gl error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- GET /:id/pending-items --
// Returns items from a GRN that still have remainingQty > 0.
// These are items ordered on the linked PO but not yet fully received.
// Used to surface "pending items" directly on the GRN ΓÇö replacing the old
// auto-draft expense booking approach.
router.get("/:id/pending-items", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });

  try {
    const pool = getPool();

    const grnResult = await pool.request().input("GRNID", sql.Int, grnId)
      .query(`
        SELECT
          grn.GRNID, grn.GRNNo, grn.DocNo, grn.GRNDate,
          grn.GRNItems, grn.SupplierID, grn.POID,
          s.LHeadName AS SupplierName,
          p.PurchaseOrderNo, p.TotalAmount AS POTotal,
          p.CompanyId, p.ProjectId,
          ISNULL((
            SELECT SUM(g2.TotalAmount)
            FROM dbo.GoodsReceiptNotes g2
            WHERE g2.POID = grn.POID
              AND g2.Status != 'Rejected'
          ), 0) AS POTotalReceived
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders p ON p.PurchaseOrderID = grn.POID
        WHERE grn.GRNID = @GRNID
      `);

    if (!grnResult.recordset.length)
      return res.status(404).json({ error: "GRN not found" });

    const row = grnResult.recordset[0];
    const allItems = parseGRNItems(row.GRNItems);

    const pendingItems = allItems
      .filter((it) => Number(it.remainingQty || 0) > 0)
      .map((it) => ({
        itemId: it.itemId || it.ItemId || null,
        itemName: it.itemName || it.ItemName || "",
        uom: it.uom || it.UOM || "",
        orderedQty: Number(it.orderedQty || 0),
        receivedQty: Number(it.receivedQty || it.ReceivedQty || 0),
        remainingQty: Number(it.remainingQty || 0),
        rate: Number(it.rate || it.Rate || 0),
        pendingAmount:
          Number(it.remainingQty || 0) * Number(it.rate || it.Rate || 0),
      }));

    // Use PO's stored total (incl. GST) minus all GRN receipts against it
    // as the true pending value ΓÇö more accurate than summing remainingQty * rate
    // which omits GST and any rate amendments made after GRN entry.
    const poTotal = Number(row.POTotal || 0);
    const poTotalReceived = Number(row.POTotalReceived || 0);
    const totalPendingAmount =
      poTotal > 0
        ? Math.max(0, poTotal - poTotalReceived)
        : pendingItems.reduce((s, i) => s + i.pendingAmount, 0);

    // Other GRNs for the same PO (partial receipts ΓÇö excludes this GRN and rejected ones)
    let partialGRNs = [];
    if (row.POID) {
      const otherGRNsResult = await pool.request()
        .input("POID", sql.Int, row.POID)
        .input("GRNID", sql.Int, grnId)
        .query(`
          SELECT grn.GRNID, grn.GRNNo, grn.DocNo, grn.GRNDate, grn.Status,
                 grn.TotalAmount, grn.GRNItems
          FROM dbo.GoodsReceiptNotes grn
          WHERE grn.POID = @POID
            AND grn.GRNID != @GRNID
            AND grn.Status != 'Rejected'
          ORDER BY grn.GRNDate DESC
        `);
      partialGRNs = otherGRNsResult.recordset.map((g) => {
        const items = parseGRNItems(g.GRNItems);
        return {
          grnId: g.GRNID,
          grnNo: g.GRNNo || g.DocNo,
          grnDate: g.GRNDate,
          status: g.Status,
          totalAmount: Number(g.TotalAmount || 0),
          itemCount: items.length,
        };
      });
    }

    res.json({
      grnId: row.GRNID,
      grnNo: row.GRNNo || row.DocNo,
      supplierName: row.SupplierName || null,
      poId: row.POID ?? null,
      poNo: row.PurchaseOrderNo || null,
      pendingItems,
      totalPendingAmount: Math.round(totalPendingAmount * 100) / 100,
      hasPending: pendingItems.length > 0,
      partialGRNs,
    });
  } catch (err) {
    console.error("GET pending-items error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ POST /from-transfer/:transferId ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Create a GRN from a Stock Transfer document.
//
// Flow:
//   1. Fetch the StockTransfer by ID (validate it exists & is Completed).
//   2. Map TransferItems ΓåÆ GRNItems (receivedQty = transferred qty).
//   3. Target godown = ToGodownID of the transfer (stock already landed there).
//   4. Lock a GRN doc-number using the standard "GRN" prefix (same series as all GRNs).
//   5. Insert GoodsReceiptNotes row (no POID / SupplierID required).
//   6. Insert StockLedger IN entries (credit the destination godown).
//   7. Store SourceTransferID + SourceTransferDocNo for traceability.
//
// The caller may pass { remarks, supplierId } in the request body to optionally
// attach a supplier and free-text note.  All other fields are derived from the
// transfer.
router.post(
  "/from-transfer/:transferId",
  requirePageRight("grn-master", "create"),
  async (req, res) => {
    const transferId = parseInt(req.params.transferId, 10);
    if (isNaN(transferId)) {
      return res.status(400).json({ error: "Invalid transferId" });
    }

    const pool = getPool();

    // ΓöÇΓöÇ 1. Fetch transfer ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    let transfer;
    try {
      const trResult = await pool
        .request()
        .input("TransferID", sql.Int, transferId).query(`
        SELECT
          st.TransferID, st.DocNo, st.TransferDate,
          st.FromGodownID, fg.GodownName AS FromGodownName,
          st.ToGodownID,   tg.GodownName AS ToGodownName,
          st.TransferItems, st.Status
        FROM dbo.StockTransfers st
        JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
        JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
        WHERE st.TransferID = @TransferID
      `);

      if (!trResult.recordset.length) {
        return res.status(404).json({ error: "Stock Transfer not found" });
      }

      transfer = trResult.recordset[0];

      // Parse TransferItems JSON
      if (
        typeof transfer.TransferItems === "string" &&
        transfer.TransferItems.trim()
      ) {
        transfer.TransferItems = JSON.parse(transfer.TransferItems);
      }
      if (
        !Array.isArray(transfer.TransferItems) ||
        !transfer.TransferItems.length
      ) {
        return res.status(400).json({ error: "Transfer has no items" });
      }
    } catch (err) {
      console.error("[grns] from-transfer fetch error:", err.message);
      return res.status(500).json({ error: err.message });
    }

    // ΓöÇΓöÇ 2. Check for duplicate GRN (idempotency guard) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const dupCheck = await pool
      .request()
      .input("SourceTransferID", sql.Int, transferId)
      .query(
        "SELECT GRNID, GRNNo FROM dbo.GoodsReceiptNotes WHERE SourceTransferID = @SourceTransferID AND Status != 'Rejected'",
      );
    if (dupCheck.recordset.length > 0) {
      const existing = dupCheck.recordset[0];
      return res.status(409).json({
        error: `A GRN (${existing.GRNNo}) already exists for this transfer`,
        existingGrnId: existing.GRNID,
        existingGrnNo: existing.GRNNo,
      });
    }

    const { remarks = null, supplierId = null } = req.body || {};
    const grnDate = transfer.TransferDate
      ? transfer.TransferDate.toISOString
        ? transfer.TransferDate.toISOString().slice(0, 10)
        : String(transfer.TransferDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // ΓöÇΓöÇ 3. Map TransferItems ΓåÆ GRNItems ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const grnItems = transfer.TransferItems.map((item) => ({
      itemId: String(item.itemId),
      itemName: item.itemName || item.itemId,
      orderedQty: Number(item.qty),
      receivedQty: Number(item.qty),
      remainingQty: 0,
      uom: item.uom || "",
      rate: Number(item.rate || 0),
      quantity: Number(item.qty),
      totalAmount: Number(item.rate || 0) * Number(item.qty),
      gstPct: 0,
      gstAmount: 0,
    }));

    const transaction = pool.transaction();
    try {
      await transaction.begin();

      // ΓöÇΓöÇ 4. Lock doc number using the standard "GRN" prefix ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      // Transfer GRNs share the same GRN-YYYY-NNNNN number series as all other
      // GRNs. The source transfer is tracked via SourceTransferDocNo (Ref Doc).
      const resolvedDocTypeId = await resolveDocTypeId(pool, sql, "GRN");

      const finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: resolvedDocTypeId,
        finYear: null,
        tableName: "GoodsReceiptNotes",
        docNoColumn: "DocNo",
        issuedBy: req.user?.email || req.user?.name || null,
        parentDocNo: transfer.DocNo,
        rootExBDocNo: null,
      });

      const parts = (finalDocNo || "").split("-");
      const docYear =
        parts.length >= 2
          ? parseInt(parts[parts.length - 2], 10) || null
          : null;
      const docSerial =
        parts.length >= 1
          ? parseInt(parts[parts.length - 1], 10) || null
          : null;

      // ΓöÇΓöÇ 5. Insert GoodsReceiptNotes ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
      const grnResult = await transaction
        .request()
        .input("GRNNo", sql.NVarChar(50), finalDocNo)
        .input("GRNDate", sql.Date, grnDate)
        .input(
          "SupplierID",
          sql.Int,
          supplierId ? parseInt(supplierId, 10) : null,
        )
        .input("POID", sql.Int, null)
        .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems))
        .input("Status", sql.NVarChar(50), "Draft")
        .input(
          "Remarks",
          sql.NVarChar(sql.MAX),
          remarks || `Auto-generated from Stock Transfer ${transfer.DocNo}`,
        )
        .input("DocTypeId", sql.Int, resolvedDocTypeId || null)
        .input("DocNo", sql.NVarChar(100), finalDocNo)
        .input("DocYear", sql.SmallInt, docYear)
        .input("DocSerial", sql.Int, docSerial)
        .input("ParentDocNo", sql.NVarChar(100), transfer.DocNo)
        .input("RootExBDocNo", sql.NVarChar(100), null)
        .input("TotalAmount", sql.Decimal(18, 2), computeGRNTotal(grnItems))
        .input("GodownID", sql.Int, parseInt(transfer.ToGodownID, 10))
        .input("SourceTransferID", sql.Int, transferId)
        .input("SourceTransferDocNo", sql.NVarChar(100), transfer.DocNo)
        .input("CreatedDate", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.GoodsReceiptNotes
          (GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks,
           DocTypeId, DocNo, DocYear, DocSerial, ParentDocNo, RootExBDocNo,
           TotalAmount, GodownID, SourceTransferID, SourceTransferDocNo, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES
          (@GRNNo, @GRNDate, @SupplierID, @POID, @GRNItems, @Status, @Remarks,
           @DocTypeId, @DocNo, @DocYear, @DocSerial, @ParentDocNo, @RootExBDocNo,
           @TotalAmount, @GodownID, @SourceTransferID, @SourceTransferDocNo, @CreatedDate)
      `);

      const grnId = grnResult.recordset[0].GRNID;

      // Stock is credited on approval (postGRNApproval), not here — this
      // GRN still starts Draft and gets auto-submitted to Pending below,
      // same as any other GRN; it isn't exempt from being vetted just
      // because it originated from a transfer.
      await transaction.commit();

      // Back-patch the doc number reservation record with the real GRNID
      await backPatchRecordId(
        pool,
        sql,
        finalDocNo,
        "GoodsReceiptNotes",
        grnId,
      );

      // Auto-submit: Draft ΓåÆ Pending
      try {
        const { transition } = require("../services/approvalService");
        await transition(
          "goods-receipt",
          grnId,
          "Pending",
          req.user?.email,
          req.user?.role,
        );
      } catch (submitErr) {
        console.warn(
          "[grns] from-transfer auto-submit failed (non-fatal):",
          submitErr.message,
        );
      }

      await bumpCacheVersion("grns");
      await bumpCacheVersion("stock-ledger");

      return res.status(201).json({
        message: `GRN created from transfer ${transfer.DocNo}`,
        grnId,
        grnNo: finalDocNo,
        docNo: finalDocNo,
        sourceTransferDocNo: transfer.DocNo,
        toGodownName: transfer.ToGodownName,
      });
    } catch (err) {
      await transaction.rollback().catch(() => {});
      console.error("[grns] from-transfer create error:", err.message);
      return res.status(500).json({
        error: "Failed to create GRN from transfer",
        message: err.message,
      });
    }
  },
);

// ΓöÇΓöÇΓöÇ GET /by-transfer/:transferId ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Returns all GRNs linked to a specific stock transfer (for UI badge/check).
router.get("/by-transfer/:transferId", async (req, res) => {
  const transferId = parseInt(req.params.transferId, 10);
  if (isNaN(transferId)) {
    return res.status(400).json({ error: "Invalid transferId" });
  }
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("SourceTransferID", sql.Int, transferId).query(`
        SELECT GRNID, GRNNo, DocNo, GRNDate, Status, TotalAmount, SourceTransferDocNo
        FROM dbo.GoodsReceiptNotes
        WHERE SourceTransferID = @SourceTransferID
        ORDER BY CreatedDate DESC
      `);
    return res.json(result.recordset);
  } catch (err) {
    console.error("[grns] by-transfer error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /by-vehicle-in-out/:id ────────────────────────────────────────
// Returns the (at most one) active GRN linked to a specific Vehicle
// In/Out document — lets the VehicleInOut UI show a "GRN Created" badge
// with a link, and lets GRN.tsx re-check before letting a user pick an
// already-consumed Vehicle In/Out record.
router.get("/by-vehicle-in-out/:id", async (req, res) => {
  const vehicleInOutId = parseInt(req.params.id, 10);
  if (isNaN(vehicleInOutId)) {
    return res.status(400).json({ error: "Invalid vehicle in/out id" });
  }
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("VehicleInOutID", sql.Int, vehicleInOutId).query(`
        SELECT GRNID, GRNNo, DocNo, GRNDate, Status, TotalAmount, POID
        FROM dbo.GoodsReceiptNotes
        WHERE VehicleInOutID = @VehicleInOutID AND Status <> 'Rejected'
        ORDER BY CreatedDate DESC
      `);
    return res.json(result.recordset[0] || null);
  } catch (err) {
    console.error("[grns] by-vehicle-in-out error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ GRN Attachments ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Mirrors the Vehicle In/Out attachment pattern: files stored as binary in
// the DB (not disk), uploaded while the form is still being filled out
// (GRNID = NULL), then linked to the GRN once it's actually saved.

let _grnAttachTableExists = null;
async function grnAttachTableExists(pool) {
  if (_grnAttachTableExists !== null) return _grnAttachTableExists;
  const r = await pool
    .request()
    .query(
      "SELECT 1 AS f FROM sys.tables WHERE object_id = OBJECT_ID('dbo.GRNAttachments')",
    );
  _grnAttachTableExists = !!r.recordset[0];
  return _grnAttachTableExists;
}

async function linkGRNAttachments(pool, grnId, attachmentIds) {
  if (!attachmentIds.length) return;
  if (!(await grnAttachTableExists(pool))) return;
  for (const attachId of attachmentIds) {
    await pool
      .request()
      .input("AttachmentId", sql.Int, attachId)
      .input("GRNID", sql.Int, grnId).query(`
        UPDATE dbo.GRNAttachments
        SET GRNID = @GRNID
        WHERE AttachmentId = @AttachmentId AND GRNID IS NULL
      `);
  }
}

function parseIdList(raw) {
  if (Array.isArray(raw))
    return raw.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        return parsed.map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    } catch {
      return [];
    }
  }
  return [];
}

// ΓöÇΓöÇ POST /upload ΓÇö GRN attachments (stored in DB, not disk) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Accepts multiple files at once (images, videos, documents, etc).
router.post(
  "/upload",
  requirePageRight("grn-master", "edit"),
  upload.array("file", 20),
  async (req, res) => {
    const userEmail = req.user?.email;
    if (!userEmail)
      return res.status(401).json({ error: "User context missing" });

    const files = req.files;
    if (!files || files.length === 0)
      return res.status(400).json({ error: "No file uploaded" });

    try {
      const pool = getPool();
      if (!(await grnAttachTableExists(pool)))
        return res
          .status(503)
          .json({
            error:
              "GRN attachments not yet available. Please run pending database migrations.",
          });
      const results = [];

      for (const file of files) {
        const insertResult = await pool
          .request()
          .input("FileName", sql.NVarChar(255), file.originalname)
          .input("MimeType", sql.NVarChar(100), file.mimetype)
          .input("FileSize", sql.Int, file.size)
          .input("FileData", sql.VarBinary(sql.MAX), file.buffer)
          .input("UploadedBy", sql.NVarChar(150), userEmail).query(`
            INSERT INTO dbo.GRNAttachments
              (GRNID, FileName, MimeType, FileSize, FileData, UploadedBy)
            OUTPUT INSERTED.AttachmentId
            VALUES
              (NULL, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy)
          `);

        const attachId = insertResult.recordset[0].AttachmentId;
        results.push({
          id: attachId,
          filename: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: `/api/grns/attachment/${attachId}`,
        });
      }

      res.json({
        success: true,
        attachments: results,
        ids: results.map((r) => r.id),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ΓöÇΓöÇ GET /attachment/:attachId ΓÇö stream binary from DB ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get("/attachment/:attachId", async (req, res) => {
  try {
    const attachId = parseInt(req.params.attachId, 10);
    if (isNaN(attachId))
      return res.status(400).json({ error: "Invalid attachment id" });

    const pool = getPool();
    if (!(await grnAttachTableExists(pool)))
      return res.status(404).json({ error: "Attachment not found" });
    const result = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query(`
        SELECT AttachmentId, FileName, MimeType, FileData
        FROM dbo.GRNAttachments
        WHERE AttachmentId = @AttachmentId
      `);

    if (!result.recordset.length)
      return res.status(404).json({ error: "Attachment not found" });

    const attachment = result.recordset[0];
    res.setHeader("Content-Type", attachment.MimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.FileName)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(attachment.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇ DELETE /attachment/:attachId ΓÇö remove a single attachment ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.delete(
  "/attachment/:attachId",
  requirePageRight("grn-master", "delete"),
  async (req, res) => {
    try {
      const attachId = parseInt(req.params.attachId, 10);
      if (isNaN(attachId))
        return res.status(400).json({ error: "Invalid attachment id" });

      const pool = getPool();
      const result = await pool
        .request()
        .input("AttachmentId", sql.Int, attachId)
        .query(
          `DELETE FROM dbo.GRNAttachments WHERE AttachmentId = @AttachmentId`,
        );

      if (result.rowsAffected[0] === 0)
        return res.status(404).json({ error: "Attachment not found" });

      await bumpCacheVersion("grns");
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
module.exports.createGRNInternal = createGRNInternal;