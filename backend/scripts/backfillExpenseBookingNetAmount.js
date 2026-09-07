// One-off backfill for GRN-linked invoices whose auto-post-on-approval
// GL entry (services/generalLedger.js's postExpenseBookingApproval,
// SourceType='ExpenseBooking') credited the supplier only the taxable
// BASE amount instead of the GST-inclusive net payable.
//
// Root cause: `netAmount = eb.ENetAmount ?? eb.EAmount` fell back to
// eb.EAmount (the base) whenever ENetAmount was unset, instead of the
// linked GRN's own (incl-GST) TotalAmount — silently understating what
// the supplier was actually owed in GL by the tax amount. Fixed in
// postExpenseBookingApproval; this backfill finds every already-posted
// GRN-linked ExpenseBooking entry whose credited amount doesn't match
// the correct payable and reposts it.
//
// GL entries are never edited in place — for every affected invoice this
// reverses the existing ExpenseBooking-sourced voucher (IsReversed=1) and
// calls the (now-fixed) postExpenseBookingApproval again, so the repost
// uses the exact same logic a live approval would.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/backfillExpenseBookingNetAmount.js
//   node backend/scripts/backfillExpenseBookingNetAmount.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");
const { reversePostingBySource, postExpenseBookingApproval, hasPosting } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  // gle.LHeadId = grn.SupplierID isolates the actual supplier-liability leg
  // from the (also CreditAmount > 0, when delta < 0) unrelated billing-term
  // adjustment leg posted to the Purchase head — comparing that one against
  // the invoice total was a false positive in an earlier version of this
  // script.
  const rowsRes = await pool.request().query(`
    SELECT eb.Eid, eb.EDocNo, eb.EAmount, eb.ENetAmount, eb.ESourceId,
           grn.TotalAmount AS GrnTotal, gle.CreditAmount AS PostedCredit, gle.VoucherNo
    FROM dbo.ExpenseBooking eb
    JOIN dbo.GoodsReceiptNotes grn ON grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
    JOIN dbo.GeneralLedgerEntry gle
      ON gle.SourceType = 'ExpenseBooking' AND gle.SourceId = eb.Eid AND gle.IsReversed = 0
      AND gle.CreditAmount > 0 AND gle.LHeadId = grn.SupplierID
    WHERE eb.ESourceType = 'GRN'
  `);

  console.log(`Found ${rowsRes.recordset.length} live ExpenseBooking-sourced supplier-credit leg(s) to check. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let changedCount = 0;
  for (const row of rowsRes.recordset) {
    const correctAmount = row.ENetAmount != null ? Number(row.ENetAmount) : Number(row.GrnTotal) || 0;
    const postedAmount = Number(row.PostedCredit);
    if (Math.abs(correctAmount - postedAmount) < 0.01) continue;

    changedCount++;
    console.log(`Invoice ${row.EDocNo} (id ${row.Eid}), currently ${row.VoucherNo}:`);
    console.log(`    Supplier credit: ${fmt(postedAmount)} → ${fmt(correctAmount)}`);

    if (APPLY) {
      // Defensive: never leave an invoice with zero live postings — if
      // InvoicePosting has since become authoritative for this invoice,
      // just reverse the stale ExpenseBooking leg and stop there instead
      // of calling postExpenseBookingApproval (which would no-op and skip
      // reposting once InvoicePosting is live).
      if (await hasPosting(pool, "InvoicePosting", row.Eid)) {
        await reversePostingBySource(pool, "ExpenseBooking", row.Eid);
        console.log(`    → reversed ${row.VoucherNo} (InvoicePosting is already authoritative for this invoice, not reposting)`);
      } else {
        await reversePostingBySource(pool, "ExpenseBooking", row.Eid);
        const result = await postExpenseBookingApproval(pool, row.Eid, "backfill-expense-booking-net-amount");
        console.log(`    → reversed ${row.VoucherNo}, reposted (${result.posted ? "ok" : result.reason})`);
      }
    }
    console.log("");
  }

  console.log(`${changedCount} invoice(s) ${APPLY ? "reclassified" : "would be reclassified"}.`);
  if (!APPLY && changedCount > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
