/**
 * Read-only diagnostic: breaks down the current balance under the
 * "CRM Collections A/c" GL head by SourceType, so we can tell whether it's
 * legitimate unreconciled clearing-account residual (broker payouts, stamp
 * duty, parking payments, SA commission/marketing invoices — all still
 * post through this head) or something erroneous that needs a write-off.
 *
 * Usage: node backend/scripts/diagnoseCrmCollectionsBalance.js
 * Makes no writes.
 */
require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();

  const head = await pool.request().query(`
    SELECT LHeadId, LHeadName, LBelongsTo FROM dbo.AccountHeadMaster WHERE LHeadName = 'CRM Collections A/c'
  `);
  const row = head.recordset[0];
  if (!row) {
    console.log("No 'CRM Collections A/c' head found.");
    process.exit(0);
  }
  console.log("LHeadId:", row.LHeadId, "| LBelongsTo (group):", row.LBelongsTo);

  const byType = await pool.request().input("id", sql.Int, row.LHeadId).query(`
    SELECT SourceType,
           SUM(CASE WHEN IsReversed = 0 THEN 1 ELSE 0 END) AS Legs,
           SUM(CASE WHEN IsReversed = 0 THEN DebitAmount ELSE 0 END) AS TotalDebit,
           SUM(CASE WHEN IsReversed = 0 THEN CreditAmount ELSE 0 END) AS TotalCredit,
           SUM(CASE WHEN IsReversed = 0 THEN DebitAmount - CreditAmount ELSE 0 END) AS NetBalance
    FROM dbo.GeneralLedgerEntry
    WHERE LHeadId = @id
    GROUP BY SourceType
    ORDER BY ABS(SUM(CASE WHEN IsReversed = 0 THEN DebitAmount - CreditAmount ELSE 0 END)) DESC
  `);
  console.log("\nBreakdown by SourceType (excl. reversed legs):");
  console.table(byType.recordset);

  const total = await pool.request().input("id", sql.Int, row.LHeadId).query(`
    SELECT SUM(DebitAmount) AS TotalDebit, SUM(CreditAmount) AS TotalCredit, SUM(DebitAmount) - SUM(CreditAmount) AS NetBalance
    FROM dbo.GeneralLedgerEntry WHERE LHeadId = @id AND IsReversed = 0
  `);
  console.log("\nOverall net balance (excl. reversed):", total.recordset[0]);

  const recent = await pool.request().input("id", sql.Int, row.LHeadId).query(`
    SELECT TOP 20 EntryId, VoucherNo, VoucherDate, SourceType, SourceId, DebitAmount, CreditAmount, Narration, CreatedAt, IsReversed
    FROM dbo.GeneralLedgerEntry
    WHERE LHeadId = @id
    ORDER BY CreatedAt DESC
  `);
  console.log("\nMost recent 20 entries:");
  console.table(recent.recordset.map(r => ({
    EntryId: r.EntryId, VoucherNo: r.VoucherNo, Date: r.VoucherDate?.toISOString?.().slice(0,10),
    SourceType: r.SourceType, SourceId: r.SourceId, Debit: r.DebitAmount, Credit: r.CreditAmount,
    Reversed: r.IsReversed, Narration: (r.Narration || "").slice(0, 60),
  })));

  process.exit(0);
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
