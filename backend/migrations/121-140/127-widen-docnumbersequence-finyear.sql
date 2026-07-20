-- Migration 127: Widen DocNumberSequence.FinYear to NVARCHAR(20)
--
-- FinYear labels (FinYearMaster.fy_label) can be up to 20 characters, but
-- DocNumberSequence.FinYear was created as NVARCHAR(10) (migration 046).
-- Passing a value longer than the declared SQL parameter length corrupts
-- the TDS stream (tedious error 8016: "Data type 0xE7 has an invalid data
-- length or metadata length"), breaking GRN/PO/WO/etc. doc number issuance
-- whenever an active financial year label exceeds 10 characters.

PRINT '=== Migration 127: Widening DocNumberSequence.FinYear ===';

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'FinYear'
      AND max_length < 40 -- NVARCHAR(20) = 40 bytes
)
BEGIN
  IF EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.DocNumberSequence')
        AND name = 'IX_DocNumberSequence_ModuleFinYear'
  )
    DROP INDEX IX_DocNumberSequence_ModuleFinYear ON dbo.DocNumberSequence;

  ALTER TABLE dbo.DocNumberSequence ALTER COLUMN FinYear NVARCHAR(20) NULL;

  CREATE INDEX IX_DocNumberSequence_ModuleFinYear
    ON dbo.DocNumberSequence (DocNoPrefix, FinYear)
    WHERE FinYear IS NOT NULL;

  PRINT '  + DocNumberSequence.FinYear widened to NVARCHAR(20)';
END
ELSE
  PRINT '  - DocNumberSequence.FinYear already wide enough, skipping';
GO
