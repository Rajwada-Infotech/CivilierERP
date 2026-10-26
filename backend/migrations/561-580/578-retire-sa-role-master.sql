-- 578-retire-sa-role-master.sql
-- SA Role Master (sa-role-master) duplicated the generic Menu Rights page
-- (Rights > Menu / checkPermission("Rights","Menu",...)) — every sa-* page
-- key, including sa-role-master itself, was already registered in
-- dbo.PageDefinitions under Module='Sales Automation' (migration 142), so
-- Menu Rights could already set role-level AND per-user permissions for
-- every SA page. The marketing_head role previously used sa-role-master to
-- self-serve SA permission management without needing admin/super_admin/dba
-- access. This migration:
--   1. Deactivates the sa-role-master PageDefinitions row (soft-delete,
--      matching the DELETE /api/page-definitions/:id convention).
--   2. Grants marketing_head Rights/Menu CanView+CanEdit (role-level), so
--      they keep the ability to manage SA role-level permissions through
--      Menu Rights. Per-user override editing stays admin/super_admin/dba-
--      only on the backend (backend/routes/userRights.js has no
--      page-scoping at all — see src/pages/admin/MenuRights.tsx's
--      isAdminTier gate on the frontend for why this is deliberate, not
--      an oversight).
--   3. Updates the one seeded marketing_head user's UserPageRightsJson
--      override row the same way, if present.
-- Idempotent: every write is guarded (NOT EXISTS / EXISTS-ELSE).

-- 1. Deactivate the retired page definition.
UPDATE dbo.PageDefinitions
SET IsActive = 0, UpdatedAt = SYSDATETIME()
WHERE PageKey = N'sa-role-master' AND IsActive = 1;

-- 2. Grant marketing_head role-level Rights/Menu view+edit.
DECLARE @ridMarketingHead INT = (SELECT RId FROM dbo.Role WHERE RName = N'marketing_head');
IF @ridMarketingHead IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.RoleRights WHERE RoleId = @ridMarketingHead AND Module = N'Rights' AND ISNULL(SubModule,'') = N'Menu')
    UPDATE dbo.RoleRights SET CanView = 1, CanEdit = 1
    WHERE RoleId = @ridMarketingHead AND Module = N'Rights' AND ISNULL(SubModule,'') = N'Menu';
  ELSE
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
    VALUES (@ridMarketingHead, N'Rights', N'Menu', 1, 0, 1, 0, 0, 0, 0);
END
GO

-- 3. Replace the retired page's entry in the one seeded marketing_head
--    user's UserPageRightsJson override, if that row exists and still
--    references sa-role-master.
UPDATE dbo.UserPageRightsJson
SET RightsJson = REPLACE(
      RightsJson,
      N'{"page":"sa-role-master","actions":["view","print"]}',
      N'{"page":"menu-rights","actions":["view","edit"]}'
    ),
    UpdatedAt = GETDATE()
WHERE IsActive = 1
  AND RightsJson LIKE N'%"page":"sa-role-master"%';
GO

PRINT '578-retire-sa-role-master: done';
