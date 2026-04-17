const express = require("express");
const router = express.Router();
const sql = require("mssql");

const { cache } = require("../middleware/cache");

// ================= GET STOCK LEDGER =================
router.get("/", cache("stock-ledger", 120), async (req, res) => {
  try {
    const pool = req.app.locals.db;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { itemId, dateFrom, dateTo } = req.query;

    // ================= FILTERS =================
    let where = "WHERE 1=1";

    if (itemId) where += " AND ItemID = @itemId";
    if (dateFrom) where += " AND EntryDate >= @dateFrom";
    if (dateTo) where += " AND EntryDate <= @dateTo";

    // ================= COUNT =================
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM StockLedger
      ${where}
    `;

    const countReq = pool.request();
    if (itemId) countReq.input("itemId", sql.Int, itemId);
    if (dateFrom) countReq.input("dateFrom", sql.Date, dateFrom);
    if (dateTo) countReq.input("dateTo", sql.Date, dateTo);

    const countResult = await countReq.query(countQuery);
    const total = countResult.recordset[0].total;

    // ================= DATA =================
    const dataQuery = `
      SELECT *
      FROM StockLedger
      ${where}
      ORDER BY EntryDate DESC, StockID DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const dataReq = pool.request();
    if (itemId) dataReq.input("itemId", sql.Int, itemId);
    if (dateFrom) dataReq.input("dateFrom", sql.Date, dateFrom);
    if (dateTo) dataReq.input("dateTo", sql.Date, dateTo);

    dataReq.input("offset", sql.Int, offset);
    dataReq.input("limit", sql.Int, limit);

    const dataResult = await dataReq.query(dataQuery);

    // ================= BALANCE =================
    const balanceQuery = `
      SELECT 
        SUM(CASE WHEN Type = 'IN' THEN Qty ELSE -Qty END) AS balance
      FROM StockLedger
      ${where}
    `;

    const balanceReq = pool.request();
    if (itemId) balanceReq.input("itemId", sql.Int, itemId);
    if (dateFrom) balanceReq.input("dateFrom", sql.Date, dateFrom);
    if (dateTo) balanceReq.input("dateTo", sql.Date, dateTo);

    const balanceResult = await balanceReq.query(balanceQuery);
    const balance = balanceResult.recordset[0].balance || 0;

    res.json({
      data: dataResult.recordset,
      balance,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("StockLedger error:", err);
    res.status(500).json({ error: "Failed to fetch stock ledger" });
  }
});

module.exports = router;