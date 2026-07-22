"use strict";

/**
 * backend/services/materialRequestFulfillment.js
 *
 * Computes how much of a Material Request's line items have already been
 * converted into Purchase Orders, and keeps the MR header Status in sync
 * with that math. Shared by materialRequests.js (read-only pending-summary
 * endpoints) and purchaseOrders.js (create/delete side-effects).
 *
 * A PO's own Status of 'Deleted'/'Rejected' doesn't count against the MR —
 * everything else (Draft/Pending/Approved/Received/...) does, since the
 * material has been committed to a supplier either way.
 */

const { getPool, sql } = require("../db");

// Per MR line item: requested vs. already-ordered (across all non-voided
// POs that were created from this MR item) vs. what's still pending.
async function getMRItemFulfillment(pool, mrId) {
  const r = await pool.request().input("MRId", sql.Int, mrId).query(`
    SELECT
      mri.MRItemId, mri.ItemId, mri.ItemName, mri.UOMCode, mri.Quantity AS RequestedQty,
      ISNULL((
        SELECT SUM(poi.Quantity)
        FROM dbo.PurchaseOrderItems poi
        JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
        WHERE poi.MRItemId = mri.MRItemId
          AND ISNULL(po.Status, '') NOT IN ('Deleted', 'Rejected')
      ), 0) AS OrderedQty
    FROM dbo.MaterialRequestItems mri
    WHERE mri.MRId = @MRId
    ORDER BY mri.MRItemId
  `);
  return r.recordset.map((row) => {
    const requested = Number(row.RequestedQty) || 0;
    const ordered = Math.min(Number(row.OrderedQty) || 0, requested);
    return {
      MRItemId: row.MRItemId,
      ItemId: row.ItemId,
      ItemName: row.ItemName,
      UOMCode: row.UOMCode,
      RequestedQty: requested,
      OrderedQty: ordered,
      PendingQty: Math.max(0, requested - ordered),
    };
  });
}

function summarize(items) {
  const totalRequested = items.reduce((s, i) => s + i.RequestedQty, 0);
  const totalOrdered = items.reduce((s, i) => s + i.OrderedQty, 0);
  const totalPending = Math.max(0, totalRequested - totalOrdered);
  return { totalRequested, totalOrdered, totalPending };
}

// Fulfillment status purely from the numbers — doesn't touch the DB.
function statusFor(totalOrdered, totalPending) {
  if (totalOrdered <= 0) return "Approved";
  if (totalPending <= 0.0001) return "Completed";
  return "Partially Fulfilled";
}

// Recomputes and persists the MR's Status from its items' fulfillment.
// Only touches MRs already in the fulfillment lifecycle (Approved /
// Partially Fulfilled / Completed) — never Draft/Pending/Rejected.
async function recomputeMRFulfillment(pool, mrId, userEmail) {
  const items = await getMRItemFulfillment(pool, mrId);
  const { totalRequested, totalOrdered, totalPending } = summarize(items);
  const status = statusFor(totalOrdered, totalPending);

  await pool
    .request()
    .input("MRId", sql.Int, mrId)
    .input("Status", sql.NVarChar(20), status)
    .input("User", sql.NVarChar(200), userEmail || null).query(`
      UPDATE dbo.MaterialRequests
      SET Status = @Status, UpdatedBy = @User, UpdatedAt = GETDATE()
      WHERE MRId = @MRId AND Status IN ('Approved', 'Partially Fulfilled', 'Completed')
    `);

  return { items, totalRequested, totalOrdered, totalPending, status };
}

module.exports = { getMRItemFulfillment, recomputeMRFulfillment, summarize, statusFor };
