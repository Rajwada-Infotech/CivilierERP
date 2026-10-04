-- ============================================================
-- Migration 403: Maintenance module scaffold — seeds the
-- PageDefinitions row for its dashboard (module strip entry, sidebar,
-- and route are code-only, no DB change needed for those).
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'maintenance-dashboard' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('maintenance-dashboard', 'Maintenance Dashboard', 'Maintenance', 'Maintenance', 'view', 240, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions maintenance-dashboard';
END
ELSE
  PRINT 'PageDefinitions maintenance-dashboard already exists';
GO

PRINT '403-maintenance-module-scaffold applied successfully.';
GO
