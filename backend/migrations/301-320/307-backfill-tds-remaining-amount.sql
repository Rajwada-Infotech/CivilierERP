-- Migration 307: backfill ETotalPaid/ERemainingAmount/EBillStatus for every
-- non-Draft/non-Rejected invoice, now that syncBillStatus.js (utils/) nets
-- TDSAmount out of the payable balance instead of ignoring it entirely.
-- Covers every invoice source (Direct/TOD, PO, GRN, WO) since they all
-- share dbo.ExpenseBooking and each carries its own TDSAmount snapshot.
-- Mirrors syncBillStatus.js's logic exactly — see that file for the
-- authoritative, ongoing calculation; this is a one-time catch-up for rows
-- that were already computed under the old (TDS-blind) logic.

WITH PaidTotals AS (
  SELECT
    np.PExpenseRef AS EDocNo,
    SUM(np.PAmount - ISNULL(np.BounceCharge, 0)) AS TotalPaid
  FROM dbo.NewPayment np
  LEFT JOIN dbo.BankReconciliation br
    ON br.SourceType = 'PAYMENT' AND br.SourceID = np.PPaymentID
  WHERE np.Status = 'Approved'
    AND ISNULL(np.PDocType, '') <> 'On Account Adjustment'
    AND (br.IsBounced IS NULL OR br.IsBounced = 0)
    AND np.PExpenseRef IS NOT NULL AND np.PExpenseRef <> ''
  GROUP BY np.PExpenseRef
),
OaTotals AS (
  SELECT RefDocNo AS EDocNo, SUM(Amount) AS TotalAdjusted
  FROM dbo.OnAccountLedger
  WHERE TxnType = 'DEBIT' AND RefType = 'Invoice'
  GROUP BY RefDocNo
),
Computed AS (
  SELECT
    eb.Eid,
    CASE WHEN ISNULL(eb.ENetAmount, 0) > 0 THEN eb.ENetAmount ELSE ISNULL(eb.EAmount, 0) END AS NetAmount,
    ISNULL(eb.TDSAmount, 0) AS TdsAmount,
    ISNULL(pt.TotalPaid, 0) + ISNULL(oa.TotalAdjusted, 0) AS TotalPaid
  FROM dbo.ExpenseBooking eb
  LEFT JOIN PaidTotals pt ON pt.EDocNo = eb.EDocNo
  LEFT JOIN OaTotals oa ON oa.EDocNo = eb.EDocNo
  WHERE ISNULL(eb.EStatus, '') NOT IN ('Draft', 'Rejected')
),
Final AS (
  SELECT
    Eid,
    TotalPaid,
    NetAmount - TdsAmount AS PayableAfterTds,
    CASE
      WHEN NetAmount - TdsAmount < 0 THEN 0
      ELSE NetAmount - TdsAmount - TotalPaid
    END AS RemainingRaw,
    CASE
      WHEN TotalPaid <= 0 THEN CASE WHEN (NetAmount - TdsAmount) <= 0 THEN 'Paid' ELSE 'Payment Due' END
      WHEN TotalPaid >= (NetAmount - TdsAmount) THEN 'Paid'
      ELSE 'Partially Paid'
    END AS BillStatus
  FROM Computed
)
UPDATE eb
SET
  eb.ETotalPaid = f.TotalPaid,
  eb.ERemainingAmount = CASE WHEN f.RemainingRaw < 0 THEN 0 ELSE f.RemainingRaw END,
  eb.EBillStatus = f.BillStatus
FROM dbo.ExpenseBooking eb
JOIN Final f ON f.Eid = eb.Eid
WHERE ISNULL(eb.TDSAmount, 0) > 0;

PRINT '307-backfill-tds-remaining-amount applied successfully.';
GO
