const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { validateBody } = require("../middleware/validateRequest");
const { requireValidId, checkRowsAffected } = require("../utils/routeHelpers");
const { getDocumentChainForPO } = require("../services/poVehicleGrnChain");
const { getServicePurchaseOrders } = require("../services/invoiceLinking");
const {
  purchaseOrderBodySchema,
  purchaseOrderUpdateSchema,
} = require("../validation/financialRouteSchemas");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

router.use(checkPermissionForMethod("Material", "PurchaseOrders"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const requireUserName = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

const parseJson = (val) => {
  if (!val) return null;
  return typeof val === "string" ? val : JSON.stringify(val);
};

const safeJson = (str) => {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// Extract scalar GST fields from the GST JSON blob for the new columns
const extractGstScalars = (gstVal) => {
  const obj = typeof gstVal === "string" ? safeJson(gstVal) : gstVal;
  if (!obj) return { hsnCode: null, gstType: null, gstRate: null };
  return {
    hsnCode: obj.hsnCode || null,
    gstType: obj.type || null,
    gstRate: obj.rate != null ? parseFloat(obj.rate) || null : null,
  };
};

// Compute subtotal from POItems array (sum of qty × rate, before GST)
const computeSubtotal = (items) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.reduce((s, it) => {
    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    return s + qty * rate;
  }, 0);
};

// Resolve a FinYear.FId from its FName label (e.g. "2026-2027", "FY 2026-27",
// "AY24-25"). The label is whatever the frontend's Financial Year dropdown
// happens to display, and that name is free-text — it can contain any
// letters/spacing the Financial Year master allows — so an exact
// byte-for-byte string match silently failed (and left fy_id NULL, with the
// rest of the PO still saving "successfully") for anything that wasn't a
// perfect match. This now falls back to a trimmed/case-insensitive compare,
// then to matching on the two embedded year numbers, so any naming
// convention resolves correctly.
// Returns null if no label was supplied or no matching row exists.
const resolveFyId = async (pool, finYearLabel) => {
  if (!finYearLabel) return null;
  const label = String(finYearLabel).trim();
  if (!label) return null;
  try {
    const exact = await pool
      .request()
      .input("FName", sql.NVarChar, label)
      .query(
        "SELECT FId FROM dbo.FinYear WHERE LTRIM(RTRIM(FName)) = @FName",
      );
    if (exact.recordset[0]?.FId) return exact.recordset[0].FId;

    const digits = label.match(/\d+/g) ?? [];
    if (digits.length >= 1) {
      const startYear = Number(digits[0].length <= 2 ? `20${digits[0]}` : digits[0]);
      const endYear =
        digits.length >= 2
          ? Number(digits[1].length <= 2 ? `20${digits[1]}` : digits[1])
          : startYear + 1;
      const byYear = await pool
        .request()
        .input("StartYear", sql.Int, startYear)
        .input("EndYear", sql.Int, endYear)
        .query(
          `SELECT FId FROM dbo.FinYear
           WHERE YEAR(FStartDate) = @StartYear AND YEAR(FEndDate) = @EndYear`,
        );
      if (byYear.recordset[0]?.FId) return byYear.recordset[0].FId;
    }
    return null;
  } catch {
    return null;
  }
};

// Build the UOM-id lookup map: name → id (used when syncing PurchaseOrderItems)
const buildUomMap = async (pool) => {
  try {
    const r = await pool
      .request()
      .query("SELECT Id, UOMName FROM dbo.UOMMaster WHERE IsActive = 1");
    const map = {};
    for (const row of r.recordset) map[row.UOMName] = row.Id;
    return map;
  } catch {
    return {};
  }
};

// ─── Sync PurchaseOrderItems child rows ──────────────────────────────────────
//
// Strategy: delete all existing rows for this PO then re-insert from POItems
// JSON.  This keeps the normalised table perfectly in sync with the JSON blob
// without needing per-row diffing.  For the volumes typical of a PO (< 100
// lines) a delete-and-reinsert is fast and simple.
//
const syncLineItems = async (
  transaction,
  sqlRef,
  purchaseOrderID,
  poItems,
  uomMap,
) => {
  if (!Array.isArray(poItems) || poItems.length === 0) return;

  // Delete existing child rows for this PO
  await transaction
    .request()
    .input("POID", sqlRef.Int, purchaseOrderID)
    .query("DELETE FROM dbo.PurchaseOrderItems WHERE PurchaseOrderID = @POID");

  // Re-insert each line item
  for (let i = 0; i < poItems.length; i++) {
    const it = poItems[i];
    const itemName = String(it.itemDescription || it.itemName || "").substring(
      0,
      255,
    );
    if (!itemName) continue; // skip blank rows

    const qty = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const amount = parseFloat(it.amount) || qty * rate;
    const uomName = String(it.unit || "").substring(0, 50);
    const uomId = uomMap[uomName] || null;

    await transaction
      .request()
      .input("POID", sqlRef.Int, purchaseOrderID)
      .input("ItemId", sqlRef.NVarChar(100), it.itemId || null)
      .input("ItemName", sqlRef.NVarChar(255), itemName)
      .input("ItemCode", sqlRef.NVarChar(50), it.itemCode || null)
      .input("Desc", sqlRef.NVarChar(sqlRef.MAX), it.description || null)
      .input("Qty", sqlRef.Decimal(18, 4), qty)
      .input("UomId", sqlRef.Int, uomId)
      .input("UomName", sqlRef.NVarChar(50), uomName || null)
      .input("Rate", sqlRef.Decimal(18, 4), rate)
      .input("TaxPct", sqlRef.Decimal(5, 2), parseFloat(it.tax) || 0)
      .input("LineAmt", sqlRef.Decimal(18, 2), amount)
      .input("Sort", sqlRef.Int, i)
      .input("ReceivedQty", sqlRef.Decimal(18, 4), 0)
      .input("Now", sqlRef.DateTime2, new Date()).query(`
        INSERT INTO dbo.PurchaseOrderItems
          (PurchaseOrderID, ItemId, ItemName, ItemCode, Description,
           Quantity, ReceivedQty, UomId, UomName, Rate, TaxPct, LineAmount, SortOrder, CreatedAt)
        VALUES
          (@POID, @ItemId, @ItemName, @ItemCode, @Desc,
           @Qty, @ReceivedQty, @UomId, @UomName, @Rate, @TaxPct, @LineAmt, @Sort, @Now)
      `);
  }
};

// ─── Internal creation function ──────────────────────────────────────────────
// Extracted from POST / so other server-side callers (the Inter-Company
// Stock Transfer orchestrator) can create a real, fully-validated Purchase
// Order in-process without duplicating this validation/numbering/insert
// logic or making an HTTP self-call. Mechanical extraction — the POST route
// below now just calls this for the DB write, then keeps doing its own
// cache-bump, MR/QT status updates, and auto-submit exactly as before, so
// its behavior is unchanged. The orchestrator, by contrast, drives its own
// approval transition separately rather than auto-submitting to Pending —
// see interCompanyTransfer.js. Thrown errors carry a `.status` for the HTTP
// code to use.
const createPurchaseOrderInternal = async (pool, payload, userEmail) => {
  const {
    PurchaseOrderNo: poNoFromClient,
    PODate,
    ExpectedDeliveryDate,
    SupplierID,
    CompanyId,
    ProjectId,
    ItemDescription,
    Quantity,
    Unit,
    Rate,
    TotalAmount,
    PaymentTerms,
    Status,
    Remarks,
    DocTypeId,
    finYear,
    POItems,
    Discount,
    GST,
    SourceWOId,
    SourceWODocNo,
    SourceMRId,
    SourceMRDocNo,
    SourceWDId,
    SourceWDDocNo,
    SourceQTId,
    SourceQTDocNo,
    POType,
    SourceSaleOrderId,
    SourceSaleOrderDocNo,
    SourceSaleInvoiceId,
    SourceSaleInvoiceDocNo,
    CostCenterId,
    VendorInvoiceDate,
    VendorInvoiceNo,
  } = payload;

  const poItemsArray = Array.isArray(POItems)
    ? POItems
    : (safeJson(parseJson(POItems)) ?? []);
  const poItemsJson = JSON.stringify(poItemsArray);
  const discountJson = parseJson(Discount);
  const gstJson = parseJson(GST);
  const { hsnCode, gstType, gstRate } = extractGstScalars(GST);
  const subtotal =
    computeSubtotal(poItemsArray) ??
    (parseFloat(Quantity) * parseFloat(Rate) || 0);

  if (!PODate) {
    const err = new Error("PODate is required.");
    err.status = 400;
    throw err;
  }
  if (!SupplierID) {
    const err = new Error("SupplierID is required.");
    err.status = 400;
    throw err;
  }

  // Enforce: a PO can only be raised against a paid Sale Invoice
  // (Sale Order workflow — Migration 111).
  if (SourceSaleInvoiceId) {
    const siId = parseInt(SourceSaleInvoiceId, 10);
    const siCheck = await pool
      .request()
      .input("SIId", sql.Int, siId)
      .query(
        "SELECT SaleInvoiceID, PaymentStatus, Amount FROM dbo.SaleInvoices WHERE SaleInvoiceID = @SIId AND IsDeleted = 0",
      );

    if (!siCheck.recordset.length) {
      const err = new Error("Source Sale Invoice not found.");
      err.status = 404;
      throw err;
    }

    const siStatus = siCheck.recordset[0].PaymentStatus;
    if (siStatus !== "Paid") {
      const err = new Error(
        `Cannot create Purchase Order: Sale Invoice is "${siStatus}". Only fully Paid Sale Invoices can be used to raise a Purchase Order.`,
      );
      err.status = 400;
      throw err;
    }
  }

  // Enforce: a PO can only be raised against an Approved Material Request.
  if (SourceMRId) {
    const mrId = parseInt(SourceMRId, 10);
    const mrCheck = await pool
      .request()
      .input("MRId", sql.Int, mrId)
      .query("SELECT Status FROM dbo.MaterialRequests WHERE MRId = @MRId");

    if (!mrCheck.recordset.length) {
      const err = new Error("Source Material Request not found.");
      err.status = 404;
      throw err;
    }

    const mrStatus = mrCheck.recordset[0].Status;
    if (mrStatus !== "Approved") {
      const err = new Error(
        `Cannot create a Purchase Order: Material Request is "${mrStatus}". Only Approved Material Requests can be used to raise a Purchase Order.`,
      );
      err.status = 400;
      throw err;
    }
  }

  const uomMap = await buildUomMap(pool);
  const fyId = await resolveFyId(pool, finYear);
  const { hasCC, hasVID, hasVIN } = await getPOCols(pool);

  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // Generate document number server-side when a document type is selected.
    // Client-provided values are previews only and are intentionally ignored
    // for numbered PO documents.
    let finalDocNo = null;
    if (DocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(DocTypeId, 10),
        finYear,
        tableName: "PurchaseOrders",
        issuedBy: userEmail,
      });
    } else {
      finalDocNo = poNoFromClient || null;
    }

    if (!finalDocNo) {
      const err = new Error(
        "PurchaseOrderNo is required. Select a document type or enter a PO number manually.",
      );
      err.status = 400;
      throw err;
    }

    const insertReq = transaction
      .request()
      .input("PurchaseOrderNo", sql.NVarChar(100), finalDocNo)
      .input("PODate", sql.Date, PODate)
      .input(
        "ExpectedDeliveryDate",
        sql.Date,
        ExpectedDeliveryDate || PODate,
      )
      .input("SupplierID", sql.Int, parseInt(SupplierID, 10))
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(sql.MAX), ItemDescription || null)
      .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit || "NOS")
      .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
      .input("SubtotalAmount", sql.Decimal(18, 2), subtotal)
      .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("HsnCode", sql.NVarChar(20), hsnCode)
      .input("GstType", sql.NVarChar(20), gstType)
      .input("GstRate", sql.Decimal(5, 2), gstRate)
      .input("PaymentTerms", sql.NVarChar(sql.MAX), PaymentTerms || null)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
      .input("Discount", sql.NVarChar(sql.MAX), discountJson)
      .input("GST", sql.NVarChar(sql.MAX), gstJson)
      .input(
        "SourceWOId",
        sql.Int,
        SourceWOId ? parseInt(SourceWOId, 10) : null,
      )
      .input("SourceWODocNo", sql.NVarChar(100), SourceWODocNo || null)
      .input(
        "SourceMRId",
        sql.Int,
        SourceMRId ? parseInt(SourceMRId, 10) : null,
      )
      .input("SourceMRDocNo", sql.NVarChar(100), SourceMRDocNo || null)
      .input(
        "SourceWDId",
        sql.Int,
        SourceWDId ? parseInt(SourceWDId, 10) : null,
      )
      .input("SourceWDDocNo", sql.NVarChar(100), SourceWDDocNo || null)
      .input(
        "SourceQTId",
        sql.Int,
        SourceQTId ? parseInt(SourceQTId, 10) : null,
      )
      .input("SourceQTDocNo", sql.NVarChar(100), SourceQTDocNo || null)
      .input(
        "SourceSaleOrderId",
        sql.Int,
        SourceSaleOrderId ? parseInt(SourceSaleOrderId, 10) : null,
      )
      .input("SourceSaleOrderDocNo", sql.NVarChar(100), SourceSaleOrderDocNo || null)
      .input(
        "SourceSaleInvoiceId",
        sql.Int,
        SourceSaleInvoiceId ? parseInt(SourceSaleInvoiceId, 10) : null,
      )
      .input("SourceSaleInvoiceDocNo", sql.NVarChar(100), SourceSaleInvoiceDocNo || null)
      .input(
        "POType",
        sql.NVarChar(20),
        POType ||
          (SourceSaleInvoiceId
            ? "SaleOrder"
            : SourceQTId
            ? "QPO"
            : SourceWOId
            ? "WO_PO"
            : SourceMRId
            ? "Normal"
            : SourceWDId
            ? "WO_PO"
            : "Direct"),
      )
      .input("FyId", sql.Int, fyId);

    if (hasCC) insertReq.input("CostCenterId", sql.Int, CostCenterId ? parseInt(CostCenterId, 10) : null);
    if (hasVID) insertReq.input("VendorInvoiceDate", sql.Date, VendorInvoiceDate || null);
    if (hasVIN) insertReq.input("VendorInvoiceNo", sql.NVarChar(100), VendorInvoiceNo || null);

    const result = await insertReq.query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID, CompanyId,
          ProjectId, ItemDescription, Quantity, Unit, Rate,
          SubtotalAmount, TotalAmount,
          HsnCode, GstType, GstRate,
          PaymentTerms, Status, Remarks, DocTypeId, DocNo,
          CreatedBy, CreatedAt, POItems, Discount, GST,
          SourceWOId, SourceWODocNo,
          SourceMRId, SourceMRDocNo,
          SourceWDId, SourceWDDocNo,
          SourceQTId, SourceQTDocNo,
          SourceSaleOrderId, SourceSaleOrderDocNo,
          SourceSaleInvoiceId, SourceSaleInvoiceDocNo,
          POType, fy_id
          ${hasCC ? ", CostCenterId" : ""}
          ${hasVID ? ", VendorInvoiceDate" : ""}
          ${hasVIN ? ", VendorInvoiceNo" : ""}
        )
        OUTPUT INSERTED.PurchaseOrderID
        VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate, @SupplierID, @CompanyId,
          @ProjectId, @ItemDescription, @Quantity, @Unit, @Rate,
          @SubtotalAmount, @TotalAmount,
          @HsnCode, @GstType, @GstRate,
          @PaymentTerms, @Status, @Remarks, @DocTypeId, @DocNo,
          @CreatedBy, @CreatedAt, @POItems, @Discount, @GST,
          @SourceWOId, @SourceWODocNo,
          @SourceMRId, @SourceMRDocNo,
          @SourceWDId, @SourceWDDocNo,
          @SourceQTId, @SourceQTDocNo,
          @SourceSaleOrderId, @SourceSaleOrderDocNo,
          @SourceSaleInvoiceId, @SourceSaleInvoiceDocNo,
          @POType, @FyId
          ${hasCC ? ", @CostCenterId" : ""}
          ${hasVID ? ", @VendorInvoiceDate" : ""}
          ${hasVIN ? ", @VendorInvoiceNo" : ""}
        )
      `);

    const newId = result.recordset[0].PurchaseOrderID;

    await syncLineItems(transaction, sql, newId, poItemsArray, uomMap);

    if (DocTypeId) {
      await backPatchRecordId(pool, sql, finalDocNo, "PurchaseOrders", newId);
    }

    await transaction.commit();

    return { PurchaseOrderID: newId, PurchaseOrderNo: finalDocNo };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }
};

// ─── SELECT columns shared by GET / and GET /:id ─────────────────────────────
// Built lazily on first use — migration-148 columns may not exist yet.

let _poCols = null;
let _poSelect = null;

async function getPOCols(pool) {
  if (_poCols) return _poCols;
  const check = async (col) => {
    const r = await pool.request()
      .input("T", sql.NVarChar(128), "PurchaseOrders")
      .input("C", sql.NVarChar(128), col)
      .query("SELECT 1 AS f FROM sys.columns WHERE object_id=OBJECT_ID(@T) AND name=@C");
    return !!r.recordset[0];
  };
  const [hasCC, hasVID, hasVIN] = await Promise.all([
    check("CostCenterId"), check("VendorInvoiceDate"), check("VendorInvoiceNo"),
  ]);
  _poCols = { hasCC, hasVID, hasVIN };
  return _poCols;
}

async function getPOSelect(pool) {
  if (_poSelect) return _poSelect;
  const { hasCC, hasVID, hasVIN } = await getPOCols(pool);

  _poSelect = `
  SELECT
    po.PurchaseOrderID,
    po.PurchaseOrderNo,
    po.PODate,
    po.ExpectedDeliveryDate,
    po.SupplierID,
    ah.LHeadName          AS SupplierName,
    po.CompanyId,
    co.name               AS CompanyName,
    po.ProjectId,
    pr.name               AS ProjectName,
    po.ItemDescription,
    po.Quantity,
    po.Unit,
    po.Rate,
    po.SubtotalAmount,
    po.TotalAmount,
    po.HsnCode,
    po.GstType,
    po.GstRate,
    po.PaymentTerms,
    po.Remarks,
    po.Status,
    po.CreatedBy,
    po.CreatedAt,
    po.UpdatedAt,
    po.ApprovedBy,
    po.ApprovedAt,
    po.DocTypeId,
    po.DocNo,
    po.ParentDocNo,
    po.RootExBDocNo,
    po.fy_id,
    COALESCE(
      fy.FName,
      (SELECT TOP 1 fyWO.FName
       FROM dbo.WorkOrderHeader woh
       JOIN dbo.FinYear fyWO
         ON woh.DocumentDate >= fyWO.FStartDate
        AND woh.DocumentDate <= fyWO.FEndDate
       WHERE woh.Id = po.SourceWOId)
    )                     AS FinYearName,
    po.SequenceNo,
    po.POItems,
    po.Discount,
    po.GST,
    po.SourceWOId,
    po.SourceWODocNo,
    po.SourceMRId,
    po.SourceMRDocNo,
    po.SourceWDId,
    po.SourceWDDocNo,
    po.SourceQTId,
    po.SourceQTDocNo,
    po.SourceSaleOrderId,
    po.SourceSaleOrderDocNo,
    po.SourceSaleInvoiceId,
    po.SourceSaleInvoiceDocNo,
    po.POType,
    po.SupplierAcknowledged,
    po.SupplierAcknowledgedAt,
    po.SuppliedDate,
    po.ChallanNumber,
    ${hasCC ? "po.CostCenterId" : "CAST(NULL AS INT) AS CostCenterId"},
    ${hasVID ? "po.VendorInvoiceDate" : "CAST(NULL AS DATE) AS VendorInvoiceDate"},
    ${hasVIN ? "po.VendorInvoiceNo" : "CAST(NULL AS NVARCHAR(100)) AS VendorInvoiceNo"},
    ${hasCC ? "cc.Name" : "CAST(NULL AS NVARCHAR(200))"} AS CostCenterName,
    td.Prefix             AS DocTypePrefix,
    td.Description        AS DocTypeDescription
  FROM dbo.PurchaseOrders po
  LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId    = po.SupplierID
  LEFT JOIN dbo.enterprise        co ON co.id         = po.CompanyId
  LEFT JOIN dbo.enterprise        pr ON pr.id         = po.ProjectId
  LEFT JOIN dbo.FinYear           fy ON fy.FId        = po.fy_id
  LEFT JOIN dbo.TypeOfDoc         td ON td.TypeOfDocId = po.DocTypeId
  ${hasCC ? "LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = po.CostCenterId" : ""}
`;
  return _poSelect;
}

const mapRow = (po) => ({
  ...po,
  POItems: safeJson(po.POItems) ?? [],
  Discount: safeJson(po.Discount) ?? null,
  GST: safeJson(po.GST) ?? null,
});

// ── GET /  (List with Pagination) ────────────────────────────────────────────
router.get(
  "/",
  cache("purchase-orders", 300, { shared: true }),
  async (req, res) => {
    try {
      const pool = getPool();
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 500);
      const offset = (page - 1) * limit;

      const sourceWOId = req.query.sourceWOId
        ? parseInt(req.query.sourceWOId, 10)
        : null;

      const fyId = req.query.fyId ? parseInt(req.query.fyId, 10) : null;

      const sourceSaleInvoiceId = req.query.sourceSaleInvoiceId
        ? parseInt(req.query.sourceSaleInvoiceId, 10)
        : null;

      // ?poType=WO_PO  → show only WO-POs
      // ?poType=Direct → show only direct POs (excludes WO-POs)
      // (no param)     → show ALL types (default: includes WO-POs)
      const poTypeFilter = req.query.poType
        ? req.query.poType.toString().trim()
        : null;

      const whereConditions = [];
      if (sourceWOId) whereConditions.push("po.SourceWOId = @sourceWOId");
      if (fyId) whereConditions.push("po.fy_id = @fyId");
      if (sourceSaleInvoiceId)
        whereConditions.push("po.SourceSaleInvoiceId = @sourceSaleInvoiceId");
      if (poTypeFilter) whereConditions.push("po.POType = @poTypeFilter");
      const whereClause = whereConditions.length
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

      const PO_SELECT = await getPOSelect(pool);
      const result = await pool
        .request()
        .input("offset", sql.Int, offset)
        .input("limit", sql.Int, limit)
        .input("sourceWOId", sql.Int, sourceWOId)
        .input("fyId", sql.Int, fyId)
        .input("sourceSaleInvoiceId", sql.Int, sourceSaleInvoiceId)
        .input("poTypeFilter", sql.NVarChar(20), poTypeFilter).query(`
        SELECT *, COUNT(*) OVER() AS _total FROM (
          ${PO_SELECT}
          ${whereClause}
        ) _po
        ORDER BY _po.PurchaseOrderID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      const total = result.recordset[0]?._total ?? 0;

      res.json({
        data: result.recordset.map((r) => {
          const { _total, ...rest } = r;
          return mapRow(rest);
        }),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error("GET PurchaseOrders error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /service-eligible — POs whose items are all Service items ────────────
// Backs the Invoice page's "PO" tab: goods must go through a GRN first,
// but a Service-only PO can be invoiced directly. Declared before /:id so
// "service-eligible" isn't swallowed as an :id param.
router.get("/service-eligible", async (req, res) => {
  try {
    const pool = getPool();
    const pos = await getServicePurchaseOrders(pool);
    res.json(pos);
  } catch (err) {
    console.error("GET service-eligible POs error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();
    const PO_SELECT = await getPOSelect(pool);
    const result = await pool.request().input("PurchaseOrderID", sql.Int, id)
      .query(`
        ${PO_SELECT}
        WHERE po.PurchaseOrderID = @PurchaseOrderID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Purchase order not found" });

    // Also return normalised line items for the new form
    const lineItems = await pool.request().input("POID", sql.Int, id).query(`
        SELECT
          Id, PurchaseOrderID, ItemId, ItemName, ItemCode, Description,
          Quantity, ReceivedQty, UomId, UomName, Rate, Discount, TaxPct,
          LineAmount, SortOrder
        FROM dbo.PurchaseOrderItems
        WHERE PurchaseOrderID = @POID
        ORDER BY SortOrder
      `);

    // Sum of all non-rejected GRNs already submitted against this PO.
    // Used by the GRN form to show the true remaining balance.
    const receivedResult = await pool.request().input("POID2", sql.Int, id)
      .query(`
        SELECT ISNULL(SUM(TotalAmount), 0) AS POTotalReceived
        FROM dbo.GoodsReceiptNotes
        WHERE POID = @POID2 AND Status != 'Rejected'
      `);
    const poTotalReceived = Number(
      receivedResult.recordset[0]?.POTotalReceived ?? 0,
    );

    res.json({
      ...mapRow(result.recordset[0]),
      LineItems: lineItems.recordset,
      POTotalReceived: poTotalReceived,
    });
  } catch (err) {
    console.error("GET PurchaseOrder by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/document-chain — PO -> Vehicle In/Out -> GRN tree ───────────────
router.get("/:id/document-chain", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();
    const chain = await getDocumentChainForPO(pool, id);
    res.json(chain);
  } catch (err) {
    console.error("GET PurchaseOrder document-chain error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /  (Create) ──────────────────────────────────────────────────────────
router.post("/", requirePageRight("purchase-orders", "create"), validateBody(purchaseOrderBodySchema), async (req, res) => {
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const { PurchaseOrderID: newId, PurchaseOrderNo: finalDocNo } =
      await createPurchaseOrderInternal(pool, req.body, userEmail);

    await bumpCacheVersion("purchase-orders");

    const { SourceMRId, SourceQTId } = req.body;

    // Mark the source MR as Ordered once a PO is raised against it.
    if (SourceMRId) {
      (async () => {
        try {
          const mrId = parseInt(SourceMRId, 10);
          await pool
            .request()
            .input("mrId", sql.Int, mrId)
            .input("user", sql.NVarChar(200), userEmail).query(`
              UPDATE dbo.MaterialRequests
              SET Status = 'Ordered', UpdatedBy = @user, UpdatedAt = GETDATE()
              WHERE MRId = @mrId AND Status = 'Approved'
            `);
        } catch (e) {
          console.error("MR status update failed:", e.message);
        }
      })();
    }

    // Mark the source Quotation as Closed once a PO is raised against it.
    if (SourceQTId) {
      (async () => {
        try {
          const qtId = parseInt(SourceQTId, 10);
          await pool
            .request()
            .input("qtId", sql.Int, qtId)
            .input("user", sql.NVarChar(200), userEmail).query(`
              UPDATE dbo.Quotations
              SET Status = 'Closed', UpdatedBy = @user, UpdatedAt = SYSDATETIME()
              WHERE QuotationId = @qtId
            `);
        } catch (e) {
          console.error("Quotation status update failed:", e.message);
        }
      })();
    }

    // Auto-submit: transition Draft → Pending immediately after creation
    // so no separate "Submit" step is needed.
    try {
      await transition(
        "purchase-orders",
        newId,
        "Pending",
        req.user?.email || userEmail,
        req.user?.role,
      );
    } catch (submitErr) {
      console.warn("PO auto-submit failed (non-fatal):", submitErr.message);
    }

    res.status(201).json({
      message: "Purchase order created successfully",
      PurchaseOrderID: newId,
      PurchaseOrderNo: finalDocNo,
      Status: "Pending",
    });
  } catch (err) {
    console.error("POST PurchaseOrders error:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id  (Update) ────────────────────────────────────────────────────────
router.put(
  "/:id",
  requirePageRight("purchase-orders", "edit"),
  validateBody(purchaseOrderUpdateSchema),
  async (req, res) => {
    const id = requireValidId(req, res);
    if (!id) return;
    const {
      PurchaseOrderNo,
      PODate,
      ExpectedDeliveryDate,
      SupplierID,
      CompanyId,
      ProjectId,
      ItemDescription,
      Quantity,
      Unit,
      Rate,
      TotalAmount,
      PaymentTerms,
      Status,
      Remarks,
      DocTypeId,
      DocNo,
      finYear,
      POItems,
      Discount,
      GST,
      CostCenterId,
      VendorInvoiceDate,
      VendorInvoiceNo,
    } = req.body;

    const poItemsArray = Array.isArray(POItems)
      ? POItems
      : (safeJson(parseJson(POItems)) ?? []);
    const poItemsJson = JSON.stringify(poItemsArray);
    const discountJson = parseJson(Discount);
    const gstJson = parseJson(GST);
    const { hsnCode, gstType, gstRate } = extractGstScalars(GST);
    const subtotal =
      computeSubtotal(poItemsArray) ??
      (parseFloat(Quantity) * parseFloat(Rate) || 0);

    let transaction;
    try {
      const userEmail = requireUserName(req, res);
      if (!userEmail) return;

      // Same NOT NULL columns as POST / — this UPDATE overwrites them
      // unconditionally (not a COALESCE-style partial update), so omitting
      // either here would null out the existing value and crash the same
      // way the create path did before the fix above.
      if (!PODate) {
        return res.status(400).json({ error: "PODate is required." });
      }
      if (!SupplierID) {
        return res.status(400).json({ error: "SupplierID is required." });
      }

      const allowPostApproval = await resolveAllowPostApproval(req, "purchase-orders");
      await guardEdit("purchase-orders", id, { allowPostApproval });

      const pool = getPool();
      const uomMap = await buildUomMap(pool);
      const fyId = await resolveFyId(pool, finYear);
      const { hasCC, hasVID, hasVIN } = await getPOCols(pool);

      transaction = pool.transaction();
      await transaction.begin();

      const updateReq = transaction
        .request()
        .input("PurchaseOrderID", sql.Int, id)
        .input("PurchaseOrderNo", sql.NVarChar(100), PurchaseOrderNo || null)
        .input("PODate", sql.Date, PODate)
        .input(
          "ExpectedDeliveryDate",
          sql.Date,
          ExpectedDeliveryDate || PODate,
        )
        .input("SupplierID", sql.Int, parseInt(SupplierID, 10))
        .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
        .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
        .input(
          "ItemDescription",
          sql.NVarChar(sql.MAX),
          ItemDescription || null,
        )
        .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
        .input("Unit", sql.NVarChar(50), Unit || "NOS")
        .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
        .input("SubtotalAmount", sql.Decimal(18, 2), subtotal)
        .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
        .input("HsnCode", sql.NVarChar(20), hsnCode)
        .input("GstType", sql.NVarChar(20), gstType)
        .input("GstRate", sql.Decimal(5, 2), gstRate)
        .input("PaymentTerms", sql.NVarChar(sql.MAX), PaymentTerms || null)
        .input("Status", sql.NVarChar(50), Status || "Draft")
        .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
        .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
        .input("DocNo", sql.NVarChar(100), DocNo || null)
        .input("UpdatedBy", sql.NVarChar(100), userEmail)
        .input("UpdatedAt", sql.DateTime2, new Date())
        .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
        .input("Discount", sql.NVarChar(sql.MAX), discountJson)
        .input("GST", sql.NVarChar(sql.MAX), gstJson)
        .input("FyId", sql.Int, fyId);

      if (hasCC) updateReq.input("CostCenterId2", sql.Int, CostCenterId ? parseInt(CostCenterId, 10) : null);
      if (hasVID) updateReq.input("VendorInvoiceDate2", sql.Date, VendorInvoiceDate || null);
      if (hasVIN) updateReq.input("VendorInvoiceNo2", sql.NVarChar(100), VendorInvoiceNo || null);

      const result = await updateReq.query(`
        UPDATE dbo.PurchaseOrders SET
          PurchaseOrderNo       = @PurchaseOrderNo,
          PODate                = @PODate,
          ExpectedDeliveryDate  = @ExpectedDeliveryDate,
          SupplierID            = @SupplierID,
          CompanyId             = @CompanyId,
          ProjectId             = @ProjectId,
          ItemDescription       = @ItemDescription,
          Quantity              = @Quantity,
          Unit                  = @Unit,
          Rate                  = @Rate,
          SubtotalAmount        = @SubtotalAmount,
          TotalAmount           = @TotalAmount,
          HsnCode               = @HsnCode,
          GstType               = @GstType,
          GstRate               = @GstRate,
          PaymentTerms          = @PaymentTerms,
          Status                = @Status,
          Remarks               = @Remarks,
          DocTypeId             = @DocTypeId,
          DocNo                 = @DocNo,
          UpdatedBy             = @UpdatedBy,
          UpdatedAt             = @UpdatedAt,
          POItems               = @POItems,
          Discount              = @Discount,
          GST                   = @GST,
          fy_id                 = COALESCE(@FyId, fy_id)
          ${hasCC ? ", CostCenterId = @CostCenterId2" : ""}
          ${hasVID ? ", VendorInvoiceDate = @VendorInvoiceDate2" : ""}
          ${hasVIN ? ", VendorInvoiceNo = @VendorInvoiceNo2" : ""}
        WHERE PurchaseOrderID = @PurchaseOrderID
      `);

      if (!checkRowsAffected(result, res, "Purchase order")) {
        await transaction.rollback();
        return;
      }

      // Sync normalised child table
      await syncLineItems(transaction, sql, id, poItemsArray, uomMap);

      await transaction.commit();
      await bumpCacheVersion("purchase-orders");

      res.json({ message: "Purchase order updated successfully" });
    } catch (err) {
      try {
        if (transaction) await transaction.rollback();
      } catch (_) {
        /* ignore */
      }
      console.error("PUT PurchaseOrders error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /:id/can-delete ───────────────────────────────────────────────────────
// Checks the full PO → GRN → ExpenseBooking → Payment → BRS chain before delete.
// Returns { deletable: true } or { deletable: false, reason, ... } with detail.
router.get("/:id/can-delete", async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  try {
    const pool = getPool();

    // ── 1. Check for linked GRNs ──────────────────────────────────────────────
    const grnCheck = await pool
      .request()
      .input("POID", sql.Int, id)
      .query(
        "SELECT GRNID, GRNNo, Status FROM dbo.GoodsReceiptNotes WHERE POID = @POID",
      );

    if (grnCheck.recordset.length > 0) {
      const grns = grnCheck.recordset.map((g) => ({
        grnId: g.GRNID,
        grnNo: g.GRNNo,
        status: g.Status,
      }));

      // For each GRN, check if it has an expense booking
      const grnIds = grns.map((g) => g.grnId);
      const expReq = pool.request();
      const expPlaceholders = grnIds.map((id, i) => {
        expReq.input(`gid${i}`, sql.Int, id);
        return `@gid${i}`;
      });
      const expCheck = await expReq.query(`
        SELECT eb.Eid, eb.EDocNo, eb.EStatus, eb.ESourceId
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = 'GRN'
          AND eb.ESourceId IN (${expPlaceholders.join(",")})
          AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
      `);

      if (expCheck.recordset.length > 0) {
        // Check if any of those expense bookings have cleared BRS payments
        const docNoList = expCheck.recordset.map((e) => e.EDocNo).filter(Boolean);

        let brsCleared = [];
        if (docNoList.length > 0) {
          // Parameterise every doc-number — never interpolate DB-sourced strings into SQL.
          const brsReq = pool.request();
          const brsPlaceholders = docNoList.map((d, i) => {
            brsReq.input(`dn${i}`, sql.NVarChar(100), d);
            return `@dn${i}`;
          });
          brsCleared = (await brsReq.query(`
            SELECT np.PPaymentID, np.PPaymentName, np.PAmount, brc.BRSID, eb.EDocNo
            FROM dbo.NewPayment np
            JOIN dbo.BankReconciliation brc
              ON brc.SourceType = 'PAYMENT' AND brc.SourceID = np.PPaymentID AND brc.IsMatched = 1
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            WHERE np.PExpenseRef IN (${brsPlaceholders.join(",")})
          `)).recordset;
        }

        if (brsCleared.length > 0) {
          return res.json({
            deletable: false,
            reason: "grn_expense_brs_cleared",
            grns,
            expenseBookings: expCheck.recordset.map((e) => ({
              id: e.Eid,
              docNo: e.EDocNo,
              status: e.EStatus,
            })),
            clearedPayments: brsCleared.map((r) => ({
              paymentId: r.PPaymentID,
              paymentName: r.PPaymentName,
              amount: r.PAmount,
              brsId: r.BRSID,
              expenseDocNo: r.EDocNo,
            })),
          });
        }

        // Check for uncleared payments
        let linkedPayments = [];
        if (docNoList.length > 0) {
          const payReq = pool.request();
          const payPlaceholders = docNoList.map((d, i) => {
            payReq.input(`pd${i}`, sql.NVarChar(100), d);
            return `@pd${i}`;
          });
          linkedPayments = (await payReq.query(`
            SELECT np.PPaymentID, np.PPaymentName, np.PAmount, eb.EDocNo
            FROM dbo.NewPayment np
            JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
            WHERE np.PExpenseRef IN (${payPlaceholders.join(",")})
          `)).recordset;
        }

        if (linkedPayments.length > 0) {
          return res.json({
            deletable: false,
            reason: "grn_expense_has_payments",
            grns,
            expenseBookings: expCheck.recordset.map((e) => ({
              id: e.Eid,
              docNo: e.EDocNo,
              status: e.EStatus,
            })),
            linkedPayments: linkedPayments.map((r) => ({
              paymentId: r.PPaymentID,
              paymentName: r.PPaymentName,
              amount: r.PAmount,
              expenseDocNo: r.EDocNo,
            })),
          });
        }

        // GRNs have expense bookings but no payments — block, must delete expense first
        return res.json({
          deletable: false,
          reason: "grn_has_expense",
          grns,
          expenseBookings: expCheck.recordset.map((e) => ({
            id: e.Eid,
            docNo: e.EDocNo,
            status: e.EStatus,
          })),
        });
      }

      // GRNs exist but no expense bookings — must delete GRNs first
      return res.json({
        deletable: false,
        reason: "has_grns",
        grns,
      });
    }

    res.json({ deletable: true });
  } catch (err) {
    console.error("PO can-delete check error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// PurchaseOrderItems child rows are cascade-deleted by FK constraint.
// Guard: block if linked GRNs exist (those must be deleted first).
router.delete("/:id", requirePageRight("purchase-orders", "delete"), async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (!id) return;
    const pool = getPool();

    // ── Guard: linked Vehicle In/Out records ──────────────────────────────────
    const vioCheck = await pool
      .request()
      .input("POID", sql.Int, id)
      .query(
        "SELECT COUNT(*) AS cnt FROM dbo.VehicleInOut WHERE POID = @POID",
      );
    if (Number(vioCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_vehicle_in_out",
        message:
          "This Purchase Order has linked Vehicle In/Out record(s). Delete them first, then delete the PO.",
      });
    }

    // ── Guard: linked GRNs ────────────────────────────────────────────────────
    const grnCheck = await pool
      .request()
      .input("POID", sql.Int, id)
      .query(
        "SELECT COUNT(*) AS cnt FROM dbo.GoodsReceiptNotes WHERE POID = @POID",
      );
    if (Number(grnCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_grns",
        message:
          "This Purchase Order has linked GRN(s). Delete the GRN(s) first, then delete the PO.",
      });
    }

    // ── Guard: expense bookings linked directly to PO (non-GRN path) ─────────
    const expCheck = await pool.request().input("POID", sql.Int, id).query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.ExpenseBooking eb
        WHERE eb.ESourceType = 'PO' AND eb.ESourceId = @POID
          AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
      `);
    if (Number(expCheck.recordset[0]?.cnt) > 0) {
      return res.status(409).json({
        error: "has_expense",
        message:
          "This Purchase Order has linked Expense Booking(s). Delete the expense bookings first.",
      });
    }

    // Capture SourceMRId before deleting so we can reset the MR afterwards
    const poMeta = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .query(
        "SELECT SourceMRId FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID",
      );
    const sourceMRId = poMeta.recordset[0]?.SourceMRId ?? null;

    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .query(
        "DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID",
      );

    if (!checkRowsAffected(result, res, "Purchase order")) return;

    await bumpCacheVersion("purchase-orders");

    // If this PO was raised from a Material Request, reset that MR back to
    // 'Approved' so a new PO can be created against it — but only when no
    // other active PO still references the same MR.
    if (sourceMRId) {
      try {
        const remainingPOs = await pool
          .request()
          .input("MRId", sql.Int, sourceMRId).query(`
            SELECT COUNT(*) AS cnt
            FROM dbo.PurchaseOrders
            WHERE SourceMRId = @MRId
              AND ISNULL(Status, '') NOT IN ('Deleted', 'Rejected')
          `);

        if (Number(remainingPOs.recordset[0]?.cnt) === 0) {
          await pool.request().input("MRId", sql.Int, sourceMRId).query(`
              UPDATE dbo.MaterialRequests
              SET Status = 'Approved', UpdatedAt = GETDATE()
              WHERE MRId = @MRId AND Status = 'Ordered'
            `);
        }
      } catch (mrErr) {
        console.error("MR status reset failed (non-fatal):", mrErr.message);
      }
    }

    res.json({ message: "Purchase order deleted successfully" });
  } catch (err) {
    console.error("DELETE PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Approval routes ───────────────────────────────────────────────────────────

router.put("/:id/submit", requirePageRight("purchase-orders", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "purchase-orders",
      id,
      "Pending",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order submitted for approval", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id/approve", requirePageRight("purchase-orders", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "purchase-orders",
      id,
      "Approved",
      userEmail,
      req.user?.role,
    );
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order approved", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

router.put("/:id/reject", requirePageRight("purchase-orders", "edit"), async (req, res) => {
  const id = requireValidId(req, res);
  if (!id) return;
  const { note } = req.body;
  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;
    const result = await transition(
      "purchase-orders",
      id,
      "Rejected",
      userEmail,
      req.user?.role,
      note || null,
    );
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order rejected", ...result });
  } catch (err) {
    res
      .status(err.message.includes("not authorized") ? 403 : 400)
      .json({ error: err.message });
  }
});

// ── Item type check for direct invoice restriction ───────────────────────────
// Returns whether this PO contains any Goods-type items (blocks direct invoice).
router.get("/:id/item-types", async (req, res) => {
  const poId = parseInt(req.params.id, 10);
  if (!poId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const poRes = await pool.request().input("POID", sql.Int, poId)
      .query(`SELECT POItems FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID`);
    if (!poRes.recordset.length) return res.status(404).json({ error: "PO not found" });

    const rawItems = (() => {
      try { return JSON.parse(poRes.recordset[0].POItems || "[]"); } catch { return []; }
    })();

    // Collect item IDs from PO items JSON
    const itemIds = rawItems
      .map((it) => String(it.itemId ?? it.ItemId ?? it.M_Id ?? "").trim())
      .filter(Boolean);

    if (!itemIds.length) {
      // No item IDs — can't determine type, allow through
      return res.json({ hasGoods: false, hasServices: false, itemTypes: [] });
    }

    const mReq = pool.request();
    const ph = itemIds.map((id, i) => { mReq.input(`iid${i}`, sql.NVarChar(100), id); return `@iid${i}`; }).join(",");
    const mRes = await mReq.query(`
      SELECT CONVERT(NVARCHAR(100), M_Id) AS M_Id, M_Name, ISNULL(M_Type, '') AS M_Type
      FROM dbo.Item_Master_Group
      WHERE CONVERT(NVARCHAR(100), M_Id) IN (${ph})
    `);

    const itemTypes = mRes.recordset.map((r) => ({ id: r.M_Id, name: r.M_Name, type: r.M_Type }));
    const hasGoods    = itemTypes.some((it) => it.type.toLowerCase() === "goods");
    const hasServices = itemTypes.some((it) => it.type.toLowerCase() === "service" || it.type.toLowerCase() === "services");

    res.json({ hasGoods, hasServices, itemTypes });
  } catch (err) {
    console.error("PO item-types check error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Lazy Socket.IO handle (mirrors ticketRoutes.js's pattern) ───────────────
let _getIo = null;
function getIo() {
  if (!_getIo) _getIo = require("../socket").getIo;
  return _getIo();
}
function emitPOMessage(poId, comment) {
  try {
    getIo().to(`po:${poId}`).emit("po:message", { poId, comment });
  } catch (err) {
    console.warn(`[purchaseOrders] Socket emit failed for poId="${poId}": ${err?.message || err}`);
  }
}

// ── GET /:id/comments — PO<->supplier chat thread (staff side) ──────────────
router.get("/:id/comments", async (req, res) => {
  const poId = parseInt(req.params.id, 10);
  if (!poId) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("POID", sql.Int, poId).query(`
      SELECT Id, PurchaseOrderId, Comment AS comment, AuthorName AS author_name,
             AuthorId AS author_id, AuthorRole AS author_role, CreatedAt AS created_at
      FROM dbo.PurchaseOrderComments
      WHERE PurchaseOrderId = @POID
      ORDER BY CreatedAt ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/comment — reply in the PO<->supplier chat (staff side) ────────
router.post("/:id/comment", async (req, res) => {
  const poId = parseInt(req.params.id, 10);
  if (!poId) return res.status(400).json({ error: "Invalid id" });
  const comment = (req.body?.comment || "").trim();
  if (!comment) return res.status(400).json({ error: "Comment is required" });

  try {
    const pool = getPool();
    const exists = await pool.request().input("POID", sql.Int, poId)
      .query(`SELECT 1 FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @POID`);
    if (!exists.recordset.length) return res.status(404).json({ error: "PO not found" });

    const authorName = req.user?.name ?? req.user?.username ?? "Staff";
    const authorId = req.user?.userId ?? req.user?.id ?? null;
    const authorRole = req.user?.role ?? "staff";

    const insert = await pool.request()
      .input("POID",       sql.Int,           poId)
      .input("Comment",    sql.NVarChar(sql.MAX), comment)
      .input("AuthorName", sql.NVarChar(200), authorName)
      .input("AuthorId",   sql.Int,           authorId)
      .input("AuthorRole", sql.NVarChar(50),  authorRole)
      .query(`
        INSERT INTO dbo.PurchaseOrderComments (PurchaseOrderId, Comment, AuthorName, AuthorId, AuthorRole)
        OUTPUT INSERTED.Id, INSERTED.PurchaseOrderId, INSERTED.Comment AS comment,
               INSERTED.AuthorName AS author_name, INSERTED.AuthorId AS author_id,
               INSERTED.AuthorRole AS author_role, INSERTED.CreatedAt AS created_at
        VALUES (@POID, @Comment, @AuthorName, @AuthorId, @AuthorRole)
      `);

    const saved = insert.recordset[0];
    res.json({ comment: saved });
    emitPOMessage(poId, saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.createPurchaseOrderInternal = createPurchaseOrderInternal;

