-- Migration 392: Seed PageDefinitions row + role grant for the new Vendor
-- Ledger Report page (Finance sidebar, Query section — next to Balance
-- Enquiry). Grants RoleId=5 "Account's Head" (Finance module owner) view +
-- export straight away, same pattern migration 306 established for Balance
-- Enquiry, so this doesn't repeat that bug (page visible but every fetch
-- silently 403's for every non-superuser role until a follow-up migration
-- notices).

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'vendor-ledger')
  UPDATE dbo.PageDefinitions
    SET Label = N'Vendor Ledger', Module = N'Finance', GroupName = N'Finance',
        Actions = N'view,export', SortOrder = 56, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'vendor-ledger';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'vendor-ledger', N'Vendor Ledger', N'Finance', N'Finance', N'view,export', 56, 1, N'migration-392', SYSDATETIME());
GO

DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Vendor Ledger'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanExport)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Vendor Ledger', 1, 0, 0, 0, 1);
  PRINT 'Inserted: Account''s Head -> Finance / Vendor Ledger Report (view, export)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Vendor Ledger Report';
GO

PRINT '392-seed-vendor-ledger-page applied successfully.';
GO
