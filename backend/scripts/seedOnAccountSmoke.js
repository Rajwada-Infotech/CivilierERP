"use strict";
/**
 * Seed smoke data for OnAccountLedger.
 * Picks real Supplier + Contractor parties from AccountHeadMaster.
 * Run: node scripts/seedOnAccountSmoke.js
 */
require("../config/env").loadEnv();
const sql = require("mssql");

const config = {
  server:   process.env.DB_SERVER,
  port:     parseInt(process.env.DB_PORT || "1433"),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

async function run() {
  const pool = await sql.connect(config);
  console.log("Connected to DB");

  // ── 1. Pick up to 3 real Supplier + 2 Contractor parties ─────────────────
  const partyRes = await pool.request().query(`
    SELECT TOP 5 LHeadId, LHeadName, LHeadType
    FROM dbo.AccountHeadMaster
    WHERE LHeadType IN ('S','C') AND LHeadStatus = 1
    ORDER BY LHeadId
  `);
  const parties = partyRes.recordset;
  if (!parties.length) { console.log("No Supplier/Contractor parties found — nothing seeded."); process.exit(0); }

  // ── 2. Pick a real ExpenseBooking doc for reference ───────────────────────
  const ebRes = await pool.request().query(`
    SELECT TOP 1 EDocNo, ECompanyId, TRY_CAST(EProjectName AS INT) AS ProjectId
    FROM dbo.ExpenseBooking ORDER BY EId DESC
  `);
  const eb = ebRes.recordset[0];
  const refDocNo   = eb?.EDocNo    ?? "SMOKE-REF";
  const companyId  = eb?.ECompanyId ?? null;
  const projectId  = eb?.ProjectId   ?? null;

  const PARTY_LABEL = { S: "Supplier", C: "Contractor", A: "Customer" };

  const entries = [];

  // For each party, create a CREDIT (excess stored) and a partial DEBIT (adjusted)
  for (const p of parties) {
    const label = PARTY_LABEL[p.LHeadType] ?? p.LHeadType;
    const creditAmt = parseFloat((Math.random() * 40000 + 5000).toFixed(2));
    const debitAmt  = parseFloat((creditAmt * (0.2 + Math.random() * 0.4)).toFixed(2));

    entries.push({
      partyId: p.LHeadId, partyType: label,
      txnDate: new Date("2026-06-15"),
      txnType: "CREDIT", amount: creditAmt,
      refType: "Payment", refDocNo, adjRefDocNo: null,
      notes: `[SMOKE] Excess payment stored for ${p.LHeadName}`,
    });
    entries.push({
      partyId: p.LHeadId, partyType: label,
      txnDate: new Date("2026-07-01"),
      txnType: "DEBIT", amount: debitAmt,
      refType: "Invoice", refDocNo, adjRefDocNo: refDocNo,
      notes: `[SMOKE] OA adjusted against invoice for ${p.LHeadName}`,
    });
  }

  // ── 3. Insert all entries ─────────────────────────────────────────────────
  let inserted = 0;
  for (const e of entries) {
    await pool.request()
      .input("PartyId",     sql.Int,           e.partyId)
      .input("PartyType",   sql.NVarChar(20),  e.partyType)
      .input("TxnDate",     sql.Date,          e.txnDate)
      .input("TxnType",     sql.NVarChar(10),  e.txnType)
      .input("Amount",      sql.Decimal(18,2), e.amount)
      .input("RefType",     sql.NVarChar(30),  e.refType)
      .input("RefDocNo",    sql.NVarChar(100), e.refDocNo)
      .input("AdjRefDocNo", sql.NVarChar(100), e.adjRefDocNo)
      .input("CompanyId",   sql.Int,           companyId)
      .input("ProjectId",   sql.Int,           projectId)
      .input("Notes",       sql.NVarChar(500), e.notes)
      .input("CreatedBy",   sql.NVarChar(150), "smoke-seed")
      .query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId,PartyType,TxnDate,TxnType,Amount,RefType,RefDocNo,AdjRefDocNo,CompanyId,ProjectId,Notes,CreatedBy)
        VALUES
          (@PartyId,@PartyType,@TxnDate,@TxnType,@Amount,@RefType,@RefDocNo,@AdjRefDocNo,@CompanyId,@ProjectId,@Notes,@CreatedBy)
      `);
    inserted++;
    console.log(`  [${e.txnType}] ${e.partyType} — ${e.partyId} — ₹${e.amount}`);
  }

  console.log(`\nDone — ${inserted} rows inserted into OnAccountLedger.`);
  console.log(`\nView at: Finance → Query → On Account Report  (/on-account-report)`);
  await pool.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
