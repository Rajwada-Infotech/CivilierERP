// Catch-up backfill for approved ExpenseBooking rows that were never
// posted to GL at all because postExpenseBookingApproval's non-GRN branch
// used to resolve the supplier by an exact string match against eb.EName
// (a free-text purpose field on TOD/direct bookings, not the supplier's
// ledger name) instead of the actual eb.LHeadId FK — see the fix in
// services/generalLedger.js and scripts/checkUnpostedDinvReason.js for
// how this was diagnosed.
//
// Finds every non-GRN ExpenseBooking with EStatus/Status = 'Approved' and
// no live GeneralLedgerEntry posting, and calls the (now-fixed)
// postExpenseBookingApproval on each — reusing the real posting function
// rather than reimplementing its logic, so there's no risk of drift and
// every one of its own guards (idempotency, EBillingTermsData handling,
// TDS, etc.) still apply exactly as they would on a live approval.
//
// Dry-run by default — only lists what WOULD be posted, calls nothing.
// Pass --apply to actually post.
//
// Usage:
//   node backend/scripts/postUnpostedApprovedInvoices.js
//   node backend/scripts/postUnpostedApprovedInvoices.js --apply

const { connectDB, getPool, closeDB } = require("../db");
const { postExpenseBookingApproval } = require("../services/generalLedger");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const rowsRes = await pool.request().query(`
    SELECT eb.Eid, eb.EDocNo, eb.EName, eb.LHeadId, eb.ENetAmount, eb.EAmount, eb.ESourceType, eb.EStatus,
           ah.LHeadName AS ResolvedSupplierName
    FROM dbo.ExpenseBooking eb
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = eb.LHeadId
    WHERE eb.ESourceType NOT IN ('GRN')
      AND (eb.EStatus = 'Approved' OR eb.Status = 'Approved')
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry gle
        WHERE gle.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND gle.SourceId = eb.Eid AND gle.IsReversed = 0
      )
    ORDER BY ah.LHeadName, eb.Eid
  `);

  console.log(`Found ${rowsRes.recordset.length} approved, unposted, non-GRN invoice(s). Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let postedCount = 0, skippedCount = 0;
  let totalAmount = 0;
  for (const eb of rowsRes.recordset) {
    const amount = Number(eb.ENetAmount ?? eb.EAmount) || 0;
    const supplierLabel = eb.ResolvedSupplierName || `LHeadId ${eb.LHeadId || "(none)"}`;
    console.log(`${eb.EDocNo} (Eid ${eb.Eid}) — ${supplierLabel} — ₹${fmt(amount)}`);

    if (APPLY) {
      const result = await postExpenseBookingApproval(pool, eb.Eid, "backfill-post-unposted-approved-invoices");
      if (result.posted) {
        postedCount++;
        totalAmount += amount;
        console.log(`    → posted`);
      } else {
        skippedCount++;
        console.log(`    → NOT posted: ${result.reason}`);
      }
    }
    console.log("");
  }

  if (APPLY) {
    console.log(`${postedCount} invoice(s) posted (₹${fmt(totalAmount)} total), ${skippedCount} still skipped (see reasons above).`);
  } else {
    console.log(`${rowsRes.recordset.length} invoice(s) would be attempted. Re-run with --apply to actually post them.`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
