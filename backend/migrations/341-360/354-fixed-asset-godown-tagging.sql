-- Migration 354: Godown-wise Fixed Asset Tagging
--
-- Adds GodownID to FixedAssetRecord (backfilled from the source GRN's header
-- godown) and to FixedAssetTagging, so "untagged quantity" can be computed
-- per (Item, Godown) off the live StockLedger balance instead of purely off
-- a single GRN-batch's Quantity. Existing pageKey/route/table names are
-- unchanged — this only adds columns.

-- ── 1. FixedAssetRecord.GodownID ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'GodownID')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD GodownID INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FAR_Godown')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord
    ADD CONSTRAINT FK_FAR_Godown FOREIGN KEY (GodownID) REFERENCES dbo.Godowns(GodownID);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FixedAssetRecord_GodownID' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
  CREATE INDEX IX_FixedAssetRecord_GodownID ON dbo.FixedAssetRecord(GodownID);
END
GO

-- Backfill existing GRN-sourced batches from their GRN header's godown.
UPDATE fa
SET fa.GodownID = grn.GodownID
FROM dbo.FixedAssetRecord fa
JOIN dbo.GoodsReceiptNotes grn ON grn.GRNID = fa.SourceId
WHERE fa.SourceType = 'GRN' AND fa.GodownID IS NULL AND grn.GodownID IS NOT NULL;
GO

-- ── 2. FixedAssetTagging.GodownID ────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'GodownID')
BEGIN
  ALTER TABLE dbo.FixedAssetTagging ADD GodownID INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FAT_Godown')
BEGIN
  ALTER TABLE dbo.FixedAssetTagging
    ADD CONSTRAINT FK_FAT_Godown FOREIGN KEY (GodownID) REFERENCES dbo.Godowns(GodownID);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FixedAssetTagging_ItemId_GodownID' AND object_id = OBJECT_ID('dbo.FixedAssetTagging'))
BEGIN
  CREATE INDEX IX_FixedAssetTagging_ItemId_GodownID ON dbo.FixedAssetTagging(ItemId, GodownID);
END
GO

PRINT '354-fixed-asset-godown-tagging applied successfully.';
GO
