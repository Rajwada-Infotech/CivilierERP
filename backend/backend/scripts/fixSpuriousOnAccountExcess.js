// One-off cleanup for OnAccountLedger "Excess ... on invoice" CREDIT rows
// whose recorded amount no longer matches reality, now that the invoice's
// actual GL posting has been corrected (see the ENetAmount / billing-term
// -delta fix in services/generalLedger.js and
// scripts/checkSpuriousOnAccountExcess.js, which this reuses the same
// detection logic from).
//
// For each flagged row: if the invoice's supplier leg is now fully
// covered by the payment (genuine excess = 0), DELETES the row outright
// (dbo.OnAccountLedger has no IsReversed/soft-delete column — see
// removeOrphanedOnAccountExcess.js's header for why a real delete is the
// right move here). If there's still a genuine partial excess, UPDATES
// the row's Amount to the correct figure instead of deleting it. Either
// way, decrements the party's cached AccountHeadMaster.OnAccountBalance
// by the difference so it stays in sync.
//
// Dry-run by default — prints what it WOULD do without touching the
// database. Pass --apply to actually write.
//
// Usage:
//   node backend/scripts/fixSpuriousOnAccountExcess.js
//   node backend/scripts/fixSpuriousOnAccountExcess.js --apply

const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const rowsRes = await pool.request().query(`
    SELECT oal.OAId, oal.PartyId, oal.Amount AS ExcessAmount, oal.RefDocNo, oal.Notes,
           ah.LHeadName AS SupplierName, ah.OnAccountBalance AS CurrentBalance
    FROM dbo.OnAccountLedger oal
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = oal.PartyId
    WHERE oal.TxnType = 'CREDIT' AND oal.RefType = 'Payment' AND oal.Notes LIKE 'Excess %on invoice%'
    ORDER BY oal.TxnDate DESC
  `);

  console.log(`Found ${rowsRes.recordset.length} genuine "Excess ... on invoice" row(s) to check. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  let fixedCount = 0;
  for (const row of rowsRes.recordset) {
    const m = /^Excess ₹[\d.]+ from (\S+) on invoice (.+)$/.exec(row.Notes || "");
    if (!m) continue;
    const [, paymentDocNo, invoiceDocNo] = m;

    const pmtRes = await pool.request().input("DocNo", paymentDocNo).query(
      `SELECT PAmount FROM dbo.NewPayment WHERE DocNo = @DocNo`,
    );
    const payment = pmtRes.recordset[0];
    const ebRes = await pool.request().input("DocNo", invoiceDocNo).query(
      `SELECT Eid FROM dbo.ExpenseBooking WHERE EDocNo = @DocNo`,
    );
    const eb = ebRes.recordset[0];
    if (!payment || !eb) continue; // unresolvable — handled separately (see removeOrphanedOnAccountExcess.js)

    const postedRes = await pool.request().input("Eid", eb.Eid).input("PartyId", row.PartyId).query(`
      SELECT ISNULL(SUM(gle.CreditAmount), 0) AS PostedSupplierCredit
      FROM dbo.GeneralLedgerEntry gle
      WHERE gle.SourceType IN ('ExpenseBooking', 'InvoicePosting')
        AND gle.SourceId = @Eid AND gle.IsReversed = 0 AND gle.LHeadId = @PartyId
    `);
    const postedSupplierCredit = Number(postedRes.recordset[0]?.PostedSupplierCredit) || 0;
    if (postedSupplierCredit === 0) continue; // invoice not posted — nothing to compare

    const paymentAmount = Number(payment.PAmount) || 0;
    const genuineExcess = Math.round(Math.max(0, paymentAmount - postedSupplierCredit) * 100) / 100;
    const excessAmount = Number(row.ExcessAmount);
    const delta = Math.round((excessAmount - genuineExcess) * 100) / 100;
    if (Math.abs(delta) < 0.01) continue; // already correct

    fixedCount++;
    console.log(`OAId ${row.OAId}, ${paymentDocNo} (${row.SupplierName || "?"}), invoice ${invoiceDocNo}:`);
    console.log(`    Recorded excess: ₹${fmt(excessAmount)}  →  correct: ₹${fmt(genuineExcess)}`);

    if (APPLY) {
      const tx = pool.transaction();
      await tx.begin();
      try {
        if (genuineExcess <= 0) {
          await tx.request().input("OAId", sql.Int, row.OAId).query(`DELETE FROM dbo.OnAccountLedger WHERE OAId = @OAId`);
        } else {
          await tx.request().input("OAId", sql.Int, row.OAId).input("Amount", sql.Decimal(18, 2), genuineExcess).query(
            `UPDATE dbo.OnAccountLedger SET Amount = @Amount WHERE OAId = @OAId`,
          );
        }
        // Re-read the party's balance fresh inside the transaction rather
        // than the batch-query's cached value — a party can have more than
        // one flagged row (e.g. MATRIX CYBER ZONE has two here), so an
        // earlier fix in this same run must already be reflected before
        // computing this one's new balance.
        const freshRes = await tx.request().input("PartyId", sql.Int, row.PartyId).query(
          `SELECT ISNULL(OnAccountBalance, 0) AS Bal FROM dbo.AccountHeadMaster WHERE LHeadId = @PartyId`,
        );
        const freshBalance = Number(freshRes.recordset[0]?.Bal) || 0;
        const newBalance = Math.round((freshBalance - delta) * 100) / 100;
        await tx.request().input("PartyId", sql.Int, row.PartyId).input("NewBalance", sql.Decimal(18, 2), newBalance).query(
          `UPDATE dbo.AccountHeadMaster SET OnAccountBalance = @NewBalance WHERE LHeadId = @PartyId`,
        );
        await tx.commit();
        console.log(`    → ${genuineExcess <= 0 ? "deleted" : "corrected"} OAId ${row.OAId}. Balance: ₹${fmt(freshBalance)} → ₹${fmt(newBalance)}.`);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }
    console.log("");
  }

  console.log(`${fixedCount} row(s) ${APPLY ? "fixed" : "would be fixed"}.`);
  if (!APPLY && fixedCount > 0) console.log("Re-run with --apply to write these changes.");

  await closeDB();
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
