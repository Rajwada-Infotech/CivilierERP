// One-off cleanup: hard-deletes the reversed, lone-leg OnAccountAdjustment
// GL rows found by diagnoseUnbalancedOnAccountAdjustmentVouchers.js — every
// one of them is already IsReversed=1 with no live financial effect (its
// partner leg is already gone; postOnAccountAdjustment always writes 2 legs
// together, so these are remnants of an earlier row-level delete, not a
// currently-broken voucher). A genuinely LIVE unbalanced voucher is never
// touched by this script — it only ever deletes rows that are already dead.
//
// Safety checks before any delete:
//   - Row must be SourceType='OnAccountAdjustment' and IsReversed=1.
//   - Row must be the ONLY leg for its SourceId (a real 2-leg reversed pair
//     is left alone — nothing to clean up there).
//   - Row must not be referenced by another row's ReversalOfEntryId (i.e.
//     nothing points at it as "the entry I reversed") — if it is, this
//     script leaves it alone and reports it instead of deleting.
//
// Dry-run by default — prints what it WOULD delete without touching the
// database. Pass --apply to actually delete.
//
// Usage:
//   node backend/scripts/deleteOrphanedOnAccountAdjustmentLegs.js
//   node backend/scripts/deleteOrphanedOnAccountAdjustmentLegs.js --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();

  const res = await pool.request().query(`
    SELECT gle.EntryId, gle.SourceId AS OAId, gle.VoucherNo, gle.VoucherDate, gle.LHeadId,
           gle.DebitAmount, gle.CreditAmount, gle.IsReversed, ah.LHeadName
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.SourceType = 'OnAccountAdjustment'
    ORDER BY gle.SourceId
  `);

  const byOAId = new Map();
  for (const r of res.recordset) {
    const g = byOAId.get(r.OAId) || [];
    g.push(r);
    byOAId.set(r.OAId, g);
  }

  // Candidates: lone reversed legs whose group has exactly 1 row.
  const candidates = [];
  for (const [oaId, legs] of byOAId) {
    if (legs.length === 1 && legs[0].IsReversed) candidates.push(legs[0]);
  }

  if (!candidates.length) {
    console.log("No reversed, lone-leg OnAccountAdjustment rows found — nothing to do.");
    await closeDB();
    return;
  }

  // Guard: skip any candidate another row points at via ReversalOfEntryId.
  const ids = candidates.map((c) => c.EntryId);
  const params = ids.map((_, i) => `@e${i}`).join(",");
  const req = pool.request();
  ids.forEach((id, i) => req.input(`e${i}`, id));
  const referencedRes = await req.query(`
    SELECT DISTINCT ReversalOfEntryId FROM dbo.GeneralLedgerEntry WHERE ReversalOfEntryId IN (${params})
  `);
  const referenced = new Set(referencedRes.recordset.map((r) => r.ReversalOfEntryId));

  const toDelete = candidates.filter((c) => !referenced.has(c.EntryId));
  const skipped = candidates.filter((c) => referenced.has(c.EntryId));

  console.log(`${candidates.length} candidate(s) found; ${toDelete.length} safe to delete, ${skipped.length} skipped (referenced by another row's ReversalOfEntryId).\n`);

  for (const c of toDelete) {
    const side = Number(c.DebitAmount) > 0 ? `DR ₹${fmt(c.DebitAmount)}` : `CR ₹${fmt(c.CreditAmount)}`;
    console.log(`${APPLY ? "DELETING" : "WOULD DELETE"}: EntryId ${c.EntryId}  OAId ${c.OAId}  ${c.VoucherNo}  ${side}  ${c.LHeadName || c.LHeadId}  ${c.VoucherDate?.toISOString?.().slice(0, 10) ?? c.VoucherDate}`);
  }
  for (const c of skipped) {
    console.log(`SKIPPED (referenced): EntryId ${c.EntryId}  OAId ${c.OAId}  ${c.VoucherNo}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to actually delete the rows listed above.");
    await closeDB();
    return;
  }

  for (const c of toDelete) {
    await pool.request().input("id", sql.Int, c.EntryId).query(`DELETE FROM dbo.GeneralLedgerEntry WHERE EntryId = @id`);
  }
  console.log(`\nDeleted ${toDelete.length} row(s).`);

  await closeDB();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
