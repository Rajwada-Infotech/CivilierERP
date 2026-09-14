-- Migration 107: GoodsReceiptNotes — link GRN to a Stock Transfer
--
-- Allows a GRN to be raised directly from a Stock Transfer doc.
-- SourceTransferID stores the TransferID of the originating TRF doc,
-- SourceTransferDocNo keeps the human-readable ref (e.g. TRF-20260616-001)
-- so reports can display it without a JOIN.
--
-- Safe to run multiple times (all guarded with IF NOT EXISTS).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'GoodsReceiptNotes'
    AND COLUMN_NAME  = 'SourceTransferID'
)
BEGIN
  ALTER TABLE dbo.GoodsReceiptNotes
    ADD SourceTransferID INT NULL
      CONSTRAINT FK_GRN_StockTransfer REFERENCES dbo.StockTransfers(TransferID);
  PRINT 'SourceTransferID column added to GoodsReceiptNotes.';
END
ELSE
  PRINT 'SourceTransferID column already exists on GoodsReceiptNotes.';
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'GoodsReceiptNotes'
    AND COLUMN_NAME  = 'SourceTransferDocNo'
)
BEGIN
  ALTER TABLE dbo.GoodsReceiptNotes
    ADD SourceTransferDocNo NVARCHAR(100) NULL;
  PRINT 'SourceTransferDocNo column added to GoodsReceiptNotes.';
END
ELSE
  PRINT 'SourceTransferDocNo column already exists on GoodsReceiptNotes.';
GO

-- Index for filtering GRNs by their source transfer
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
    AND name = 'IX_GRN_SourceTransferID'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_GRN_SourceTransferID
    ON dbo.GoodsReceiptNotes (SourceTransferID)
    INCLUDE (GRNID, GRNNo, DocNo, Status, GRNDate);
  PRINT 'Index IX_GRN_SourceTransferID created.';
END
ELSE
  PRINT 'Index IX_GRN_SourceTransferID already exists.';
GO

PRINT '================================================================';
PRINT '107-grn-source-transfer applied successfully.';
PRINT '================================================================';
GO
