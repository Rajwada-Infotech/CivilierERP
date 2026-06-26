-- Migration 124: Seed Inside Work > Activity page definition.
-- This page is currently a read-only placeholder (no audit data source
-- wired up yet — see dbo.FollowupAuditLog for the audit-log shape this
-- will eventually read from, once Inside Work writes its own activity
-- trail). Seeding the page definition now so it shows up correctly in
-- the Menu Rights admin screen and can be granted ahead of time.
-- Safe to re-run: insert is guarded.

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'insidework-activity' AND IsActive = 1)
  BEGIN
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('insidework-activity', 'Activity', 'Inside Work', 'Inside Work', 'view', 15, 1, 'migration', GETDATE());
  END
END

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Inside Work'
ORDER BY SortOrder;
