// Resolves the GL Account an Item Master item should actually post to —
// the single place the "item's tagged GL Account substitutes the generic
// Purchase A/c" rule lives. Used by GRN posting (services/grnPosting.js),
// PO/WO-sourced invoice posting (routes/expenseBooking.js) that has no
// per-invoice Expense Head allocation to work from, and their shared
// backfill (scripts/backfillItemGlHeads.js) — one definition, so a live
// posting and a historical backfill can never compute a different answer
// for the same item.
//
// Rule: an item tagged with its own GL Account (Item_Master_Group.
// M_GLHeadId, migration 295) posts there. An untagged item whose Type is
// 'Fixed Asset' capitalizes onto the "Fixed Assets A/c" ledger instead of
// expensing to Purchase A/c. Everything else falls back to the caller's
// own "Purchase A/c" id.

let fixedAssetHeadIdCache = null;

async function getFixedAssetHeadId(pool) {
  if (fixedAssetHeadIdCache) return fixedAssetHeadIdCache;
  const res = await pool.request().query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1 AND LHeadName = 'Fixed Assets A/c'`);
  fixedAssetHeadIdCache = res.recordset[0]?.LHeadId ?? null;
  return fixedAssetHeadIdCache;
}

/**
 * Returns Map<itemId (string), { glHeadId: number|null, isFixedAsset: bool,
 * cgstRate, sgstRate }> for the given item ids. `glHeadId` already resolves
 * the Fixed Asset fallback — a caller only needs `glHeadId || purchaseId`.
 */
async function resolveItemGlHeads(pool, sql, itemIds) {
  const map = new Map();
  const ids = [...new Set(itemIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return map;

  const req = pool.request();
  const ph = ids.map((id, i) => { req.input(`iid${i}`, sql.NVarChar(100), id); return `@iid${i}`; }).join(",");
  const res = await req.query(`SELECT CONVERT(NVARCHAR(100), M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST, M_Type, M_GLHeadId FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100), M_Id) IN (${ph})`);

  const needsFixedAssetHead = res.recordset.some((r) => r.M_Type === "Fixed Asset" && !r.M_GLHeadId);
  const fixedAssetHeadId = needsFixedAssetHead ? await getFixedAssetHeadId(pool) : null;

  for (const r of res.recordset) {
    const isFixedAsset = r.M_Type === "Fixed Asset";
    map.set(r.M_Id, {
      glHeadId: r.M_GLHeadId || (isFixedAsset ? fixedAssetHeadId : null),
      isFixedAsset,
      cgstRate: parseFloat(r.M_CGST) || 0,
      sgstRate: parseFloat(r.M_SGST) || 0,
    });
  }
  return map;
}

module.exports = { resolveItemGlHeads, getFixedAssetHeadId };
