-- Migration 441: seed the last 4 dev-only PageDefinitions rows into
-- production, completing the dev/prod alignment started in migration 440.
--
-- All four are real, currently-routed pages (confirmed via usePageRights()/
-- ProtectedRoute pageKey in src/), just never seeded on production:
--   - civilworkdpr-work-done (WorkDone.tsx, Civil Work DPR module)
--   - room-category-master (RoomCategoryMaster.tsx, Civil Work DPR Setup)
--   - room-composition-builder (RoomCompositionBuilder.tsx, Civil Work DPR Setup)
--   - year-end-close (YearEndClose.tsx, Finance)
--
-- Idempotent both directions: no-op on dev (already present), inserts on
-- production.

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-work-done')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('civilworkdpr-work-done', 'Work Done', 'Civil Work DPR', 'Civil Work DPR', 'view,create,edit,delete', 16, 1, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'room-category-master')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('room-category-master', 'Room Category Master', 'Civil Work DPR', 'Setup', 'view,create,edit,delete', 22, 1, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'room-composition-builder')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('room-composition-builder', 'Room Composition Builder', 'Civil Work DPR', 'Setup', 'view,create,edit,delete', 23, 1, 'migration', GETDATE());
END

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'year-end-close')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('year-end-close', 'Year End Close', 'Finance', 'Finance', 'view,create,edit,delete,print,export', 27, 1, 'migration', GETDATE());
END

PRINT 'Seeded 4 remaining dev-only PageDefinitions rows';
GO
