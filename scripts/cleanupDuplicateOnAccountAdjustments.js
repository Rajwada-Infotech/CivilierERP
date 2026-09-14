// One-off cleanup for the "same On Account Adjustment applied N times to
// the same invoice" bug. Root cause (fixed in backend/routes/onAccount.js,
// POST /apply-adjustment): the endpoint only ever checked the PARTY's
// on-account balance before applying, never whether the INVOICE itself
// still had a remaining balance — so once an invoice was fully paid by the
// first adjustment, nothing stopped it being "applied" again and again
// against the same already-settled invoice as long as the party still had
// OA balance left. Each call wrote its own OnAccountLedger DEBIT row +
// synthetic "Dummy Bank" NewPayment row.
//
// This script finds invoices with more than one DEBIT ledger entry against
// them, keeps the EARLIEST one (the legitimate original application), and
// reverses the rest:
//   1. Inserts an offsetting CREDIT row into OnAccountLedger for each
//      duplicate DEBIT (restores the audit trail instead of deleting it —
//      OnAccountLedger is the audit log, per the route's own comment).
//   2. Restores AccountHeadMaster.OnAccountBalance for the amount reversed.
//   3. Deletes the matching synthetic "Dummy Bank" NewPayment row (these
//      are pure bookkeeping artifacts of the buggy duplicate call, not real
//      bank transactions — nothing else should reference them, unlike the
//      ledger).
//   4. Re-runs syncBillStatus so the invoice's EBillStatus/ETotalPaid/
//      ERemainingAmount reflect only the one legitimate payment.
//
// Matches a ledger DEBIT row to its synthetic NewPayment row by
// (PExpenseRef = RefDocNo, PAmount = Amount, PDocType = 'On Account
// Adjustment', closest CreatedAt) — both rows are written in the same
// request a few milliseconds apart, so pairing chronologically within each
// invoice group is reliable.
//
// Dry-run by default — prints what it WOULD change without touching the
// database. Pass --apply to actually write. This touches real financial
// ledger data — review the dry-run output carefully before applying.
//
// Usage:
//   node backend/scripts/cleanupDuplicateOnAccountAdjustments.js
//   node backend/scripts/cleanupDuplicateOnAccountAdjustments.js --apply

const { connectDB, getPool, sql, closeDB } = require("../db");
const { syncBillStatus } = require("../utils/syncBillStatus");

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const pool = getPool();

  const dupResult = await pool.request().query(`
    SELECT RefDocNo, PartyId, COUNT(*) AS cnt, SUM(Amount) AS totalAmount
    FROM dbo.OnAccountLedger
    WHERE TxnType = 'DEBIT' AND RefType = 'Invoice' AND RefDocNo IS NOT NULL
    GROUP BY RefDocNo, PartyId
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  const groups = dupResult.recordset;
  if (groups.length === 0) {
    console.log("No duplicate On Account Adjustments found — nothing to do.");
    await closeDB();
    return;
  }

  console.log(`Found ${groups.length} invoice(s) with duplicate adjustments:\n`);

  let totalReversals = 0;
  let totalReversedAmount = 0;

  for (const g of groups) {
    console.log(`--- ${g.RefDocNo} (party ${g.PartyId}) — ${g.cnt} entries, ₹${g.totalAmount} total applied ---`);

    const rowsResult = await pool
      .request()
      .input("RefDocNo", sql.NVarChar(100), g.RefDocNo)
      .input("PartyId", sql.Int, g.PartyId).query(`
        SELECT OAId, Amount, CreatedAt
        FROM dbo.OnAccountLedger
        WHERE TxnType = 'DEBIT' AND RefType = 'Invoice' AND RefDocNo = @RefDocNo AND PartyId = @PartyId
        ORDER BY CreatedAt ASC, OAId ASC
      `);
    const rows = rowsResult.recordset;
    const keep = rows[0];
    const duplicates = rows.slice(1);

    console.log(`  keeping OAId ${keep.OAId} (${keep.CreatedAt.toISOString()}, ₹${keep.Amount})`);

    for (const dup of duplicates) {
      // Find the matching synthetic NewPayment row — same expense ref,
      // same amount, created within a few seconds of this ledger row.
      const payResult = await pool
        .request()
        .input("RefDocNo", sql.NVarChar(100), g.RefDocNo)
        .input("Amount", sql.Decimal(18, 2), dup.Amount)
        .input("CreatedAt", sql.DateTime, dup.CreatedAt).query(`
          SELECT TOP 1 PPaymentID, DocNo, PCreatedAt
          FROM dbo.NewPayment
          WHERE PExpenseRef = @RefDocNo AND PAmount = @Amount AND PDocType = 'On Account Adjustment'
            AND ABS(DATEDIFF(SECOND, PCreatedAt, @CreatedAt)) < 10
          ORDER BY ABS(DATEDIFF(SECOND, PCreatedAt, @CreatedAt)) ASC
        `);
      const match = payResult.recordset[0];

      console.log(`  reversing OAId ${dup.OAId} (${dup.CreatedAt.toISOString()}, ₹${dup.Amount})${match ? ` -> NewPayment ${match.DocNo} (id ${match.PPaymentID})` : " -> no matching synthetic payment found"}`);
      totalReversals += 1;
      totalReversedAmount += Number(dup.Amount);

      if (!APPLY) continue;

      const transaction = pool.transaction();
      await transaction.begin();
      try {
        await transaction
          .request()
          .input("PartyId", sql.Int, g.PartyId)
          .input("TxnDate", sql.Date, new Date())
          .input("Amount", sql.Decimal(18, 2), dup.Amount)
          .input("RefDocNo", sql.NVarChar(100), g.RefDocNo)
          .input("Notes", sql.NVarChar(500), `Reversal of duplicate adjustment (OAId ${dup.OAId}) — auto-cleanup`)
          .query(`
            INSERT INTO dbo.OnAccountLedger
              (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, Notes, CreatedBy)
            SELECT PartyId, PartyType, @TxnDate, 'CREDIT', @Amount, 'Manual', @RefDocNo, @Notes, 'cleanup-script'
            FROM dbo.OnAccountLedger WHERE OAId = ${dup.OAId};

            UPDATE dbo.AccountHeadMaster SET OnAccountBalance = OnAccountBalance + @Amount WHERE LHeadId = @PartyId;
          `);

        if (match) {
          await transaction
            .request()
            .input("PPaymentID", sql.Int, match.PPaymentID)
            .query(`DELETE FROM dbo.NewPayment WHERE PPaymentID = @PPaymentID`);
        }

        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        console.error(`  FAILED to reverse OAId ${dup.OAId}:`, err.message);
        throw err;
      }
    }

    if (APPLY) {
      await syncBillStatus(pool, sql, g.RefDocNo);
      console.log(`  re-synced bill status for ${g.RefDocNo}`);
    }
    console.log("");
  }

  console.log(`${APPLY ? "Reversed" : "Would reverse"} ${totalReversals} duplicate adjustment(s), ₹${totalReversedAmount} total.`);
  if (!APPLY) console.log("(dry run — pass --apply to write these changes)");

  await closeDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
