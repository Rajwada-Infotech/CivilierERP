/**
 * smokeTestTrialBalance.js
 *
 * 1. Assigns LBelongsTo (account group) to all AccountHeadMaster rows
 *    that currently have it NULL — maps by LHeadType.
 * 2. Inserts 4 balanced double-entry test vouchers into GeneralLedgerEntry.
 *
 * Safe to run multiple times: group assignment uses UPDATE WHERE NULL,
 * and vouchers use a distinct VoucherNo prefix "SMOKE-" so they're easy to
 * identify and delete later.
 *
 * Run: node backend/scripts/smokeTestTrialBalance.js
 */

require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");

// ── Group assignments ──────────────────────────────────────────────────────
// AGId references from dbo.AccountGroup (seeded in migrations)
const GROUP = {
  S: 60,   // Suppliers  → SUNDRY CREDITORS (under TRADE PAYABLES → CURRENT LIABILITIES)
  C: 60,   // Contractors → SUNDRY CREDITORS (same creditor bucket)
  B: 14,   // Banks      → CURRENT ASSETS
  A: 14,   // Customers  → CURRENT ASSETS (debtors)
  GL_PURCHASE: 21,   // Purchase A/c → COST OF MATERIALS CONSUMED
  GL_PROVISION: 53,  // PROVISION FOR PENDING GRN A/C → TRADE PAYABLES
  GL_PROV_CREDIT: 14, // Provisional Credit Available → CURRENT ASSETS
};

async function main() {
  await connectDB();
  const pool = getPool();

  // ── Step 1: Assign groups ─────────────────────────────────────────────────
  console.log("\n── Step 1: Assigning account groups ──");

  // Suppliers and Contractors → SUNDRY CREDITORS
  const r1 = await pool.request()
    .input("groupId", sql.Int, GROUP.S)
    .query(`UPDATE dbo.AccountHeadMaster SET LBelongsTo = @groupId
            WHERE LHeadType IN ('S','C') AND LBelongsTo IS NULL`);
  console.log(`  Suppliers/Contractors assigned: ${r1.rowsAffected[0]} rows`);

  // Banks → CURRENT ASSETS
  const r2 = await pool.request()
    .input("groupId", sql.Int, GROUP.B)
    .query(`UPDATE dbo.AccountHeadMaster SET LBelongsTo = @groupId
            WHERE LHeadType = 'B' AND LBelongsTo IS NULL`);
  console.log(`  Banks assigned: ${r2.rowsAffected[0]} rows`);

  // Customers → CURRENT ASSETS
  const r3 = await pool.request()
    .input("groupId", sql.Int, GROUP.A)
    .query(`UPDATE dbo.AccountHeadMaster SET LBelongsTo = @groupId
            WHERE LHeadType = 'A' AND LBelongsTo IS NULL`);
  console.log(`  Customers assigned: ${r3.rowsAffected[0]} rows`);

  // GL accounts — by name
  const glMap = [
    { name: "Purchase A/c",                   groupId: GROUP.GL_PURCHASE },
    { name: "PROVISION FOR PENDING GRN A/C",  groupId: GROUP.GL_PROVISION },
    { name: "Provisional Credit Available",    groupId: GROUP.GL_PROV_CREDIT },
  ];
  for (const { name, groupId } of glMap) {
    const r = await pool.request()
      .input("name", sql.NVarChar(200), name)
      .input("groupId", sql.Int, groupId)
      .query(`UPDATE dbo.AccountHeadMaster SET LBelongsTo = @groupId
              WHERE LHeadName = @name AND LBelongsTo IS NULL`);
    console.log(`  GL "${name}" → group ${groupId}: ${r.rowsAffected[0]} rows`);
  }

  // Verify
  const check = await pool.request().query(
    `SELECT COUNT(*) AS withGroup FROM dbo.AccountHeadMaster WHERE LBelongsTo IS NOT NULL`
  );
  console.log(`  ✓ Total heads now with group: ${check.recordset[0].withGroup}`);

  // ── Step 2: Look up head IDs we'll need ──────────────────────────────────
  console.log("\n── Step 2: Resolving head IDs ──");

  async function headId(name) {
    const r = await pool.request()
      .input("n", sql.NVarChar(200), name)
      .query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @n`);
    const id = r.recordset[0]?.LHeadId;
    if (!id) throw new Error(`AccountHeadMaster entry not found: "${name}"`);
    return id;
  }

  const [
    supplierHowrah,
    supplierBengal,
    purchaseGL,
    provisionGL,
    bankSBI,
  ] = await Promise.all([
    headId("Howrah Steel & Iron Traders"),
    headId("Bengal TMT Distributors Pvt Ltd"),
    headId("Purchase A/c"),
    headId("PROVISION FOR PENDING GRN A/C"),
    headId("State Bank of India"),
  ]);

  console.log(`  Howrah Steel: ${supplierHowrah}, Bengal TMT: ${supplierBengal}`);
  console.log(`  Purchase GL: ${purchaseGL}, Provision GL: ${provisionGL}, SBI: ${bankSBI}`);

  // ── Step 3: Insert test double-entry vouchers ────────────────────────────
  console.log("\n── Step 3: Inserting test GL vouchers ──");

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Check if smoke vouchers already exist
  const existing = await pool.request().query(
    `SELECT COUNT(*) AS cnt FROM dbo.GeneralLedgerEntry WHERE VoucherNo LIKE 'SMOKE-%'`
  );
  if (existing.recordset[0].cnt > 0) {
    console.log(`  ⚠  Smoke vouchers already exist (${existing.recordset[0].cnt} entries). Skipping insert.`);
    console.log("     Delete them first with: DELETE FROM dbo.GeneralLedgerEntry WHERE VoucherNo LIKE 'SMOKE-%'");
    process.exit(0);
  }

  // Helper to insert one leg
  async function insertLeg({ voucherNo, voucherDate, lheadId, debit, credit, narration, sourceType }) {
    await pool.request()
      .input("VoucherNo",    sql.NVarChar(50),  voucherNo)
      .input("VoucherDate",  sql.Date,           voucherDate)
      .input("LHeadId",      sql.Int,            lheadId)
      .input("DebitAmount",  sql.Decimal(18, 2), debit)
      .input("CreditAmount", sql.Decimal(18, 2), credit)
      .input("Narration",    sql.NVarChar(500),  narration)
      .input("SourceType",   sql.NVarChar(50),   sourceType)
      .input("SourceId",     sql.Int,            1)
      .query(`INSERT INTO dbo.GeneralLedgerEntry
                (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount,
                 Narration, SourceType, SourceId, IsReversed, CreatedAt)
              VALUES
                (@VoucherNo, @VoucherDate, @LHeadId, @DebitAmount, @CreditAmount,
                 @Narration, @SourceType, @SourceId, 0, GETDATE())`);
  }

  // ── Voucher 1: GRN for Howrah Steel (TMT Bars ₹45,000)
  // DR Purchase A/c 45,000 | CR Howrah Steel (creditor) 45,000
  await insertLeg({ voucherNo: "SMOKE-GRN-001", voucherDate: yesterday, lheadId: purchaseGL,    debit: 45000, credit: 0,     narration: "GRN - TMT Bars 500kg @ ₹90",     sourceType: "GRN" });
  await insertLeg({ voucherNo: "SMOKE-GRN-001", voucherDate: yesterday, lheadId: supplierHowrah, debit: 0,     credit: 45000, narration: "GRN - TMT Bars 500kg @ ₹90",     sourceType: "GRN" });
  console.log("  ✓ SMOKE-GRN-001: Purchase ₹45,000 from Howrah Steel");

  // ── Voucher 2: GRN for Bengal TMT (Cement ₹28,500)
  // DR Purchase A/c 28,500 | CR Bengal TMT (creditor) 28,500
  await insertLeg({ voucherNo: "SMOKE-GRN-002", voucherDate: yesterday, lheadId: purchaseGL,    debit: 28500, credit: 0,     narration: "GRN - OPC Cement 57 bags",        sourceType: "GRN" });
  await insertLeg({ voucherNo: "SMOKE-GRN-002", voucherDate: yesterday, lheadId: supplierBengal, debit: 0,     credit: 28500, narration: "GRN - OPC Cement 57 bags",        sourceType: "GRN" });
  console.log("  ✓ SMOKE-GRN-002: Purchase ₹28,500 from Bengal TMT");

  // ── Voucher 3: Payment to Howrah Steel ₹20,000 via SBI
  // DR Howrah Steel (reduces creditor) 20,000 | CR SBI Bank (cash out) 20,000
  await insertLeg({ voucherNo: "SMOKE-PAY-001", voucherDate: today,     lheadId: supplierHowrah, debit: 20000, credit: 0,     narration: "Payment to Howrah Steel - Cheque 004521", sourceType: "NewPayment" });
  await insertLeg({ voucherNo: "SMOKE-PAY-001", voucherDate: today,     lheadId: bankSBI,        debit: 0,     credit: 20000, narration: "Payment to Howrah Steel - Cheque 004521", sourceType: "NewPayment" });
  console.log("  ✓ SMOKE-PAY-001: Payment ₹20,000 to Howrah Steel via SBI");

  // ── Voucher 4: Payment to Bengal TMT ₹15,000 via SBI
  // DR Bengal TMT (reduces creditor) 15,000 | CR SBI Bank 15,000
  await insertLeg({ voucherNo: "SMOKE-PAY-002", voucherDate: today,     lheadId: supplierBengal, debit: 15000, credit: 0,     narration: "Payment to Bengal TMT - Cheque 004522", sourceType: "NewPayment" });
  await insertLeg({ voucherNo: "SMOKE-PAY-002", voucherDate: today,     lheadId: bankSBI,        debit: 0,     credit: 15000, narration: "Payment to Bengal TMT - Cheque 004522", sourceType: "NewPayment" });
  console.log("  ✓ SMOKE-PAY-002: Payment ₹15,000 to Bengal TMT via SBI");

  // ── Verify totals ────────────────────────────────────────────────────────
  console.log("\n── Step 4: Verification ──");
  const totals = await pool.request().query(`
    SELECT
      SUM(DebitAmount)  AS totalDR,
      SUM(CreditAmount) AS totalCR,
      COUNT(*)          AS entries
    FROM dbo.GeneralLedgerEntry
    WHERE VoucherNo LIKE 'SMOKE-%'
  `);
  const { totalDR, totalCR, entries } = totals.recordset[0];
  console.log(`  Entries inserted: ${entries}`);
  console.log(`  Total DR: ₹${totalDR}  |  Total CR: ₹${totalCR}`);
  console.log(`  Balanced: ${totalDR === totalCR ? "✓ YES" : "✗ NO — mismatch!"}`);

  console.log("\n✅ Smoke test data ready. Open Trial Balance in FY 2026-27 to verify.");
  console.log("   When done: DELETE FROM dbo.GeneralLedgerEntry WHERE VoucherNo LIKE 'SMOKE-%'");
  console.log("              (or tell me and I'll run the delete)\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
