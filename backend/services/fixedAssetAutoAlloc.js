"use strict";

/**
 * backend/services/fixedAssetAutoAlloc.js
 *
 * Auto-allocates a dbo.FixedAssetRecord batch row for every GRN line item
 * whose Item Master item is tagged M_Type = 'Fixed Asset' — the moment the
 * GRN is approved (goods physically received), regardless of whether the
 * flow that got here was PO→GRN, MR→PO→GRN, or WO→PO→GRN. GRN approval is
 * the one terminal receipt step every material flow funnels through (see
 * postGRNApproval in generalLedger.js), so hooking it once covers every path.
 *
 * A GRN quantity > 1 means that many *physical* assets were received (e.g.
 * 5 laptops), not one asset with quantity 5 — so immediately after creating
 * the batch row, this also auto-tags it: one unique FA Item Code per unit,
 * generated the same way FA Inventory's manual "Generate ID" does, so each
 * physical unit is individually selectable (and individually excludable
 * once used) in Fixed Asset Record without anyone visiting FA Inventory by
 * hand. That requires a Project Alias (ID Template Master) and a Financial
 * Year configured for the receipt date — when either is missing, the batch
 * is left AssetStatus='Pending' exactly as before, so it still shows up as
 * untagged stock in Godown-wise Stock and can be tagged manually later.
 */

const { sql } = require("../db");
const { resolveDocTypeId, lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { generateFAItemCodes } = require("./faItemCodeGenerator");

// Financial Year is always derived from the date, never guessed — mirrors
// the same dbo.FinYear range lookup used by FA Inventory's tagging endpoint,
// so a GRN received on a given date and a manual tag on that same date can
// never end up in different Financial Years.
async function deriveFinYear(pool, docDate) {
  if (!docDate) return null;
  const result = await pool.request().input("DocDate", sql.Date, docDate).query(`
    SELECT TOP 1 FName FROM dbo.FinYear
    WHERE @DocDate BETWEEN FStartDate AND FEndDate
    ORDER BY FStartDate DESC
  `);
  return result.recordset[0]?.FName || null;
}

// Tags every unit of a freshly-created Pending batch in one shot, flipping
// it to Active on success. All-or-nothing: any failure rolls back the whole
// batch of codes so the parent row is never left half-tagged — it simply
// stays Pending for manual tagging via FA Inventory instead.
async function autoTagBatch(pool, {
  assetId, itemId, itemName, qty, companyId, projectId, godownId, docDate, sourceDocNo, userEmail,
}) {
  if (!projectId || !godownId) return { tagged: 0 };

  const templateRes = await pool.request().input("ProjectId", sql.Int, projectId).query(`
    SELECT ProjectAlias FROM dbo.IDTemplateMaster WHERE ProjectId = @ProjectId AND IsActive = 1
  `);
  const template = templateRes.recordset[0];
  if (!template) return { tagged: 0 };

  const finYear = await deriveFinYear(pool, docDate);
  if (!finYear) return { tagged: 0 };

  const docTypeId = await resolveDocTypeId(pool, sql, "FAT");
  const tagDocNo = await lockNextDocNumber(pool, sql, {
    docTypeId, finYear, tableName: "FixedAssetTagging", issuedBy: userEmail,
  });

  const codes = await generateFAItemCodes(pool, {
    projectId, projectAlias: template.ProjectAlias, itemId, itemName, finYear, count: qty,
  });

  const tx = pool.transaction();
  await tx.begin();
  try {
    let firstTagId = null;
    for (const code of codes) {
      const insert = await tx.request()
        .input("DocNo",     sql.NVarChar(100), tagDocNo)
        .input("DocDate",   sql.Date,          docDate || null)
        .input("CompanyId", sql.Int,           companyId ?? null)
        .input("ProjectId", sql.Int,           projectId)
        .input("FinYear",   sql.NVarChar(20),  finYear)
        .input("AssetId",   sql.Int,           assetId)
        .input("ItemId",    sql.NVarChar(100), itemId)
        .input("GodownId",  sql.Int,           godownId)
        .input("TaggedQty", sql.Decimal(18,3), 1)
        .input("FAItemCode",sql.NVarChar(200), code)
        .input("Remarks",   sql.NVarChar(sql.MAX), `Auto-tagged on receipt — GRN ${sourceDocNo}`)
        .input("CreatedBy", sql.NVarChar(200), userEmail || null)
        .query(`
          INSERT INTO dbo.FixedAssetTagging
            (DocNo, DocDate, CompanyId, ProjectId, FinYear, AssetId, ItemId, GodownId, TaggedQty, FAItemCode, Remarks, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.TagId
          VALUES
            (@DocNo, @DocDate, @CompanyId, @ProjectId, @FinYear, @AssetId, @ItemId, @GodownId, @TaggedQty, @FAItemCode, @Remarks, 'Tagged', @CreatedBy, SYSDATETIME())
        `);
      if (firstTagId == null) firstTagId = insert.recordset[0].TagId;
    }

    // Every unit in this batch now has its own FA Item Code — flip it from
    // Pending to Active, the same transition full manual tagging causes.
    await tx.request()
      .input("AssetId",        sql.Int,  assetId)
      .input("ActivationDate", sql.Date, docDate || null)
      .input("UpdatedBy",      sql.NVarChar(200), userEmail || null)
      .query(`
        UPDATE dbo.FixedAssetRecord
        SET AssetStatus = 'Active',
            ActivationDate = ISNULL(ActivationDate, @ActivationDate),
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
        WHERE AssetId = @AssetId
      `);

    await tx.commit();
    await backPatchRecordId(pool, sql, tagDocNo, "FixedAssetTagging", firstTagId);
    return { tagged: codes.length };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

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
  let tagged = 0;

  for (const item of items) {
    const itemId = item.itemId != null ? String(item.itemId) : null;
    const master = itemId ? fixedAssetMasters.get(itemId) : null;
    if (!master) continue;

    const qty = Number(item.receivedQty) || 0;
    if (qty <= 0) continue;
    const unitRate = Number(item.unitRate ?? item.rate ?? 0);
    const purchaseCost = unitRate * qty || Number(item.totalAmount) || 0;
    const itemName = master.M_Name || item.itemName || "Fixed Asset";

    // Idempotent — the filtered unique index on (SourceType, SourceId,
    // SourceItemId) rejects a second insert for the same GRN+item, so a
    // retried/re-entrant approval never double-allocates.
    let newAssetId = null;
    try {
      const insertRes = await pool.request()
        .input("DocDate", sql.Date, grn.GRNDate)
        .input("CompanyId", sql.Int, grn.CompanyId ?? null)
        .input("ProjectId", sql.Int, grn.ProjectId ?? null)
        .input("AssetName", sql.NVarChar(200), itemName)
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
          OUTPUT INSERTED.AssetId
          VALUES
            (@DocDate, @CompanyId, @ProjectId, @AssetName, @AssetCategory,
             @PurchaseDate, @PurchaseInvoiceRef, @SupplierId, @PurchaseCost, @Quantity,
             @AssetStatus, @Remarks, @SourceType, @SourceId, @SourceItemId, @GodownId, @CreatedBy)
        `);
      newAssetId = insertRes.recordset[0]?.AssetId;
      created++;
    } catch (err) {
      // Unique-index violation (2601/2627) = already allocated for this
      // GRN+item — expected on a re-entrant approval, not an error.
      if (err.number !== 2601 && err.number !== 2627) {
        console.error(`[fixedAssetAutoAlloc] failed for GRN ${grnId} item ${itemId}:`, err.message);
      }
      continue;
    }

    if (!newAssetId) continue;

    try {
      const result = await autoTagBatch(pool, {
        assetId: newAssetId, itemId, itemName, qty,
        companyId: grn.CompanyId, projectId: grn.ProjectId, godownId: grn.GodownID,
        docDate: grn.GRNDate, sourceDocNo: docNo, userEmail,
      });
      tagged += result.tagged;
    } catch (err) {
      // Non-fatal — the batch stays Pending and shows up as untagged stock
      // in Godown-wise Stock for manual tagging via FA Inventory.
      console.error(`[fixedAssetAutoAlloc] auto-tagging failed for GRN ${grnId} item ${itemId} (asset ${newAssetId} left Pending):`, err.message);
    }
  }

  return { created, tagged };
}

module.exports = { autoCreateFixedAssetsFromGRN };
