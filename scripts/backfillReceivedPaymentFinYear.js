// backend/scripts/backfillReceivedPaymentFinYear.js
//
// System-generated Received Payment rows (CRM Money Receipt sync, CRM
// Booking token-payment capture, Inter-Company Transfer's Dummy Bank auto
// receipt, Contract advance auto-adjustment) never passed RPFinYear
// through, so every one of them landed with a NULL Fin Year — see the
// fix in routes/receivedPayment.js (getActiveFinYearName) and
// routes/saleInvoices.js. This backfills the rows that already exist,
// mapping each one to whichever dbo.FinYear row's date range its
// RPDocDate (falling back to RPCreatedAt) actually falls in, rather than
// blanket-assigning the currently active FY to older rows.
//
// Dry-run by default. Pass --apply to write.
//
// Usage:
//   node backend/scripts/backfillReceivedPaymentFinYear.js
//   node backend/scripts/backfillReceivedPaymentFinYear.js --apply

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  const pool = getPool();

  const rows = await pool.request().query(`
    SELECT rp.RPPaymentID, rp.RPDocNo, rp.RPDocDate, rp.RPCreatedAt, rp.RPRemarks,
           fy.FName AS MatchedFinYear
    FROM dbo.ReceivedPayment rp
    OUTER APPLY (
      SELECT TOP 1 FName
      FROM dbo.FinYear
      WHERE ISNULL(rp.RPDocDate, CAST(rp.RPCreatedAt AS DATE)) BETWEEN FStartDate AND FEndDate
      ORDER BY FStartDate DESC
    ) fy
    WHERE rp.RPFinYear IS NULL OR rp.RPFinYear = ''
  `);

  console.log(`Found ${rows.recordset.length} Received Payment row(s) with no Fin Year.\n`);

  let matched = 0;
  let unmatched = 0;
  for (const row of rows.recordset) {
    if (!row.MatchedFinYear) {
      unmatched++;
      console.log(`  [SKIP] #${row.RPPaymentID} (${row.RPDocNo || "no doc no"}) — no FinYear row covers ${row.RPDocDate || row.RPCreatedAt}`);
      continue;
    }
    matched++;
    console.log(`  #${row.RPPaymentID} (${row.RPDocNo || "no doc no"}) -> ${row.MatchedFinYear}  [${row.RPRemarks || ""}]`);
    if (apply) {
      await pool.request()
        .input("id", sql.Int, row.RPPaymentID)
        .input("finYear", sql.NVarChar(20), row.MatchedFinYear)
        .query("UPDATE dbo.ReceivedPayment SET RPFinYear = @finYear WHERE RPPaymentID = @id");
    }
  }

  console.log(`\n${matched} matched, ${unmatched} unmatched.`);
  console.log(apply ? "Applied." : "Dry run only — pass --apply to write.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
