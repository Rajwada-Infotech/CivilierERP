// One-off read-only check: for a given list of OAId (SourceId), list every
// GeneralLedgerEntry leg regardless of CreatedBy, to confirm each voucher's
// DR+CR pair actually exists and is reversed/live consistently.
const { connectDB, getPool, closeDB } = require("../db");

const OAIDS = [3057, 3052, 3054, 2047, 2058, 1053, 1048, 1043, 1041, 46, 41, 37, 30, 15];

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  await connectDB();
  const pool = getPool();
  const params = OAIDS.map((_, i) => `@id${i}`).join(",");
  const req = pool.request();
  OAIDS.forEach((id, i) => req.input(`id${i}`, id));
  const res = await req.query(`
    SELECT gle.SourceId AS OAId, gle.EntryId, gle.VoucherNo, gle.DebitAmount, gle.CreditAmount,
           gle.IsReversed, gle.CreatedBy, ah.LHeadName
    FROM dbo.GeneralLedgerEntry gle
    LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
    WHERE gle.SourceType = 'OnAccountAdjustment' AND gle.SourceId IN (${params})
    ORDER BY gle.SourceId, gle.DebitAmount DESC
  `);

  const byOAId = new Map();
  for (const r of res.recordset) {
    const g = byOAId.get(r.OAId) || [];
    g.push(r);
    byOAId.set(r.OAId, g);
  }

  for (const oaId of OAIDS) {
    const legs = byOAId.get(oaId) || [];
    console.log(`OAId ${oaId}: ${legs.length} leg(s) total`);
    for (const l of legs) {
      const side = Number(l.DebitAmount) > 0 ? `DR ₹${fmt(l.DebitAmount)}` : `CR ₹${fmt(l.CreditAmount)}`;
      console.log(`    EntryId ${l.EntryId}  ${side}  ${l.LHeadName}  CreatedBy=${l.CreatedBy}  ${l.IsReversed ? "REVERSED" : "LIVE"}`);
    }
    if (legs.length !== 2) console.log(`    ⚠ NOT a clean 2-leg pair`);
  }

  await closeDB();
}
main().catch((e) => { console.error(e); process.exit(1); });
