-- Migration 351: promote Fixed Asset to its own top-level module
--
-- Fixed Asset Record, Fixed Asset Tagging, and Depreciation Setup moved out
-- of the Material module's sidebar/routes into a dedicated "Fixed Asset"
-- module (frontend-only routing/nav change — see ModuleStrip.tsx,
-- FixedAssetSidebar.ts, module.utils.ts). PageKeys are unchanged, so
-- existing RoleRights/UserPageRightsJson grants keep working; only the
-- PageDefinitions grouping metadata (used by the admin Menu Rights screen)
-- needs to move, plus a new page-key for the module's dashboard.

UPDATE dbo.PageDefinitions
SET Module = 'Fixed Asset', GroupName = 'Fixed Asset'
WHERE PageKey IN ('fixed-asset-record', 'fixed-asset-tagging', 'depreciation-setup');
PRINT 'Updated PageDefinitions Module/GroupName for fixed-asset-record, fixed-asset-tagging, depreciation-setup';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-dashboard' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-dashboard', 'Fixed Asset Dashboard', 'Fixed Asset', 'Fixed Asset', 'view', 229, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-dashboard';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-dashboard already exists';
GO

PRINT '351-fixed-asset-module applied successfully.';
GO
