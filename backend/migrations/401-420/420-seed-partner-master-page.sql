-- Migration 420: Seed PageDefinitions row + role grant for the new Partner
-- Master page (Finance sidebar, Finance Masters group). Same pattern
-- migration 392 established for Vendor Ledger — without this, RoleId=5
-- "Account's Head" (Finance module owner) would see the sidebar link but
-- every fetch would silently 403 until someone noticed and granted it by
-- hand.

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'partner-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Partner Master', Module = N'Finance', GroupName = N'Finance Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 195, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'partner-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'partner-master', N'Partner Master', N'Finance', N'Finance Masters', N'view,create,edit,delete,print,export', 195, 1, N'migration-420', SYSDATETIME());
GO

DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Partner Master'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanExport)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Partner Master', 1, 1, 1, 1, 1);
  PRINT 'Inserted: Account''s Head -> Finance / Partner Master (view, create, edit, delete, export)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Partner Master';
GO

PRINT '420-seed-partner-master-page applied successfully.';
GO
