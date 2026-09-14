-- Migration 350: Fixed Asset Tagging module
--
-- Adds the transaction/audit-trail table that records tagging of individual
-- quantities out of a GRN-auto-allocated dbo.FixedAssetRecord batch
-- (AssetStatus='Pending', SourceType='GRN' — see fixedAssetAutoAlloc.js).
-- "Untagged quantity" per batch is derived at query time as
--   FixedAssetRecord.Quantity - SUM(FixedAssetTagging.TaggedQty WHERE Status='Tagged')
-- rather than stored, so it's always consistent with the audit trail.
--
-- Seeds TypeOfDoc (FAT) for doc numbering and PageDefinitions for the menu.

-- ── 1. FixedAssetTagging ─────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'FixedAssetTagging'
)
BEGIN
  CREATE TABLE dbo.FixedAssetTagging (
    TagId       INT IDENTITY(1,1) PRIMARY KEY,
    DocNo       NVARCHAR(100) NULL,
    DocDate     DATE          NULL,
    CompanyId   INT           NULL,
    ProjectId   INT           NULL,
    FinYear     NVARCHAR(20)  NULL,
    AssetId     INT           NOT NULL,
    ItemId      NVARCHAR(100) NULL,
    TaggedQty   DECIMAL(18,3) NOT NULL,
    Remarks     NVARCHAR(MAX) NULL,
    Status      NVARCHAR(20)  NOT NULL DEFAULT 'Tagged',
    CreatedBy   NVARCHAR(200) NULL,
    CreatedAt   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy   NVARCHAR(200) NULL,
    UpdatedAt   DATETIME2     NULL,
    CONSTRAINT CK_FAT_Status CHECK (Status IN ('Tagged','Cancelled')),
    CONSTRAINT FK_FAT_AssetId FOREIGN KEY (AssetId) REFERENCES dbo.FixedAssetRecord(AssetId)
  );
  PRINT 'Created dbo.FixedAssetTagging';
END
ELSE
  PRINT 'dbo.FixedAssetTagging already exists';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FixedAssetTagging_AssetId' AND object_id = OBJECT_ID('dbo.FixedAssetTagging')
)
BEGIN
  CREATE INDEX IX_FixedAssetTagging_AssetId ON dbo.FixedAssetTagging(AssetId);
END
GO

-- ── 2. TypeOfDoc — FAT prefix ────────────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FAT')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FAT', 'FAT', 'Fixed Asset Tagging', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FAT';
END
ELSE
  PRINT 'TypeOfDoc FAT already exists';
GO

-- ── 3. PageDefinitions ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-tagging' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-tagging', 'Fixed Asset Tagging', 'Material', 'Material', 'view,create,edit,delete,print,export', 232, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-tagging';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-tagging already exists';
GO

PRINT '350-fixed-asset-tagging applied successfully.';
GO
