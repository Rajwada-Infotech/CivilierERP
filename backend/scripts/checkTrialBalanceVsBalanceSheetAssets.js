// Diagnostic: compares Trial Balance's ASSETS-root rollup against Balance
// Sheet's Total Assets figure, for the same as-of date — and, more
// importantly, lists every individual head that lands in one calculation
// but not the other, so a real discrepancy (a head Balance Sheet silently
// drops) is visible even though the two totals are NOT expected to match
// exactly by design (see note below).
//
// IMPORTANT CAVEAT: Trial Balance's "Closing Debit" for the ASSETS group is
// a GROSS figure — the sum of every debit-side posting across all asset
// heads, completely separate from the Closing Credit column (that's what a
// trial balance is: Dr and Cr columns kept apart, not netted per account).
// Balance Sheet's "Total Assets" is a NET figure — each head's
// (debit - credit) summed, with a credit-balance asset showing as a
// negative contribution rather than moving to the credit column. So even
// in a perfectly correct system, TB's ASSETS gross Closing Debit and BS's
// Total Assets will usually NOT be equal — that gap is normal, not a bug,
// UNLESS the "missing heads" list below is non-empty, which means Balance
// Sheet is silently dropping heads Trial Balance still counts.
//
// Usage: node scripts/checkTrialBalanceVsBalanceSheetAssets.js [asOf=YYYY-MM-DD]
const { getPool, sql, connectDB } = require("../db");

const asOf = process.argv[2] || new Date().toISOString().slice(0, 10);

// ── Copied verbatim from backend/routes/financialStatements.js so this
//    script classifies exactly the way the real Balance Sheet route does —
//    a hand-rewritten version would risk diverging from the real logic and
//    proving nothing. ──────────────────────────────────────────────────────
const ROOT_NAMES = { LIABILITIES: "LIABILITIES", ASSETS: "ASSETS", REVENUE: "REVENUE", EXPENSES: "EXPENSES" };
const LOANS_GROUP_NAME = "LOANS AND ADVANCES";

async function resolveRootIds(pool) {
  const res = await pool.request().query(`
    SELECT AGId, Name FROM dbo.AccountGroup
    WHERE Name IN ('LIABILITIES', 'ASSETS', 'REVENUE', 'EXPENSES') AND ParentGroupId IS NULL
  `);
  const byName = new Map(res.recordset.map((r) => [r.Name, Number(r.AGId)]));
  return {
    LIABILITIES: byName.get(ROOT_NAMES.LIABILITIES) ?? null,
    ASSETS: byName.get(ROOT_NAMES.ASSETS) ?? null,
    REVENUE: byName.get(ROOT_NAMES.REVENUE) ?? null,
    EXPENSES: byName.get(ROOT_NAMES.EXPENSES) ?? null,
  };
}
async function resolveLoansGroupId(pool) {
  const res = await pool.request().input("name", sql.NVarChar(200), LOANS_GROUP_NAME)
    .query(`SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Name = @name`);
  return res.recordset[0]?.AGId ?? null;
}
async function loadGroups(pool) {
  const res = await pool.request().query(`
    SELECT AGId,
           LTRIM(CASE WHEN LEFT(ISNULL(Name, CONCAT('Group-', AGId)), 1) = '?'
                      THEN SUBSTRING(ISNULL(Name, CONCAT('Group-', AGId)), 2, 4000)
                      ELSE ISNULL(Name, CONCAT('Group-', AGId)) END) AS Name,
           Code, ParentGroupId
    FROM dbo.AccountGroup
  `);
  const map = new Map();
  for (const g of res.recordset) {
    const id = Number(g.AGId);
    map.set(id, { id, name: g.Name, code: g.Code || null, parentId: g.ParentGroupId != null ? Number(g.ParentGroupId) : null });
  }
  return map;
}
function rootOf(groupMap, groupId, rootIds) {
  let cur = groupMap.get(Number(groupId));
  let hops = 0;
  while (cur && hops < 20) {
    if (Object.values(rootIds).includes(cur.id)) return cur.id;
    if (cur.parentId == null) return null;
    cur = groupMap.get(cur.parentId);
    hops++;
  }
  return null;
}

(async () => {
  await connectDB();
  const pool = getPool();

  const groupMap = await loadGroups(pool);
  const rootIds = await resolveRootIds(pool);
  const loansGroupId = await resolveLoansGroupId(pool);

  // ── 1. Trial Balance's ASSETS-root gross rollup (no LHeadStatus filter,
  //    same query shape as trialBalance.js) ────────────────────────────────
  const tbHeadsRes = await pool.request().input("asOf", sql.Date, asOf).query(`
    SELECT ahm.LHeadId AS id, ahm.LHeadName AS name, ahm.LHeadStatus, ahm.LBelongsTo AS groupId,
           ISNULL((SELECT SUM(gle.DebitAmount) FROM dbo.GeneralLedgerEntry gle
                   WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf), 0)
           + CASE WHEN ahm.LHeadType = 'B' THEN ISNULL(ahm.BankOpeningBalance, 0) ELSE 0 END AS debit,
           ISNULL((SELECT SUM(gle.CreditAmount) FROM dbo.GeneralLedgerEntry gle
                   WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf), 0)
           + CASE WHEN ahm.LHeadType IN ('S','C') THEN ISNULL(ahm.OnAccountBalance, 0) ELSE 0 END AS credit
    FROM dbo.AccountHeadMaster ahm
    WHERE ahm.LBelongsTo IS NOT NULL
  `);

  let tbAssetsClosingDebit = 0, tbAssetsClosingCredit = 0;
  const tbAssetHeadIds = new Set();
  for (const h of tbHeadsRes.recordset) {
    if (rootOf(groupMap, h.groupId, rootIds) !== rootIds.ASSETS) continue;
    tbAssetsClosingDebit += Number(h.debit) || 0;
    tbAssetsClosingCredit += Number(h.credit) || 0;
    tbAssetHeadIds.add(Number(h.id));
  }

  // ── 2. Balance Sheet's Total Assets (exact same query + classification
  //    the real route uses, LHeadStatus=1 filter included) ─────────────────
  const bsHeadsRes = await pool.request().input("asOf", sql.Date, asOf).query(`
    SELECT ahm.LHeadId AS id, ahm.LHeadName AS name, ahm.LHeadCode AS code, ahm.LBelongsTo AS groupId,
           ISNULL((SELECT SUM(gle.DebitAmount) FROM dbo.GeneralLedgerEntry gle
                   WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf), 0)
           + CASE WHEN ahm.LHeadType = 'B' THEN ISNULL(ahm.BankOpeningBalance, 0) ELSE 0 END AS debit,
           ISNULL((SELECT SUM(gle.CreditAmount) FROM dbo.GeneralLedgerEntry gle
                   WHERE gle.LHeadId = ahm.LHeadId AND gle.IsReversed = 0 AND gle.VoucherDate <= @asOf), 0)
           + CASE WHEN ahm.LHeadType IN ('S','C') THEN ISNULL(ahm.OnAccountBalance, 0) ELSE 0 END AS credit
    FROM dbo.AccountHeadMaster ahm
    WHERE ahm.LBelongsTo IS NOT NULL AND ahm.LHeadStatus = 1
  `);

  let bsTotalAssets = 0;
  const bsAssetHeadIds = new Set();
  for (const h of bsHeadsRes.recordset) {
    const net = Math.round(((Number(h.debit) || 0) - (Number(h.credit) || 0)) * 100) / 100;
    if (Math.abs(net) < 0.005) continue;
    let gid = Number(h.groupId);
    let root = rootOf(groupMap, gid, rootIds);
    if (gid === loansGroupId) root = net > 0 ? rootIds.ASSETS : rootIds.LIABILITIES;
    if (h.code === "INCOME-SUMMARY") continue;
    if (root !== rootIds.ASSETS) continue;
    bsTotalAssets = Math.round((bsTotalAssets + net) * 100) / 100;
    bsAssetHeadIds.add(Number(h.id));
  }

  console.log(`As of: ${asOf}\n`);
  console.log(`Trial Balance — ASSETS root gross Closing Debit:  ${tbAssetsClosingDebit.toFixed(2)}`);
  console.log(`Trial Balance — ASSETS root gross Closing Credit: ${tbAssetsClosingCredit.toFixed(2)}`);
  console.log(`Trial Balance — ASSETS root NET (Dr - Cr):        ${(tbAssetsClosingDebit - tbAssetsClosingCredit).toFixed(2)}  <- compare this to Balance Sheet, not the raw gross Closing Debit`);
  console.log(`Balance Sheet — Total Assets:                     ${bsTotalAssets.toFixed(2)}`);
  console.log(`Difference (TB net - BS total):                   ${(tbAssetsClosingDebit - tbAssetsClosingCredit - bsTotalAssets).toFixed(2)}\n`);

  // Heads Trial Balance counts under ASSETS that Balance Sheet's calc
  // dropped entirely (inactive-status filter, orphan group, zero-net skip).
  const missingFromBS = [...tbAssetHeadIds].filter((id) => !bsAssetHeadIds.has(id));
  console.log(`Asset heads Trial Balance counts that Balance Sheet's calc drops entirely: ${missingFromBS.length}`);
  for (const id of missingFromBS) {
    const h = tbHeadsRes.recordset.find((r) => Number(r.id) === id);
    const net = (Number(h.debit) || 0) - (Number(h.credit) || 0);
    if (Math.abs(net) < 0.005) continue; // genuinely zero-balance, correctly skipped by both
    console.log(`  ${h.name} (LHeadId=${id}, LHeadStatus=${h.LHeadStatus}) — Net=${net.toFixed(2)}`);
  }

  // Reverse: heads Balance Sheet counts under Assets that Trial Balance's
  // own ASSETS-root classification does NOT agree are Assets — e.g. the
  // loansGroupId sign-flip reclassifying a LIABILITIES-root head as an
  // Asset because its net balance happens to be positive.
  const extraInBS = [...bsAssetHeadIds].filter((id) => !tbAssetHeadIds.has(id));
  console.log(`\nHeads Balance Sheet counts under Assets that Trial Balance's ASSETS group does not: ${extraInBS.length}`);
  for (const id of extraInBS) {
    const h = bsHeadsRes.recordset.find((r) => Number(r.id) === id);
    const net = (Number(h.debit) || 0) - (Number(h.credit) || 0);
    const gid = Number(h.groupId);
    const grp = groupMap.get(gid);
    const actualRoot = rootOf(groupMap, gid, rootIds);
    const rootName = actualRoot === rootIds.ASSETS ? "ASSETS" : actualRoot === rootIds.LIABILITIES ? "LIABILITIES" : actualRoot === rootIds.REVENUE ? "REVENUE" : actualRoot === rootIds.EXPENSES ? "EXPENSES" : "none/orphan";
    console.log(`  ${h.name} (LHeadId=${id}) — Net=${net.toFixed(2)} — actual group "${grp?.name}" (AGId=${gid}) rolls up to root: ${rootName}${gid === loansGroupId ? " [LOANS AND ADVANCES — sign-flip reclassified]" : ""}`);
  }

  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
