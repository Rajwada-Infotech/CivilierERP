-- Migration 294: Seed PageDefinitions row for the new Cheque Cancellation page
-- (Finance → Transaction → Cheque Cancellation, below BRS).

IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'cheque-cancellation')
  UPDATE dbo.PageDefinitions
    SET Label = N'Cheque Cancellation', Module = N'Finance', GroupName = N'Finance',
        Actions = N'view,create,edit,export', SortOrder = 51, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'cheque-cancellation';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'cheque-cancellation', N'Cheque Cancellation', N'Finance', N'Finance', N'view,create,edit,export', 51, 1, N'migration-294', SYSDATETIME());
GO

PRINT '294-seed-cheque-cancellation-page applied successfully.';
GO
