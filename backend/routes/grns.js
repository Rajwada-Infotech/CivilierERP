const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { transition, guardEdit } = require("../services/approvalService");
const router = express.Router();
const { getPool, sql } = require("../db");
const {
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");

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

/** Sum rate × quantity for every line item, falling back to stored totalAmount. */
function computeGRNTotal(grnItems) {
  const items = parseGRNItems(grnItems);
  return items.reduce((sum, item) => {
    const lineTotal =
      Number(item.totalAmount) > 0
        ? Number(item.totalAmount)
        : Number(item.rate || 0) * Number(item.quantity || 0);
    return sum + lineTotal;
  }, 0);
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
  return row;
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
// NOTE: GRNItems is intentionally NOT normalised here — the list endpoint
// returns raw strings (or null) which is fine for picker row counts.
// The frontend always re-fetches GET /:id for authoritative item data.
router.get("/", cache("grns", 300), async (req, res) => {
  try {
    const pool = getPool();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 500);
    const offset = (page - 1) * limit;

    const countResult = await pool.request().query(`
      SELECT COUNT(*) AS total
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
    `);
    const total = parseInt(countResult.recordset[0].total);

    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
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
        grn.DocTypeId,
        grn.DocNo,
        s.LHeadName AS SupplierName,
        p.PurchaseOrderNo AS PONumber,
        td.Prefix AS DocTypePrefix,
        td.Description AS DocTypeDescription
      FROM GoodsReceiptNotes grn
      LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
      LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
      ORDER BY grn.GRNID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data: result.recordset,
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

// GET single GRN by ID
// This is the authoritative endpoint used by the expense booking form to load
// GRN items. GRNItems is normalised to a parsed array before returning so the
// frontend never has to deal with raw JSON strings or truncation.
router.get("/:id", async (req, res) => {
  const grnId = parseInt(req.params.id, 10);
  if (isNaN(grnId)) return res.status(400).json({ error: "Invalid GRN ID" });

  try {
    const pool = await getPool();
    const result = await pool.request().input("GRNID", sql.Int, grnId).query(`
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
          grn.DocTypeId,
          grn.DocNo,
          s.LHeadName AS SupplierName,
          p.PurchaseOrderNo AS PONumber,
          td.Prefix AS DocTypePrefix,
          td.Description AS DocTypeDescription
        FROM GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON grn.SupplierID = s.LHeadId
        LEFT JOIN PurchaseOrders p ON grn.POID = p.PurchaseOrderID
        LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = grn.DocTypeId
        WHERE grn.GRNID = @GRNID
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "GRN not found" });

    // FIX: normalise GRNItems to a parsed array so the client always receives
    // an array, not a raw JSON string. This prevents double-parsing issues on
    // the frontend and handles cases where the NVARCHAR(MAX) column is returned
    // as a truncated string by some mssql driver versions.
    res.json(normaliseGRNRow(result.recordset[0]));
  } catch (err) {
    console.error("GET GRN by ID ERROR:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch GRN", message: err.message });
  }
});

// POST - Create GRN + Stock Ledger Entries
router.post("/", async (req, res) => {
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
    finYear,
  } = req.body;

  if (!grnDate || !supplierId) {
    return res
      .status(400)
      .json({ error: "GRNDate and SupplierID are required" });
  }

  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    let finalDocNo = grnNo || docNo || null;

    if (docTypeId) {
      finalDocNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(docTypeId, 10),
        finYear,
        tableName: "GoodsReceiptNotes",
        docNoColumn: "GRNNo",
        issuedBy: req.user?.email || req.user?.name || null,
      });
    } else if (!finalDocNo) {
      const seqResult = await pool
        .request()
        .query(
          "SELECT ISNULL(MAX(GRNID), 0) + 1 AS NextId FROM dbo.GoodsReceiptNotes",
        );
      const nextId = seqResult.recordset[0].NextId;
      const padded = String(nextId).padStart(6, "0");
      const fy = (finYear || "").toString().trim();
      finalDocNo = fy ? `CI/REC/${padded}/${fy}` : `CI/REC/${padded}`;
    }

    const grnResult = await transaction
      .request()
      .input("GRNNo", sql.NVarChar(50), finalDocNo)
      .input("GRNDate", sql.Date, grnDate)
      .input("SupplierID", sql.Int, supplierId)
      .input("POID", sql.Int, poId || null)
      .input("GRNItems", sql.NVarChar(sql.MAX), JSON.stringify(grnItems || []))
      .input("Status", sql.NVarChar(50), status || "Draft")
      .input("Remarks", sql.NVarChar(sql.MAX), remarks || null)
      .input("DocTypeId", sql.Int, docTypeId ? parseInt(docTypeId, 10) : null)
      .input("DocNo", sql.NVarChar(100), finalDocNo)
      .input("TotalAmount", sql.Decimal(18, 2), computeGRNTotal(grnItems))
      .input("CreatedDate", sql.DateTime2, new Date()).query(`
        INSERT INTO GoodsReceiptNotes
          (GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks, DocTypeId, DocNo, TotalAmount, CreatedDate)
        OUTPUT INSERTED.GRNID
        VALUES
          (@GRNNo, @GRNDate, @SupplierID, @POID, @GRNItems, @Status, @Remarks, @DocTypeId, @DocNo, @TotalAmount, @CreatedDate)
      `);

    const grnId = grnResult.recordset[0].GRNID;

    if (docTypeId && finalDocNo) {
      await backPatchRecordId(
        pool,
        sql,
        finalDocNo,
        "GoodsReceiptNotes",
        grnId,
      );
    }

    await insertStockLedgerEntries(transaction, grnId, grnItems);

    await transaction.commit();
    await bumpCacheVersion("grns");
    await bumpCacheVersion("stock-ledger");

    res.status(201).json({
      message: "GRN created successfully",
      grnId,
      grnNo: finalDocNo,
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
  try {
    await guardEdit("goods-receipt", req.params.id);
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

    await transaction
      .request()
      .input("RefID", sql.Int, grnId)
      .query(
        "DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @RefID",
      );

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

// ── PUT /:id/submit — Draft/Partially Received → Pending ──────────────────────
router.put("/:id/submit", async (req, res) => {
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
    await bumpCacheVersion("goods-receipt");
    res.json({ message: "GRN submitted for approval", ...result });
  } catch (err) {
    console.error("GRN submit error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved ─────────────────────────────────────
router.put("/:id/approve", async (req, res) => {
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
    await bumpCacheVersion("goods-receipt");
    res.json({ message: "GRN approved", ...result });
  } catch (err) {
    console.error("GRN approve error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected ──────────────────────────────────────
router.put("/:id/reject", async (req, res) => {
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
    await bumpCacheVersion("goods-receipt");
    res.json({ message: "GRN rejected", ...result });
  } catch (err) {
    console.error("GRN reject error:", err.message);
    const status = err.message.includes("not authorized") ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
