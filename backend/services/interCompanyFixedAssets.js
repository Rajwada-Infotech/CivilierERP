"use strict";

/**
 * backend/services/interCompanyFixedAssets.js
 *
 * Fixed Asset items moved through an Inter-Company Stock Transfer
 * (routes/interCompanyTransfer.js).
 *
 * Ordinary stock only changes godown; a Fixed Asset unit is an individually
 * tracked thing — its own FA Item Code (dbo.FixedAssetTagging) and its own
 * depreciation (dbo.FixedAssetRecord). So the transfer must say WHICH units
 * move, and approving it has to retire them on the sending side and bring them
 * in as brand-new assets on the receiving side:
 *
 *   sending company / project
 *     - every moved FA Code → Status 'Transferred' (no longer an active code —
 *       every picker already requires Status = 'Tagged')
 *     - the Fixed Asset Record built from it (if any) → AssetStatus
 *       'Transferred' with TransferredAt = the transfer date, which the
 *       depreciation engine reads to stop charging from that month on
 *     - nothing is deleted: the old rows stay for history and reference only
 *   receiving company / project
 *     - a fresh FA Inventory batch (dbo.FixedAssetRecord, SourceType 'ICT')
 *     - brand-new FA Item Codes from the receiving project's own FA Code
 *       template (the old code is never reused)
 *     - NO depreciation setup — the receiving side configures its own when it
 *       creates the Fixed Asset Record, and depreciates independently
 *
 * Which units are moving is stored in dbo.InterCompanyTransferAssets from the
 * moment the transfer is raised, so the same code can't be promised to two
 * transfers at once.
 */

const { sql } = require("../db");
const { autoTagBatch, deriveFinYear } = require("./fixedAssetAutoAlloc");

const FA_TYPE = "Fixed Asset";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Subset of the given Item Master ids whose M_Type is 'Fixed Asset'. */
async function faItemIdSet(pool, itemIds) {
  const ids = [...new Set(itemIds.filter((i) => i != null).map(String))];
  if (!ids.length) return new Set();
  const req = pool.request();
  const ph = ids.map((id, i) => { req.input(`i${i}`, sql.NVarChar(100), id); return `@i${i}`; }).join(",");
  const r = await req.query(`
    SELECT CONVERT(NVARCHAR(100), M_Id) AS M_Id
    FROM dbo.Item_Master_Group
    WHERE CONVERT(NVARCHAR(100), M_Id) IN (${ph}) AND M_Type = '${FA_TYPE}'
  `);
  return new Set(r.recordset.map((x) => x.M_Id));
}

/**
 * FA Item Codes of `itemId` that can still be put on a transfer out of
 * `projectId`: active (Tagged), in that project, and not already promised to
 * another live transfer. `excludeIctId` lets an edit/re-check ignore the
 * transfer's own reservation.
 */
async function listTransferableTags(pool, { projectId, itemId, excludeIctId = null }) {
  const r = await pool.request()
    .input("ProjectId", sql.Int, projectId)
    .input("ItemId", sql.NVarChar(100), String(itemId))
    .input("Exclude", sql.Int, excludeIctId)
    .query(`
      SELECT t.TagId, t.FAItemCode, t.ItemId, t.GodownID AS GodownId,
             fr.AssetId AS RecordAssetId, fr.DocNo AS RecordDocNo, fr.Custodian,
             fr.DepreciationType, fr.DepreciationRate
      FROM dbo.FixedAssetTagging t
      OUTER APPLY (
        SELECT TOP 1 f.AssetId, f.DocNo, f.Custodian, f.DepreciationType, f.DepreciationRate
        FROM dbo.FixedAssetRecord f
        WHERE f.SourceTagId = t.TagId AND f.Status <> 'Deleted'
      ) fr
      WHERE t.Status = 'Tagged' AND t.FAItemCode IS NOT NULL
        AND t.ProjectId = @ProjectId AND t.ItemId = @ItemId
        AND NOT EXISTS (
          SELECT 1 FROM dbo.InterCompanyTransferAssets a
          JOIN dbo.InterCompanyTransfer i ON i.ICTId = a.ICTId
          WHERE a.TagId = t.TagId AND i.Status <> 'Rejected'
            AND (@Exclude IS NULL OR a.ICTId <> @Exclude)
        )
      ORDER BY t.FAItemCode
    `);
  return r.recordset;
}

/**
 * Validates the FA Item Codes picked on each Fixed Asset line and returns them
 * per line index. Throws a 400 naming the problem. Non-Fixed-Asset lines are
 * left alone (and may not carry codes).
 *
 * `items` are the priced lines: { itemId, itemName, qty, faTagIds? }.
 */
async function resolveFaSelection(pool, { senderProjectId, items, excludeIctId = null }) {
  const faIds = await faItemIdSet(pool, items.map((i) => i.itemId));
  const byLine = new Map();
  const seen = new Set();

  for (const [idx, item] of items.entries()) {
    const picked = Array.isArray(item.faTagIds) ? item.faTagIds.map((n) => parseInt(n, 10)).filter(Number.isFinite) : [];
    const isFa = faIds.has(String(item.itemId));
    const label = item.itemName || item.itemId;

    if (!isFa) {
      if (picked.length) throw httpError(400, `${label} is not a Fixed Asset item — FA Item Codes can't be attached to it.`);
      continue;
    }
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw httpError(400, `${label} is a Fixed Asset — transfer a whole number of units (one FA Item Code each).`);
    }
    if (picked.length !== item.qty) {
      throw httpError(
        400,
        `${label} is a Fixed Asset: select the exact FA Item Code of each unit being transferred — ${item.qty} required, ${picked.length} selected.`,
      );
    }
    if (new Set(picked).size !== picked.length) throw httpError(400, `${label}: the same FA Item Code is selected twice.`);
    for (const id of picked) {
      if (seen.has(id)) throw httpError(400, `An FA Item Code on ${label} is also selected on another line of this transfer.`);
      seen.add(id);
    }

    const free = await listTransferableTags(pool, { projectId: senderProjectId, itemId: item.itemId, excludeIctId });
    const freeById = new Map(free.map((t) => [t.TagId, t]));
    const tags = [];
    for (const id of picked) {
      const t = freeById.get(id);
      if (!t) {
        throw httpError(
          409,
          `FA Item Code #${id} on ${label} isn't available to transfer — it must be an active code of the sending project and not already on another transfer.`,
        );
      }
      tags.push(t);
    }
    byLine.set(idx, tags);
  }
  return byLine;
}

/** Records which codes a transfer line moves (inside the caller's transaction). */
async function saveIctAssets(tx, { ictId, ictItemId, itemId, tags }) {
  for (const t of tags) {
    await tx.request()
      .input("ICTId", sql.Int, ictId)
      .input("ICTItemId", sql.Int, ictItemId)
      .input("ItemId", sql.NVarChar(100), String(itemId))
      .input("TagId", sql.Int, t.TagId)
      .input("Code", sql.NVarChar(200), t.FAItemCode)
      .query(`
        INSERT INTO dbo.InterCompanyTransferAssets (ICTId, ICTItemId, ItemId, TagId, FAItemCode)
        VALUES (@ICTId, @ICTItemId, @ItemId, @TagId, @Code)
      `);
  }
}

/** The codes a transfer moves, with where each one ended up (for display). */
async function loadIctAssets(pool, ictId) {
  const r = await pool.request().input("ICTId", sql.Int, ictId).query(`
    SELECT a.ICTAssetId, a.ICTItemId, a.ItemId, a.TagId, a.FAItemCode,
           t.Status AS TagStatus, t.TransferredAt, t.TransferredToCode
    FROM dbo.InterCompanyTransferAssets a
    LEFT JOIN dbo.FixedAssetTagging t ON t.TagId = a.TagId
    WHERE a.ICTId = @ICTId
    ORDER BY a.ICTAssetId
  `);
  return r.recordset;
}

/** Throws a 409 if any code on this transfer can no longer be moved. Safe to
 *  call again on a retry: codes this very transfer already moved are fine. */
async function assertFaReady(pool, ictId) {
  const rows = await loadIctAssets(pool, ictId);
  for (const a of rows) {
    if (a.TagStatus === "Tagged") continue;
    if (a.TagStatus === "Transferred") {
      const own = await pool.request().input("Tag", sql.Int, a.TagId).input("Ict", sql.Int, ictId)
        .query("SELECT 1 AS ok FROM dbo.FixedAssetTagging WHERE TagId = @Tag AND TransferICTId = @Ict");
      if (own.recordset.length) continue;
    }
    throw httpError(409, `FA Item Code ${a.FAItemCode} is no longer available to transfer (it is ${a.TagStatus || "missing"}). Edit or recreate the transfer.`);
  }
}

/**
 * Carries out the Fixed Asset side of an approved transfer. Idempotent: a
 * retry after a partial failure only does what's left.
 *
 *   receiver: { CompanyId, ProjectId }   receiverGodown: { GodownID }
 */
async function executeFaTransfer(pool, { ictId, docNo, transferDate, receiver, receiverGodown, userEmail }) {
  const all = await pool.request().input("ICTId", sql.Int, ictId).query(`
    SELECT a.ICTAssetId, a.ICTItemId, a.ItemId, a.TagId, a.FAItemCode,
           t.Status AS TagStatus, t.TransferICTId,
           ti.Amount, ti.ItemName
    FROM dbo.InterCompanyTransferAssets a
    JOIN dbo.FixedAssetTagging t ON t.TagId = a.TagId
    LEFT JOIN dbo.InterCompanyTransferItems ti ON ti.ICTItemId = a.ICTItemId
    WHERE a.ICTId = @ICTId
    ORDER BY a.ICTAssetId
  `);
  if (!all.recordset.length) return { transferred: 0, newCodes: [] };

  // Codes already retired by THIS transfer (a retry) are skipped.
  const todo = all.recordset.filter((a) => !(a.TagStatus === "Transferred" && Number(a.TransferICTId) === Number(ictId)));
  for (const a of todo) {
    if (a.TagStatus !== "Tagged") throw httpError(409, `FA Item Code ${a.FAItemCode} is no longer available to transfer.`);
  }
  if (!todo.length) return { transferred: 0, newCodes: [] };

  const finYear = await deriveFinYear(pool, transferDate);
  const newCodes = [];

  // One fresh batch per item (the batch table is unique on source + item).
  const byItem = new Map();
  for (const a of todo) {
    if (!byItem.has(a.ItemId)) byItem.set(a.ItemId, []);
    byItem.get(a.ItemId).push(a);
  }

  for (const [itemId, units] of byItem) {
    const master = (await pool.request().input("Id", sql.NVarChar(100), String(itemId)).query(`
      SELECT M_Name, M_Group FROM dbo.Item_Master_Group WHERE CONVERT(NVARCHAR(100), M_Id) = @Id
    `)).recordset[0] || {};
    const itemName = master.M_Name || units[0].ItemName || "Fixed Asset";

    // Value brought in = what the transfer priced these units at (excl. GST),
    // counted once per transfer line even if several of its units are here.
    const lineAmounts = new Map(units.map((u) => [u.ICTItemId, Number(u.Amount) || 0]));
    const purchaseCost = [...lineAmounts.values()].reduce((s, n) => s + n, 0);

    // Reuse the batch if a previous attempt already created it.
    let batch = (await pool.request()
      .input("Ict", sql.Int, ictId).input("Item", sql.NVarChar(100), String(itemId))
      .query(`SELECT AssetId FROM dbo.FixedAssetRecord WHERE SourceType = 'ICT' AND SourceId = @Ict AND SourceItemId = @Item`))
      .recordset[0];

    if (!batch) {
      const oldCodes = units.map((u) => u.FAItemCode).join(", ");
      const ins = await pool.request()
        .input("DocDate", sql.Date, transferDate)
        .input("CompanyId", sql.Int, receiver.CompanyId ?? null)
        .input("ProjectId", sql.Int, receiver.ProjectId ?? null)
        .input("FinYear", sql.NVarChar(20), finYear)
        .input("AssetName", sql.NVarChar(200), itemName)
        .input("AssetCategory", sql.NVarChar(100), master.M_Group || "Uncategorized")
        .input("PurchaseDate", sql.Date, transferDate)
        .input("PurchaseInvoiceRef", sql.NVarChar(100), docNo)
        .input("PurchaseCost", sql.Decimal(18, 2), purchaseCost)
        .input("Quantity", sql.Decimal(18, 3), units.length)
        .input("Remarks", sql.NVarChar(sql.MAX),
          `Received through Inter-Company Transfer ${docNo} — previously ${oldCodes} (now Transferred). Configure this company's depreciation on the Fixed Asset Record.`)
        .input("SourceId", sql.Int, ictId)
        .input("SourceItemId", sql.NVarChar(100), String(itemId))
        .input("GodownId", sql.Int, receiverGodown?.GodownID ?? null)
        .input("CreatedBy", sql.NVarChar(200), userEmail || null)
        .query(`
          INSERT INTO dbo.FixedAssetRecord
            (DocDate, CompanyId, ProjectId, FinYear, AssetName, AssetCategory,
             PurchaseDate, PurchaseInvoiceRef, PurchaseCost, Quantity,
             AssetStatus, Remarks, SourceType, SourceId, SourceItemId, GodownID, CreatedBy)
          OUTPUT INSERTED.AssetId
          VALUES
            (@DocDate, @CompanyId, @ProjectId, @FinYear, @AssetName, @AssetCategory,
             @PurchaseDate, @PurchaseInvoiceRef, @PurchaseCost, @Quantity,
             'Pending', @Remarks, 'ICT', @SourceId, @SourceItemId, @GodownId, @CreatedBy)
        `);
      batch = { AssetId: ins.recordset[0].AssetId };

      // Fresh codes from the RECEIVING project's own template. If it has no
      // alias / financial year yet the batch simply stays Pending in FA
      // Inventory and is tagged as soon as that's configured (see
      // autoTagPendingBatchesForProject).
      try {
        await autoTagBatch(pool, {
          assetId: batch.AssetId, itemId: String(itemId), itemName, qty: units.length,
          companyId: receiver.CompanyId, projectId: receiver.ProjectId, godownId: receiverGodown?.GodownID,
          docDate: transferDate, sourceDocNo: docNo, userEmail, receiptLabel: "ICT",
        });
      } catch (err) {
        console.error(`[interCompanyFixedAssets] auto-tagging ICT ${ictId} item ${itemId} failed (batch ${batch.AssetId} left Pending):`, err.message);
      }
    }

    const fresh = (await pool.request().input("Asset", sql.Int, batch.AssetId).query(`
      SELECT TagId, FAItemCode FROM dbo.FixedAssetTagging
      WHERE AssetId = @Asset AND Status = 'Tagged' ORDER BY TagId
    `)).recordset;

    // Retire the old side and link old ↔ new, unit by unit.
    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const [i, u] of units.entries()) {
        const next = fresh[i] || null;
        await tx.request()
          .input("Tag", sql.Int, u.TagId).input("Ict", sql.Int, ictId)
          .input("At", sql.Date, transferDate).input("To", sql.NVarChar(200), next?.FAItemCode ?? null)
          .input("By", sql.NVarChar(200), userEmail || null)
          .query(`
            UPDATE dbo.FixedAssetTagging
            SET Status = 'Transferred', TransferredAt = @At, TransferICTId = @Ict, TransferredToCode = @To,
                UpdatedBy = @By, UpdatedAt = SYSDATETIME()
            WHERE TagId = @Tag AND Status = 'Tagged'
          `);
        // The depreciable record built from the old code stops here.
        await tx.request()
          .input("Tag", sql.Int, u.TagId).input("Ict", sql.Int, ictId)
          .input("At", sql.Date, transferDate).input("By", sql.NVarChar(200), userEmail || null)
          .query(`
            UPDATE dbo.FixedAssetRecord
            SET AssetStatus = 'Transferred', TransferredAt = @At, TransferICTId = @Ict,
                UpdatedBy = @By, UpdatedAt = SYSDATETIME()
            WHERE SourceTagId = @Tag AND Status <> 'Deleted'
          `);
        if (next) {
          await tx.request()
            .input("New", sql.Int, next.TagId).input("Ict", sql.Int, ictId).input("From", sql.NVarChar(200), u.FAItemCode)
            .query(`UPDATE dbo.FixedAssetTagging SET SourceICTId = @Ict, TransferredFromCode = @From WHERE TagId = @New`);
          newCodes.push(next.FAItemCode);
        }
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch {}
      throw e;
    }
  }
  return { transferred: todo.length, newCodes };
}

/**
 * Undoes a completed transfer's Fixed Asset side (used when a Completed
 * transfer is deleted): the old codes become active again, and the receiving
 * side's fresh batch and codes are removed. Refuses if the receiving side has
 * already built on them (a Fixed Asset Record exists for a new code).
 */
async function revertFaTransfer(pool, ictId) {
  const used = await pool.request().input("Ict", sql.Int, ictId).query(`
    SELECT TOP 1 t.FAItemCode
    FROM dbo.FixedAssetTagging t
    JOIN dbo.FixedAssetRecord r ON r.SourceTagId = t.TagId AND r.Status <> 'Deleted'
    WHERE t.SourceICTId = @Ict
  `);
  if (used.recordset.length) {
    throw httpError(409, `Cannot delete — the receiving company has already created a Fixed Asset Record for ${used.recordset[0].FAItemCode}. Delete that record first.`);
  }
  const moved = await pool.request().input("Ict", sql.Int, ictId).query(`
    SELECT TOP 1 t.FAItemCode
    FROM dbo.FixedAssetTagging t
    WHERE t.SourceICTId = @Ict AND t.Status <> 'Tagged'
  `);
  if (moved.recordset.length) {
    throw httpError(409, `Cannot delete — the received FA Item Code ${moved.recordset[0].FAItemCode} has since been moved or cancelled.`);
  }

  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("Ict", sql.Int, ictId).query(`
      DELETE FROM dbo.FixedAssetTagging WHERE SourceICTId = @Ict;
      DELETE FROM dbo.FixedAssetRecord
        WHERE SourceType = 'ICT' AND SourceId = @Ict AND AssetCode IS NULL;
      UPDATE dbo.FixedAssetRecord
        SET AssetStatus = 'Active', TransferredAt = NULL, TransferICTId = NULL, UpdatedAt = SYSDATETIME()
        WHERE TransferICTId = @Ict AND AssetStatus = 'Transferred';
      UPDATE dbo.FixedAssetTagging
        SET Status = 'Tagged', TransferredAt = NULL, TransferICTId = NULL, TransferredToCode = NULL, UpdatedAt = SYSDATETIME()
        WHERE TransferICTId = @Ict AND Status = 'Transferred';
    `);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
}

module.exports = {
  faItemIdSet,
  listTransferableTags,
  resolveFaSelection,
  saveIctAssets,
  loadIctAssets,
  assertFaReady,
  executeFaTransfer,
  revertFaTransfer,
};
