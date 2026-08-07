"use strict";

/**
 * backend/utils/oaAdjustments.js
 *
 * Looks up On Account adjustments applied against a specific invoice
 * (dbo.OnAccountLedger rows written by routes/onAccount.js's
 * POST /apply-adjustment — TxnType='DEBIT', RefType='Invoice',
 * RefDocNo=<invoice EDocNo>) so the Payment page's amount breakdown can
 * show "On A/C adjusted with ₹X from <Supplier>" instead of the
 * adjustment silently vanishing into ETotalPaid with no explanation of
 * where the money came from.
 */

/**
 * @param {import("mssql").ConnectionPool} pool
 * @param {import("mssql")} sql
 * @param {string} expenseRef - the invoice's EDocNo
 * @returns {Promise<{ amount: number, partyId: number, partyName: string, date: string }[]>}
 */
async function getOAAdjustmentsForInvoice(pool, sql, expenseRef) {
  if (!expenseRef) return [];
  const result = await pool
    .request()
    .input("RefDocNo", sql.NVarChar(100), expenseRef).query(`
      SELECT
        oa.OAId     AS oaId,
        oa.Amount   AS amount,
        oa.PartyId  AS partyId,
        ISNULL(ahm.LHeadName, 'Unknown Party') AS partyName,
        oa.TxnDate  AS date,
        oa.AdjustmentDocNo AS adjustmentDocNo,
        oa.AdjRefDocNo AS sourcePaymentDocNo,
        oa.Mode AS mode,
        oa.CreatedBy AS performedBy,
        ISNULL(ahm.OnAccountBalance, 0) AS partyRemainingBalance
      FROM dbo.OnAccountLedger oa
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = oa.PartyId
      WHERE oa.TxnType = 'DEBIT'
        AND oa.RefType = 'Invoice'
        AND oa.RefDocNo = @RefDocNo
      ORDER BY oa.TxnDate DESC, oa.OAId DESC
    `);
  return result.recordset.map((r) => ({
    oaId: r.oaId,
    amount: parseFloat(r.amount) || 0,
    partyId: r.partyId,
    partyName: r.partyName,
    date: r.date,
    adjustmentDocNo: r.adjustmentDocNo || null,
    sourcePaymentDocNo: r.sourcePaymentDocNo || null,
    mode: r.mode || null,
    performedBy: r.performedBy || null,
    // The party's CURRENT (materialized) balance — since OnAccountBalance is
    // a running total rather than a per-row snapshot, this reflects the
    // balance as of NOW, not as of this specific historical adjustment.
    partyRemainingBalance: Math.max(0, parseFloat(r.partyRemainingBalance) || 0),
  }));
}

module.exports = { getOAAdjustmentsForInvoice };
