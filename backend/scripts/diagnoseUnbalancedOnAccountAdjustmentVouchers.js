// Read-only diagnostic — no writes. Finds every OnAccountAdjustment GL
// voucher (SourceType='OnAccountAdjustment', grouped by SourceId = the
// OnAccountLedger.OAId it settles) that doesn't have a clean 2-leg
// Dr <party> / Cr "Company On Account A/c" pair — regardless of IsReversed
// status, live or dead.
//
// postOnAccountAdjustment (services/generalLedger.js) and migration 299's
// backfill both always write exactly 2 legs together in one call, so a
// voucher with any other leg count means one leg was later deleted from
// dbo.GeneralLedgerEntry directly (that table has no row-level soft-delete
// beyond IsReversed — see removeOrphanedOnAccountExcess.js's comment on
// OnAccountLedger having the same gap) rather than the pair being reversed
// together as a unit.
//
// A REVERSED lone leg has no live financial effect (Trial Balance/Balance
// Sheet only ever read IsReversed=0), but is still a broken audit trail. A
// LIVE lone leg (if any exist) would actually distort a report right now —
// those are called out separately at the end.
//
// Usage: node backend/scripts/diagnoseUnbalancedOnAccountAdjustmentVouchers.js

const { connectDB, getPool, closeDB } = require("../db");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const res = await pool.request().query(`
    SELECT gle.SourceId AS OAId, gle.EntryId, gle.VoucherNo, gle.VoucherDate,
           gle.LHeadId, gle.DebitAmount, gle.CreditAmount, gle.IsReversed,
           gle.CreatedBy, gle.CreatedAt, ah.LHeadName
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.SourceType = 'OnAccountAdjustment'
    ORDER BY gle.SourceId, gle.DebitAmount DESC
  `);

  const byOAId = new Map();
  for (const r of res.recordset) {
    const g = byOAId.get(r.OAId) || { OAId: r.OAId, legs: [] };
    g.legs.push(r);
    byOAId.set(r.OAId, g);
  }

  console.log(`Found ${byOAId.size} distinct OnAccountAdjustment voucher(s) (${res.recordset.length} GL leg(s) total, live + reversed).\n`);

  let unbalancedCount = 0;
  let liveUnbalancedCount = 0;
  const liveUnbalanced = [];

  for (const [oaId, g] of byOAId) {
    const debitSum = g.legs.reduce((s, l) => s + Number(l.DebitAmount), 0);
    const creditSum = g.legs.reduce((s, l) => s + Number(l.CreditAmount), 0);
    const cleanPair = g.legs.length === 2 && Math.abs(debitSum - creditSum) <= 0.01;
    if (cleanPair) continue;

    unbalancedCount++;
    const anyLive = g.legs.some((l) => !l.IsReversed);
    if (anyLive) { liveUnbalancedCount++; liveUnbalanced.push(oaId); }

    const first = g.legs[0];
    console.log(
      `${anyLive ? "🔴 LIVE" : "⚪"} OAId ${oaId} — ${first.VoucherNo} — ${g.legs.length} leg(s), ` +
      `Dr total ₹${fmt(debitSum)} vs Cr total ₹${fmt(creditSum)}:`,
    );
    for (const l of g.legs) {
      const side = Number(l.DebitAmount) > 0 ? `DR ₹${fmt(l.DebitAmount)}` : `CR ₹${fmt(l.CreditAmount)}`;
      console.log(
        `    EntryId ${l.EntryId}  ${side}  ${l.LHeadName || l.LHeadId}  ` +
        `${l.VoucherDate?.toISOString?.().slice(0, 10) ?? l.VoucherDate}  ` +
        `CreatedBy=${l.CreatedBy || "?"}  ${l.IsReversed ? "REVERSED" : "LIVE"}`,
      );
    }
    console.log("");
  }

  console.log(`${unbalancedCount} of ${byOAId.size} voucher(s) are not a clean 2-leg pair.`);
  if (liveUnbalancedCount > 0) {
    console.log(`⚠ ${liveUnbalancedCount} of those have at least one LIVE (non-reversed) leg — these ARE currently affecting Trial Balance/Balance Sheet: OAId ${liveUnbalanced.join(", ")}`);
  } else {
    console.log("None have a live leg — every unbalanced voucher found is fully reversed and has no current financial effect.");
  }
  console.log("\nThis is diagnostic only — nothing was changed.");

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
