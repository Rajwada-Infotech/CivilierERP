-- =============================================================================
-- Migration 108: Seed TypeOfDoc row for "TRF-GRN" prefix
--
-- Transfer-sourced GRNs (raised from a Stock Transfer doc) use a separate
-- doc-number series so they are visually distinct from supplier GRNs:
--
--   Normal GRN      →  GRN-2026-00051
--   Transfer GRN    →  TRF-GRN-2026-00001
--
-- Uses the same Tier-2 dash format as all other TypeOfDoc rows
-- (DocNoPrefix-{CalendarYear}-{PaddedSerial}).
-- Safe to run multiple times (guarded with IF NOT EXISTS).
-- =============================================================================

SET NOCOUNT ON;
GO

DECLARE @EId_GRN UNIQUEIDENTIFIER =
  ISNULL(
    (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Purchase Order'),
    (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt)
  );

IF @EId_GRN IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'TRF-GRN')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('TRF-GRN', 'TRF-GRN', 'GRN from Stock Transfer', 1, 5, 1, @EId_GRN, 'migration', GETDATE());
  PRINT 'TRF-GRN TypeOfDoc row inserted.';
END
ELSE
  PRINT 'TRF-GRN TypeOfDoc row already exists — skipped.';
GO

PRINT '================================================================';
PRINT '108-typeofdoc-trf-grn applied successfully.';
PRINT '================================================================';
GO
