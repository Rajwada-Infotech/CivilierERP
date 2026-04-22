const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

const { transition, guardEdit } = require("../services/approvalService");

const requireUserEmail = (req, res) => {
  const email = req.user?.email;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
};

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get("/", cache("purchase-orders", 300), async (req, res) => {
  try {
    const pool = getPool();

    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total
      FROM dbo.PurchaseOrders po
      LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
      LEFT JOIN dbo.enterprise en ON en.id = po.ProjectId
    `);
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        SELECT
          po.PurchaseOrderID,
          po.PurchaseOrderNo,
          po.PODate,
          po.ExpectedDeliveryDate,
          po.SupplierID,
          ah.LHeadName AS SupplierName,
          po.ProjectId,
          en.name AS ProjectName,
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
          po.ApprovedAt
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        LEFT JOIN dbo.enterprise en ON en.id = po.ProjectId
        ORDER BY po.PurchaseOrderID DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error("GET PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    PurchaseOrderNo, PODate, ExpectedDeliveryDate,
    SupplierID, ProjectId, ItemDescription,
    Quantity, Unit, Rate, TotalAmount,
    PaymentTerms, Status, Remarks,
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    await guardEdit("purchase-orders", id);

    const pool = getPool();
    const result = await pool
      .request()
      .input("PurchaseOrderNo",      sql.NVarChar(100),  PurchaseOrderNo || null)
      .input("PODate",               sql.Date,           PODate || null)
      .input("ExpectedDeliveryDate", sql.Date,           ExpectedDeliveryDate || null)
      .input("SupplierID",           sql.Int,            SupplierID ? parseInt(SupplierID, 10) : null)
      .input("ProjectId",            sql.Int,            ProjectId  ? parseInt(ProjectId,  10) : null)
      .input("ItemDescription",      sql.NVarChar(510),  ItemDescription || null)
      .input("Quantity",             sql.Decimal(18, 2), parseFloat(Quantity)    || 0)
      .input("Unit",                 sql.NVarChar(50),   Unit || null)
      .input("Rate",                 sql.Decimal(18, 2), parseFloat(Rate)        || 0)
      .input("TotalAmount",          sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms",         sql.NVarChar(255),  PaymentTerms || null)
      .input("Status",               sql.NVarChar(50),   Status || "Draft")
      .input("Remarks",              sql.NVarChar(500),  Remarks || null)
      .input("CreatedBy",            sql.NVarChar(100),  userEmail)  // ✅ real email, was req.user.id
      .input("CreatedAt",            sql.DateTime2,      new Date())
      .query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate,
          SupplierID, ProjectId,
          ItemDescription, Quantity, Unit, Rate, TotalAmount,
          PaymentTerms, Status, Remarks, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.PurchaseOrderID
        VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate,
          @SupplierID, @ProjectId,
          @ItemDescription, @Quantity, @Unit, @Rate, @TotalAmount,
          @PaymentTerms, @Status, @Remarks, @CreatedBy, @CreatedAt
        )
      `);

    await bumpCacheVersion("purchase-orders");
    res.status(201).json({
      message: "Purchase order created successfully",
      PurchaseOrderID: result.recordset[0].PurchaseOrderID,
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
    PurchaseOrderNo, PODate, ExpectedDeliveryDate,
    SupplierID, ProjectId, ItemDescription,
    Quantity, Unit, Rate, TotalAmount,
    PaymentTerms, Status, Remarks,
  } = req.body;

  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool = getPool();
    const result = await pool
      .request()
      .input("PurchaseOrderID",      sql.Int,            id)
      .input("PurchaseOrderNo",      sql.NVarChar(100),  PurchaseOrderNo || null)
      .input("PODate",               sql.Date,           PODate || null)
      .input("ExpectedDeliveryDate", sql.Date,           ExpectedDeliveryDate || null)
      .input("SupplierID",           sql.Int,            SupplierID ? parseInt(SupplierID, 10) : null)
      .input("ProjectId",            sql.Int,            ProjectId  ? parseInt(ProjectId,  10) : null)
      .input("ItemDescription",      sql.NVarChar(510),  ItemDescription || null)
      .input("Quantity",             sql.Decimal(18, 2), parseFloat(Quantity)    || 0)
      .input("Unit",                 sql.NVarChar(50),   Unit || null)
      .input("Rate",                 sql.Decimal(18, 2), parseFloat(Rate)        || 0)
      .input("TotalAmount",          sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms",         sql.NVarChar(255),  PaymentTerms || null)
      .input("Status",               sql.NVarChar(50),   Status || "Draft")
      .input("Remarks",              sql.NVarChar(500),  Remarks || null)
      .input("UpdatedBy",            sql.NVarChar(100),  userEmail)  // ✅ real email, was req.user.id
      .input("UpdatedAt",            sql.DateTime2,      new Date())
      .query(`
        UPDATE dbo.PurchaseOrders SET
          PurchaseOrderNo      = @PurchaseOrderNo,
          PODate               = @PODate,
          ExpectedDeliveryDate = @ExpectedDeliveryDate,
          SupplierID           = @SupplierID,
          ProjectId            = @ProjectId,
          ItemDescription      = @ItemDescription,
          Quantity             = @Quantity,
          Unit                 = @Unit,
          Rate                 = @Rate,
          TotalAmount          = @TotalAmount,
          PaymentTerms         = @PaymentTerms,
          Status               = @Status,
          Remarks              = @Remarks,
          UpdatedBy            = @UpdatedBy,
          UpdatedAt            = @UpdatedAt
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
    const id = parseInt(req.params.id, 10);
    const pool = getPool();

    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .query("DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID");

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

// ── PUT /:id/submit — Draft → Pending ─────────────────────────────────────────
router.put("/:id/submit", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("purchase-orders", id, "Pending", userEmail, req.user?.role);
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order submitted for approval", ...result });
  } catch (err) {
    console.error("PO submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
// Requires role: admin | super_admin | dba
router.put("/:id/approve", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("purchase-orders", id, "Approved", userEmail, req.user?.role);
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order approved", ...result });
  } catch (err) {
    console.error("PO approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ──────────────────────────────────────
// Requires role: admin | super_admin | dba
// Body: { note: "Reason for rejection" }
router.put("/:id/reject", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note } = req.body;
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const result = await transition("purchase-orders", id, "Rejected", userEmail, req.user?.role, note || null);
    await bumpCacheVersion("purchase-orders");
    res.json({ message: "Purchase order rejected", ...result });
  } catch (err) {
    console.error("PO reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
