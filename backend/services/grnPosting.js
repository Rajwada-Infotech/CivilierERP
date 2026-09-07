// Shared GRN GL-posting computation — used by routes/grns.js's manual
// "Post to GL" action AND scripts/backfillGrnItemGlHeads.js (retroactive
// reclassification of already-posted GRNs once an item gets tagged with
// its own GL Account, or turns out to be an untagged Fixed Asset item).
// Keeping this in one place means the backfill can never drift from what
// a live posting would actually produce.

function parseGRNItems(grnItems) {
  if (Array.isArray(grnItems)) return grnItems;
  if (typeof grnItems === "string" && grnItems.trim())
    return JSON.parse(grnItems);
  return [];
}

/**
 * Computes the (Cost Centre, GL Head) buckets a GRN's received items should
 * post to — base amount debited to the item's own tagged GL Account
 * (Item_Master_Group.M_GLHeadId) when set, "Fixed Assets A/c" for an
 * untagged Fixed Asset item, or the shared "Purchase A/c" otherwise.
 *
 * `grn` must carry { GRNItems, POID }.
 * Returns { buckets: Map<key, {costCenterId, glHeadId, base, gst}>, totalBase, totalGST }.
 */
async function computeGrnPostingBuckets(pool, sql, grn) {
  const rawItems = parseGRNItems(grn.GRNItems);
  const receivedItems = rawItems.filter(
    (it) =>
      Number(it.receivedQty || it.ReceivedQty || 0) > 0 ||
      Number(it.quantity || it.Quantity || 0) > 0 ||
      Number(it.totalAmount || 0) > 0,
  );

  let totalBase = 0,
    totalGST = 0;
  const buckets = new Map(); // key: `${costCenterId}|${glHeadId}` -> { costCenterId, glHeadId, base, gst }

  if (receivedItems.length === 0) return { buckets, totalBase: 0, totalGST: 0 };

  const itemIds = receivedItems.map((it) => String(it.itemId || it.ItemId || "").trim()).filter(Boolean);
  let masterMap = {};
  if (itemIds.length > 0) {
    const mReq = pool.request();
    const ph = itemIds.map((id, i) => { mReq.input(`iid${i}`, sql.NVarChar(100), id); return `@iid${i}`; }).join(",");
    const mRes = await mReq.query(`SELECT CONVERT(NVARCHAR(100),M_Id) AS M_Id, ISNULL(M_CGST,0) AS M_CGST, ISNULL(M_SGST,0) AS M_SGST, M_Type, M_GLHeadId FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100),M_Id) IN (${ph})`);
    for (const row of mRes.recordset) masterMap[row.M_Id] = {
      cgstRate: parseFloat(row.M_CGST) || 0, sgstRate: parseFloat(row.M_SGST) || 0,
      isFixedAsset: row.M_Type === "Fixed Asset", glHeadId: row.M_GLHeadId ?? null,
    };
  }

  // Untagged Fixed Asset items capitalize onto "Fixed Assets A/c" instead
  // of falling into the generic "Purchase A/c".
  const needsFixedAssetHead = Object.values(masterMap).some((m) => m.isFixedAsset && !m.glHeadId);
  let fixedAssetHeadId = null;
  if (needsFixedAssetHead) {
    const faRes = await pool.request().query(`SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadType='GL' AND IsSystemGenerated=1 AND LHeadStatus=1 AND LHeadName = 'Fixed Assets A/c'`);
    fixedAssetHeadId = faRes.recordset[0]?.LHeadId ?? null;
  }

  let itemCostCentreMap = {};
  if (grn.POID && itemIds.length > 0) {
    const ccReq = pool.request().input("POID", sql.Int, grn.POID);
    const ph2 = itemIds.map((id, i) => { ccReq.input(`ccid${i}`, sql.NVarChar(100), id); return `@ccid${i}`; }).join(",");
    const ccRes = await ccReq.query(`
      SELECT CONVERT(NVARCHAR(100), ItemId) AS ItemId, CostCenterId
      FROM dbo.PurchaseOrderItems
      WHERE PurchaseOrderID = @POID AND CONVERT(NVARCHAR(100), ItemId) IN (${ph2})
    `);
    for (const row of ccRes.recordset) itemCostCentreMap[row.ItemId] = row.CostCenterId ?? null;
  }

  for (const it of receivedItems) {
    const itemId = String(it.itemId || it.ItemId || "");
    const receivedQty = Number(it.receivedQty || it.ReceivedQty || 0);
    const rate = Number(it.rate || it.Rate || 0);
    const baseAmount = Number(it.totalAmount) > 0 ? Number(it.totalAmount) : rate * Number(it.quantity || it.Quantity || receivedQty || 0);
    const master = masterMap[itemId] || { cgstRate: 0, sgstRate: 0 };
    const lineGstPct = Number(it.gstPct ?? it.GstPct ?? NaN);
    const totalGSTRate = Number.isFinite(lineGstPct) ? lineGstPct : (master.cgstRate + master.sgstRate);
    const gstAmount = baseAmount * (totalGSTRate / 100);
    totalBase += baseAmount;
    totalGST += gstAmount;

    const costCenterId = itemCostCentreMap[itemId] ?? null;
    const itemMaster = masterMap[itemId];
    const glHeadId = itemMaster?.glHeadId || (itemMaster?.isFixedAsset ? fixedAssetHeadId : null);
    const bucketKey = `${costCenterId ?? "unassigned"}|${glHeadId ?? "default"}`;
    const bucket = buckets.get(bucketKey) ?? { costCenterId, glHeadId, base: 0, gst: 0 };
    bucket.base += baseAmount;
    bucket.gst += gstAmount;
    buckets.set(bucketKey, bucket);
  }

  totalBase = Math.round(totalBase * 100) / 100;
  totalGST = Math.round(totalGST * 100) / 100;
  return { buckets, totalBase, totalGST };
}

/**
 * Turns computeGrnPostingBuckets' buckets into postVoucher-ready legs —
 * same self-balancing base/tax pair construction as before (see
 * routes/grns.js's original inline comment): [bucket's GL Account] Dr
 * (base) = PGRN Cr (base), and Provisional Credit Dr (tax) = [bucket's GL
 * Account] Cr (tax), falling back to Purchase A/c when a bucket has no
 * tagged GL Head.
 */
function buildGrnPostingLines({ buckets, grnNo, purchaseId, pgrnId, provisionalId }) {
  const lines = [];
  for (const { costCenterId, glHeadId, base, gst } of buckets.values()) {
    const roundedBase = Math.round(base * 100) / 100;
    const roundedGst = Math.round(gst * 100) / 100;
    if (roundedBase <= 0) continue;
    const baseHeadId = glHeadId || purchaseId;
    lines.push(
      { LHeadId: baseHeadId, DebitAmount: roundedBase, CreditAmount: 0, Narration: `GRN Posting: ${grnNo} — Goods received (base)`, CostCenterId: costCenterId },
      { LHeadId: pgrnId, DebitAmount: 0, CreditAmount: roundedBase, Narration: `GRN Posting: ${grnNo} — Provision for Pending GRN`, CostCenterId: costCenterId },
    );
    if (roundedGst > 0) {
      lines.push(
        { LHeadId: provisionalId, DebitAmount: roundedGst, CreditAmount: 0, Narration: `GRN Posting: ${grnNo} — Provisional ITC`, CostCenterId: costCenterId },
        { LHeadId: baseHeadId, DebitAmount: 0, CreditAmount: roundedGst, Narration: `GRN Posting: ${grnNo} — Purchase (tax offset)`, CostCenterId: costCenterId },
      );
    }
  }
  return lines;
}

module.exports = { parseGRNItems, computeGrnPostingBuckets, buildGrnPostingLines };
