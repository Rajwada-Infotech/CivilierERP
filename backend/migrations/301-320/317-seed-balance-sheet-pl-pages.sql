-- Migration 317: PageDefinitions rows for the new Balance Sheet and Profit &
-- Loss report pages (Finance sidebar, "Query" submenu — alongside Trial
-- Balance and Balance Enquiry), plus the same RoleRights grant migration 306
-- had to add for Balance Enquiry after the fact — without a RoleRights row,
-- requirePageRight() 403s for every role except the hardcoded
-- super_admin/admin/dba bypass.

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'balance-sheet')
  UPDATE dbo.PageDefinitions
    SET Label = N'Balance Sheet', Module = N'Finance', GroupName = N'Finance',
        Actions = N'view,export', SortOrder = 25, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'balance-sheet';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'balance-sheet', N'Balance Sheet', N'Finance', N'Finance', N'view,export', 25, 1, N'migration-317', SYSDATETIME());

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'profit-and-loss')
  UPDATE dbo.PageDefinitions
    SET Label = N'Profit & Loss', Module = N'Finance', GroupName = N'Finance',
        Actions = N'view,export', SortOrder = 26, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'profit-and-loss';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'profit-and-loss', N'Profit & Loss', N'Finance', N'Finance', N'view,export', 26, 1, N'migration-317', SYSDATETIME());
GO

DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Balance Sheet'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanExport)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Balance Sheet', 1, 0, 0, 0, 1);
  PRINT 'Inserted: Account''s Head -> Finance / Balance Sheet (view, export)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Balance Sheet';

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Profit and Loss'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanExport)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Profit and Loss', 1, 0, 0, 0, 1);
  PRINT 'Inserted: Account''s Head -> Finance / Profit and Loss (view, export)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Profit and Loss';
GO

PRINT '317-seed-balance-sheet-pl-pages applied successfully.';
GO
