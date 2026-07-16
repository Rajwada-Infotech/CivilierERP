-- Migration 122: Seed customer-master page definition
-- CustomerMaster page at /masters/customers uses usePageRights("customer-master")
-- but this key was missing from dbo.PageDefinitions (migration 117/121 seeded
-- followup-customer-master but not the standalone masters/customers page key).

IF NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'customer-master' AND IsActive = 1
)
BEGIN
  INSERT INTO dbo.PageDefinitions
    (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES
    ('customer-master', 'Customer Master', 'Masters', 'Masters',
     'view,create,edit,delete,print,export', 48, 1, 'migration-122', GETDATE());
  PRINT 'Inserted: customer-master';
END
ELSE
BEGIN
  PRINT 'Already exists: customer-master';
END
GO

-- Verify
SELECT PageKey, Label, Module, GroupName, IsActive
FROM dbo.PageDefinitions
WHERE PageKey = 'customer-master';
GO