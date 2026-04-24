const express = require("express");
const router  = express.Router();
const sql     = require("mssql");

const { cache }             = require("../middleware/cache");
const { bumpCacheVersion }  = require("../redis");
const { getPool }           = require("../db");

// ── GET /brs/filters ─────────────────────────────────────────────────────────
// Returns companies (LHeadType='C') and banks (LHeadType='B').
// Banks link to their company via bank.LBelongsTo = company.LHeadName.
// We resolve that join here so the frontend gets companyId on each bank
// for cascading dropdowns.
router.get("/filters", cache("brs-filters", 300), async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        b.LHeadId,
        b.LHeadName,
        b.LHeadType,
        b.LBelongsTo,
        c.LHeadId   AS CompanyId,
        c.LHeadName AS CompanyName
      FROM AccountHeadMaster b
      LEFT JOIN AccountHeadMaster c
        ON  c.LHeadType  = 'C'
        AND c.LHeadStatus = 1
        AND c.LHeadName  = b.LBelongsTo
      WHERE b.LHeadType IN ('C', 'B')
        AND b.LHeadStatus = 1
      ORDER BY b.LHeadType, b.LHeadName
    `);

    const companies = result.recordset
      .filter((r) => r.LHeadType === "C")
      .map((r) => ({ id: r.LHeadId, name: r.LHeadName }));

    const banks = result.recordset
      .filter((r) => r.LHeadType === "B")
      .map((r) => ({
        id:        r.LHeadId,
        name:      r.LHeadName,
        companyId: r.CompanyId   ?? null,   // null if LBelongsTo didn't match any company
        companyName: r.CompanyName ?? null,
      }));

    res.json({ companies, banks });
  } catch (err) {
    console.error("BRS filters error:", err);
    res.status(500).json({ error: "Failed to fetch filter options" });
  }
});

// ── GET /brs ─────────────────────────────────────────────────────────────────
// BankReconciliation columns: BRSID, BankID, TransactionID, Amount, Type,
//   IsMatched, BankDate, SystemDate, CreatedAt
// NOTE: No CompanyID column — company is resolved via AccountHeadMaster JOIN.
router.get("/", cache("brs", 120), async (req, res) => {
  try {
    const pool = getPool();

    const page   = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { bankId, companyId, fromDate, toDate, status } = req.query;

    // companyId filters via bank.LBelongsTo = company.LHeadName join
    let where = "WHERE 1=1";
    if (bankId)    where += " AND b.BankID = @bankId";
    if (companyId) where += " AND company.LHeadId = @companyId";
    if (fromDate)  where += " AND b.BankDate >= @fromDate";
    if (toDate)    where += " AND b.BankDate <= @toDate";
    if (status === "reconciled") where += " AND b.IsMatched = 1";
    if (status === "pending")    where += " AND b.IsMatched = 0";

    // Shared param binder
    const bind = (r) => {
      if (bankId)    r.input("bankId",    sql.Int,  bankId);
      if (companyId) r.input("companyId", sql.Int,  companyId);
      if (fromDate)  r.input("fromDate",  sql.Date, fromDate);
      if (toDate)    r.input("toDate",    sql.Date, toDate);
      return r;
    };

    // Base FROM used in all three queries
    const baseFrom = `
      FROM BankReconciliation b
      LEFT JOIN AccountHeadMaster bank
        ON  bank.LHeadId   = b.BankID
        AND bank.LHeadType = 'B'
      LEFT JOIN AccountHeadMaster company
        ON  company.LHeadType  = 'C'
        AND company.LHeadStatus = 1
        AND company.LHeadName  = bank.LBelongsTo
    `;

    // ── COUNT ─────────────────────────────────────────────────────────────────
    const countResult = await bind(pool.request()).query(
      `SELECT COUNT(*) AS total ${baseFrom} ${where}`
    );
    const total = countResult.recordset[0].total;

    // ── DATA ──────────────────────────────────────────────────────────────────
    const dataReq = bind(pool.request());
    dataReq.input("offset", sql.Int, offset);
    dataReq.input("limit",  sql.Int, limit);

    const dataResult = await dataReq.query(`
      SELECT
        b.BRSID,
        b.BankID,
        b.TransactionID,
        b.Amount,
        b.Type,
        b.IsMatched,
        b.BankDate,
        b.SystemDate,
        b.CreatedAt,
        bank.LHeadName    AS BankName,
        company.LHeadId   AS CompanyID,
        company.LHeadName AS CompanyName
      ${baseFrom}
      ${where}
      ORDER BY b.BankDate DESC, b.BRSID DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const summaryResult = await bind(pool.request()).query(`
      SELECT
        SUM(CASE WHEN b.IsMatched = 1 THEN b.Amount ELSE 0 END) AS matched,
        SUM(CASE WHEN b.IsMatched = 0 THEN b.Amount ELSE 0 END) AS unmatched
      ${baseFrom}
      ${where}
    `);

    const matched   = summaryResult.recordset[0].matched   || 0;
    const unmatched = summaryResult.recordset[0].unmatched || 0;

    res.json({
      data: dataResult.recordset,
      matched,
      unmatched,
      difference:  unmatched,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });

  } catch (err) {
    console.error("BRS list error:", err);
    res.status(500).json({ error: "Failed to fetch BRS" });
  }
});

// ── POST /brs ─────────────────────────────────────────────────────────────────
// No CompanyID column — only BankID (company resolved via bank's LParentId)
router.post("/", async (req, res) => {
  try {
    const pool = getPool();
    const { bankId, transactionId, amount, type, bankDate, systemDate } = req.body;

    await pool.request()
      .input("bankId",        sql.Int,            bankId)
      .input("transactionId", sql.Int,            transactionId)
      .input("amount",        sql.Decimal(18, 2), amount)
      .input("type",          sql.VarChar(10),    type)
      .input("bankDate",      sql.Date,           bankDate)
      .input("systemDate",    sql.Date,           systemDate)
      .query(`
        INSERT INTO BankReconciliation
          (BankID, TransactionID, Amount, Type, BankDate, SystemDate)
        VALUES
          (@bankId, @transactionId, @amount, @type, @bankDate, @systemDate)
      `);

    await bumpCacheVersion("brs");
    res.json({ message: "BRS entry added" });

  } catch (err) {
    console.error("BRS insert error:", err);
    res.status(500).json({ error: "Insert failed" });
  }
});

// ── PUT /brs/:id/match ────────────────────────────────────────────────────────
router.put("/:id/match", async (req, res) => {
  try {
    const pool = getPool();
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

// ── PUT /brs/:id/unmatch ──────────────────────────────────────────────────────
router.put("/:id/unmatch", async (req, res) => {
  try {
    const pool = getPool();
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

// ── PUT /brs/auto-match ───────────────────────────────────────────────────────
// Pairs unmatched CREDIT/DEBIT entries with the same amount (±0.01)
router.put("/auto-match", async (req, res) => {
  const pool        = getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const { recordset } = await transaction.request().query(
      "SELECT BRSID, Amount, Type FROM BankReconciliation WHERE IsMatched = 0 ORDER BY Amount ASC"
    );

    const credits = recordset.filter((r) => r.Type === "CREDIT");
    const debits  = recordset.filter((r) => r.Type === "DEBIT");

    const pairedCredits = new Set();
    const pairedDebits  = new Set();

    for (const credit of credits) {
      if (pairedCredits.has(credit.BRSID)) continue;
      for (const debit of debits) {
        if (pairedDebits.has(debit.BRSID)) continue;
        if (Math.abs(credit.Amount - debit.Amount) < 0.01) {
          pairedCredits.add(credit.BRSID);
          pairedDebits.add(debit.BRSID);
          break;
        }
      }
    }

    const allIds = [...pairedCredits, ...pairedDebits];
    if (allIds.length > 0) {
      const req2 = transaction.request();
      allIds.forEach((id, i) => req2.input("id" + i, sql.Int, id));
      const placeholders = allIds.map((_, i) => "@id" + i).join(",");
      await req2.query(
        `UPDATE BankReconciliation SET IsMatched = 1 WHERE BRSID IN (${placeholders})`
      );
    }

    await transaction.commit();
    await bumpCacheVersion("brs");

    const pairCount = pairedCredits.size;
    res.json({
      message:      `Auto-match done: ${pairCount} pair(s) reconciled`,
      pairs:        pairCount,
      creditsLeft:  credits.length - pairCount,
      debitsLeft:   debits.length  - pairCount,
    });

  } catch (err) {
    await transaction.rollback();
    console.error("Auto-match error:", err);
    res.status(500).json({ error: "Auto-match failed" });
  }
});

module.exports = router;