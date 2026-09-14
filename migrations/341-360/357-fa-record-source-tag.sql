-- Links a manually-created Fixed Asset Record to the FA Item Code (unit) it
-- represents, generated in FA Inventory. Enforces one-to-one assignment so a
-- generated code can back at most one Fixed Asset Record.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'SourceTagId')
BEGIN
    ALTER TABLE dbo.FixedAssetRecord ADD SourceTagId INT NULL;
    PRINT 'Added FixedAssetRecord.SourceTagId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FAR_SourceTag')
BEGIN
    ALTER TABLE dbo.FixedAssetRecord
        ADD CONSTRAINT FK_FAR_SourceTag FOREIGN KEY (SourceTagId) REFERENCES dbo.FixedAssetTagging(TagId);
    PRINT 'Added FK_FAR_SourceTag';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAR_SourceTagId' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
    CREATE UNIQUE INDEX UX_FAR_SourceTagId ON dbo.FixedAssetRecord(SourceTagId) WHERE SourceTagId IS NOT NULL;
    PRINT 'Added UX_FAR_SourceTagId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'FAItemCode')
BEGIN
    ALTER TABLE dbo.FixedAssetRecord ADD FAItemCode NVARCHAR(200) NULL;
    PRINT 'Added FixedAssetRecord.FAItemCode';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAR_FAItemCode' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
    CREATE UNIQUE INDEX UX_FAR_FAItemCode ON dbo.FixedAssetRecord(FAItemCode) WHERE FAItemCode IS NOT NULL;
    PRINT 'Added UX_FAR_FAItemCode';
END
GO
