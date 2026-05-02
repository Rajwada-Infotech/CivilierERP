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

const requireUserName = (req, res) => {
  const name = req.user?.name || req.user?.email;
  if (!name) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return name;
};

// Helper to parse POItems safely
const parseItems = (body) => {
  const items = body.POItems;
  if (!items) return "[]";
  return typeof items === "string" ? items : JSON.stringify(items);
};

// Helper to serialize items for response
const serializeItems = (itemsStr) => {
  if (!itemsStr) return [];
  try {
    return JSON.parse(itemsStr);
  } catch {
    return [];
  }
};

// Helper to serialize discount for response
const serializeDiscount = (discountStr) => {
  if (!discountStr) return null;
  try {
    return JSON.parse(discountStr);
  } catch {
    return null;
  }
};

// Helper to serialize GST for response
const serializeGST = (gstStr) => {
  if (!gstStr) return null;
  try {
    return JSON.parse(gstStr);
  } catch {
    return null;
  }
};

// ── GET / (List with Pagination) ─────────────────────────────────────────────
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
        SELECT
          po.PurchaseOrderID,
          po.PurchaseOrderNo,
          po.PODate,
          po.ExpectedDeliveryDate,
          po.SupplierID,
          ah.LHeadName AS SupplierName,
          po.CompanyId,
          co.name AS CompanyName,
          po.ProjectId,
          pr.name AS ProjectName,
          po.ItemDescription,
          po.Quantity,
          po.Unit,
          po.Rate,
          po.TotalAmount,
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
          po.POItems,
          po.Discount,                    -- Discount column added
          po.GST,                         -- GST column added
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        LEFT JOIN dbo.enterprise co ON co.id = po.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = po.DocTypeId
        ORDER BY po.PurchaseOrderID DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    // Parse JSON fields for each record
    const data = result.recordset.map((po) => ({
      ...po,
      POItems: serializeItems(po.POItems),
      Discount: serializeDiscount(po.Discount),
      GST: serializeGST(po.GST),
    }));

    res.json({
      data,
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
        SELECT
          po.PurchaseOrderID,
          po.PurchaseOrderNo,
          po.PODate,
          po.ExpectedDeliveryDate,
          po.SupplierID,
          ah.LHeadName AS SupplierName,
          po.CompanyId,
          co.name AS CompanyName,
          po.ProjectId,
          pr.name AS ProjectName,
          po.ItemDescription,
          po.Quantity,
          po.Unit,
          po.Rate,
          po.TotalAmount,
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
          po.POItems,
          po.Discount,                    -- Discount column added
          po.GST,                         -- GST column added
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        LEFT JOIN dbo.enterprise co ON co.id = po.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = po.ProjectId
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = po.DocTypeId
        WHERE po.PurchaseOrderID = @PurchaseOrderID
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    const po = result.recordset[0];

    res.json({
      ...po,
      POItems: serializeItems(po.POItems),
      Discount: serializeDiscount(po.Discount),
      GST: serializeGST(po.GST),
    });
  } catch (err) {
    console.error("GET PurchaseOrder by id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
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

  const poItemsJson = parseItems({ POItems });
  const discountJson = Discount
    ? typeof Discount === "string"
      ? Discount
      : JSON.stringify(Discount)
    : null;
  const gstJson = GST
    ? typeof GST === "string"
      ? GST
      : JSON.stringify(GST)
    : null;

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    const pool = getPool();

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

    const result = await pool
      .request()
      .input("PurchaseOrderNo", sql.NVarChar(100), finalDocNo || null)
      .input("PODate", sql.Date, PODate || null)
      .input("ExpectedDeliveryDate", sql.Date, ExpectedDeliveryDate || null)
      .input(
        "SupplierID",
        sql.Int,
        SupplierID ? parseInt(SupplierID, 10) : null,
      )
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(510), ItemDescription || null)
      .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit || null)
      .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms", sql.NVarChar(255), PaymentTerms || null)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), finalDocNo || null)
      .input("CreatedBy", sql.NVarChar(100), userEmail)
      .input("CreatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
      .input("Discount", sql.NVarChar(sql.MAX), discountJson)
      .input("GST", sql.NVarChar(sql.MAX), gstJson).query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID, CompanyId,
          ProjectId, ItemDescription, Quantity, Unit, Rate, TotalAmount,
          PaymentTerms, Status, Remarks, DocTypeId, DocNo, CreatedBy, CreatedAt,
          POItems, Discount, GST
        )
        OUTPUT INSERTED.PurchaseOrderID
        VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate, @SupplierID, @CompanyId,
          @ProjectId, @ItemDescription, @Quantity, @Unit, @Rate, @TotalAmount,
          @PaymentTerms, @Status, @Remarks, @DocTypeId, @DocNo, @CreatedBy, @CreatedAt,
          @POItems, @Discount, @GST
        )
      `);

    const newId = result.recordset[0].PurchaseOrderID;

    if (DocTypeId && finalDocNo) {
      await backPatchRecordId(pool, sql, finalDocNo, "PurchaseOrders", newId);
    }

    await bumpCacheVersion("purchase-orders");

    res.status(201).json({
      message: "Purchase order created successfully",
      PurchaseOrderID: newId,
      PurchaseOrderNo: finalDocNo,
    });
  } catch (err) {
    console.error("POST PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────
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

  const poItemsJson = parseItems({ POItems });
  const discountJson = Discount
    ? typeof Discount === "string"
      ? Discount
      : JSON.stringify(Discount)
    : null;
  const gstJson = GST
    ? typeof GST === "string"
      ? GST
      : JSON.stringify(GST)
    : null;

  try {
    const userEmail = requireUserName(req, res);
    if (!userEmail) return;

    await guardEdit("purchase-orders", id);

    const pool = getPool();

    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .input("PurchaseOrderNo", sql.NVarChar(100), PurchaseOrderNo || null)
      .input("PODate", sql.Date, PODate || null)
      .input("ExpectedDeliveryDate", sql.Date, ExpectedDeliveryDate || null)
      .input(
        "SupplierID",
        sql.Int,
        SupplierID ? parseInt(SupplierID, 10) : null,
      )
      .input("CompanyId", sql.Int, CompanyId ? parseInt(CompanyId, 10) : null)
      .input("ProjectId", sql.Int, ProjectId ? parseInt(ProjectId, 10) : null)
      .input("ItemDescription", sql.NVarChar(510), ItemDescription || null)
      .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit || null)
      .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms", sql.NVarChar(255), PaymentTerms || null)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(500), Remarks || null)
      .input("DocTypeId", sql.Int, DocTypeId ? parseInt(DocTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), DocNo || null)
      .input("UpdatedBy", sql.NVarChar(100), userEmail)
      .input("UpdatedAt", sql.DateTime2, new Date())
      .input("POItems", sql.NVarChar(sql.MAX), poItemsJson)
      .input("Discount", sql.NVarChar(sql.MAX), discountJson)
      .input("GST", sql.NVarChar(sql.MAX), gstJson).query(`
        UPDATE dbo.PurchaseOrders
        SET
          PurchaseOrderNo = @PurchaseOrderNo,
          PODate = @PODate,
          ExpectedDeliveryDate = @ExpectedDeliveryDate,
          SupplierID = @SupplierID,
          CompanyId = @CompanyId,
          ProjectId = @ProjectId,
          ItemDescription = @ItemDescription,
          Quantity = @Quantity,
          Unit = @Unit,
          Rate = @Rate,
          TotalAmount = @TotalAmount,
          PaymentTerms = @PaymentTerms,
          Status = @Status,
          Remarks = @Remarks,
          DocTypeId = @DocTypeId,
          DocNo = @DocNo,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt,
          POItems = @POItems,
          Discount = @Discount,
          GST = @GST
        WHERE PurchaseOrderID = @PurchaseOrderID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order updated successfully" });
  } catch (err) {
    console.error("PUT PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, parseInt(req.params.id, 10))
      .query(
        "DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID",
      );

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order deleted successfully" });
  } catch (err) {
    console.error("DELETE PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Approval Routes
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