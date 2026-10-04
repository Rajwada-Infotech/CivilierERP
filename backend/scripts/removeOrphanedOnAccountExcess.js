// One-off cleanup for OnAccountLedger row(s) whose underlying Payment
// and/or Invoice were later hard-deleted, leaving a phantom "Excess"
// credit sitting in the party's on-account balance with nothing real
// behind it (confirmed manually — see OAId 1045: PAY-2026-00121 and
// INV/GRN-2026-00005 both deleted).
//
// dbo.OnAccountLedger has no IsReversed/soft-delete column (unlike
// GeneralLedgerEntry) — every row in it up to now has been a plain
// INSERT with no reversal precedent, so for an orphaned row referencing
// records that no longer exist at all, a real DELETE is the correct
// move here, paired with decrementing the party's cached
// AccountHeadMaster.OnAccountBalance by the same amount so the running
// total stays in sync with the ledger it's supposed to reflect.
//
// Dry-run by default — prints what it WOULD do without touching the
// database. Pass --apply to actually delete. Pass --oaid=<id> to target
// a specific row (default: 1045, the one confirmed this session).
//
// Usage:
//   node backend/scripts/removeOrphanedOnAccountExcess.js
//   node backend/scripts/removeOrphanedOnAccountExcess.js --apply
//   node backend/scripts/removeOrphanedOnAccountExcess.js --apply --oaid=1045

const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");
const oaidArg = process.argv.find((a) => a.startsWith("--oaid="));
const OAID = oaidArg ? parseInt(oaidArg.split("=")[1], 10) : 1045;

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const rowRes = await pool.request().input("OAId", sql.Int, OAID).query(`
    SELECT oal.OAId, oal.PartyId, oal.TxnType, oal.Amount, oal.RefDocNo, oal.Notes,
           ah.LHeadName AS SupplierName, ah.OnAccountBalance AS CurrentBalance
    FROM dbo.OnAccountLedger oal
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = oal.PartyId
    WHERE oal.OAId = @OAId
  `);
  const row = rowRes.recordset[0];
  if (!row) {
    console.log(`OAId ${OAID} not found — nothing to do.`);
    await closeDB();
    return;
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);
  console.log(`OAId ${row.OAId} — ${row.SupplierName || `PartyId ${row.PartyId}`}`);
  console.log(`  Notes: "${row.Notes}"`);
  console.log(`  Amount: ₹${fmt(row.Amount)} (${row.TxnType})`);
  console.log(`  Current cached OnAccountBalance for this party: ₹${fmt(row.CurrentBalance)}`);

  const amount = Number(row.Amount) || 0;
  const isCredit = row.TxnType === "CREDIT";
  // Same sign convention used everywhere else in this codebase: CREDIT
  // added to OnAccountBalance, DEBIT subtracted — removing the row
  // reverses that.
  const newBalance = isCredit
    ? Number(row.CurrentBalance) - amount
    : Number(row.CurrentBalance) + amount;
  console.log(`  Balance after removing this row: ₹${fmt(newBalance)}`);

  if (APPLY) {
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("OAId", sql.Int, OAID).query(
        `DELETE FROM dbo.OnAccountLedger WHERE OAId = @OAId`,
      );
      await tx.request()
        .input("PartyId", sql.Int, row.PartyId)
        .input("NewBalance", sql.Decimal(18, 2), newBalance)
        .query(`UPDATE dbo.AccountHeadMaster SET OnAccountBalance = @NewBalance WHERE LHeadId = @PartyId`);
      await tx.commit();
      console.log(`\n→ Deleted OAId ${row.OAId} and updated OnAccountBalance to ₹${fmt(newBalance)}.`);
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } else {
    console.log("\nRe-run with --apply to actually delete this row and correct the balance.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
