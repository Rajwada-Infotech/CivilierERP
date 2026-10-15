// CRM deposits whose on-account figure in Finance (OnAccountLedger /
// OnAccountBalance) is higher than what is really left of them: refunds,
// cancellation roll-overs, re-booking transfers and buy-backs used the deposit
// up without writing the matching line, so Finance's On Account screen kept
// showing that money as available. Only ever takes a figure DOWN to the
// deposit's real unused amount (never adds credit).
//   node scripts/fixCrmOnAccountLedger.js           dry run - lists, changes nothing
//   node scripts/fixCrmOnAccountLedger.js --apply   writes one adjusting line per deposit
const { connectDB, getPool, closeDB } = require("../db");
const { syncCrmOnAccountLedger } = require("../services/crmLedger");

const apply = process.argv.includes("--apply");

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT * FROM (
      SELECT oa.Id, oa.ReceiptNo, oa.BookingId, oa.Status, oa.Amount,
             CASE WHEN oa.Status = 'Bounced' THEN 0
                  WHEN oa.Amount - ISNULL(oa.AppliedAmount, 0) < 0 THEN 0
                  ELSE oa.Amount - ISNULL(oa.AppliedAmount, 0) END AS LeftNow,
             ISNULL((SELECT SUM(CASE WHEN l.TxnType = 'CREDIT' THEN l.Amount ELSE -l.Amount END) FROM dbo.OnAccountLedger l
                     WHERE l.RefId = oa.Id AND l.RefType IN ('CrmOnAccountPayment', 'CrmPaymentReceipt', 'CrmOnAccountAdjust')), 0) AS Tracked,
             (SELECT COUNT(*) FROM dbo.OnAccountLedger l WHERE l.RefType = 'CrmOnAccountPayment' AND l.RefId = oa.Id AND l.TxnType = 'CREDIT') AS OnTracker
      FROM dbo.CrmOnAccountPayment oa
    ) x
    WHERE OnTracker > 0 AND Tracked - LeftNow > 0.009
    ORDER BY Id`)).recordset;

  if (!rows.length) { console.log("OK   every CRM deposit's on-account figure matches what is left of it"); await closeDB?.(); process.exit(0); }
  let total = 0;
  for (const r of rows) {
    const over = Math.round((Number(r.Tracked) - Number(r.LeftNow)) * 100) / 100;
    total += over;
    console.log(`FIX  ${r.ReceiptNo || "#" + r.Id} (booking ${r.BookingId}, ${r.Status}): shows ${Number(r.Tracked).toFixed(2)}, really left ${Number(r.LeftNow).toFixed(2)} -> take off ${over.toFixed(2)}`);
  }
  console.log(`${rows.length} deposit(s), Rs ${total.toFixed(2)} too high in total`);
  if (!apply) { console.log("Dry run - nothing changed. Run again with --apply to fix."); await closeDB?.(); process.exit(0); }

  let done = 0;
  for (const r of rows) {
    const tx = pool.transaction();
    await tx.begin();
    try {
      const out = await syncCrmOnAccountLedger(tx, r.Id, "system:fixCrmOnAccountLedger", "Correction: deposit was used up (refund / cancellation / buy-back) without its on-account line");
      await tx.commit();
      if (out.diff) done++;
    } catch (e) {
      try { await tx.rollback(); } catch { /* rolled back */ }
      console.error(`ERR  ${r.ReceiptNo || "#" + r.Id}: ${e.message}`);
    }
  }
  console.log(`Applied: ${done} of ${rows.length} corrected. Run again without --apply to verify (expect OK).`);
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
