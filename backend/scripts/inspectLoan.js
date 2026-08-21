// backend/scripts/inspectLoan.js — read-only, dumps everything about one
// loan (by LoanNo) so a real bug can be diagnosed instead of guessed at.
//
// Usage: node scripts/inspectLoan.js LN-000015

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

const loanNo = process.argv[2];
if (!loanNo) {
  console.error("Usage: node scripts/inspectLoan.js <LoanNo>");
  process.exit(1);
}

(async () => {
  await connectDB();
  const pool = getPool();

  const loan = await pool.request().input("no", sql.NVarChar(50), loanNo).query(`
    SELECT * FROM dbo.LoanSanction WHERE LoanNo = @no
  `);
  console.log("=== LoanSanction ===");
  console.log(JSON.stringify(loan.recordset, null, 2));
  const loanId = loan.recordset[0]?.LoanId;
  if (!loanId) process.exit(0);

  const emis = await pool.request().input("id", sql.Int, loanId).query(`
    SELECT * FROM dbo.LoanEMISchedule WHERE LoanId = @id ORDER BY InstallmentNo
  `);
  console.log("\n=== LoanEMISchedule ===");
  console.log(JSON.stringify(emis.recordset, null, 2));

  const payments = await pool.request().input("id", sql.Int, loanId).query(`
    SELECT * FROM dbo.LoanPayment WHERE LoanId = @id
  `);
  console.log("\n=== LoanPayment ===");
  console.log(JSON.stringify(payments.recordset, null, 2));

  for (const p of payments.recordset) {
    if (p.NewPaymentId) {
      const np = await pool.request().input("id", sql.Int, p.NewPaymentId).query(`
        SELECT PPaymentID, DocNo, PAmount, PDate, PMode, PChequeNo, PChequeDate, PBankName,
               PRemarks, PPaymentName, Status, PCreatedBy, PCreatedAt
        FROM dbo.NewPayment WHERE PPaymentID = @id
      `);
      console.log(`\n=== NewPayment linked to LoanPayment #${p.PaymentId} ===`);
      console.log(JSON.stringify(np.recordset, null, 2));
    }
    if (p.ReceivedPaymentId) {
      const rp = await pool.request().input("id", sql.Int, p.ReceivedPaymentId).query(`
        SELECT RPPaymentID, RPDocNo, RPAmount, RPDocDate, RPMode, RPCheckNumber, RPChequeDate,
               RPDepositBankName, RPRemarks, RPStatus, RPCreatedBy, RPCreatedAt
        FROM dbo.ReceivedPayment WHERE RPPaymentID = @id
      `);
      console.log(`\n=== ReceivedPayment linked to LoanPayment #${p.PaymentId} ===`);
      console.log(JSON.stringify(rp.recordset, null, 2));
    }
  }

  const gl = await pool.request().input("id", sql.Int, loanId).query(`
    SELECT EntryId, VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration,
           SourceType, SourceId, CompanyId, IsReversed, CreatedAt
    FROM dbo.GeneralLedgerEntry
    WHERE (SourceType = 'LoanPosting' AND SourceId = @id)
       OR (SourceType = 'LoanRepayment' AND SourceId IN (SELECT PaymentId FROM dbo.LoanPayment WHERE LoanId = @id))
    ORDER BY EntryId
  `);
  console.log("\n=== GeneralLedgerEntry (LoanPosting + LoanRepayment for this loan) ===");
  console.log(JSON.stringify(gl.recordset, null, 2));

  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
