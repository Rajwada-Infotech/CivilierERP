const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { resolvePartyFromRef } = require("../utils/resolvePartyFromRef");

router.use(requireAuth);

const PARTY_LABEL = { S: "Supplier", C: "Contractor", A: "Customer" };

// ── GET /balance/:partyId — running balance for a party ───────────────────
router.get("/balance/:partyId", async (req, res) => {
  const partyId = parseInt(req.params.partyId, 10);
  if (!partyId) return res.status(400).json({ error: "Invalid partyId" });
  try {
    const pool = getPool();
    const r = await pool.request().input("PartyId", sql.Int, partyId).query(`
      SELECT
        ISNULL(SUM(CASE WHEN TxnType='CREDIT' THEN Amount ELSE 0 END), 0) AS totalCredit,
        ISNULL(SUM(CASE WHEN TxnType='DEBIT'  THEN Amount ELSE 0 END), 0) AS totalDebit
      FROM dbo.OnAccountLedger WHERE PartyId = @PartyId
    `);
    const { totalCredit, totalDebit } = r.recordset[0];
    const balance = parseFloat(totalCredit) - parseFloat(totalDebit);
    res.json({ partyId, balance: Math.max(0, balance), totalCredit: parseFloat(totalCredit), totalDebit: parseFloat(totalDebit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /balance-by-ref/:expenseRef — resolve party from invoice ref, return balance
router.get("/balance-by-ref/:expenseRef", async (req, res) => {
  const expenseRef = decodeURIComponent(req.params.expenseRef);
  try {
    const pool = getPool();
    const party = await resolvePartyFromRef(pool, expenseRef);
    if (!party) return res.json({ balance: 0, partyId: null, partyType: null });
    const r = await pool.request().input("PartyId", sql.Int, party.partyId).query(`
      SELECT
        ISNULL(SUM(CASE WHEN TxnType='CREDIT' THEN Amount ELSE 0 END), 0) AS totalCredit,
        ISNULL(SUM(CASE WHEN TxnType='DEBIT'  THEN Amount ELSE 0 END), 0) AS totalDebit
      FROM dbo.OnAccountLedger WHERE PartyId = @PartyId
    `);
    const { totalCredit, totalDebit } = r.recordset[0];
    const balance = Math.max(0, parseFloat(totalCredit) - parseFloat(totalDebit));
    res.json({ ...party, balance, partyLabel: PARTY_LABEL[party.partyType] ?? party.partyType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /record — internal: called by payment flow to create/adjust OA entries
// Body: { partyId, partyType, txnDate, txnType, amount, refType, refDocNo, refId, adjRefDocNo, companyId, projectId, notes, createdBy }
router.post("/record", async (req, res) => {
  const { partyId, partyType, txnDate, txnType, amount, refType, refDocNo, refId, adjRefDocNo, companyId, projectId, notes } = req.body;
  const createdBy = req.user?.email || "system";
  if (!partyId || !txnType || !amount || amount <= 0) return res.status(400).json({ error: "Missing required fields" });
  try {
    const pool = getPool();
    const r = await pool.request()
      .input("PartyId",     sql.Int,           partyId)
      .input("PartyType",   sql.NVarChar(20),  partyType ?? "")
      .input("TxnDate",     sql.Date,          txnDate ? new Date(txnDate) : new Date())
      .input("TxnType",     sql.NVarChar(10),  txnType)
      .input("Amount",      sql.Decimal(18,2), parseFloat(amount))
      .input("RefType",     sql.NVarChar(30),  refType ?? "Payment")
      .input("RefDocNo",    sql.NVarChar(100), refDocNo ?? null)
      .input("RefId",       sql.Int,           refId ? parseInt(refId) : null)
      .input("AdjRefDocNo", sql.NVarChar(100), adjRefDocNo ?? null)
      .input("CompanyId",   sql.Int,           companyId ?? null)
      .input("ProjectId",   sql.Int,           projectId ?? null)
      .input("Notes",       sql.NVarChar(500), notes ?? null)
      .input("CreatedBy",   sql.NVarChar(150), createdBy)
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
        OUTPUT INSERTED.OAId
        VALUES
          (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy)
      `);
    res.status(201).json({ oaId: r.recordset[0].OAId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /apply-adjustment — apply OA balance to an invoice ───────────────
// Body: { expenseRef, amount (to apply), paymentId?, createdBy? }
router.post("/apply-adjustment", async (req, res) => {
  const { expenseRef, amount, paymentDocNo, paymentId } = req.body;
  const createdBy = req.user?.email || "system";
  if (!expenseRef || !amount || amount <= 0) return res.status(400).json({ error: "expenseRef and amount required" });
  try {
    const pool = getPool();

    // Resolve party
    const party = await resolvePartyFromRef(pool, expenseRef);
    if (!party) return res.status(404).json({ error: "Party not found for this invoice" });

    // Check current OA balance
    const balRes = await pool.request().input("PartyId", sql.Int, party.partyId).query(`
      SELECT ISNULL(SUM(CASE WHEN TxnType='CREDIT' THEN Amount ELSE -Amount END), 0) AS balance
      FROM dbo.OnAccountLedger WHERE PartyId = @PartyId
    `);
    const balance = parseFloat(balRes.recordset[0].balance);
    if (balance <= 0) return res.status(400).json({ error: "No On Account balance available" });

    const applyAmt = Math.min(amount, balance);

    // Get invoice details for companyId/projectId
    const ebRes = await pool.request().input("EDocNo", sql.NVarChar(100), expenseRef).query(`
      SELECT TOP 1 ECompanyId, TRY_CAST(EProjectName AS INT) AS ProjectId FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo
    `);
    const eb = ebRes.recordset[0];

    await pool.request()
      .input("PartyId",     sql.Int,           party.partyId)
      .input("PartyType",   sql.NVarChar(20),  PARTY_LABEL[party.partyType] ?? party.partyType)
      .input("TxnDate",     sql.Date,          new Date())
      .input("TxnType",     sql.NVarChar(10),  "DEBIT")
      .input("Amount",      sql.Decimal(18,2), applyAmt)
      .input("RefType",     sql.NVarChar(30),  "Invoice")
      .input("RefDocNo",    sql.NVarChar(100), expenseRef)
      .input("RefId",       sql.Int,           paymentId ?? null)
      .input("AdjRefDocNo", sql.NVarChar(100), paymentDocNo ?? null)
      .input("CompanyId",   sql.Int,           eb?.ECompanyId ?? null)
      .input("ProjectId",   sql.Int,           eb?.ProjectId ?? null)
      .input("Notes",       sql.NVarChar(500), `On Account adjusted for invoice ${expenseRef}`)
      .input("CreatedBy",   sql.NVarChar(150), createdBy)
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,RefId,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
        VALUES
          (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@RefId,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy)
      `);

    res.json({ applied: applyAmt, remainingBalance: Math.max(0, balance - applyAmt) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /report — On Account report ──────────────────────────────────────
router.get("/report", async (req, res) => {
  const { companyId, projectId, partyId, partyType, dateFrom, dateTo, page = 1, pageSize = 50 } = req.query;
  try {
    const pool = getPool();
    const request = pool.request();
    const conditions = [];

    if (companyId) { conditions.push("oa.CompanyId = @CompanyId"); request.input("CompanyId", sql.Int, parseInt(companyId)); }
    if (projectId) { conditions.push("oa.ProjectId = @ProjectId"); request.input("ProjectId", sql.Int, parseInt(projectId)); }
    if (partyId)   { conditions.push("oa.PartyId = @PartyId");   request.input("PartyId",   sql.Int, parseInt(partyId)); }
    if (partyType) { conditions.push("oa.PartyType = @PartyType"); request.input("PartyType", sql.NVarChar(20), partyType); }
    if (dateFrom)  { conditions.push("oa.TxnDate >= @DateFrom"); request.input("DateFrom", sql.Date, new Date(dateFrom)); }
    if (dateTo)    { conditions.push("oa.TxnDate <= @DateTo");   request.input("DateTo",   sql.Date, new Date(dateTo)); }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    // Running balance per row using window function
    const data = await request.query(`
      SELECT
        oa.OAId, oa.PartyId,
        ahm.LHeadName AS PartyName, ahm.LHeadType AS PartyTypeCode, oa.PartyType,
        oa.TxnDate, oa.TxnType,
        oa.Amount,
        CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE 0 END AS OnAccountCreated,
        CASE WHEN oa.TxnType='DEBIT'  THEN oa.Amount ELSE 0 END AS OnAccountAdjusted,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END)
          OVER (PARTITION BY oa.PartyId ORDER BY oa.TxnDate, oa.OAId
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningBalance,
        oa.RefDocNo, oa.AdjRefDocNo,
        oa.CompanyId, ISNULL(ec.name, '') AS CompanyName,
        oa.ProjectId, ISNULL(ep.name, '') AS ProjectName,
        oa.Notes, oa.CreatedBy, oa.CreatedAt
      FROM dbo.OnAccountLedger oa
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      LEFT JOIN dbo.enterprise ec ON ec.id = oa.CompanyId AND ec.business_type = 'C'
      LEFT JOIN dbo.enterprise ep ON ep.id = oa.ProjectId AND ep.business_type = 'P'
      ${where}
      ORDER BY oa.TxnDate DESC, oa.OAId DESC
      OFFSET ${(parseInt(page)-1)*parseInt(pageSize)} ROWS
      FETCH NEXT ${parseInt(pageSize)} ROWS ONLY
    `);

    const countRes = await pool.request().query(`SELECT COUNT(*) AS total FROM dbo.OnAccountLedger oa ${where}`);

    res.json({ data: data.recordset, total: countRes.recordset[0].total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /party-summary — balance summary per party ────────────────────────
router.get("/party-summary", async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT
        oa.PartyId, ahm.LHeadName AS PartyName, oa.PartyType,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE 0 END) AS TotalCredit,
        SUM(CASE WHEN oa.TxnType='DEBIT'  THEN oa.Amount ELSE 0 END) AS TotalDebit,
        SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END) AS Balance
      FROM dbo.OnAccountLedger oa
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      GROUP BY oa.PartyId, ahm.LHeadName, oa.PartyType
      HAVING SUM(CASE WHEN oa.TxnType='CREDIT' THEN oa.Amount ELSE -oa.Amount END) > 0
      ORDER BY Balance DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
