-- Migration 292: Add PFinYearId to dbo.NewPayment
-- Direct/manual payments (no linked ExpenseBooking) had no way to resolve a
-- Financial Year at all — the Reports page's FY filter compares against
-- dbo.FinYear.FId, but the only "year" NewPayment stored was DocYear, a raw
-- calendar year lifted from the doc-number sequence at issue time (always
-- "today", never the payment's own PDate) — the two never matched, so
-- Payment Register rows silently vanished under any FY filter and showed a
-- blank Fin Year column for direct payments.
--
-- PFinYearId is resolved from the payment's own PDate (the year in the date
-- IS the fin year) by matching it into dbo.FinYear's FStartDate/FEndDate
-- window, and is what both the FY filter and the Fin Year display column
-- now use for payments with no linked ExpenseBooking.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'NewPayment'
    AND COLUMN_NAME  = 'PFinYearId'
)
BEGIN
  ALTER TABLE dbo.NewPayment
    ADD PFinYearId INT NULL
      REFERENCES dbo.FinYear(FId);
  PRINT 'Column PFinYearId added to NewPayment.';
END
ELSE
  PRINT 'Column PFinYearId already exists on NewPayment — skipped.';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.NewPayment')
    AND name = 'IX_NewPayment_PFinYearId'
)
  CREATE NONCLUSTERED INDEX IX_NewPayment_PFinYearId
    ON dbo.NewPayment (PFinYearId)
    WHERE PFinYearId IS NOT NULL;
GO

-- Backfill existing rows from their own PDate so historical direct payments
-- also become filterable/visible by Financial Year immediately.
UPDATE np
SET np.PFinYearId = fy.FId
FROM dbo.NewPayment np
CROSS APPLY (
  SELECT TOP 1 FId
  FROM dbo.FinYear
  WHERE np.PDate >= FStartDate AND np.PDate <= FEndDate
  ORDER BY FStartDate DESC
) fy
WHERE np.PFinYearId IS NULL AND np.PDate IS NOT NULL;
GO

PRINT '292-new-payment-fin-year-id applied successfully.';
GO
