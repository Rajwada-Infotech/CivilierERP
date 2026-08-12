-- Migration 301: auto-allocation of Fixed Asset Record rows from GRN
-- approval, for Item Master items tagged M_Type = 'Fixed Asset'.
--
-- Adds:
--   1. 'Pending' to FixedAssetRecord.AssetStatus's allowed values — the
--      status an auto-created row starts in until the user completes it
--      (category confirmed, depreciation rate tagged, etc.).
--   2. SourceType/SourceId/SourceItemId + a filtered unique index, so the
--      GRN-approval hook (see services/fixedAssetAutoAlloc.js) can run
--      idempotently — re-running approval (or a retried request) never
--      creates a duplicate asset row for the same GRN line.

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FAR_AssetStatus')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord DROP CONSTRAINT CK_FAR_AssetStatus;
END
GO

ALTER TABLE dbo.FixedAssetRecord
  ADD CONSTRAINT CK_FAR_AssetStatus CHECK (AssetStatus IN ('Pending','Active','Sold','Scrapped','Under Maintenance'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'SourceType')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD SourceType NVARCHAR(20) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'SourceId')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD SourceId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'SourceItemId')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD SourceItemId NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_FixedAssetRecord_Source' AND object_id = OBJECT_ID('dbo.FixedAssetRecord')
)
BEGIN
  CREATE UNIQUE INDEX UX_FixedAssetRecord_Source
    ON dbo.FixedAssetRecord(SourceType, SourceId, SourceItemId)
    WHERE SourceType IS NOT NULL AND SourceId IS NOT NULL AND SourceItemId IS NOT NULL;
END
GO

PRINT '301-fixed-asset-auto-allocation applied successfully.';
GO
