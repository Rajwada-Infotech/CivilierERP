-- Migration 300: backfill EBillStatus/ETotalPaid/ERemainingAmount for
-- Approved invoices that were approved before this trio was ever computed
-- for them (EBillStatus stayed NULL until the invoice's first payment or
-- On Account adjustment). Those showed as "Unknown" instead of "Payment
-- Due" in pickers like the On Account Adjustment invoice list.
--
-- Logic mirrors backend/utils/syncBillStatus.js exactly: sum Approved,
-- non-bounced NewPayment rows (excluding the old synthetic 'On Account
-- Adjustment' rows — see migration 299) plus OnAccountLedger invoice-DEBIT
-- rows, against ENetAmount (falling back to EAmount).

UPDATE eb
SET
  eb.ETotalPaid = paid.TotalPaid,
  eb.ERemainingAmount = CASE
    WHEN (CASE WHEN eb.ENetAmount > 0 THEN eb.ENetAmount ELSE ISNULL(eb.EAmount, 0) END) - paid.TotalPaid > 0
    THEN (CASE WHEN eb.ENetAmount > 0 THEN eb.ENetAmount ELSE ISNULL(eb.EAmount, 0) END) - paid.TotalPaid
    ELSE 0
  END,
  eb.EBillStatus = CASE
    WHEN paid.TotalPaid <= 0 THEN 'Payment Due'
    WHEN paid.TotalPaid >= (CASE WHEN eb.ENetAmount > 0 THEN eb.ENetAmount ELSE ISNULL(eb.EAmount, 0) END) THEN 'Paid'
    ELSE 'Partially Paid'
  END
FROM dbo.ExpenseBooking eb
CROSS APPLY (
  SELECT
    ISNULL((
      SELECT SUM(np.PAmount - ISNULL(np.BounceCharge, 0))
      FROM dbo.NewPayment np
      LEFT JOIN dbo.BankReconciliation br
        ON br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
      WHERE np.PExpenseRef = eb.EDocNo
        AND np.Status = 'Approved'
        AND ISNULL(np.PDocType, '') <> 'On Account Adjustment'
        AND (br.IsBounced IS NULL OR br.IsBounced = 0)
    ), 0)
    +
    ISNULL((
      SELECT SUM(oa.Amount)
      FROM dbo.OnAccountLedger oa
      WHERE oa.TxnType = 'DEBIT' AND oa.RefType = 'Invoice' AND oa.RefDocNo = eb.EDocNo
    ), 0) AS TotalPaid
) paid
WHERE eb.EStatus = 'Approved'
  AND eb.EDocNo IS NOT NULL
  AND eb.EBillStatus IS NULL;

PRINT '300-backfill-null-bill-status applied successfully.';
GO
