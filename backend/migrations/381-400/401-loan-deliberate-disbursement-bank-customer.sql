-- ============================================================
-- Migration 401: Bank Loan / Customer Loan disbursement becomes deliberate
-- too — same fix Inter-Company already got.
--
-- LoanSanction.tsx's Posting tab auto-posted Bank Loan/Customer Loan to GL
-- the moment anyone opened the tab to look at the loan (Inter-Company was
-- already excluded from this). That auto-post only ever books the loan
-- LEDGER side (Dr/Cr the "Loan - X" heads) — it never touches a real bank
-- account — yet it stamped DisbursedAt as if real money had moved. The
-- result: a loan could read "Disbursed" with zero bank-side record
-- anywhere (no GeneralLedgerEntry against a bank head, no NewPayment/
-- ReceivedPayment) — confirmed on dev for LoanId 10 (LN-000010).
--
-- DisbursementPaymentId/DisbursementPaymentType record which real
-- NewPayment/ReceivedPayment row backs a Bank Loan/Customer Loan's
-- disbursement (see routes/loanSanction.js's new POST /:id/disburse) —
-- same convention as the existing ClosurePaymentId column.
--
-- Also backfills correctness: reverses any Bank Loan/Customer Loan's
-- LoanPosting GL entries that never had a matching bank-side record
-- (i.e. were auto-posted with no real payment behind them) and resets
-- DisbursedAt, so those loans re-enter the undisbursed pool and get
-- disbursed properly through the new deliberate flow.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'DisbursementPaymentId'
)
  ALTER TABLE dbo.LoanSanction ADD DisbursementPaymentId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'DisbursementPaymentType'
)
  ALTER TABLE dbo.LoanSanction ADD DisbursementPaymentType NVARCHAR(20) NULL;
GO

-- ── Data correction: undo any Bank Loan/Customer Loan "disbursement" that
-- never actually touched a bank account ──────────────────────────────────
DECLARE @LoanId INT;
DECLARE loan_cursor CURSOR LOCAL FOR
  SELECT ls.LoanId
  FROM dbo.LoanSanction ls
  WHERE ls.LoanType IN ('Bank Loan', 'Customer Loan')
    AND ls.DisbursedAt IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = gle.LHeadId
      WHERE gle.SourceType = 'LoanPosting' AND gle.SourceId = ls.LoanId
        AND gle.IsReversed = 0 AND ahm.LHeadType = 'B'
    );

OPEN loan_cursor;
FETCH NEXT FROM loan_cursor INTO @LoanId;
WHILE @@FETCH_STATUS = 0
BEGIN
  UPDATE dbo.GeneralLedgerEntry
    SET IsReversed = 1
    WHERE SourceType = 'LoanPosting' AND SourceId = @LoanId AND IsReversed = 0;

  UPDATE dbo.LoanSanction
    SET DisbursedAt = NULL
    WHERE LoanId = @LoanId;

  PRINT 'Reversed phantom disbursement posting for LoanId ' + CAST(@LoanId AS NVARCHAR(20)) + ' — no bank-side record existed.';

  FETCH NEXT FROM loan_cursor INTO @LoanId;
END
CLOSE loan_cursor;
DEALLOCATE loan_cursor;
GO

PRINT '401-loan-deliberate-disbursement-bank-customer applied successfully.';
GO
