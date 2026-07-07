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
      .query("SELECT Eid, ENetAmount, EAmount FROM dbo.ExpenseBooking WHERE EDocNo = @EDocNo");
    if (!ebRes.recordset.length) return;

    const { Eid, ENetAmount, EAmount } = ebRes.recordset[0];
    const netAmount = parseFloat(ENetAmount ?? EAmount ?? 0) || 0;

    // Exclude bounced payments — a bounced cheque must not reduce outstanding balance
    const payRes = await pool
      .request()
      .input("PExpenseRef", sql.NVarChar(100), expenseRef)
      .query(`
        SELECT ISNULL(SUM(np.PAmount), 0) AS TotalPaid
        FROM dbo.NewPayment np
        LEFT JOIN dbo.BankReconciliation br
          ON  br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
        WHERE np.PExpenseRef = @PExpenseRef
          AND np.Status = 'Approved'
          AND (br.IsBounced IS NULL OR br.IsBounced = 0)
      `);

    const totalPaid = parseFloat(payRes.recordset[0].TotalPaid) || 0;
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
