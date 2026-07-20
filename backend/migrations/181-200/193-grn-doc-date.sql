-- ============================================================
-- Migration: 193-grn-doc-date.sql
--
-- Adds a DocDate column to dbo.GoodsReceiptNotes — the date the GRN
-- entry was actually made (always "today" when created), distinct from
-- GRNDate which now tracks the linked Vehicle In/Out document's own
-- date (see backend/services/poVehicleGrnChain.js). CreatedDate already
-- records a full timestamp but isn't a clean date-only field to filter/
-- display on, and mirrors the existing DocDate column on dbo.VehicleInOut.
--
-- Backfilled from CreatedDate for existing rows.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'DocDate'
)
BEGIN
    ALTER TABLE dbo.GoodsReceiptNotes
        ADD DocDate DATE NULL;

    PRINT 'dbo.GoodsReceiptNotes.DocDate added.';
END
ELSE
    PRINT 'dbo.GoodsReceiptNotes.DocDate already exists — skipped.';
GO

UPDATE dbo.GoodsReceiptNotes
SET DocDate = CAST(CreatedDate AS DATE)
WHERE DocDate IS NULL AND CreatedDate IS NOT NULL;
GO

PRINT '================================================================';
PRINT '193-grn-doc-date applied successfully.';
PRINT '================================================================';
GO
