const express = require("express")
const router = express.Router()
const { sql } = require("../db")

router.get("/", async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query("SELECT * FROM dbo.PurchaseOrders")
    res.json(result.recordset)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post("/", async (req, res) => {
  const {
    PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID,
    ProjectSiteID, ItemDescription, Quantity, Unit,
    Rate, TotalAmount, PaymentTerms, Status, Remarks
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("PurchaseOrderNo",     sql.NVarChar,      PurchaseOrderNo || null)
      .input("PODate",              sql.Date,           PODate || null)
      .input("ExpectedDeliveryDate",sql.Date,           ExpectedDeliveryDate || null)
      .input("SupplierID",          sql.Int,            SupplierID || null)
      .input("ProjectSiteID",       sql.Int,            ProjectSiteID || null)
      .input("ItemDescription",     sql.NVarChar,       ItemDescription || null)
      .input("Quantity",            sql.Decimal(18,2),  Quantity || null)
      .input("Unit",                sql.NVarChar,       Unit || null)
      .input("Rate",                sql.Decimal(18,2),  Rate || null)
      .input("TotalAmount",         sql.Decimal(18,2),  TotalAmount || null)
      .input("PaymentTerms",        sql.NVarChar,       PaymentTerms || null)
      .input("Status",              sql.NVarChar,       Status || "Pending")
      .input("Remarks",             sql.NVarChar,       Remarks || null)
      .input("CreatedAt",           sql.DateTime2,      new Date())
      .query(`
        INSERT INTO dbo.PurchaseOrders (
          PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID,
          ProjectSiteID, ItemDescription, Quantity, Unit, Rate,
          TotalAmount, PaymentTerms, Status, Remarks, CreatedAt
        ) VALUES (
          @PurchaseOrderNo, @PODate, @ExpectedDeliveryDate, @SupplierID,
          @ProjectSiteID, @ItemDescription, @Quantity, @Unit, @Rate,
          @TotalAmount, @PaymentTerms, @Status, @Remarks, @CreatedAt
        )
      `)
    res.json({ message: "Purchase order added" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put("/:id", async (req, res) => {
  const {
    PurchaseOrderNo, PODate, ExpectedDeliveryDate, SupplierID,
    ProjectSiteID, ItemDescription, Quantity, Unit,
    Rate, TotalAmount, PaymentTerms, Status, Remarks
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("PurchaseOrderID",     sql.Int,            req.params.id)
      .input("PurchaseOrderNo",     sql.NVarChar,       PurchaseOrderNo || null)
      .input("PODate",              sql.Date,           PODate || null)
      .input("ExpectedDeliveryDate",sql.Date,           ExpectedDeliveryDate || null)
      .input("SupplierID",          sql.Int,            SupplierID || null)
      .input("ProjectSiteID",       sql.Int,            ProjectSiteID || null)
      .input("ItemDescription",     sql.NVarChar,       ItemDescription || null)
      .input("Quantity",            sql.Decimal(18,2),  Quantity || null)
      .input("Unit",                sql.NVarChar,       Unit || null)
      .input("Rate",                sql.Decimal(18,2),  Rate || null)
      .input("TotalAmount",         sql.Decimal(18,2),  TotalAmount || null)
      .input("PaymentTerms",        sql.NVarChar,       PaymentTerms || null)
      .input("Status",              sql.NVarChar,       Status || "Pending")
      .input("Remarks",             sql.NVarChar,       Remarks || null)
      .input("UpdatedAt",           sql.DateTime2,      new Date())
      .query(`
        UPDATE dbo.PurchaseOrders SET
          PurchaseOrderNo=@PurchaseOrderNo, PODate=@PODate,
          ExpectedDeliveryDate=@ExpectedDeliveryDate, SupplierID=@SupplierID,
          ProjectSiteID=@ProjectSiteID, ItemDescription=@ItemDescription,
          Quantity=@Quantity, Unit=@Unit, Rate=@Rate, TotalAmount=@TotalAmount,
          PaymentTerms=@PaymentTerms, Status=@Status, Remarks=@Remarks,
          UpdatedAt=@UpdatedAt
        WHERE PurchaseOrderID=@PurchaseOrderID
      `)
    res.json({ message: "Purchase order updated" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("PurchaseOrderID", sql.Int, req.params.id)
      .query("DELETE FROM dbo.PurchaseOrders WHERE PurchaseOrderID=@PurchaseOrderID")
    res.json({ message: "Purchase order deleted" })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router