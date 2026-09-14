"use strict";

/**
 * backend/services/invoiceLinking.js
 *
 * Owns the two Invoice-page (Material Expense Booking) linking rules:
 *
 *   1. Service-only Purchase Orders — a PO can be picked directly (without
 *      a GRN) for the Invoice's "PO" tab only when every line item on it
 *      belongs to the "Subcontract Services" item group (goods must always
 *      flow through a GRN first, since there's physical stock to receive
 *      and reconcile — services don't have that step).
 *
 *   2. Multi-GRN invoices — a single invoice can combine several GRNs
 *      raised against the *same* Purchase Order into one total-amount
 *      booking (e.g. three partial deliveries, one supplier invoice for
 *      all of them), or keep booking one GRN at a time as before. Both
 *      paths are valid; this just validates and totals the multi-GRN case.
 *
 * Every function takes `pool` explicitly (never opens its own connection),
 * matching this codebase's existing service convention. Validation
 * failures throw an Error with a `.status` property, the same pattern
 * grns.js's createGRNInternal and poVehicleGrnChain.js already use.
 */

const { sql } = require("../db");

function linkError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Root Item_Master_Group for services — items under this group don't get
// physically received/stocked, so they're the only items eligible for a
// direct-from-PO invoice (no GRN in between).
const SERVICE_ROOT_GROUP = "SVC";

// ── 1. Service-only Purchase Orders ─────────────────────────────────────────

/**
 * Purchase Orders where every line item's Item_Master_Group ancestry
 * resolves up to the Service root group — eligible for direct-from-PO
 * invoicing on the Invoice page's "PO" tab.
 */
async function getServicePurchaseOrders(pool) {
  const result = await pool
    .request()
    .input("ServiceRoot", sql.NVarChar(20), SERVICE_ROOT_GROUP).query(`
      ;WITH GroupRoot AS (
        SELECT M_Id, M_Id AS RootId, M_Group AS RootGroup, M_BelongsTo
        FROM dbo.Item_Master_Group
        WHERE M_BelongsTo IS NULL
        UNION ALL
        SELECT g.M_Id, r.RootId, r.RootGroup, g.M_BelongsTo
        FROM dbo.Item_Master_Group g
        JOIN GroupRoot r ON g.M_BelongsTo = r.M_Id
      )
      SELECT
        po.PurchaseOrderID, po.PurchaseOrderNo, po.DocNo, po.PODate,
        po.Status, po.TotalAmount, po.SupplierID, ahm.LHeadName AS SupplierName,
        po.CompanyId, po.ProjectId, po.POType,
        po.SourceWODocNo, po.SourceWDDocNo, po.POItems,
        po.CostCenterId, cc.Name AS CostCenterName, cc.Code AS CostCenterCode
      FROM dbo.PurchaseOrders po
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = po.SupplierID
      LEFT JOIN dbo.CostCenter cc ON cc.CostCenterId = po.CostCenterId
      WHERE po.Status IN ('Approved', 'Received')
        AND EXISTS (
          SELECT 1 FROM dbo.PurchaseOrderItems poi
          WHERE poi.PurchaseOrderID = po.PurchaseOrderID
        )
        AND NOT EXISTS (
          SELECT 1 FROM dbo.PurchaseOrderItems poi
          LEFT JOIN GroupRoot gr ON gr.M_Id = TRY_CAST(poi.ItemId AS uniqueidentifier)
          WHERE poi.PurchaseOrderID = po.PurchaseOrderID
            AND (gr.RootGroup IS NULL OR gr.RootGroup <> @ServiceRoot)
        )
      ORDER BY po.PurchaseOrderID DESC
    `);
  return result.recordset.map((r) => {
    let poItems = [];
    try {
      poItems = JSON.parse(r.POItems || "[]");
      if (!Array.isArray(poItems)) poItems = [];
    } catch {
      poItems = [];
    }
    return { ...r, POItems: poItems };
  });
}

// ── 2. Multi-GRN invoices ───────────────────────────────────────────────────

/**
 * Validates a set of GRN IDs for a combined invoice — all must exist,
 * be Approved, and share the same Purchase Order — then returns the
 * aggregate total and merged line items an invoice booking should use.
 */
async function computeMultiGRNInvoice(pool, grnIds) {
  const ids = (Array.isArray(grnIds) ? grnIds : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (ids.length === 0) {
    throw linkError("Select at least one GRN to link.", 400);
  }

  const request = pool.request();
  const placeholders = ids.map((id, i) => {
    request.input(`GRNID${i}`, sql.Int, id);
    return `@GRNID${i}`;
  });

  const result = await request.query(`
    SELECT
      grn.GRNID, grn.GRNNo, grn.DocNo, grn.GRNDate, grn.Status,
      grn.TotalAmount, grn.GRNItems, grn.POID, grn.SupplierID,
      ahm.LHeadName AS SupplierName, po.PurchaseOrderNo, po.DocNo AS PODocNo
    FROM dbo.GoodsReceiptNotes grn
    LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = grn.SupplierID
    LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
    WHERE grn.GRNID IN (${placeholders.join(", ")})
  `);

  const rows = result.recordset;
  if (rows.length !== ids.length) {
    throw linkError("One or more selected GRNs could not be found.", 404);
  }

  const rejected = rows.find((r) => r.Status === "Rejected");
  if (rejected) {
    throw linkError(
      `${rejected.DocNo || rejected.GRNNo} is Rejected and can't be invoiced.`,
      400,
    );
  }

  const poIds = new Set(rows.map((r) => r.POID).filter((v) => v != null));
  if (poIds.size !== 1) {
    throw linkError(
      "All selected GRNs must be linked to the same Purchase Order.",
      400,
    );
  }
  const [poId] = poIds;
  if (poId == null) {
    throw linkError(
      "Selected GRNs aren't linked to a Purchase Order, so they can't be combined.",
      400,
    );
  }

  // None of the selected GRNs may already be tied to an active invoice —
  // neither as a single booking's ESourceId, nor buried inside another
  // multi-GRN booking's ELinkedGrnIds set.
  const dupResult = await pool.request().query(`
    SELECT EId, ESourceId, ELinkedGrnIds
    FROM dbo.ExpenseBooking
    WHERE ESourceType = 'GRN' AND ISNULL(EStatus, '') <> 'Deleted'
      AND (ESourceId IS NOT NULL OR ELinkedGrnIds IS NOT NULL)
  `);
  const idSet = new Set(ids);
  for (const row of dupResult.recordset) {
    const usedIds = new Set(
      row.ESourceId != null ? [row.ESourceId] : [],
    );
    if (row.ELinkedGrnIds) {
      try {
        for (const id of JSON.parse(row.ELinkedGrnIds)) usedIds.add(id);
      } catch {
        /* ignore malformed JSON on old rows */
      }
    }
    const clash = [...usedIds].find((id) => idSet.has(id));
    if (clash != null) {
      throw linkError(
        `GRN #${clash} is already linked to an existing invoice (booking #${row.EId}).`,
        409,
      );
    }
  }

  // Order by GRNID so the "primary" GRN (used for ESourceId, the parts of
  // the app that still key off a single source doc) is deterministic.
  const ordered = [...rows].sort((a, b) => a.GRNID - b.GRNID);

  const totalAmount = ordered.reduce(
    (sum, r) => sum + Number(r.TotalAmount || 0),
    0,
  );

  const items = ordered.flatMap((r) => {
    let parsed = [];
    try {
      parsed = Array.isArray(r.GRNItems)
        ? r.GRNItems
        : JSON.parse(r.GRNItems || "[]");
    } catch {
      parsed = [];
    }
    const docNo = r.DocNo || r.GRNNo;
    return (Array.isArray(parsed) ? parsed : []).map((it) => ({
      ...it,
      sourceGrnId: r.GRNID,
      sourceGrnDocNo: docNo,
    }));
  });

  return {
    poId,
    poNo: ordered[0].PODocNo || ordered[0].PurchaseOrderNo || null,
    supplierId: ordered[0].SupplierID,
    supplierName: ordered[0].SupplierName,
    primaryGrnId: ordered[0].GRNID,
    grnIds: ordered.map((r) => r.GRNID),
    grnDocNos: ordered.map((r) => r.DocNo || r.GRNNo),
    totalAmount,
    items,
  };
}

module.exports = {
  linkError,
  getServicePurchaseOrders,
  computeMultiGRNInvoice,
};
