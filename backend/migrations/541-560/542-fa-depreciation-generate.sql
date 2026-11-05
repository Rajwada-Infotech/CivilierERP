-- Migration 542: "Fixed Asset Depreciation Generate" menu.
--  1. dbo.FixedAssetDepreciationRun.ProjectId — a Generate click is logged per project + month
--     (NULL for the company-wide scheduler runs).
--  2. PageDefinitions row so the menu can be granted in Menu Rights.

IF COL_LENGTH('dbo.FixedAssetDepreciationRun', 'ProjectId') IS NULL
BEGIN
  ALTER TABLE dbo.FixedAssetDepreciationRun ADD ProjectId INT NULL;
  PRINT 'Migration 542: added FixedAssetDepreciationRun.ProjectId.';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-depreciation-generate' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-depreciation-generate', 'Fixed Asset Depreciation Generate', 'Fixed Asset', 'Fixed Asset', 'view,create', 239, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-depreciation-generate';
END
GO
