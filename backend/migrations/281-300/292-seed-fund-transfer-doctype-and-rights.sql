-- Migration 292: Seed Fund Transfer document type, page definition, and
-- baseline role rights (mirrors 159/164/166 for Journal Voucher).

DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FT')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, links_to, CreatedBy, CreatedAt)
  VALUES ('FT', 'FT', 'Fund Transfer', 1, 5, 1, @EId_ANY, 'Fund Transfer', 'migration', GETDATE());
GO

IF NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fund-transfer' AND IsActive = 1
)
BEGIN
  INSERT INTO dbo.PageDefinitions
    (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES
    ('fund-transfer', 'Fund Transfer', 'Finance', 'Finance',
     'view,create,edit,delete,print,export', 61, 1, 'migration-292', GETDATE());
  PRINT 'Inserted: fund-transfer';
END
ELSE
  PRINT 'Already exists: fund-transfer';
GO

-- Only "Account's Head" (RId=5) may initiate a Fund Transfer by default,
-- same concept as Journal Voucher / Inter-Company Transfer (migration 166)
-- -- approval stays restricted to super_admin in code regardless of this.
DECLARE @AccountsHeadRoleId INT = 5;

IF NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights
  WHERE RoleId = @AccountsHeadRoleId AND Module = 'Finance' AND SubModule = 'Fund Transfer'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@AccountsHeadRoleId, 'Finance', 'Fund Transfer', 1, 1, 0, 0);
  PRINT 'Inserted: Account''s Head -> Finance / Fund Transfer (view, create)';
END
ELSE
  PRINT 'Already exists: Account''s Head -> Finance / Fund Transfer';
GO

SELECT PageKey, Label, Module, GroupName, IsActive FROM dbo.PageDefinitions WHERE PageKey = 'fund-transfer';
SELECT DocNoPrefix, Description, links_to FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FT';
GO
