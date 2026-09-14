require("dotenv").config();
const { connectDB, getPool, sql } = require("../db");
const { reversePostingBySource } = require("../services/generalLedger");
const { syncBillStatus } = require("../utils/syncBillStatus");

const docNo = process.argv[2];
if (!docNo) {
  console.error("Usage: node scripts/fixCancelledCheque.js <PaymentDocNo>");
  process.exit(1);
}

(async () => {
  await connectDB();
  const pool = getPool();

  // ── Step 1: diagnose ──────────────────────────────────────────────────
  const payRes = await pool.request().input("DocNo", sql.NVarChar(100), docNo).query(`
    SELECT PPaymentID, DocNo, Status, PIsChequeCancelled, PChequeNo, PExpenseRef, PAmount
    FROM dbo.NewPayment WHERE DocNo = @DocNo
  `);
  const payment = payRes.recordset[0];
  if (!payment) {
    console.error("No payment found with DocNo:", docNo);
    process.exit(1);
  }
  console.log("Payment:", JSON.stringify(payment, null, 2));

  const glRes = await pool.request().input("pid", sql.Int, payment.PPaymentID).query(`
    SELECT EntryId, LHeadId, DebitAmount, CreditAmount, IsReversed FROM dbo.GeneralLedgerEntry
    WHERE SourceType = 'NewPayment' AND SourceId = @pid
  `);
  console.log("GL entries:", JSON.stringify(glRes.recordset, null, 2));

  let invoice = null;
  if (payment.PExpenseRef) {
    const invRes = await pool.request().input("EDocNo", sql.NVarChar(100), payment.PExpenseRef).query(`
      SELECT Eid, EDocNo, EStatus, EBillStatus, ENetAmount, ETotalPaid, ERemainingAmount
      FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo
    `);
    invoice = invRes.recordset[0];
    console.log("Invoice:", JSON.stringify(invoice, null, 2));
  } else {
    console.log("Payment has no PExpenseRef — not linked to an invoice, nothing to reconcile.");
  }

  // ── Step 2: fix, only if this is actually the stale pre-fix state ─────
  const needsStatusFix = payment.PIsChequeCancelled && payment.Status !== "Cancelled";
  const hasUnreversedGL = glRes.recordset.some((r) => !r.IsReversed);
  const needsFix = needsStatusFix || hasUnreversedGL;

  if (!needsFix) {
    console.log("\nNothing to fix — payment/GL state already matches the current logic.");
    if (invoice) {
      console.log("If the invoice still isn't reappearing in the picker, the issue is elsewhere");
      console.log("(e.g. EStatus isn't 'Approved', or a stale client-side cache) — not this payment's data.");
    }
    process.exit(0);
  }

  console.log("\nDiagnosis: this payment was cancelled under the OLD logic (flag set, but");
  console.log("Status/GL/invoice were never reconciled). Applying the fix now...");

  if (needsStatusFix) {
    await pool.request().input("pid", sql.Int, payment.PPaymentID).query(`
      UPDATE dbo.NewPayment SET Status = 'Cancelled' WHERE PPaymentID = @pid
    `);
    console.log("- Set Status = 'Cancelled'");
  }

  if (hasUnreversedGL) {
    await reversePostingBySource(pool, "NewPayment", payment.PPaymentID);
    console.log("- Reversed GL posting");
  }

  if (payment.PExpenseRef) {
    await syncBillStatus(pool, sql, payment.PExpenseRef);
    const after = await pool.request().input("EDocNo", sql.NVarChar(100), payment.PExpenseRef).query(`
      SELECT EDocNo, EBillStatus, ETotalPaid, ERemainingAmount FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo
    `);
    console.log("- Recomputed invoice:", JSON.stringify(after.recordset[0], null, 2));
  }

  console.log("\nDone. Recheck the Payment page's invoice picker for", payment.PExpenseRef);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
