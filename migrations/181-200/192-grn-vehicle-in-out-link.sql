-- ============================================================
-- Migration: 192-grn-vehicle-in-out-link.sql
--
-- Adds the missing link in the PO -> Vehicle In/Out -> GRN document
-- chain: GRNs could only ever reference a Purchase Order (POID), with no
-- way to know which specific Vehicle In/Out lot a GRN was raised against.
-- Mirrors the existing SourceTransferID pattern from migration
-- 107-grn-source-transfer.sql.
--
-- A GRN can reference at most one Vehicle In/Out record, and (enforced by
-- the filtered unique index below) a Vehicle In/Out record can have at
-- most one *active* (non-Rejected) GRN — GRN rows are hard-deleted on
-- delete (see backend/routes/grns.js DELETE /:id), so excluding Rejected
-- is the only exclusion needed; there is no separate "Deleted" status to
-- also exclude.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GoodsReceiptNotes' AND COLUMN_NAME = 'VehicleInOutID'
)
BEGIN
    ALTER TABLE dbo.GoodsReceiptNotes
        ADD VehicleInOutID INT NULL;

    PRINT 'dbo.GoodsReceiptNotes.VehicleInOutID added.';
END
ELSE
    PRINT 'dbo.GoodsReceiptNotes.VehicleInOutID already exists — skipped.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_GoodsReceiptNotes_VehicleInOut'
)
BEGIN
    ALTER TABLE dbo.GoodsReceiptNotes
        ADD CONSTRAINT FK_GoodsReceiptNotes_VehicleInOut
        FOREIGN KEY (VehicleInOutID) REFERENCES dbo.VehicleInOut (VehicleInOutID);

    PRINT 'FK_GoodsReceiptNotes_VehicleInOut added.';
END
ELSE
    PRINT 'FK_GoodsReceiptNotes_VehicleInOut already exists — skipped.';
GO

-- One active GRN per Vehicle In/Out record — the "One Vehicle In/Out
-- Document -> One GRN" rule, enforced at the database level so it can
-- never be bypassed by a future code path that forgets to check.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_GoodsReceiptNotes_VehicleInOutID_Active'
      AND object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
)
BEGIN
    CREATE UNIQUE INDEX UX_GoodsReceiptNotes_VehicleInOutID_Active
        ON dbo.GoodsReceiptNotes (VehicleInOutID)
        WHERE VehicleInOutID IS NOT NULL AND Status <> 'Rejected';

    PRINT 'UX_GoodsReceiptNotes_VehicleInOutID_Active created.';
END
ELSE
    PRINT 'UX_GoodsReceiptNotes_VehicleInOutID_Active already exists — skipped.';
GO

PRINT '================================================================';
PRINT '192-grn-vehicle-in-out-link applied successfully.';
PRINT '================================================================';
GO
