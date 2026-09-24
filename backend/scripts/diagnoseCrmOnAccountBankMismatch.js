/**
 * Read-only: for every CrmOnAccountPayment whose GL debit leg landed on
 * "CRM Collections A/c" instead of a real bank, show what bank the SOURCE
 * ReceivedPayment actually has on file (RPDepositBankId) — this is what the
 * debit leg SHOULD have posted to. Also lists every real Bank-type
 * AccountHeadMaster row for reference in case a manual pick is needed.
 *
 * Usage: node backend/scripts/diagnoseCrmOnAccountBankMismatch.js
 * Makes no writes.
 */
require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();

  const head = await pool.request().query(`
    SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'CRM Collections A/c'
  `);
  const collectionsHeadId = head.recordset[0]?.LHeadId;
  if (!collectionsHeadId) {
    console.log("No 'CRM Collections A/c' head found.");
    process.exit(0);
  }

  const mismatched = await pool.request().input("id", sql.Int, collectionsHeadId).query(`
    SELECT
      oa.Id AS OnAccountId, oa.ReceiptNo, oa.Amount, oa.DepositBankId AS OaBankId, oa.DepositBankName AS OaBankName,
      oa.SourceReceivedPaymentId,
      rp.RPPaymentID, rp.RPDepositBankId, rp.RPDepositBankName, rp.RPAmount, rp.RPDocDate,
      gle.EntryId, gle.DebitAmount
    FROM dbo.GeneralLedgerEntry gle
    JOIN dbo.CrmOnAccountPayment oa ON oa.Id = gle.SourceId AND gle.SourceType = 'CrmOnAccountPayment'
    LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = oa.SourceReceivedPaymentId
    WHERE gle.LHeadId = @id AND gle.IsReversed = 0 AND gle.DebitAmount > 0
    ORDER BY gle.CreatedAt DESC
  `);

  console.log("On-account entries currently debited to 'CRM Collections A/c':\n");
  console.table(mismatched.recordset.map(r => ({
    EntryId: r.EntryId, OnAccountId: r.OnAccountId, ReceiptNo: r.ReceiptNo, Amount: r.DebitAmount,
    OaBankId: r.OaBankId, OaBankName: r.OaBankName,
    SourceRP: r.SourceReceivedPaymentId, RPBankId: r.RPDepositBankId, RPBankName: r.RPDepositBankName,
    RPDocDate: r.RPDocDate?.toISOString?.().slice(0,10),
  })));

  const banks = await pool.request().query(`
    SELECT LHeadId, ISNULL(DisplayName, LHeadName) AS Name, LHeadCode
    FROM dbo.AccountHeadMaster
    WHERE LHeadType = 'B' AND LHeadStatus = 1 AND ISNULL(LHeadCode, '') <> 'DUMMY-BANK'
    ORDER BY Name
  `);
  console.log("\nReal active Bank accounts (LHeadType='B', excl. DUMMY-BANK):");
  console.table(banks.recordset);

  process.exit(0);
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
