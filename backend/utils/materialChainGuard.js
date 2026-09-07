"use strict";

const sql = require("mssql");

/**
 * Edit guards for the MR -> PO -> GRN -> Expense Booking (Invoice) -> Payment
 * chain (and its shorter variants, e.g. a direct PO or GRN with no MR/PO
 * ancestor). Each existing DELETE endpoint in this chain already refuses to
 * delete a document while a downstream document still references it; these
 * functions run the exact same existence checks so PUT (edit) endpoints can
 * enforce the same rule — a document can't be edited while anything
 * downstream of it still exists, since an edit can silently invalidate
 * quantities/amounts a child document already locked in. Delete the child
 * first (which itself cascades the same rule to its own children), then the
 * parent becomes editable again.
 *
 * Each function returns a short human-readable description of what's
 * blocking (e.g. "linked GRN(s)") or null when there's nothing downstream.
 */

async function poExistsForMR(pool, mrId) {
  const r = await pool
    .request()
    .input("id", sql.Int, mrId)
    .query("SELECT TOP 1 DocNo FROM dbo.PurchaseOrders WHERE SourceMRId = @id");
  return r.recordset[0]?.DocNo
    ? `Purchase Order ${r.recordset[0].DocNo}`
    : null;
}

async function downstreamOfPO(pool, poId) {
  const vio = await pool
    .request()
    .input("POID", sql.Int, poId)
    .query("SELECT COUNT(*) AS cnt FROM dbo.VehicleInOut WHERE POID = @POID");
  if (Number(vio.recordset[0]?.cnt) > 0) return "linked Vehicle In/Out record(s)";

  const grn = await pool
    .request()
    .input("POID", sql.Int, poId)
    .query("SELECT COUNT(*) AS cnt FROM dbo.GoodsReceiptNotes WHERE POID = @POID");
  if (Number(grn.recordset[0]?.cnt) > 0) return "linked GRN(s)";

  const exp = await pool.request().input("POID", sql.Int, poId).query(`
    SELECT COUNT(*) AS cnt
    FROM dbo.ExpenseBooking eb
    WHERE eb.ESourceType = 'PO' AND eb.ESourceId = @POID
      AND ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
  `);
  if (Number(exp.recordset[0]?.cnt) > 0) return "linked Expense Booking(s)";

  return null;
}

async function downstreamOfGRN(pool, grnId) {
  // Same OPENJSON expansion as the GRN DELETE guard — a non-primary GRN in
  // a multi-GRN combined invoice only shows up in ELinkedGrnIds, not ESourceId.
  const exp = await pool.request().input("GRNID", sql.Int, grnId).query(`
    SELECT COUNT(*) AS cnt
    FROM dbo.ExpenseBooking eb
    WHERE ISNULL(eb.EStatus, '') NOT IN ('Deleted', 'Draft')
      AND (
        (eb.ESourceType = 'GRN' AND eb.ESourceId = @GRNID)
        OR (eb.ELinkedGrnIds IS NOT NULL AND EXISTS (
              SELECT 1 FROM OPENJSON(eb.ELinkedGrnIds) WHERE TRY_CAST(value AS INT) = @GRNID
            ))
      )
  `);
  if (Number(exp.recordset[0]?.cnt) > 0) return "linked Expense Booking(s)";
  return null;
}

async function downstreamOfExpenseBooking(pool, eid) {
  const pay = await pool.request().input("Eid", sql.Int, eid).query(`
    SELECT COUNT(*) AS cnt
    FROM dbo.ExpenseBooking eb
    JOIN dbo.NewPayment np ON np.PExpenseRef = eb.EDocNo
    WHERE eb.Eid = @Eid
  `);
  if (Number(pay.recordset[0]?.cnt) > 0) return "linked Payment record(s)";
  return null;
}

module.exports = {
  poExistsForMR,
  downstreamOfPO,
  downstreamOfGRN,
  downstreamOfExpenseBooking,
};
