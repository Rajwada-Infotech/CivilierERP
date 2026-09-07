// Read-only audit — no writes. Every supplier's closing balance should net
// to ₹0 once every invoice against them is fully paid, UNLESS they
// genuinely have a standalone advance outstanding (a real "Standalone
// Advance Payment" on-account credit with no invoice to apply against
// yet). This finds every supplier where that's NOT the case, and why.
//
// Two known patterns checked for specifically:
//   1. A payment is posted (Dr Supplier) against an invoice that was
//      NEVER posted to GL at all (no Cr Supplier leg exists) — the
//      "Nu Vista" pattern: the payment shows in the ledger, the invoice
//      never does, leaving a permanent, unexplained debit balance.
//   2. Any other non-zero closing balance not accounted for by a
//      standalone advance — reported for manual review, not auto-
//      diagnosed further.
//
// Usage: node backend/scripts/auditVendorLedgerBalances.js

const { connectDB, getPool, closeDB } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  // 1. Unposted-invoice-but-posted-payment pattern, across every supplier.
  const unpostedRes = await pool.request().query(`
    SELECT np.DocNo AS PaymentDocNo, np.PAmount, np.PExpenseRef, np.PPartyId,
           ah.LHeadName AS SupplierName, eb.Eid, eb.EDocNo, eb.EStatus
    FROM dbo.NewPayment np
    JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = np.PPartyId AND ah.LHeadType = 'S'
    LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
    WHERE np.PExpenseRef IS NOT NULL AND np.PExpenseRef <> ''
      AND EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry gle
        WHERE gle.SourceType IN ('NewPayment', 'PaymentPosting') AND gle.SourceId = np.PPaymentID AND gle.IsReversed = 0
      )
      AND (eb.Eid IS NULL OR NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry gle2
        WHERE gle2.SourceType IN ('ExpenseBooking', 'InvoicePosting') AND gle2.SourceId = eb.Eid AND gle2.IsReversed = 0
      ))
    ORDER BY ah.LHeadName
  `);

  console.log(`=== Pattern 1: payment posted, linked invoice never posted to GL ===`);
  console.log(`Found ${unpostedRes.recordset.length} case(s).\n`);
  for (const r of unpostedRes.recordset) {
    console.log(`⚠ ${r.SupplierName}: payment ${r.PaymentDocNo} (₹${fmt(r.PAmount)}) references invoice "${r.PExpenseRef}"`);
    if (!r.Eid) {
      console.log(`    Invoice "${r.PExpenseRef}" doesn't exist in ExpenseBooking at all.`);
    } else {
      console.log(`    Invoice ${r.EDocNo} exists (status: ${r.EStatus}) but has no live GL posting.`);
    }
  }

  // 2. Every supplier's closing balance, flagging non-zero ones not
  // explained by a standalone advance.
  const suppliersRes = await pool.request().query(`
    SELECT LHeadId, LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType = 'S' AND LHeadStatus = 1
  `);

  console.log(`\n=== Pattern 2: non-zero closing balances, by supplier ===`);
  let nonZeroCount = 0;
  for (const s of suppliersRes.recordset) {
    const glRes = await pool.request().input("Id", s.LHeadId).query(`
      SELECT ISNULL(SUM(DebitAmount), 0) - ISNULL(SUM(CreditAmount), 0) AS Net
      FROM dbo.GeneralLedgerEntry
      WHERE LHeadId = @Id AND IsReversed = 0 AND SourceType NOT IN ('GRN', 'GRNPosting')
    `);
    const glNet = Number(glRes.recordset[0]?.Net) || 0;

    const oaRes = await pool.request().input("Id", s.LHeadId).query(`
      SELECT TxnType, Amount, Notes FROM dbo.OnAccountLedger WHERE PartyId = @Id AND PartyType = 'Supplier'
    `);
    let oaNet = 0;
    let hasStandaloneAdvance = false;
    for (const oa of oaRes.recordset) {
      oaNet += oa.TxnType === "CREDIT" ? Number(oa.Amount) : -Number(oa.Amount);
      if (oa.TxnType === "CREDIT" && /Standalone Advance Payment|Backfilled:/.test(oa.Notes || "")) {
        hasStandaloneAdvance = true;
      }
    }

    const closingBalance = Math.round((glNet + oaNet) * 100) / 100;
    if (Math.abs(closingBalance) < 0.01) continue; // clean

    nonZeroCount++;
    const label = closingBalance > 0 ? "Dr" : "Cr";
    console.log(`⚠ ${s.LHeadName}: closing balance ₹${fmt(Math.abs(closingBalance))} ${label}${hasStandaloneAdvance ? " (has a standalone advance on record — may be legitimate)" : " — NO standalone advance on record, needs review"}`);
  }
  console.log(`\n${nonZeroCount} of ${suppliersRes.recordset.length} suppliers have a non-zero closing balance.`);
  console.log("This is diagnostic only — nothing was changed.");

  await closeDB();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
