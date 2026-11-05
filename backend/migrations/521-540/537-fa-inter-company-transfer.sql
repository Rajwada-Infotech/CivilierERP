-- Migration 537: Fixed Asset transfer through an Inter-Company Stock Transfer.
--
-- A Fixed Asset item moved to another company's project is not "stock" that
-- just changes godown: each physical unit has its own FA Item Code
-- (dbo.FixedAssetTagging) and its own depreciation. When the transfer is
-- approved, the units picked on the transfer are
--   * marked Transferred on the SENDING side (their tag, and any Fixed Asset
--     Record built from it) so the old FA Code is no longer active and no
--     further depreciation is posted against it, and
--   * received as a fresh FA Inventory batch under the RECEIVING company /
--     project, with brand-new FA Item Codes and no depreciation setup (the
--     receiving side configures its own).
--
-- This migration adds:
--   1. 'Transferred' as an allowed FixedAssetTagging.Status / FixedAssetRecord.
--      AssetStatus, plus the transfer audit columns on both tables.
--   2. dbo.InterCompanyTransferAssets — which specific FA Item Codes each
--      transfer line moves (and so reserves) while the transfer is in flight.

-- ── 1a. FixedAssetTagging: allow 'Transferred' + audit columns ───────────────
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FAT_Status')
  ALTER TABLE dbo.FixedAssetTagging DROP CONSTRAINT CK_FAT_Status;
GO
ALTER TABLE dbo.FixedAssetTagging
  ADD CONSTRAINT CK_FAT_Status CHECK (Status IN ('Tagged', 'Cancelled', 'Transferred'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'TransferredAt')
  ALTER TABLE dbo.FixedAssetTagging ADD TransferredAt DATE NULL;           -- effective transfer date (sending side)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'TransferICTId')
  ALTER TABLE dbo.FixedAssetTagging ADD TransferICTId INT NULL;            -- the transfer that retired this code
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'TransferredToCode')
  ALTER TABLE dbo.FixedAssetTagging ADD TransferredToCode NVARCHAR(200) NULL;   -- the new FA Code it became
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'SourceICTId')
  ALTER TABLE dbo.FixedAssetTagging ADD SourceICTId INT NULL;              -- receiving side: the transfer this code came from
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'TransferredFromCode')
  ALTER TABLE dbo.FixedAssetTagging ADD TransferredFromCode NVARCHAR(200) NULL; -- receiving side: the old FA Code
GO

-- ── 1b. FixedAssetRecord: allow 'Transferred' + audit columns ────────────────
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FAR_AssetStatus')
  ALTER TABLE dbo.FixedAssetRecord DROP CONSTRAINT CK_FAR_AssetStatus;
GO
ALTER TABLE dbo.FixedAssetRecord
  ADD CONSTRAINT CK_FAR_AssetStatus CHECK (AssetStatus IN ('Pending', 'Active', 'Sold', 'Scrapped', 'Under Maintenance', 'Transferred'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'TransferredAt')
  ALTER TABLE dbo.FixedAssetRecord ADD TransferredAt DATE NULL;            -- depreciation stops from this month
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'TransferICTId')
  ALTER TABLE dbo.FixedAssetRecord ADD TransferICTId INT NULL;
GO

-- ── 2. Which FA Item Codes each transfer line moves ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'InterCompanyTransferAssets')
BEGIN
  CREATE TABLE dbo.InterCompanyTransferAssets (
    ICTAssetId  INT IDENTITY(1,1) PRIMARY KEY,
    ICTId       INT           NOT NULL,
    ICTItemId   INT           NULL,
    ItemId      NVARCHAR(100) NOT NULL,
    TagId       INT           NOT NULL,           -- FixedAssetTagging.TagId being moved
    FAItemCode  NVARCHAR(200) NOT NULL,           -- snapshot of the old code
    CONSTRAINT FK_ICTAssets_ICT FOREIGN KEY (ICTId)
      REFERENCES dbo.InterCompanyTransfer (ICTId) ON DELETE CASCADE
  );
  CREATE INDEX IX_ICTAssets_ICT ON dbo.InterCompanyTransferAssets (ICTId);
  CREATE INDEX IX_ICTAssets_Tag ON dbo.InterCompanyTransferAssets (TagId);
END
GO

PRINT '537-fa-inter-company-transfer applied successfully.';
GO
