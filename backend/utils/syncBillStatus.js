const { bumpCacheVersion } = require("../redis");

/**
 * Recalculate and persist EBillStatus, ETotalPaid, ERemainingAmount on ExpenseBooking.
 *
 * Called after any payment state change (create, approve, delete, BRS bounce).
 * Only Approved payments that have NOT been bounced in BRS count toward ETotalPaid.
 * This ensures a bounced cheque no longer reduces the outstanding balance.
 */
async function syncBillStatus(pool, sql, expenseRef) {
  if (!expenseRef) return;
  try {
    const ebRes = await pool
      .request()
      .input("EDocNo", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT eb.Eid, eb.ENetAmount, eb.EAmount
        FROM dbo.ExpenseBooking eb
        WHERE eb.EDocNo = @EDocNo
      `);
    if (!ebRes.recordset.length) return;

    const { Eid, ENetAmount, EAmount } = ebRes.recordset[0];
    // ENetAmount is the finalized net payable (base + GST + billing term adjustments).
    // GrnTotalAmount is the pre-tax GRN base — never use it for payment calculations.
    const netAmount = parseFloat(ENetAmount ?? 0) > 0
      ? parseFloat(ENetAmount)
      : parseFloat(EAmount ?? 0) || 0;

    // Exclude bounced payments — a bounced cheque must not reduce outstanding balance.
    // Also exclude PDocType='On Account Adjustment' rows: those were the OLD
    // synthetic "Dummy Bank" payments apply-adjustment used to create before
    // On Account settlements were moved to a direct GL voucher (see
    // routes/onAccount.js) — excluding them here prevents double-counting
    // against the OnAccountLedger sum below for any that still exist in
    // historical data, without having to delete those rows outright.
    const payRes = await pool
      .request()
      .input("PExpenseRef", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT ISNULL(SUM(np.PAmount - ISNULL(np.BounceCharge, 0)), 0) AS TotalPaid
        FROM dbo.NewPayment np
        LEFT JOIN dbo.BankReconciliation br
          ON  br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
        WHERE np.PExpenseRef = @PExpenseRef
          AND np.Status = 'Approved'
          AND ISNULL(np.PDocType, '') <> 'On Account Adjustment'
          AND (br.IsBounced IS NULL OR br.IsBounced = 0)
      `);

    // On Account adjustments settle the invoice without ever creating a
    // NewPayment row (no cash moves — see postOnAccountAdjustment in
    // generalLedger.js) — sum them in separately from dbo.OnAccountLedger,
    // the same source getOAAdjustmentsForInvoice already reads.
    const oaRes = await pool
      .request()
      .input("RefDocNo", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT ISNULL(SUM(Amount), 0) AS TotalAdjusted
        FROM dbo.OnAccountLedger
        WHERE TxnType = 'DEBIT' AND RefType = 'Invoice' AND RefDocNo = @RefDocNo
      `);

    const totalPaid =
      (parseFloat(payRes.recordset[0].TotalPaid) || 0) +
      (parseFloat(oaRes.recordset[0].TotalAdjusted) || 0);
    const remaining = Math.max(0, netAmount - totalPaid);

    let billStatus;
    if (totalPaid <= 0) {
      billStatus = "Payment Due";
    } else if (totalPaid >= netAmount) {
      billStatus = "Paid";
    } else {
      billStatus = "Partially Paid";
    }

    await pool
      .request()
      .input("Eid", sql.Int, Eid)
      .input("EBillStatus", sql.NVarChar(20), billStatus)
      .input("ETotalPaid", sql.Decimal(18, 2), totalPaid)
      .input("ERemainingAmount", sql.Decimal(18, 2), remaining)
      .query("UPDATE dbo.ExpenseBooking SET EBillStatus=@EBillStatus, ETotalPaid=@ETotalPaid, ERemainingAmount=@ERemainingAmount WHERE Eid=@Eid");

    await bumpCacheVersion("expense-booking");
  } catch (err) {
    console.warn("syncBillStatus failed:", err.message);
  }
}

module.exports = { syncBillStatus };
