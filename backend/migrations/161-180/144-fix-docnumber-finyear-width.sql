-- 05-fix-docnumber-finyear-width.sql
-- DocNumberSequence.FinYear was NVARCHAR(10); labels like "FY 2026-2027"
-- are 11 chars, causing a TDS error on every Material/Finance save.
-- Widens the column to NVARCHAR(20). Safe to re-run.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence')
    AND name = 'FinYear'
    AND max_length < 40   -- NVARCHAR(20) = 40 bytes; current is 20 bytes = NVARCHAR(10)
)
  ALTER TABLE dbo.DocNumberSequence ALTER COLUMN FinYear NVARCHAR(20) NULL;
GO

PRINT '05-fix-docnumber-finyear-width: done';
