// Invoices left "Partially Paid" by a round-off of less than a rupee: the net amount was rounded to the
// rupee (₹64,800) while the vendor was credited and paid the exact figure (₹64,799.70). syncBillStatus
// now treats a shortfall under ₹1 as settled; this re-runs it for the invoices already stuck.
//   node scripts/fixRoundOffBills.js           dry run - lists them, changes nothing
//   node scripts/fixRoundOffBills.js --apply   re-syncs each one's paid status
const { connectDB, getPool, closeDB, sql } = require("../db");
const { syncBillStatus } = require("../utils/syncBillStatus");

const apply = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT Eid, EDocNo, EName, ENetAmount, ETotalPaid, ERemainingAmount, EBillStatus
    FROM dbo.ExpenseBooking
    WHERE ERemainingAmount > 0 AND ERemainingAmount < 1
      AND ISNULL(EBillStatus, '') <> 'Paid'
      AND ISNULL(EStatus, '') NOT IN ('Deleted', 'Rejected', 'Cancelled')
    ORDER BY Eid`)).recordset;

  if (!rows.length) {
    console.log("OK   no invoice is held open by a round-off under a rupee");
    await closeDB?.();
    process.exit(0);
  }
  for (const r of rows) {
    console.log(`FIX  #${r.Eid} ${r.EDocNo} (${r.EName || "—"}): net ${Number(r.ENetAmount).toFixed(2)}, paid ${Number(r.ETotalPaid).toFixed(2)}, ${Number(r.ERemainingAmount).toFixed(2)} left, ${r.EBillStatus}`);
  }
  console.log(`${rows.length} invoice(s)`);
  if (!apply) {
    console.log("Dry run - nothing changed. Run again with --apply to fix.");
    await closeDB?.();
    process.exit(0);
  }

  let fixed = 0;
  for (const r of rows) {
    await syncBillStatus(pool, sql, r.EDocNo);
    const after = (await pool.request().input("id", sql.Int, r.Eid)
      .query("SELECT EBillStatus, ERemainingAmount FROM dbo.ExpenseBooking WHERE Eid = @id")).recordset[0];
    if (after && after.EBillStatus === "Paid") fixed++;
    console.log(`  #${r.Eid} ${r.EDocNo}: now ${after?.EBillStatus}, ${Number(after?.ERemainingAmount ?? 0).toFixed(2)} left`);
  }
  console.log(`Done - ${fixed} of ${rows.length} now Paid.`);
  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
