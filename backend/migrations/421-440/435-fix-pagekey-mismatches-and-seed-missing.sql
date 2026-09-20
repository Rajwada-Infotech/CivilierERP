-- Migration 435: fix PageKey mismatches between dbo.PageDefinitions and
-- what the actual page components check via usePageRights()/requirePageRight(),
-- and seed the one page with no definition row at all.
--
-- Cross-referenced every usePageRights("...")/pageKey prop in src/ and every
-- requirePageRight("...") in backend/routes/ against PageDefinitions.PageKey.
-- Found 6 rows whose PageKey didn't match what the running page actually
-- checks — a real bug, not cosmetic: MenuRights.tsx lets an admin "grant"
-- access under the DB's (wrong) key, RoleRights/user pagePermissions save
-- under that same wrong key, but the page itself checks a different string
-- — so a non-privileged user could never actually be granted access to
-- these pages through Menu Rights no matter what an admin toggled there.
-- Confirmed via full trace: AuthContext's canDoAction/canAccessPage match
-- by exact page-key string (auth.utils.ts), sourced from whatever key was
-- saved (roles.js's /:roleId/rights, users.js's pagePermissions) — which is
-- always whatever PageDefinitions.PageKey MenuRights.tsx was showing at
-- save time. No separate data migration needed for RoleRights/user
-- pagePermissions themselves: neither references PageDefinitions by
-- id — both are keyed by this same string, read fresh from the corrected
-- PageDefinitions on next save, so fixing the key here is sufficient going
-- forward (any already-saved grant under the old, never-actually-checked
-- key was already inert).
--
-- Labels also corrected to match each page's real on-screen title where
-- they'd drifted (e.g. "Menu Types Master" -> "Menu Type Master", matching
-- MenuTypeMaster.tsx's own <PageHeader title>).

UPDATE dbo.PageDefinitions SET PageKey = 'admin-signatures', Label = 'Digital Signatures' WHERE PageKey = 'signature';
UPDATE dbo.PageDefinitions SET PageKey = 'widgets-rights', Label = 'Widgets Rights' WHERE PageKey = 'widget-rights';
UPDATE dbo.PageDefinitions SET PageKey = 'roles' WHERE PageKey = 'role-master';
UPDATE dbo.PageDefinitions SET PageKey = 'menu-type', Label = 'Menu Type Master' WHERE PageKey = 'menu-types';
UPDATE dbo.PageDefinitions SET PageKey = 'contractor-category' WHERE PageKey = 'contractor-categories';
UPDATE dbo.PageDefinitions SET PageKey = 'godown-master' WHERE PageKey = 'godowns';

-- menu-master (MenuMaster.tsx, usePageRights("menu-master")) had no
-- PageDefinitions row at all — seeded alongside its sibling menu-type,
-- same Setup group and Actions set.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'menu-master')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('menu-master', 'Menu Master', 'Admin', 'Setup', 'view,create,edit,delete,print,export', 235, 1, 'migration', GETDATE());
END

PRINT 'Fixed 6 PageKey mismatches and seeded menu-master';
GO
