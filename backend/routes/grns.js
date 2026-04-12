const express = require("express");
const { cache } = require("../middleware/cache");
const { redisDelPattern } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

// GET all GRNs
router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = await getPool(); // ← Fixed: await
    const result = await pool.request().query(`
      SELECT
        grn.GRNID,
        grn.GRNNo,
        grn.GRNDate,
        grn.SupplierID,
        grn.POID,
        grn.GRNItems,
        grn.Status,
        grn.CreatedDate,
        s.LHeadName AS SupplierName,
        p.PurchaseOrderNo AS PONumber
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      ORDER BY grn.GRNID DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to fetch GRNs",
      message: err.message,
    });
  }
});

// POST - Create GRN + Stock Ledger Entries
router.post("/", async (req, res) => {
  const { grnNo, grnDate, supplierId, poId, grnItems, status, remarks } =
    req.body;

  if (!grnNo || !grnDate || !supplierId) {
    return res
      .status(400)
      .json({ error: "GRNNo, GRNDate and SupplierID are required" });
  }

  const pool = await getPool(); // ← Fixed: await outside

  const transaction = pool.transaction();

  try {
    await transaction.begin();

    // Insert GRN Header
    const grnResult = await transaction
      .request()
      .input("GRNNo", sql.NVarChar(50), grnNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId || null)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems || []))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("CreatedDate", sql.DateTime2, new Date()).query(`
        INSERT INTO GoodsReceiptNotes
          (GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES
          (@GRNNo, @GRNDate, @SupplierID, @POID, @GRNItems, @Status, @Remarks, @CreatedDate)
      `);

    const grnId = grnResult.recordset[0].GRNID;

    // Insert Stock Ledger Entries
    const items = Array.isArray(grnItems)
      ? grnItems
      : typeof grnItems === "string"
        ? JSON.parse(grnItems)
        : [];

    for (const item of items) {
      if (item.itemId && item.receivedQty) {
        await transaction
          .request()
          .input("ItemID", sql.Int, item.itemId)
          .input("Qty", sql.Decimal(18, 2), item.receivedQty)
          .input("Type", sql.NVarChar(10), "IN")
          .input("RefType", sql.NVarChar(20), "GRN")
          .input("RefID", sql.Int, grnId).query(`
            INSERT INTO StockLedger (ItemID, Qty, Type, RefType, RefID, CreatedDate)
            VALUES (@ItemID, @Qty, @Type, @RefType, @RefID, GETDATE())
          `);
      }
    }

    await transaction.commit();
    await redisDelPattern("cache:grns:*");

    res.status(201).json({
      message: "GRN created successfully",
      grnId,
    });
  } catch (err) {
    await transaction.rollback().catch(() => {}); // rollback if possible

    console.error("CREATE GRN FULL ERROR:", err);
    res.status(500).json({
      error: "Failed to create GRN",
      message: err.message,
      detail: err.originalError?.info || null,
    });
  }
});

// PUT - Update GRN
router.put("/:id", async (req, res) => {
  const { grnNo, grnDate, supplierId, poId, grnItems, status, remarks } =
    req.body;

  try {
    const pool = await getPool();

    await pool
      .request()
      .input("GRNID", sql.Int, req.params.id)
      .input("GRNNo", sql.NVarChar(50), grnNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId || null)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems || []))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("UpdatedDate", sql.DateTime2, new Date()).query(`
        UPDATE GoodsReceiptNotes
        SET GRNNo = @GRNNo,
            GRNDate = @GRNDate,
            SupplierID = @SupplierID,
            POID = @POID,
            GRNItems = @GRNItems,
            Status = @Status,
            Remarks = @Remarks
        WHERE GRNID = @GRNID
      `);

    await redisDelPattern("cache:grns:*");
    res.json({ message: "GRN updated successfully" });
  } catch (err) {
    console.error("UPDATE GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to update GRN",
      message: err.message,
    });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();

    await pool
      .request()
      .input("GRNID", sql.Int, req.params.id)
      .query("DELETE FROM GoodsReceiptNotes WHERE GRNID = @GRNID");

    await redisDelPattern("cache:grns:*");
    res.json({ message: "GRN deleted successfully" });
  } catch (err) {
    console.error("DELETE GRN ERROR:", err);
    res.status(500).json({
      error: "Failed to delete GRN",
      message: err.message,
    });
  }
});

module.exports = router;
