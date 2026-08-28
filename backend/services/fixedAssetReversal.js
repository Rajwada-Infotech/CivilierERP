"use strict";

/**
 * backend/services/fixedAssetReversal.js
 *
 * "Delete & Reverse" for a GRN- or Inventory-Import-sourced Fixed Asset
 * batch — a distinct, more destructive action from Fixed Asset Record's
 * normal soft-delete (see routes/fixedAssets.js DELETE /:id, which
 * deliberately leaves the GRN/tagging alone so the FA Item Code can be
 * re-picked without a fresh receipt).
 *
 * A "batch" is the dbo.FixedAssetRecord row auto-created the moment a
 * Fixed-Asset-category item is received — via GRN approval
 * (services/fixedAssetAutoAlloc.js) or via Inventory Import
 * (routes/fixedAssetInventoryImport.js) — identified by having
 * SourceType/SourceId/SourceItemId all set. Reversing one:
 *   1. hard-deletes every "unit" FixedAssetRecord (SourceTagId set) created
 *      by completing one of the batch's FA Item Codes,
 *   2. hard-deletes the batch's dbo.FixedAssetTagging rows (frees the FA
 *      Item Codes' number range is untouched — see faItemCodeGenerator.js,
 *      whose counter never rewinds, so a fresh code is never reissued),
 *   3. hard-deletes the batch row itself,
 *   4. removes only THIS item's StockLedger rows from the source
 *      GRN/Import — other items on the same GRN, and every other asset,
 *      are untouched — and only hard-deletes the GRN header itself once no
 *      StockLedger rows remain on it at all (Import headers are soft-
 *      reversed instead, since there is no other audit anchor for them).
 *
 * Blocked (never reversed silently) when any affected unit:
 *   - has User-Wise Asset Transfer history (would orphan that audit trail)
 *   - is Sold/Scrapped (would discard a recorded financial outcome)
 *   - traces to a GRN with a live (non-Deleted/Draft) Expense Booking
 *
 * Every check re-runs inside the transaction under UPDLOCK/HOLDLOCK right
 * before the writes — buildReversalPlan() is for surfacing a preview/
 * confirmation to the user, not something executeReversal() trusts blindly.
 */

const { sql } = require("../db");
const { bumpCacheVersion } = require("../redis");
// Reused rather than re-implemented — same PO-status-revert logic the
// existing GRN DELETE endpoint runs after removing a GRN's last stock.
const { syncPOItemReceivedQty } = require("../routes/grns");

const DISPOSED_STATUSES = ["Sold", "Scrapped"];

// Any FixedAssetRecord.AssetId — a batch row, or a completed "unit" row
// created from one of that batch's FA Item Codes — resolves to the batch's
// own AssetId, since that's the row carrying the GRN/Import linkage.
async function resolveBatchAssetId(pool, assetId) {
  const res = await pool.request().input("AssetId", sql.Int, assetId).query(`
    SELECT AssetId, SourceType, SourceId, SourceItemId, SourceTagId
    FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId
  `);
  const row = res.recordset[0];
  if (!row) return null;
  if (row.SourceType && row.SourceId && row.SourceItemId) return row.AssetId;
  if (row.SourceTagId) {
    const tagRes = await pool.request().input("TagId", sql.Int, row.SourceTagId)
      .query(`SELECT AssetId FROM dbo.FixedAssetTagging WHERE TagId = @TagId`);
    return tagRes.recordset[0]?.AssetId ?? null;
  }
  return null;
}

async function findBlockers(requester, batch, unitRows) {
  const blockers = [];
  const disposed = unitRows.filter((u) => DISPOSED_STATUSES.includes(u.AssetStatus));
  if (DISPOSED_STATUSES.includes(batch.AssetStatus)) disposed.push(batch);
  if (disposed.length) {
    blockers.push({
      reason: "disposed",
      message: "One or more units from this batch are Sold or Scrapped — reversing would discard that recorded financial outcome.",
      assetIds: disposed.map((d) => d.AssetId),
    });
  }

  const allIds = [batch.AssetId, ...unitRows.map((u) => u.AssetId)];
  const req = requester();
  const ph = allIds.map((id, i) => { req.input(`a${i}`, sql.Int, id); return `@a${i}`; }).join(",");
  const transferRes = await req.query(`SELECT DISTINCT AssetId FROM dbo.AssetTransferHistory WHERE AssetId IN (${ph})`);
  if (transferRes.recordset.length) {
    blockers.push({
      reason: "transferred",
      message: "One or more units from this batch have User-Wise Asset Transfer history — reversing would orphan that audit trail.",
      assetIds: transferRes.recordset.map((r) => r.AssetId),
    });
  }

  return blockers;
}

// Read-only preview for the confirmation dialog — safe to call outside a
// transaction, never mutates anything.
async function buildReversalPlan(pool, assetId) {
  const batchAssetId = await resolveBatchAssetId(pool, assetId);
  if (batchAssetId == null) {
    return { reversible: false, reason: "not_source_linked",
      message: "This asset wasn't created from a GRN or Inventory Import — use the normal Delete instead." };
  }

  const batchRes = await pool.request().input("AssetId", sql.Int, batchAssetId).query(`
    SELECT AssetId, AssetName, AssetStatus, Status, SourceType, SourceId, SourceItemId
    FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId
  `);
  const batch = batchRes.recordset[0];
  if (!batch || batch.Status === "Deleted") {
    return { reversible: false, reason: "already_deleted", message: "This asset has already been deleted." };
  }

  const tagsRes = await pool.request().input("AssetId", sql.Int, batchAssetId).query(`
    SELECT TagId, FAItemCode FROM dbo.FixedAssetTagging WHERE AssetId = @AssetId AND Status = 'Tagged'
  `);
  const tagIds = tagsRes.recordset.map((t) => t.TagId);

  let units = [];
  if (tagIds.length) {
    const req = pool.request();
    const ph = tagIds.map((id, i) => { req.input(`t${i}`, sql.Int, id); return `@t${i}`; }).join(",");
    const unitsRes = await req.query(`
      SELECT AssetId, AssetName, AssetStatus, FAItemCode
      FROM dbo.FixedAssetRecord
      WHERE SourceTagId IN (${ph}) AND Status <> 'Deleted'
    `);
    units = unitsRes.recordset;
  }

  const blockers = await findBlockers(() => pool.request(), batch, units);
  if (blockers.length) {
    return { reversible: false, reason: blockers[0].reason, message: blockers[0].message, blockedAssetIds: blockers[0].assetIds };
  }

  let grnDocNo = null;
  if (batch.SourceType === "GRN") {
    const grnId = batch.SourceId;
    const expCheck = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT COUNT(*) AS cnt FROM dbo.ExpenseBooking
      WHERE ESourceType = 'GRN' AND ESourceId = @GRNID AND ISNULL(EStatus, '') NOT IN ('Deleted', 'Draft')
    `);
    if (Number(expCheck.recordset[0]?.cnt) > 0) {
      return { reversible: false, reason: "has_expense",
        message: "This item's GRN has a linked Expense Booking — delete/reverse that first, then retry." };
    }
    const grnRes = await pool.request().input("GRNID", sql.Int, grnId).query(`
      SELECT DocNo, GRNNo FROM dbo.GoodsReceiptNotes WHERE GRNID = @GRNID
    `);
    const grn = grnRes.recordset[0];
    if (!grn) {
      return { reversible: false, reason: "grn_missing",
        message: "The originating GRN no longer exists — this asset can't be reversed through this action." };
    }
    grnDocNo = grn.DocNo || grn.GRNNo || null;
  }

  return {
    reversible: true,
    sourceType: batch.SourceType,
    sourceId: batch.SourceId,
    batchAssetId: batch.AssetId,
    batchAssetName: batch.AssetName,
    grnDocNo,
    unitCount: units.length,
    taggedCount: tagIds.length,
    units: units.map((u) => ({ assetId: u.AssetId, assetName: u.AssetName, faItemCode: u.FAItemCode })),
  };
}

// The real, transactional reversal — re-validates everything itself under
// row locks rather than trusting a previously-computed plan.
async function executeReversal(pool, assetId, email) {
  const batchAssetId = await resolveBatchAssetId(pool, assetId);
  if (batchAssetId == null) {
    const err = new Error("This asset wasn't created from a GRN or Inventory Import — use the normal Delete instead.");
    err.code = "NOT_SOURCE_LINKED";
    throw err;
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    const batchRes = await tx.request().input("AssetId", sql.Int, batchAssetId).query(`
      SELECT AssetId, AssetName, AssetStatus, Status, SourceType, SourceId, SourceItemId
      FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
      WHERE AssetId = @AssetId
    `);
    const batch = batchRes.recordset[0];
    if (!batch || batch.Status === "Deleted") {
      const err = new Error("This asset has already been deleted.");
      err.code = "ALREADY_DELETED";
      throw err;
    }

    const tagsRes = await tx.request().input("AssetId", sql.Int, batchAssetId).query(`
      SELECT TagId FROM dbo.FixedAssetTagging WITH (UPDLOCK, HOLDLOCK) WHERE AssetId = @AssetId AND Status = 'Tagged'
    `);
    const tagIds = tagsRes.recordset.map((t) => t.TagId);

    let units = [];
    if (tagIds.length) {
      const req = tx.request();
      const ph = tagIds.map((id, i) => { req.input(`t${i}`, sql.Int, id); return `@t${i}`; }).join(",");
      const unitsRes = await req.query(`
        SELECT AssetId, AssetStatus FROM dbo.FixedAssetRecord WITH (UPDLOCK, HOLDLOCK)
        WHERE SourceTagId IN (${ph}) AND Status <> 'Deleted'
      `);
      units = unitsRes.recordset;
    }

    const blockers = await findBlockers(() => tx.request(), batch, units);
    if (blockers.length) {
      const err = new Error(blockers[0].message);
      err.code = "BLOCKED";
      err.reason = blockers[0].reason;
      throw err;
    }

    let grnDeleted = false;
    let linkedPOId = null;

    if (batch.SourceType === "GRN") {
      const grnId = batch.SourceId;
      const expCheck = await tx.request().input("GRNID", sql.Int, grnId).query(`
        SELECT COUNT(*) AS cnt FROM dbo.ExpenseBooking
        WHERE ESourceType = 'GRN' AND ESourceId = @GRNID AND ISNULL(EStatus, '') NOT IN ('Deleted', 'Draft')
      `);
      if (Number(expCheck.recordset[0]?.cnt) > 0) {
        const err = new Error("This item's GRN has a linked Expense Booking — can't reverse.");
        err.code = "BLOCKED";
        err.reason = "has_expense";
        throw err;
      }

      const grnMeta = await tx.request().input("GRNID", sql.Int, grnId)
        .query(`SELECT POID FROM dbo.GoodsReceiptNotes WITH (UPDLOCK, HOLDLOCK) WHERE GRNID = @GRNID`);
      if (!grnMeta.recordset.length) {
        const err = new Error("The originating GRN no longer exists.");
        err.code = "GRN_MISSING";
        throw err;
      }
      linkedPOId = grnMeta.recordset[0]?.POID ?? null;

      // Only this item's stock is reversed — other items on the same GRN
      // (or any other GRN) are never touched.
      await tx.request()
        .input("GRNID", sql.Int, grnId)
        .input("ItemId", sql.NVarChar(100), batch.SourceItemId)
        .query(`DELETE FROM StockLedger WHERE RefType = 'GRN' AND RefID = @GRNID AND ItemID = @ItemId`);

      const remaining = await tx.request().input("GRNID", sql.Int, grnId).query(`
        SELECT COUNT(*) AS cnt FROM StockLedger WHERE RefType = 'GRN' AND RefID = @GRNID
      `);
      if (Number(remaining.recordset[0]?.cnt) === 0) {
        await tx.request().input("GRNID", sql.Int, grnId).query(`DELETE FROM GoodsReceiptNotes WHERE GRNID = @GRNID`);
        grnDeleted = true;
      }
    } else if (batch.SourceType === "IMPORT") {
      await tx.request()
        .input("ImportId", sql.Int, batch.SourceId)
        .query(`DELETE FROM StockLedger WHERE RefType = 'FA_IMPORT' AND RefID = @ImportId`);
      await tx.request()
        .input("ImportId", sql.Int, batch.SourceId)
        .input("ReversedBy", sql.NVarChar(200), email)
        .query(`
          UPDATE dbo.FixedAssetInventoryImport
          SET Status = 'Reversed', ReversedBy = @ReversedBy, ReversedAt = SYSDATETIME()
          WHERE ImportId = @ImportId
        `);
    } else {
      const err = new Error("This asset wasn't created from a GRN or Inventory Import — use the normal Delete instead.");
      err.code = "NOT_SOURCE_LINKED";
      throw err;
    }

    const unitAssetIds = units.map((u) => u.AssetId);
    if (unitAssetIds.length) {
      const req = tx.request();
      const ph = unitAssetIds.map((id, i) => { req.input(`u${i}`, sql.Int, id); return `@u${i}`; }).join(",");
      await req.query(`DELETE FROM dbo.FixedAssetRecord WHERE AssetId IN (${ph})`);
    }
    if (tagIds.length) {
      const req = tx.request();
      const ph = tagIds.map((id, i) => { req.input(`g${i}`, sql.Int, id); return `@g${i}`; }).join(",");
      await req.query(`DELETE FROM dbo.FixedAssetTagging WHERE TagId IN (${ph})`);
    }
    await tx.request().input("AssetId", sql.Int, batch.AssetId)
      .query(`DELETE FROM dbo.FixedAssetRecord WHERE AssetId = @AssetId`);

    await tx.commit();

    await bumpCacheVersion("fixed-assets");
    await bumpCacheVersion("fixed-asset-tagging");
    if (batch.SourceType === "GRN") {
      await bumpCacheVersion("grns");
      await bumpCacheVersion("stock-ledger");
    } else if (batch.SourceType === "IMPORT") {
      await bumpCacheVersion("fixed-asset-inventory-import");
    }

    // Same PO-status-revert the existing GRN DELETE endpoint runs — only
    // relevant when this reversal just hard-deleted the GRN header.
    if (grnDeleted && linkedPOId) {
      try {
        const poRecheck = await pool.request().input("POID", sql.Int, linkedPOId).query(`
          SELECT po.Status AS POStatus, po.TotalAmount AS POTotalAmount,
                 ISNULL(SUM(grn.TotalAmount), 0) AS TotalReceived,
                 COUNT(grn.GRNID) AS GRNCount
          FROM dbo.PurchaseOrders po
          LEFT JOIN dbo.GoodsReceiptNotes grn
            ON grn.POID = po.PurchaseOrderID AND ISNULL(grn.Status, '') != 'Rejected'
          WHERE po.PurchaseOrderID = @POID
          GROUP BY po.Status, po.TotalAmount
        `);
        if (poRecheck.recordset.length > 0) {
          const poRow = poRecheck.recordset[0];
          const totalOrdered = Number(poRow.POTotalAmount || 0);
          const totalReceived = Number(poRow.TotalReceived || 0);
          const grnCount = Number(poRow.GRNCount || 0);
          const shouldRevert = poRow.POStatus === "Received" && (grnCount === 0 || totalReceived < totalOrdered);
          if (shouldRevert) {
            await pool.request().input("POID", sql.Int, linkedPOId).query(`
              UPDATE dbo.PurchaseOrders SET Status = 'Approved', UpdatedAt = GETDATE()
              WHERE PurchaseOrderID = @POID AND Status = 'Received'
            `);
            await bumpCacheVersion("purchase-orders");
          }
        }
        await syncPOItemReceivedQty(pool, sql, linkedPOId);
      } catch (poErr) {
        console.error("[fixedAssetReversal] PO status revert failed (non-fatal):", poErr.message);
      }
    }

    return {
      sourceType: batch.SourceType,
      sourceId: batch.SourceId,
      grnDeleted,
      linkedPOId,
      unitsRemoved: unitAssetIds.length,
      tagsRemoved: tagIds.length,
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

module.exports = { resolveBatchAssetId, buildReversalPlan, executeReversal };
