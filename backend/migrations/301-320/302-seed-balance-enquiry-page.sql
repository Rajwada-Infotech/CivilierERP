-- Migration 302: Seed PageDefinitions row for the new Balance Enquiry page
-- (Finance sidebar, just before Journal Voucher).

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'balance-enquiry')
  UPDATE dbo.PageDefinitions
    SET Label = N'Balance Enquiry', Module = N'Finance', GroupName = N'Finance',
        Actions = N'view,export', SortOrder = 55, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'balance-enquiry';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'balance-enquiry', N'Balance Enquiry', N'Finance', N'Finance', N'view,export', 55, 1, N'migration-302', SYSDATETIME());
GO

PRINT '302-seed-balance-enquiry-page applied successfully.';
GO
