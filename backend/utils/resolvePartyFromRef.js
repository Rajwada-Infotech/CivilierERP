"use strict";

const { sql } = require("../db");

/**
 * Resolve the AccountHeadMaster partyId + partyType for a given ExpenseBooking doc ref.
 * Handles GRN, PO, WO_PO, WORK_DONE, and direct-invoice fallbacks (migration 179/180).
 * Returns { partyId, partyType } or null.
 */
async function resolvePartyFromRef(pool, expenseRef) {
  if (!expenseRef) return null;
  const r = await pool.request().input("EDocNo", sql.NVarChar(100), expenseRef).query(`
    SELECT
      eb.ESourceType,
      eb.ESourceId,
      eb.EName,
      grn_sup.LHeadId   AS GrnSupId,   grn_sup.LHeadType   AS GrnSupType,
      po_sup.LHeadId    AS PoSupId,    po_sup.LHeadType    AS PoSupType,
      wd_sup.LHeadId    AS WdSupId,    wd_sup.LHeadType    AS WdSupType
    FROM dbo.ExpenseBooking eb
    LEFT JOIN dbo.GoodsReceiptNotes grn_eb
      ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.AccountHeadMaster grn_sup ON grn_sup.LHeadId = grn_eb.SupplierID
    LEFT JOIN dbo.PurchaseOrders po
      ON eb.ESourceType IN ('PO','WO_PO') AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.AccountHeadMaster po_sup ON po_sup.LHeadId = po.SupplierID
    LEFT JOIN dbo.WorkDone wd
      ON eb.ESourceType = 'WORK_DONE' AND wd.ID = TRY_CAST(eb.ESourceId AS INT)
    LEFT JOIN dbo.AccountHeadMaster wd_sup ON wd_sup.LHeadId = wd.SupplierId
    WHERE eb.EDocNo = @EDocNo
  `);
  if (!r.recordset.length) return null;

  const row = r.recordset[0];
  const src = row.ESourceType;

  if (src === 'GRN'                    && row.GrnSupId) return { partyId: row.GrnSupId, partyType: row.GrnSupType };
  if (src === 'PO' || src === 'WO_PO') {
    if (row.PoSupId) return { partyId: row.PoSupId, partyType: row.PoSupType };
  }
  if (src === 'WORK_DONE'              && row.WdSupId)  return { partyId: row.WdSupId,  partyType: row.WdSupType  };

  // Fallback 1: LHeadId stored on ExpenseBooking (migration 179) — separate query so
  // the main query doesn't break if the column doesn't exist yet.
  try {
    const lhRes = await pool.request()
      .input("EDocNo_lh", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT TOP 1 eb.LHeadId, ahm.LHeadType
        FROM dbo.ExpenseBooking eb
        JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = eb.LHeadId
        WHERE eb.EDocNo = @EDocNo_lh AND eb.LHeadId IS NOT NULL
      `);
    if (lhRes.recordset.length) {
      return { partyId: lhRes.recordset[0].LHeadId, partyType: lhRes.recordset[0].LHeadType };
    }
  } catch { /* migration 179 not yet applied */ }

  // Fallback 2: PPartyId on NewPayment (migration 180)
  try {
    const npRes = await pool.request()
      .input("EDocNo2", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT TOP 1 np.PPartyId, ahm.LHeadType
        FROM dbo.NewPayment np
        JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = np.PPartyId
        WHERE np.PExpenseRef = @EDocNo2
          AND np.PPartyId IS NOT NULL
          AND np.Status = 'Approved'
        ORDER BY np.PCreatedAt DESC
      `);
    if (npRes.recordset.length) {
      return { partyId: npRes.recordset[0].PPartyId, partyType: npRes.recordset[0].LHeadType };
    }
  } catch { /* migration 180 not yet applied */ }

  // Fallback 3: EName match in AccountHeadMaster (works when EName is a real supplier name)
  if (row.EName) {
    const nameRes = await pool.request()
      .input("LHeadName", sql.NVarChar(200), row.EName.trim())
      .query(`
        SELECT TOP 1 LHeadId, LHeadType
        FROM dbo.AccountHeadMaster
        WHERE LHeadName = @LHeadName AND LHeadType IN ('S','C','A')
      `);
    if (nameRes.recordset.length) {
      const { LHeadId, LHeadType } = nameRes.recordset[0];
      return { partyId: LHeadId, partyType: LHeadType };
    }
  }

  return null;
}

module.exports = { resolvePartyFromRef };
