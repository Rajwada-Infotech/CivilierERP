"use strict";

/**
 * backend/services/fixedAssetAutoAlloc.js
 *
 * Auto-allocates a Pending dbo.FixedAssetRecord row for every GRN line item
 * whose Item Master item is tagged M_Type = 'Fixed Asset' — the moment the
 * GRN is approved (goods physically received), regardless of whether the
 * flow that got here was PO→GRN, MR→PO→GRN, or WO→PO→GRN. GRN approval is
 * the one terminal receipt step every material flow funnels through (see
 * postGRNApproval in generalLedger.js), so hooking it once covers every path.
 *
 * The created row is deliberately incomplete: AssetStatus='Pending' signals
 * to the user (via the Fixed Asset Record page) that depreciation category/
 * rate/useful-life/custodian etc. still need to be filled in — this only
 * captures what's known for certain at receipt time (name, cost, qty, date,
 * supplier, company/project).
 */

const { sql } = require("../db");

async function autoCreateFixedAssetsFromGRN(pool, grnId, userEmail) {
  const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
    SELECT grn.GRNID, grn.DocNo, grn.GRNNo, grn.GRNDate, grn.GRNItems,
           grn.SupplierID, grn.GodownID, p.CompanyId, p.ProjectId
    FROM dbo.GoodsReceiptNotes grn
    LEFT JOIN dbo.PurchaseOrders p ON p.PurchaseOrderID = grn.POID
    WHERE grn.GRNID = @GRNID
  `);
  const grn = grnRes.recordset[0];
  if (!grn) return { created: 0 };

  let items = [];
  try {
    items = JSON.parse(grn.GRNItems || "[]");
    if (!Array.isArray(items)) items = [];
  } catch {
    items = [];
  }

  const fixedAssetItemIds = items
    .map((it) => it.itemId)
    .filter((id) => id != null)
    .map(String);
  if (fixedAssetItemIds.length === 0) return { created: 0 };

  const masterReq = pool.request();
  const placeholders = fixedAssetItemIds
    .map((id, i) => {
      masterReq.input(`iid${i}`, sql.NVarChar(100), id);
      return `@iid${i}`;
    })
    .join(",");
  const masterRes = await masterReq.query(`
    SELECT CONVERT(NVARCHAR(100), M_Id) AS M_Id, M_Name, M_Group
    FROM dbo.Item_Master_Group
    WHERE CONVERT(NVARCHAR(100), M_Id) IN (${placeholders}) AND M_Type = 'Fixed Asset'
  `);
  if (!masterRes.recordset.length) return { created: 0 };
  const fixedAssetMasters = new Map(masterRes.recordset.map((r) => [r.M_Id, r]));

  const docNo = grn.DocNo || grn.GRNNo || `GRN-${grnId}`;
  let created = 0;

  for (const item of items) {
    const itemId = item.itemId != null ? String(item.itemId) : null;
    const master = itemId ? fixedAssetMasters.get(itemId) : null;
    if (!master) continue;

    const qty = Number(item.receivedQty) || 0;
    if (qty <= 0) continue;
    const unitRate = Number(item.unitRate ?? item.rate ?? 0);
    const purchaseCost = unitRate * qty || Number(item.totalAmount) || 0;

    // Idempotent — the filtered unique index on (SourceType, SourceId,
    // SourceItemId) rejects a second insert for the same GRN+item, so a
    // retried/re-entrant approval never double-allocates.
    try {
      await pool.request()
        .input("DocDate", sql.Date, grn.GRNDate)
        .input("CompanyId", sql.Int, grn.CompanyId ?? null)
        .input("ProjectId", sql.Int, grn.ProjectId ?? null)
        .input("AssetName", sql.NVarChar(200), master.M_Name || item.itemName || "Fixed Asset")
        .input("AssetCategory", sql.NVarChar(100), master.M_Group || "Uncategorized")
        .input("PurchaseDate", sql.Date, grn.GRNDate)
        .input("PurchaseInvoiceRef", sql.NVarChar(100), docNo)
        .input("SupplierId", sql.Int, grn.SupplierID ?? null)
        .input("PurchaseCost", sql.Decimal(18, 2), purchaseCost)
        .input("Quantity", sql.Decimal(18, 3), qty)
        .input("AssetStatus", sql.NVarChar(30), "Pending")
        .input("Remarks", sql.NVarChar(sql.MAX), `Auto-allocated from GRN ${docNo} on approval — complete depreciation details.`)
        .input("SourceType", sql.NVarChar(20), "GRN")
        .input("SourceId", sql.Int, grnId)
        .input("SourceItemId", sql.NVarChar(100), itemId)
        .input("GodownId", sql.Int, grn.GodownID ?? null)
        .input("CreatedBy", sql.NVarChar(200), userEmail || null)
        .query(`
          INSERT INTO dbo.FixedAssetRecord
            (DocDate, CompanyId, ProjectId, AssetName, AssetCategory,
             PurchaseDate, PurchaseInvoiceRef, SupplierId, PurchaseCost, Quantity,
             AssetStatus, Remarks, SourceType, SourceId, SourceItemId, GodownID, CreatedBy)
          VALUES
            (@DocDate, @CompanyId, @ProjectId, @AssetName, @AssetCategory,
             @PurchaseDate, @PurchaseInvoiceRef, @SupplierId, @PurchaseCost, @Quantity,
             @AssetStatus, @Remarks, @SourceType, @SourceId, @SourceItemId, @GodownId, @CreatedBy)
        `);
      created++;
    } catch (err) {
      // Unique-index violation (2601/2627) = already allocated for this
      // GRN+item — expected on a re-entrant approval, not an error.
      if (err.number !== 2601 && err.number !== 2627) {
        console.error(`[fixedAssetAutoAlloc] failed for GRN ${grnId} item ${itemId}:`, err.message);
      }
    }
  }

  return { created };
}

module.exports = { autoCreateFixedAssetsFromGRN };
