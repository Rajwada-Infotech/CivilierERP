const express = require("express")
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router()
const { sql } = require("../db")

router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = await sql.connect()
    const result = await pool.request().query(`
      SELECT GRNID, GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, CreatedDate,
      s.LHeadName as SupplierName,
      p.PurchaseOrderNo as PONumber
      FROM GoodsReceiptNotes grn
      LEFT JOIN [dbo].[LHead] s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
    `)
    res.json(result.recordset)
  } catch (err) { 
    res.status(500).json({ error: err.message }) 
  }
})

router.post("/", async (req, res) => {
  const {
    grnNo, grnDate, supplierId, poId, grnItems, status, remarks
  } = req.body
  try {
    const pool = await sql.connect()
    const result = await pool.request()
      .input("GRNNo", sql.NVarChar(50), grnNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("CreatedDate", sql.DateTime2, new Date())
      .query(`
        INSERT INTO GoodsReceiptNotes 
        (GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES (@GRNNo, @GRNDate, @SupplierID, @POID, @GRNItems, @Status, @Remarks, @CreatedDate)
      `)
    const grnId = result.recordset[0].GRNID

    console.log("GRN ID:", grnId)
    
    const items = Array.isArray(grnItems) ? grnItems : JSON.parse(grnItems || '[]')
    console.log("FINAL ITEMS:", items)
    
    for (const item of items) {
      console.log("Processing item:", item.itemId, item.receivedQty)
      await pool.request()
        .input("ItemID", sql.Int, item.itemId)
        .input("Qty", sql.Decimal(18,2), item.receivedQty)
        .input("Type", sql.NVarChar, "IN")
        .input("RefType", sql.NVarChar, "GRN")
        .input("RefID", sql.Int, grnId)
        .query(`
          INSERT INTO StockLedger (ItemID, Qty, Type, RefType, RefID)
          VALUES (@ItemID, @Qty, @Type, @RefType, @RefID)
        `)
    }

    res.json({ message: "GRN created successfully", grnId })
  } catch (err) { 
    console.error("GRN error:", err)
    res.status(500).json({ error: err.message }) 
  }
})

router.put("/:id", async (req, res) => {
  const {
    grnNo, grnDate, supplierId, poId, grnItems, status, remarks
  } = req.body
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("GRNID", sql.Int, req.params.id)
      .input("GRNNo", sql.NVarChar(50), grnNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems))
      .input("Status", sql.NVarChar(50), status)
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("UpdatedDate", sql.DateTime2, new Date())
      .query(`
        UPDATE GoodsReceiptNotes SET
          GRNNo = @GRNNo, GRNDate = @GRNDate,
          SupplierID = @SupplierID, POID = @POID,
          GRNItems = @GRNItems, Status = @Status,
          Remarks = @Remarks
        WHERE GRNID = @GRNID
      `)
    await redisDelPattern("cache:grns:*");

    res.json({ message: "GRN updated successfully" })
  } catch (err) { 
    res.status(500).json({ error: err.message }) 
  }
})

router.delete("/:id", async (req, res) => {
  try {
    const pool = await sql.connect()
    await pool.request()
      .input("GRNID", sql.Int, req.params.id)
      .query("DELETE FROM GoodsReceiptNotes WHERE GRNID = @GRNID")
    await redisDelPattern("cache:grns:*");

    res.json({ message: "GRN deleted successfully" })
  } catch (err) { 
    res.status(500).json({ error: err.message }) 
  }
})

module.exports = router

