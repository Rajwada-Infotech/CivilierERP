"use strict";

const { sql } = require("../db");

/**
 * Resolve the AccountHeadMaster partyId + partyType for a given ExpenseBooking doc ref.
 * Returns { partyId, partyType } or null.
 */
async function resolvePartyFromRef(pool, expenseRef) {
  if (!expenseRef) return null;
  const r = await pool.request().input("EDocNo", sql.NVarChar(100), expenseRef).query(`
    SELECT eb.ESourceType, eb.ESourceId,
           grn_sup.LHeadId AS GrnSupId, grn_sup.LHeadType AS GrnSupType,
           po_sup.LHeadId  AS PoSupId,  po_sup.LHeadType  AS PoSupType,
           grn2_sup.LHeadId AS Grn2SupId, grn2_sup.LHeadType AS Grn2SupType
    FROM dbo.ExpenseBooking eb
    LEFT JOIN dbo.GoodsReceiptNotes grn_eb
      ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.AccountHeadMaster grn_sup ON grn_sup.LHeadId = grn_eb.SupplierID
    LEFT JOIN dbo.PurchaseOrders po
      ON eb.ESourceType = 'PO' AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.AccountHeadMaster po_sup ON po_sup.LHeadId = po.SupplierID
    LEFT JOIN dbo.GoodsReceiptNotes grn2
      ON eb.ESourceType NOT IN ('GRN','PO') AND grn2.POID = po.PurchaseOrderID
    LEFT JOIN dbo.AccountHeadMaster grn2_sup ON grn2_sup.LHeadId = grn2.SupplierID
    WHERE eb.EDocNo = @EDocNo
  `);
  if (!r.recordset.length) return null;
  const row = r.recordset[0];
  const src = row.ESourceType;
  const partyId   = src === 'GRN' ? row.GrnSupId  : src === 'PO' ? row.PoSupId  : row.Grn2SupId;
  const partyType = src === 'GRN' ? row.GrnSupType : src === 'PO' ? row.PoSupType : row.Grn2SupType;
  return partyId ? { partyId, partyType } : null;
}

module.exports = { resolvePartyFromRef };
