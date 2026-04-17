const express = require("express");
const router = express.Router();
const sql = require("mssql");

const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");

// ================= GET BRS =================
router.get("/", cache("brs", 120), async (req, res) => {
  try {
    const pool = req.app.locals.db;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const offset = (page - 1) * limit;

    const { bankId, fromDate, toDate } = req.query;

    let where = "WHERE 1=1";

    if (bankId) where += " AND BankID = @bankId";
    if (fromDate) where += " AND BankDate >= @fromDate";
    if (toDate) where += " AND BankDate <= @toDate";

    // COUNT
    const countReq = pool.request();
    if (bankId) countReq.input("bankId", sql.Int, bankId);
    if (fromDate) countReq.input("fromDate", sql.Date, fromDate);
    if (toDate) countReq.input("toDate", sql.Date, toDate);

    const countResult = await countReq.query(
      "SELECT COUNT(*) AS total FROM BankReconciliation " + where
    );

    const total = countResult.recordset[0].total;

    // DATA
    const dataReq = pool.request();
    if (bankId) dataReq.input("bankId", sql.Int, bankId);
    if (fromDate) dataReq.input("fromDate", sql.Date, fromDate);
    if (toDate) dataReq.input("toDate", sql.Date, toDate);

    dataReq.input("offset", sql.Int, offset);
    dataReq.input("limit", sql.Int, limit);

    const dataResult = await dataReq.query(
      "SELECT * FROM BankReconciliation " + where + " ORDER BY BankDate DESC, BRSID DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY"
    );

    // SUMMARY
    const summaryReq = pool.request();
    if (bankId) summaryReq.input("bankId", sql.Int, bankId);

    const summaryResult = await summaryReq.query(
      "SELECT SUM(CASE WHEN IsMatched = 1 THEN Amount ELSE 0 END) AS matched, SUM(CASE WHEN IsMatched = 0 THEN Amount ELSE 0 END) AS unmatched FROM BankReconciliation" + (bankId ? " WHERE BankID = @bankId" : "")
    );

    const matched = summaryResult.recordset[0].matched || 0;
    const unmatched = summaryResult.recordset[0].unmatched || 0;

    res.json({
      data: dataResult.recordset,
      matched,
      unmatched,
      difference: unmatched,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("BRS error:", err);
    res.status(500).json({ error: "Failed to fetch BRS" });
  }
});

// ================= ADD ENTRY =================
router.post("/", async (req, res) => {
  try {
    const pool = req.app.locals.db;

    const { bankId, transactionId, amount, type, bankDate, systemDate } = req.body;

    await pool.request()
      .input("bankId", sql.Int, bankId)
      .input("transactionId", sql.Int, transactionId)
      .input("amount", sql.Decimal(18,2), amount)
      .input("type", sql.VarChar(10), type)
      .input("bankDate", sql.Date, bankDate)
      .input("systemDate", sql.Date, systemDate)
      .query("INSERT INTO BankReconciliation (BankID, TransactionID, Amount, Type, BankDate, SystemDate) VALUES (@bankId, @transactionId, @amount, @type, @bankDate, @systemDate)");

    await bumpCacheVersion("brs");

    res.json({ message: "BRS entry added" });

  } catch (err) {
    console.error("BRS insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// ================= MATCH =================
router.put("/:id/match", async (req, res) => {
  try {
    const pool = req.app.locals.db;

    await pool.request()
      .input("id", sql.Int, req.params.id)
      .query("UPDATE BankReconciliation SET IsMatched = 1 WHERE BRSID = @id");

    await bumpCacheVersion("brs");

    res.json({ message: "Marked as matched" });

  } catch (err) {
    console.error("BRS match error:", err);
    res.status(500).json({ error: "Match failed" });
  }
});

// ================= UNMATCH =================
router.put("/:id/unmatch", async (req, res) => {
  try {
    const pool = req.app.locals.db;

    await pool.request()
      .input("id", sql.Int, req.params.id)
      .query("UPDATE BankReconciliation SET IsMatched = 0 WHERE BRSID = @id");

    await bumpCacheVersion("brs");

    res.json({ message: "Marked as unmatched" });

  } catch (err) {
    console.error("BRS unmatch error:", err);
    res.status(500).json({ error: "Unmatch failed" });
  }
});

// ================= SMART AUTO-MATCH =================
router.put("/auto-match", async (req, res) => {
  const pool = req.app.locals.db;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // Fetch unmatched
    const unmatchedResult = await transaction.request().query(
      "SELECT BRSID, Amount, Type FROM BankReconciliation WHERE IsMatched = 0 ORDER BY Amount ASC"
    );

    const credits = [];
    const debits = [];

    for (const row of unmatchedResult.recordset) {
      if (row.Type === "CREDIT") credits.push(row);
      else if (row.Type === "DEBIT") debits.push(row);
    }

    const pairedCredits = new Set();
    const pairedDebits = new Set();
    let pairCount = 0;

    for (const credit of credits) {
      if (pairedCredits.has(credit.BRSID)) continue;

      for (const debit of debits) {
        if (pairedDebits.has(debit.BRSID)) continue;

        if (Math.abs(credit.Amount - debit.Amount) < 0.01) {
          pairedCredits.add(credit.BRSID);
          pairedDebits.add(debit.BRSID);
          pairCount++;
          break;
        }
      }
    }

    // Update safely (parameterized)
    const allIds = [...pairedCredits, ...pairedDebits];

    if (allIds.length > 0) {
      const request = transaction.request();

      allIds.forEach((id, i) => {
        request.input("id" + i, sql.Int, id);
      });

      const placeholders = allIds.map((_, i) => "@id" + i).join(",");

      await request.query(
        "UPDATE BankReconciliation SET IsMatched = 1 WHERE BRSID IN (" + placeholders + ")"
      );
    }

    await transaction.commit();

    await bumpCacheVersion("brs");

    res.json({
      message: "Smart auto-match completed: " + pairCount + " pairs matched",
      pairs: pairCount,
      creditsLeft: credits.length - pairedCredits.size,
      debitsLeft: debits.length - pairedDebits.size,
    });

  } catch (err) {
    await transaction.rollback();
    console.error("Smart auto-match error:", err);
    res.status(500).json({ error: "Auto-match failed" });
  }
});

module.exports = router;

