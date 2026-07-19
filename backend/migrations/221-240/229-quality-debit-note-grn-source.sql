-- ============================================================
-- Migration: 229-quality-debit-note-grn-source.sql
--
-- Quality Rejection Debit Notes could originally only be raised from a
-- Vehicle In/Out received line (VehicleInOutID/VehicleInOutItemID were
-- NOT NULL). This lets them also be raised straight from a GRN entry.
--
-- GRN line items are NOT a normalized child table — they live as a JSON
-- array in dbo.GoodsReceiptNotes.GRNItems with no stable per-line id (an
-- itemId can legitimately repeat within one GRN), so the array position
-- (GRNItemIndex) is the only reliable way to point at "this specific GRN
-- line". Adds GRNID + GRNItemIndex alongside the existing VehicleInOut*
-- columns, and relaxes those to NULL-able since a debit note now comes
-- from exactly one source, not both.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QualityRejectionDebitNote'
      AND COLUMN_NAME = 'VehicleInOutID' AND IS_NULLABLE = 'NO'
)
BEGIN
    ALTER TABLE dbo.QualityRejectionDebitNote ALTER COLUMN VehicleInOutID INT NULL;
    PRINT 'QualityRejectionDebitNote.VehicleInOutID relaxed to NULL.';
END
GO

IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QualityRejectionDebitNote'
      AND COLUMN_NAME = 'VehicleInOutItemID' AND IS_NULLABLE = 'NO'
)
BEGIN
    ALTER TABLE dbo.QualityRejectionDebitNote ALTER COLUMN VehicleInOutItemID INT NULL;
    PRINT 'QualityRejectionDebitNote.VehicleInOutItemID relaxed to NULL.';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QualityRejectionDebitNote') AND name = N'GRNID'
)
BEGIN
    ALTER TABLE dbo.QualityRejectionDebitNote ADD GRNID INT NULL;              -- FK -> GoodsReceiptNotes
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.QualityRejectionDebitNote') AND name = N'GRNItemIndex'
)
BEGIN
    ALTER TABLE dbo.QualityRejectionDebitNote ADD GRNItemIndex INT NULL;       -- position within GRNItems JSON
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_QualityRejectionDebitNote_GRNID'
      AND object_id = OBJECT_ID('dbo.QualityRejectionDebitNote')
)
    CREATE INDEX IX_QualityRejectionDebitNote_GRNID
        ON dbo.QualityRejectionDebitNote (GRNID);
GO

PRINT '================================================================';
PRINT '229-quality-debit-note-grn-source applied successfully.';
PRINT '================================================================';
GO
