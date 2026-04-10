const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");

const BASE_PATH = "/api/purchase-orders"; // for reference

// ====================== GET ALL ======================
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        PurchaseOrderID,
        PurchaseOrderNo,
        PODate,
        ExpectedDeliveryDate,
        Supplier,
        Company,
        ProjectSite,
        ItemDescription,
        Quantity,
        Unit,
        Rate,
        TotalAmount,
        PaymentTerms,
        Status,
        Remarks,
        CreatedBy,
        CreatedAt,
        UpdatedAt
      FROM dbo.PurchaseOrders
      ORDER BY CreatedAt DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================== CREATE ======================
router.post("/", async (req, res) => {
  const {
    PurchaseOrderNo,
    PODate,
    ExpectedDeliveryDate,
    Supplier,
    Company,
    ProjectSite,
    ItemDescription,
    Quantity,
    Unit,
    Rate,
    TotalAmount,
    PaymentTerms,
    Status,
    Remarks,
  } = req.body;

  try {
    console.log("POST body:", req.body);

    const pool = getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    const result = await pool
      .request()
      .input("PurchaseOrderNo", sql.NVarChar(100), PurchaseOrderNo)
      .input("PODate", sql.Date, PODate)
      .input("ExpectedDeliveryDate", sql.Date, ExpectedDeliveryDate)
      .input("Supplier", sql.NVarChar(200), Supplier)
      .input("Company", sql.NVarChar(200), Company)
      .input("ProjectSite", sql.NVarChar(200), ProjectSite)
      .input("ItemDescription", sql.NVarChar(500), ItemDescription)
      .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit)
      .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms", sql.NVarChar(255), PaymentTerms)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(500), Remarks)
      .input("CreatedBy", sql.Int, userId)
      .input("CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate, Supplier, Company,
          ProjectSite, ItemDescription, Quantity, Unit, Rate, TotalAmount,
          PaymentTerms, Status, Remarks, CreatedBy, CreatedAt
        )
        OUTPUT INSERTED.PurchaseOrderID, INSERTED.*
        VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate, @Supplier, @Company,
          @ProjectSite, @ItemDescription, @Quantity, @Unit, @Rate, @TotalAmount,
          @PaymentTerms, @Status, @Remarks, @CreatedBy, @CreatedAt
        )
      `);

    console.log("Purchase Order Created:", result.recordset[0]);
    res.status(201).json({
      message: "Purchase order created successfully",
      PurchaseOrderID: result.recordset[0].PurchaseOrderID,
    });
  } catch (err) {
    console.error("POST PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================== UPDATE ======================
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  const {
    PurchaseOrderNo,
    PODate,
    ExpectedDeliveryDate,
    Supplier,
    Company,
    ProjectSite,
    ItemDescription,
    Quantity,
    Unit,
    Rate,
    TotalAmount,
    PaymentTerms,
    Status,
    Remarks,
  } = req.body;

  try {
    const pool = getPool();
    const userId = req.user?.id || req.user?.userId || 1;

    await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .input("PurchaseOrderNo", sql.NVarChar(100), PurchaseOrderNo)
      .input("PODate", sql.Date, PODate)
      .input("ExpectedDeliveryDate", sql.Date, ExpectedDeliveryDate)
      .input("Supplier", sql.NVarChar(200), Supplier)
      .input("Company", sql.NVarChar(200), Company)
      .input("ProjectSite", sql.NVarChar(200), ProjectSite)
      .input("ItemDescription", sql.NVarChar(500), ItemDescription)
      .input("Quantity", sql.Decimal(18, 2), parseFloat(Quantity) || 0)
      .input("Unit", sql.NVarChar(50), Unit)
      .input("Rate", sql.Decimal(18, 2), parseFloat(Rate) || 0)
      .input("TotalAmount", sql.Decimal(18, 2), parseFloat(TotalAmount) || 0)
      .input("PaymentTerms", sql.NVarChar(255), PaymentTerms)
      .input("Status", sql.NVarChar(50), Status || "Draft")
      .input("Remarks", sql.NVarChar(500), Remarks)
      .input("UpdatedBy", sql.Int, userId)
      .input("UpdatedAt", sql.DateTime2, new Date()).query(`
        UPDATE dbo.PurchaseOrders SET
          PurchaseOrderNo = @PurchaseOrderNo,
          PODate = @PODate,
          ExpectedDeliveryDate = @ExpectedDeliveryDate,
          Supplier = @Supplier,
          Company = @Company,
          ProjectSite = @ProjectSite,
          ItemDescription = @ItemDescription,
          Quantity = @Quantity,
          Unit = @Unit,
          Rate = @Rate,
          TotalAmount = @TotalAmount,
          PaymentTerms = @PaymentTerms,
          Status = @Status,
          Remarks = @Remarks,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE PurchaseOrderID = @PurchaseOrderID
      `);

    res.json({ message: "Purchase order updated successfully" });
  } catch (err) {
    console.error("PUT PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ====================== DELETE ======================
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pool = getPool();

    const result = await pool
      .request()
      .input("PurchaseOrderID", sql.Int, id)
      .query(
        "DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID = @PurchaseOrderID",
      );

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    res.json({ message: "Purchase order deleted successfully" });
  } catch (err) {
    console.error("DELETE PurchaseOrders error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
