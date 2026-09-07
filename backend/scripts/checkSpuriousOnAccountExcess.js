// Read-only diagnostic — no writes. Checks every genuine "Excess"
// OnAccountLedger CREDIT row (created by newPayment.js when a payment
// appeared to overpay its linked invoice — Notes: "Excess ₹X from
// <payment doc> on invoice <invoice doc>") against that invoice's CURRENT
// ExpenseBooking.ENetAmount, to find ones that were only "excess" because
// the invoice's own ENetAmount was wrong at the time of payment (see the
// ENetAmount / billing-term-delta fix in services/generalLedger.js).
//
// Deliberately excludes "Standalone Advance Payment" / "Backfilled: ..."
// rows — those are advances with NO linked invoice by design, there is
// nothing to compare them against and they are not a symptom of this bug.
//
// Extracts the invoice's doc number directly out of the Notes text (rather
// than joining Payment → ExpenseBooking via PExpenseRef) since that join
// doesn't reliably resolve for every payment shape; the Notes text is
// exactly what newPayment.js wrote at posting time and is authoritative
// for which invoice this excess was computed against.
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
           ah.LHeadName AS SupplierName
    FROM dbo.OnAccountLedger oal
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = oal.PartyId
    WHERE oal.TxnType = 'CREDIT' AND oal.RefType = 'Payment' AND oal.Notes LIKE 'Excess %on invoice%'
    ORDER BY oal.TxnDate DESC
  `);

  console.log(`Found ${rowsRes.recordset.length} genuine "Excess ... on invoice" row(s) (excluding standalone advances, which have no invoice to compare against).\n`);

  let flagged = 0;
  for (const row of rowsRes.recordset) {
    const m = /^Excess ₹[\d.]+ from (\S+) on invoice (.+)$/.exec(row.Notes || "");
    if (!m) {
      console.log(`⚠ OAId ${row.OAId} (₹${fmt(row.ExcessAmount)}, ${row.RefDocNo}): couldn't parse Notes text — check manually. Notes: "${row.Notes}"`);
      continue;
    }
    const [, paymentDocNo, invoiceDocNo] = m;

    const pmtRes = await pool.request().input("DocNo", paymentDocNo).query(
      `SELECT PPaymentID, PAmount FROM dbo.NewPayment WHERE DocNo = @DocNo`,
    );
    const payment = pmtRes.recordset[0];
    const ebRes = await pool.request().input("DocNo", invoiceDocNo).query(
      `SELECT Eid, ENetAmount, EAmount FROM dbo.ExpenseBooking WHERE EDocNo = @DocNo`,
    );
    const eb = ebRes.recordset[0];

    if (!payment || !eb) {
      console.log(`⚠ OAId ${row.OAId} (₹${fmt(row.ExcessAmount)}): could not resolve payment "${paymentDocNo}" (${payment ? "found" : "MISSING"}) or invoice "${invoiceDocNo}" (${eb ? "found" : "MISSING"}) — check manually.`);
      continue;
    }

    const paymentAmount = Number(payment.PAmount) || 0;
    const currentNetPayable = Number(eb.ENetAmount ?? eb.EAmount) || 0;
    const genuineExcess = Math.max(0, paymentAmount - currentNetPayable);
    const excessAmount = Number(row.ExcessAmount);

    if (Math.abs(genuineExcess - excessAmount) > 0.01) {
      flagged++;
      console.log(`⚠ LIKELY SPURIOUS — OAId ${row.OAId}, ${paymentDocNo} (${row.SupplierName || "?"}), invoice ${invoiceDocNo}:`);
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
