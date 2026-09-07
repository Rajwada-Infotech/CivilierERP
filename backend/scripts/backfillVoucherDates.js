// backend/scripts/backfillVoucherDates.js
//
// Fixes dbo.GeneralLedgerEntry.VoucherDate for entries that were stamped
// with the date they happened to get posted to GL instead of their source
// document's own date — an invoice dated 8 June, logged/posted on 10 Aug,
// showed 10 Aug in the Trial Balance/ledger. Four posting routes had this
// bug (all fixed to use the source's own date going forward):
//   InvoicePosting -> ExpenseBooking.EDocDate   (routes/expenseBooking.js)
//   GRNPosting     -> GoodsReceiptNotes.GRNDate (routes/grns.js)
//   PaymentPosting -> NewPayment.PDate          (routes/newPayment.js)
//   LoanPosting    -> LoanSanction.LoanDate     (routes/loanSanction.js)
//
// This script re-dates every already-posted entry of these four types to
// match its source document, active (IsReversed=0) entries only — a
// reversed entry's date doesn't matter for anything still showing on the
// books.
//
// Usage:
//   cd backend
//   node scripts/backfillVoucherDates.js            # dry run — reports mismatches, writes nothing
//   node scripts/backfillVoucherDates.js --apply     # corrects every mismatched VoucherDate

require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

const SOURCES = [
  {
    sourceType: "InvoicePosting",
    label: "Invoice",
    query: `
      SELECT gle.EntryId, gle.VoucherNo, gle.VoucherDate, eb.EDocDate AS RealDate
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.ExpenseBooking eb ON eb.Eid = gle.SourceId
      WHERE gle.SourceType = 'InvoicePosting' AND gle.IsReversed = 0
        AND CAST(gle.VoucherDate AS DATE) <> CAST(eb.EDocDate AS DATE)
    `,
  },
  {
    sourceType: "GRNPosting",
    label: "GRN",
    query: `
      SELECT gle.EntryId, gle.VoucherNo, gle.VoucherDate, g.GRNDate AS RealDate
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.GoodsReceiptNotes g ON g.GRNID = gle.SourceId
      WHERE gle.SourceType = 'GRNPosting' AND gle.IsReversed = 0
        AND CAST(gle.VoucherDate AS DATE) <> CAST(g.GRNDate AS DATE)
    `,
  },
  {
    sourceType: "PaymentPosting",
    label: "Payment",
    query: `
      SELECT gle.EntryId, gle.VoucherNo, gle.VoucherDate, np.PDate AS RealDate
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.NewPayment np ON np.PPaymentID = gle.SourceId
      WHERE gle.SourceType = 'PaymentPosting' AND gle.IsReversed = 0
        AND CAST(gle.VoucherDate AS DATE) <> CAST(np.PDate AS DATE)
    `,
  },
  {
    sourceType: "LoanPosting",
    label: "Loan",
    query: `
      SELECT gle.EntryId, gle.VoucherNo, gle.VoucherDate, l.LoanDate AS RealDate
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.LoanSanction l ON l.LoanId = gle.SourceId
      WHERE gle.SourceType = 'LoanPosting' AND gle.IsReversed = 0
        AND CAST(gle.VoucherDate AS DATE) <> CAST(l.LoanDate AS DATE)
    `,
  },
];

(async () => {
  await connectDB();
  const pool = getPool();

  let totalMismatched = 0;
  let totalFixed = 0;

  for (const src of SOURCES) {
    const result = await pool.request().query(src.query);
    if (result.recordset.length === 0) {
      console.log(`${src.label}: no mismatches.`);
      continue;
    }
    totalMismatched += result.recordset.length;
    console.log(`${src.label}: ${result.recordset.length} entr${result.recordset.length === 1 ? "y" : "ies"} mismatched.${APPLY ? "" : " (dry run)"}`);

    for (const row of result.recordset) {
      const wrongDate = new Date(row.VoucherDate).toISOString().slice(0, 10);
      const rightDate = new Date(row.RealDate).toISOString().slice(0, 10);
      const label = `  ${row.VoucherNo} (EntryId ${row.EntryId}): ${wrongDate} -> ${rightDate}`;
      if (!APPLY) {
        console.log(`WOULD FIX${label}`);
        continue;
      }
      await pool.request()
        .input("EntryId", sql.Int, row.EntryId)
        .input("VoucherDate", sql.Date, row.RealDate)
        .query("UPDATE dbo.GeneralLedgerEntry SET VoucherDate = @VoucherDate WHERE EntryId = @EntryId");
      console.log(`FIXED${label}`);
      totalFixed++;
    }
  }

  if (totalMismatched === 0) {
    console.log("\nNo mismatched VoucherDates found — nothing to do.");
  } else if (APPLY) {
    console.log(`\nFixed: ${totalFixed} of ${totalMismatched}.`);
  } else {
    console.log(`\n${totalMismatched} mismatch(es) found. Pass --apply to fix them.`);
  }
  process.exit(0);
})().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});
