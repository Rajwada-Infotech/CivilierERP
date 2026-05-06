const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

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

// ─── SELECT columns shared by GET / and GET /:id ─────────────────────────────

const PO_SELECT = `
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
    po.fy_id,
    po.SequenceNo,
    po.POItems,
    po.Discount,
    po.GST,
    td.Prefix             AS DocTypePrefix,
    td.Description        AS DocTypeDescription
  FROM dbo.PurchaseOrders po
  LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId    = po.SupplierID
  LEFT JOIN dbo.enterprise        co ON co.id         = po.CompanyId
  LEFT JOIN dbo.enterprise        pr ON pr.id         = po.ProjectId
  LEFT JOIN dbo.TypeOfDoc         td ON td.TypeOfDocId = po.DocTypeId
`;

const mapRow = (po) => ({
  ...po,
  POItems: safeJson(po.POItems) ?? [],
  Discount: safeJson(po.Discount) ?? null,
  GST: safeJson(po.GST) ?? null,
});

// ── GET /  (List with Pagination) ────────────────────────────────────────────
router.get("/", cache("purchase-orders", 300), async (req, res) => {
  try {
    const pool = getPool();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.PurchaseOrders");

    const total = parseInt(countResult.recordset[0].total);

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        ${PO_SELECT}
        ORDER BY po.PurchaseOrderID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset.map(mapRow),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, parseInt(req.params.id, 10)).query(`
        ${PO_SELECT}
        WHERE po.PurchaseOrderID = @PurchaseOrderID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Purchase order not found" });

    // Also return normalised line items for the new form
    const lineItems = await pool
      .request()
      .input("POID", sql.Int, parseInt(req.params.id, 10)).query(`
        SELECT
          Id, PurchaseOrderID, ItemId, ItemName, ItemCode, Description,
          Quantity, ReceivedQty, UomId, UomName, Rate, Discount, TaxPct,
          LineAmount, SortOrder
        FROM dbo.PurchaseOrderItems
        WHERE PurchaseOrderID = @POID
        ORDER BY SortOrder
      `);

    res.json({
      ...mapRow(result.recordset[0]),
      LineItems: lineItems.recordset,
    });
  } catch (err) {
    console.error("GET PurchaseOrder by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /  (Create) ──────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
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

    const pool = getPool();
    const uomMap = await buildUomMap(pool);

    transaction = pool.transaction();
    await transaction.begin();

    // Generate document number if DocTypeId is provided
    let finalDocNo = poNoFromClient || null;
    if (DocTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(DocTypeId, 10),
        finYear,
        tableName: "PurchaseOrders",
        issuedBy: req.user?.email,
      });
    }

    if (!finalDocNo) {
      await transaction.rollback();
      return res.status(400).json({
        error:
          "PurchaseOrderNo is required. Select a document type or enter a PO number manually.",
      });
    }

    const result = await transaction
      .request()
      .input("PurchaseOrderNo", sql.NVarChar(100), finalDocNo)
      .input("PODate", sql.Date, PODate || null)
      .input(
        "ExpectedDeliveryDate",
        sql.Date,
        ExpectedDeliveryDate || PODate || null,
      )
      .input(
        "SupplierID",
        sql.Int,
        SupplierID ? parseInt(SupplierID, 10) : null,
      )
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
      .input("DocNo", sql.NVarChar(100), finalDocNo || null)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
      .input("Discount", sql.NVarChar(sql.MAX), discountJson)
      .input("GST", sql.NVarChar(sql.MAX), gstJson).query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID, CompanyId,
          ProjectId, ItemDescription, Quantity, Unit, Rate,
          SubtotalAmount, TotalAmount,
          HsnCode, GstType, GstRate,
          PaymentTerms, Status, Remarks, DocTypeId, DocNo,
          CreatedBy, CreatedAt, POItems, Discount, GST
        )
        OUTPUT INSERTED.PurchaseOrderID
        VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate, @SupplierID, @CompanyId,
          @ProjectId, @ItemDescription, @Quantity, @Unit, @Rate,
          @SubtotalAmount, @TotalAmount,
          @HsnCode, @GstType, @GstRate,
          @PaymentTerms, @Status, @Remarks, @DocTypeId, @DocNo,
          @CreatedBy, @CreatedAt, @POItems, @Discount, @GST
        )
      `);

    const newId = result.recordset[0].PurchaseOrderID;

    // Sync normalised child table
    await syncLineItems(transaction, sql, newId, poItemsArray, uomMap);

    if (DocTypeId && finalDocNo) {
      await backPatchRecordId(pool, sql, finalDocNo, "PurchaseOrders", newId);
    }

    await transaction.commit();
    await bumpCacheVersion("purchase-orders");

    res.status(201).json({
      message: "Purchase order created successfully",
      PurchaseOrderID: newId,
      PurchaseOrderNo: finalDocNo,
    });
  } catch (err) {
    try {
      if (transaction) await transaction.rollback();
    } catch (_) {
      /* ignore */
    }
    console.error("POST PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id  (Update) ────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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
    POItems,
    Discount,
    GST,
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

    await guardEdit("purchase-orders", id);

    const pool = getPool();
    const uomMap = await buildUomMap(pool);

    transaction = pool.transaction();
    await transaction.begin();

    const result = await transaction
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .input("PurchaseOrderNo", sql.NVarChar(100), PurchaseOrderNo || null)
      .input("PODate", sql.Date, PODate || null)
      .input(
        "ExpectedDeliveryDate",
        sql.Date,
        ExpectedDeliveryDate || PODate || null,
      )
      .input(
        "SupplierID",
        sql.Int,
        SupplierID ? parseInt(SupplierID, 10) : null,
      )
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
      .input("DocNo", sql.NVarChar(100), DocNo || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail)
      .input("UpdatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
      .input("Discount", sql.NVarChar(sql.MAX), discountJson)
      .input("GST", sql.NVarChar(sql.MAX), gstJson).query(`
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
          GST                   = @GST
        WHERE PurchaseOrderID = @PurchaseOrderID
      `);

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "Purchase order not found" });
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
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
// PurchaseOrderItems child rows are cascade-deleted by FK constraint
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, parseInt(req.params.id, 10))
      .query(
        "DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID",
      );

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Purchase order not found" });

    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order deleted successfully" });
  } catch (err) {
    console.error("DELETE PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Approval routes ───────────────────────────────────────────────────────────

router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
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

module.exports = router;
