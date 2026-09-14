const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { checkPermissionForMethod } = require("../middleware/routePermission");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

router.use(checkPermissionForMethod("Material", "StockTransfer"));

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) return JSON.parse(raw);
  return [];
}

// ─── GET list of transfers ────────────────────────────────────────────────────
router.get("/", cache("stock-transfers", 60), async (req, res) => {
  try {
    const pool = getPool();
    const { fromGodown, toGodown, limit = 100, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const request = pool
      .request()
      .input("limit", sql.Int, parseInt(limit))
      .input("offset", sql.Int, offset);

    let where = "WHERE 1=1";
    if (fromGodown) {
      request.input("from", sql.Int, parseInt(fromGodown));
      where += " AND st.FromGodownID=@from";
    }
    if (toGodown) {
      request.input("to", sql.Int, parseInt(toGodown));
      where += " AND st.ToGodownID=@to";
    }

    // ── Total count (real DB count, not page size) ────────────────────────────
    const countReq = pool.request();
    if (fromGodown) countReq.input("from", sql.Int, parseInt(fromGodown));
    if (toGodown)   countReq.input("to",   sql.Int, parseInt(toGodown));
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM dbo.StockTransfers st
      ${where}
    `);
    const dbTotal = Number(countResult.recordset[0].total || 0);

    const result = await request.query(`
      SELECT
        st.TransferID, st.DocNo, st.TransferDate,
        st.FromGodownID, fg.GodownName AS FromGodownName,
        st.ToGodownID,   tg.GodownName AS ToGodownName,
        st.TransferItems, st.Remarks, st.Status,
        st.CreatedBy, st.CreatedAt
      FROM dbo.StockTransfers st
      JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
      JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
      ${where}
      ORDER BY st.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    const rows = result.recordset.map((r) => ({
      ...r,
      TransferItems: parseItems(r.TransferItems),
    }));

    res.json({ data: rows, total: dbTotal });
  } catch (err) {
    console.error("[stock-transfers] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST create transfer ─────────────────────────────────────────────────────
// This is the core warehouse transfer logic:
//   1. Validate stock availability in FromGodown
//   2. Insert OUT entries in StockLedger for FromGodown
//   3. Insert IN  entries in StockLedger for ToGodown
//   4. Record the StockTransfer header
router.post("/", requirePageRight("stock-transfers", "create"), async (req, res) => {
  const pool = getPool();
  const transaction = pool.transaction();
  try {
    const {
      FromGodownID,
      ToGodownID,
      TransferItems, // [{itemId, itemName, qty, uom, remarks}]
      Remarks,
      TransferDate,
    } = req.body;

    if (!FromGodownID || !ToGodownID)
      return res
        .status(400)
        .json({ error: "FromGodownID and ToGodownID are required" });
    if (FromGodownID === ToGodownID)
      return res
        .status(400)
        .json({ error: "Source and destination godown must differ" });

    const items = parseItems(TransferItems);
    if (!items.length)
      return res
        .status(400)
        .json({ error: "At least one transfer item is required" });

    const userEmail = req.user?.email || null;
    const tDate = TransferDate || new Date().toISOString().slice(0, 10);

    await transaction.begin();

    // ── Validate available stock per item in FromGodown ──────────────────────
    for (const item of items) {
      const { itemId, qty } = item;
      if (!itemId || !(Number(qty) > 0))
        throw new Error(`Invalid item entry: itemId=${itemId} qty=${qty}`);

      const avail = await transaction
        .request()
        .input("itemId", sql.NVarChar(100), String(itemId))
        .input("godownId", sql.Int, parseInt(FromGodownID)).query(`
          SELECT ISNULL(SUM(CASE WHEN Type='IN' THEN Qty ELSE -Qty END), 0) AS Available
          FROM dbo.StockLedger
          WHERE ItemID = @itemId AND GodownID = @godownId
        `);

      const available = Number(avail.recordset[0].Available || 0);
      if (available < Number(qty))
        throw new Error(
          `Insufficient stock for item ${item.itemName || itemId}: available=${available}, requested=${qty}`,
        );
    }

    // ── Build a doc number (simple sequential: TRF-YYYYMMDD-N) ──────────────
    const countRes = await transaction.request().query(`
      SELECT COUNT(1)+1 AS N FROM dbo.StockTransfers
      WHERE CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const seq = String(countRes.recordset[0].N).padStart(3, "0");
    const ymd = tDate.replace(/-/g, "");
    const docNo = `TRF-${ymd}-${seq}`;

    // ── Insert StockLedger rows ──────────────────────────────────────────────
    for (const item of items) {
      const itemId = String(item.itemId);
      const qty = Number(item.qty);
      const uom = item.uom || null;

      // OUT from source
      await transaction
        .request()
        .input("ItemID", sql.NVarChar(50), itemId)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("UOM", sql.NVarChar(20), uom)
        .input("GodownID", sql.Int, parseInt(FromGodownID))
        .input("DocNo", sql.NVarChar(100), docNo).query(`
          INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
          VALUES (@ItemID,@Qty,@UOM,'OUT','TRF',0,@GodownID,@DocNo,GETDATE())
        `);

      // IN to destination
      await transaction
        .request()
        .input("ItemID", sql.NVarChar(50), itemId)
        .input("Qty", sql.Decimal(18, 2), qty)
        .input("UOM", sql.NVarChar(20), uom)
        .input("GodownID", sql.Int, parseInt(ToGodownID))
        .input("DocNo", sql.NVarChar(100), docNo).query(`
          INSERT INTO dbo.StockLedger (ItemID,Qty,UOM,Type,RefType,RefID,GodownID,DocNo,CreatedDate)
          VALUES (@ItemID,@Qty,@UOM,'IN','TRF',0,@GodownID,@DocNo,GETDATE())
        `);
    }

    // ── Insert StockTransfers header ─────────────────────────────────────────
    const insertRes = await transaction
      .request()
      .input("DocNo", sql.NVarChar(100), docNo)
      .input("TransferDate", sql.Date, tDate)
      .input("FromGodownID", sql.Int, parseInt(FromGodownID))
      .input("ToGodownID", sql.Int, parseInt(ToGodownID))
      .input("TransferItems", sql.NVarChar(sql.MAX), JSON.stringify(items))
      .input("Remarks", sql.NVarChar(sql.MAX), Remarks || null)
      .input("CreatedBy", sql.NVarChar(255), userEmail).query(`
        INSERT INTO dbo.StockTransfers
          (DocNo, TransferDate, FromGodownID, ToGodownID, TransferItems, Remarks, Status, CreatedBy)
        OUTPUT INSERTED.TransferID
        VALUES
          (@DocNo, @TransferDate, @FromGodownID, @ToGodownID, @TransferItems, @Remarks, 'Completed', @CreatedBy)
      `);

    await transaction.commit();
    await bumpCacheVersion("stock-transfers");
    await bumpCacheVersion("inventory-master");

    res.status(201).json({
      TransferID: insertRes.recordset[0].TransferID,
      DocNo: docNo,
      message: "Stock transfer completed successfully",
    });
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {}
    console.error("[stock-transfers] POST /:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── GET single transfer ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, parseInt(req.params.id)).query(`
        SELECT st.*, fg.GodownName AS FromGodownName, tg.GodownName AS ToGodownName
        FROM dbo.StockTransfers st
        JOIN dbo.Godowns fg ON fg.GodownID = st.FromGodownID
        JOIN dbo.Godowns tg ON tg.GodownID = st.ToGodownID
        WHERE st.TransferID = @id
      `);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Transfer not found" });
    const row = {
      ...result.recordset[0],
      TransferItems: parseItems(result.recordset[0].TransferItems),
    };
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;