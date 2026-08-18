-- Migration 341: Loan perspective tracking -- DisbursedAt timestamp.
--
-- Previously, LoanSanction.Status jumped directly from 'Sanctioned' to
-- 'Closed' with no explicit record of when funds actually moved. For
-- Inter-Company and Customer Loans the GL posting is the moment of
-- disbursement, but no timestamp was captured.
--
-- DisbursedAt: set when the first GL posting (SourceType='LoanPosting')
-- is committed for this loan, marking that money physically moved.
-- NULL = sanctioned but not yet disbursed (e.g. approval pending).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'DisbursedAt'
)
BEGIN
  ALTER TABLE dbo.LoanSanction ADD DisbursedAt DATETIME2 NULL;
END
GO

-- Backfill: for loans that already have a GL posting, treat that posting's
-- earliest timestamp as the disbursement date so the field isn't blank on live data.
UPDATE ls
SET DisbursedAt = (
  SELECT MIN(gle.PostedAt)
  FROM dbo.GeneralLedgerEntry gle
  WHERE gle.SourceType = 'LoanPosting'
    AND gle.SourceId = ls.LoanId
    AND gle.IsReversed = 0
)
FROM dbo.LoanSanction ls
WHERE ls.DisbursedAt IS NULL;
GO
