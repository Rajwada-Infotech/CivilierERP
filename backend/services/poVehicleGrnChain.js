"use strict";

/**
 * backend/services/poVehicleGrnChain.js
 *
 * Owns the Purchase Order -> Vehicle In/Out -> GRN document chain:
 *
 *   Purchase Order
 *         |
 *         +-- Vehicle In/Out #1 -- GRN #1
 *         +-- Vehicle In/Out #2 -- GRN #2
 *         +-- Vehicle In/Out #3 -- GRN #3
 *
 *   - One PO             -> many Vehicle In/Out lots
 *   - One Vehicle In/Out  -> at most one GRN (enforced by the DB —
 *     see migration 192-grn-vehicle-in-out-link.sql's filtered unique
 *     index — and re-checked here so callers get a clean error instead
 *     of a raw constraint-violation exception)
 *
 * Every function takes `pool` explicitly (never opens its own connection),
 * matching this codebase's existing service convention (approvalService.js,
 * sourceChain.js). Validation failures throw an Error with a `.status`
 * property — the same pattern grns.js's createGRNInternal already uses —
 * so route handlers can just do `res.status(err.status || 500)`.
 */

const { sql } = require("../db");

function chainError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// ── PO -> Vehicle In/Out ──────────────────────────────────────────────────

/**
 * Vehicle In/Out lots for a PO that don't already have an active
 * (non-Rejected) GRN — the "only show what's eligible to become a GRN"
 * list for the GRN creation form's PO -> Vehicle In/Out picker.
 */
async function getPendingVehicleInOutsForPO(pool, poId) {
  const result = await pool.request().input("POID", sql.Int, poId).query(`
    SELECT
      v.VehicleInOutID, v.DocNo, v.DocDate, v.VehicleNo, v.ChallanNo,
      v.EntryTime, v.Status,
      (SELECT ISNULL(SUM(vi.ReceivedQty), 0) FROM dbo.VehicleInOutItems vi WHERE vi.VehicleInOutID = v.VehicleInOutID) AS TotalReceivedQty
    FROM dbo.VehicleInOut v
    WHERE v.POID = @POID
      AND v.Status <> 'Rejected'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GoodsReceiptNotes g
        WHERE g.VehicleInOutID = v.VehicleInOutID AND g.Status <> 'Rejected'
      )
    ORDER BY v.VehicleInOutID DESC
  `);
  return result.recordset;
}

/**
 * A Vehicle In/Out lot's items, enriched with the parent PO line item's
 * rate/UOM/tax data — VehicleInOutItems only stores quantity, so the GRN
 * form needs this join to build proper GRN line items from it.
 */
async function getVehicleInOutItemsEnriched(pool, vehicleInOutId) {
  const result = await pool.request().input("ID", sql.Int, vehicleInOutId).query(`
    SELECT
      vi.VehicleInOutItemID, vi.POItemId, vi.ReceivedQty AS VehicleQty,
      poi.ItemId, poi.ItemName, poi.ItemCode, poi.UomId, poi.UomName,
      poi.Rate, poi.TaxPct
    FROM dbo.VehicleInOutItems vi
    JOIN dbo.PurchaseOrderItems poi ON poi.Id = vi.POItemId
    WHERE vi.VehicleInOutID = @ID
    ORDER BY poi.SortOrder
  `);
  return result.recordset;
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Throws if the given Vehicle In/Out record already has an active GRN.
 * excludeGrnId lets an edit re-check without tripping over its own row.
 */
async function assertVehicleInOutHasNoGRN(pool, vehicleInOutId, excludeGrnId) {
  if (!vehicleInOutId) return;
  const request = pool.request().input("ID", sql.Int, vehicleInOutId);
  if (excludeGrnId) request.input("ExcludeGRNID", sql.Int, excludeGrnId);
  const result = await request.query(`
    SELECT TOP 1 GRNID, DocNo FROM dbo.GoodsReceiptNotes
    WHERE VehicleInOutID = @ID AND Status <> 'Rejected'
      ${excludeGrnId ? "AND GRNID <> @ExcludeGRNID" : ""}
  `);
  if (result.recordset.length > 0) {
    throw chainError(
      `This Vehicle In/Out document already has a GRN (${result.recordset[0].DocNo || `#${result.recordset[0].GRNID}`}). One Vehicle In/Out document can only have one GRN.`,
      409,
    );
  }
}

/**
 * Throws if any submitted GRN line item quantity exceeds what was actually
 * recorded as received in the source Vehicle In/Out lot for that PO item —
 * a GRN can confirm receipt of at most what the vehicle physically brought
 * in, never more.
 */
async function assertGRNQuantitiesWithinVehicleInOut(pool, vehicleInOutId, grnItems) {
  if (!vehicleInOutId) return;
  const vioItems = await getVehicleInOutItemsEnriched(pool, vehicleInOutId);
  const byItemId = new Map(vioItems.map((it) => [String(it.ItemId), it]));

  for (const line of Array.isArray(grnItems) ? grnItems : []) {
    const itemId = String(line.itemId ?? line.ItemId ?? "");
    const qty = Number(line.quantity ?? line.Quantity ?? 0);
    if (!itemId || qty <= 0) continue;

    const vioItem = byItemId.get(itemId);
    if (!vioItem) {
      throw chainError(
        `${line.itemName ?? line.ItemName ?? "Item"} was not part of the selected Vehicle In/Out document.`,
        400,
      );
    }
    if (qty > Number(vioItem.VehicleQty) + 1e-6) {
      throw chainError(
        `${vioItem.ItemName}: GRN quantity ${qty} exceeds what was received in this Vehicle In/Out lot (${vioItem.VehicleQty}).`,
        400,
      );
    }
  }
}

// ── Document-chain retrieval (for "Linked Documents" panels) ─────────────

/** PO -> every Vehicle In/Out lot, each with its GRN (or null if pending). */
async function getDocumentChainForPO(pool, poId) {
  const result = await pool.request().input("POID", sql.Int, poId).query(`
    SELECT
      v.VehicleInOutID, v.DocNo AS VehicleDocNo, v.DocDate AS VehicleDocDate,
      v.VehicleNo, v.Status AS VehicleStatus,
      g.GRNID, g.DocNo AS GRNDocNo, g.GRNNo, g.Status AS GRNStatus, g.GRNDate
    FROM dbo.VehicleInOut v
    LEFT JOIN dbo.GoodsReceiptNotes g
      ON g.VehicleInOutID = v.VehicleInOutID AND g.Status <> 'Rejected'
    WHERE v.POID = @POID AND v.Status <> 'Rejected'
    ORDER BY v.VehicleInOutID DESC
  `);
  return result.recordset.map((r) => ({
    vehicleInOut: {
      id: r.VehicleInOutID,
      docNo: r.VehicleDocNo,
      docDate: r.VehicleDocDate,
      vehicleNo: r.VehicleNo,
      status: r.VehicleStatus,
    },
    grn: r.GRNID
      ? {
          id: r.GRNID,
          docNo: r.GRNDocNo || r.GRNNo,
          status: r.GRNStatus,
          date: r.GRNDate,
        }
      : null,
  }));
}

/** A single Vehicle In/Out record's parent PO + its GRN (or null). */
async function getDocumentChainForVehicleInOut(pool, vehicleInOutId) {
  const result = await pool.request().input("ID", sql.Int, vehicleInOutId).query(`
    SELECT
      v.VehicleInOutID, v.POID, po.PurchaseOrderNo, po.DocNo AS PODocNo,
      g.GRNID, g.DocNo AS GRNDocNo, g.GRNNo, g.Status AS GRNStatus, g.GRNDate
    FROM dbo.VehicleInOut v
    LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = v.POID
    LEFT JOIN dbo.GoodsReceiptNotes g
      ON g.VehicleInOutID = v.VehicleInOutID AND g.Status <> 'Rejected'
    WHERE v.VehicleInOutID = @ID
  `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    purchaseOrder: row.POID
      ? { id: row.POID, docNo: row.PODocNo || row.PurchaseOrderNo }
      : null,
    grn: row.GRNID
      ? { id: row.GRNID, docNo: row.GRNDocNo || row.GRNNo, status: row.GRNStatus, date: row.GRNDate }
      : null,
  };
}

/** A single GRN's parent PO + parent Vehicle In/Out (whichever are linked). */
async function getDocumentChainForGRN(pool, grnId) {
  const result = await pool.request().input("ID", sql.Int, grnId).query(`
    SELECT
      g.GRNID, g.POID, po.PurchaseOrderNo, po.DocNo AS PODocNo,
      g.VehicleInOutID, v.DocNo AS VehicleDocNo, v.VehicleNo
    FROM dbo.GoodsReceiptNotes g
    LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = g.POID
    LEFT JOIN dbo.VehicleInOut v ON v.VehicleInOutID = g.VehicleInOutID
    WHERE g.GRNID = @ID
  `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    purchaseOrder: row.POID
      ? { id: row.POID, docNo: row.PODocNo || row.PurchaseOrderNo }
      : null,
    vehicleInOut: row.VehicleInOutID
      ? { id: row.VehicleInOutID, docNo: row.VehicleDocNo, vehicleNo: row.VehicleNo }
      : null,
  };
}

module.exports = {
  chainError,
  getPendingVehicleInOutsForPO,
  getVehicleInOutItemsEnriched,
  assertVehicleInOutHasNoGRN,
  assertGRNQuantitiesWithinVehicleInOut,
  getDocumentChainForPO,
  getDocumentChainForVehicleInOut,
  getDocumentChainForGRN,
};
