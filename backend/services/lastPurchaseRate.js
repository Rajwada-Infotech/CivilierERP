// backend/services/lastPurchaseRate.js
//
// Inter-Company Stock Transfer needs to price the auto-generated invoice/GRN
// at the SENDING project's own cost basis — the rate it last paid when it
// originally acquired the item — so the transfer books no artificial
// profit/loss on either side.
//
// Checked most-recent-first:
//   1. GRNs raised against a PO scoped to the sending project (GRNItems is a
//      JSON blob — see migration 034 — queried via OPENJSON).
//   2. PurchaseOrderItems scoped to the sending project, for items ordered
//      but not yet GRN'd.
// Returns null if neither has a positive rate on file for this item — the
// caller must reject the transfer rather than guess a price.

const { sql } = require("../db");

async function getLastPurchaseRate(pool, projectId, itemId) {
  const grnResult = await pool
    .request()
    .input("ProjectId", sql.Int, projectId)
    .input("ItemId", sql.NVarChar(100), String(itemId)).query(`
      SELECT TOP 1
        item.rate AS Rate,
        grn.DocNo AS SourceDocNo,
        grn.GRNDate AS SourceDate
      FROM dbo.GoodsReceiptNotes grn
      JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
      CROSS APPLY OPENJSON(grn.GRNItems)
        WITH (
          itemId NVARCHAR(100) '$.itemId',
          rate DECIMAL(18, 4) '$.rate'
        ) item
      WHERE po.ProjectId = @ProjectId
        AND item.itemId = @ItemId
        AND item.rate > 0
      ORDER BY grn.GRNDate DESC, grn.GRNID DESC
    `);

  const grnRow = grnResult.recordset[0];
  if (grnRow) {
    return {
      rate: Number(grnRow.Rate),
      sourceDocNo: grnRow.SourceDocNo,
      sourceDate: grnRow.SourceDate,
    };
  }

  const poResult = await pool
    .request()
    .input("ProjectId", sql.Int, projectId)
    .input("ItemId", sql.NVarChar(100), String(itemId)).query(`
      SELECT TOP 1
        poi.Rate AS Rate,
        po.DocNo AS SourceDocNo,
        po.PODate AS SourceDate
      FROM dbo.PurchaseOrderItems poi
      JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
      WHERE po.ProjectId = @ProjectId
        AND poi.ItemId = @ItemId
        AND poi.Rate > 0
      ORDER BY poi.CreatedAt DESC, poi.PurchaseOrderID DESC
    `);

  const poRow = poResult.recordset[0];
  if (poRow) {
    return {
      rate: Number(poRow.Rate),
      sourceDocNo: poRow.SourceDocNo,
      sourceDate: poRow.SourceDate,
    };
  }

  return null;
}

module.exports = { getLastPurchaseRate };
