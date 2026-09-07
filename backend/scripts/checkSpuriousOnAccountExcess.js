// Read-only diagnostic — no writes. Checks every "Excess" OnAccountLedger
// CREDIT row (created by newPayment.js when a payment appeared to overpay
// its linked invoice) against that invoice's CURRENT ExpenseBooking.
// ENetAmount, to find ones that were only "excess" because the invoice's
// own ENetAmount was wrong at the time of payment (see the ENetAmount /
// billing-term-delta fix in services/generalLedger.js).
//
// A row is flagged as likely-spurious when the payment's own full amount
// (which already includes the "excess" portion) no longer exceeds the
// invoice's current (corrected) net payable — i.e. there was never a real
// overpayment once the invoice amount itself is right.
//
// Usage: node backend/scripts/checkSpuriousOnAccountExcess.js

const { connectDB, getPool, closeDB } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const rowsRes = await pool.request().query(`
    SELECT oal.OAId, oal.PartyId, oal.TxnDate, oal.Amount AS ExcessAmount, oal.RefDocNo, oal.Notes,
           np.PPaymentID, np.PAmount AS PaymentAmount, np.PExpenseRef,
           eb.Eid, eb.EDocNo, eb.ENetAmount, eb.EAmount,
           ah.LHeadName AS SupplierName
    FROM dbo.OnAccountLedger oal
    LEFT JOIN dbo.NewPayment np ON np.DocNo = oal.RefDocNo
    LEFT JOIN dbo.ExpenseBooking eb ON eb.EDocNo = np.PExpenseRef
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = oal.PartyId
    WHERE oal.TxnType = 'CREDIT' AND oal.RefType = 'Payment'
    ORDER BY oal.TxnDate DESC
  `);

  console.log(`Found ${rowsRes.recordset.length} "Excess" on-account credit row(s). Checking each against the linked invoice's current net payable...\n`);

  let flagged = 0;
  for (const row of rowsRes.recordset) {
    if (!row.Eid) {
      console.log(`⚠ OAId ${row.OAId} (₹${fmt(row.ExcessAmount)}, ${row.RefDocNo}): could not resolve a linked invoice — check manually. Notes: "${row.Notes}"`);
      continue;
    }
    const paymentAmount = Number(row.PaymentAmount) || 0;
    const currentNetPayable = Number(row.ENetAmount ?? row.EAmount) || 0;
    const genuineExcess = Math.max(0, paymentAmount - currentNetPayable);
    const excessAmount = Number(row.ExcessAmount);

    if (Math.abs(genuineExcess - excessAmount) > 0.01) {
      flagged++;
      console.log(`⚠ LIKELY SPURIOUS — OAId ${row.OAId}, ${row.RefDocNo} (${row.SupplierName || "?"}), invoice ${row.EDocNo}:`);
      console.log(`    Payment amount: ₹${fmt(paymentAmount)}`);
      console.log(`    Invoice net payable (current, corrected): ₹${fmt(currentNetPayable)}`);
      console.log(`    Recorded "excess": ₹${fmt(excessAmount)}  →  actual excess should be: ₹${fmt(genuineExcess)}`);
      console.log("");
    }
  }

  console.log(`${flagged} of ${rowsRes.recordset.length} "Excess" row(s) look spurious (don't match the invoice's current net payable).`);
  console.log("This is diagnostic only — nothing was changed. Review the list above before deciding on a fix.");

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
