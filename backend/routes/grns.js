const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

function parseGRNItems(grnItems) {
  if (Array.isArray(grnItems)) return grnItems;
  if (typeof grnItems === "string" && grnItems.trim()) return JSON.parse(grnItems);
  return [];
}

async function insertStockLedgerEntries(transaction, grnId, grnItems) {
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
        .input("RefID", sql.Int, grnId).query(`
          INSERT INTO StockLedger (ItemID, Qty, UOM, Type, RefType, RefID, CreatedDate)
          VALUES (@ItemID, @Qty, @UOM, @Type, @RefType, @RefID, GETDATE())
        `);
    }
  }
}

// GET all GRNs
router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = getPool();

    // Sanitized pagination params
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    // Total count (matching exact JOINs)
    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
    `);
    const total = parseInt(countResult.recordset[0].total);

    // Paginated data
    const result = await pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, limit)
      .query(`
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
        s.LHeadName AS SupplierName,
        p.PurchaseOrderNo AS PONumber
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      ORDER BY grn.GRNID DESC
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

  const pool = getPool();
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

    await insertStockLedgerEntries(transaction, grnId, grnItems);

    await transaction.commit();
    await bumpCacheVersion("grns");
    await bumpCacheVersion("stock-ledger");

    res.status(201).json({
      message: "GRN created successfully",
      grnId,
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
router.put("/:id", async (req, res) => {
  const { grnNo, grnDate, supplierId, poId, grnItems, status, remarks } =
    req.body;
  const grnId = parseInt(req.params.id, 10);

  const pool = getPool();
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

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "GRN not found" });
    }

    await transaction
      .request()
      .input("RefID", sql.Int, grnId)
      .query("DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID");

    await insertStockLedgerEntries(transaction, grnId, grnItems);
    await transaction.commit();

    await bumpCacheVersion("grns");
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
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    await transaction
      .request()
      .input("RefID", sql.Int, grnId)
      .query("DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID");

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

module.exports = router;
