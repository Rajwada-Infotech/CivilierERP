-- Migration 128: Seed the Sales Dashboard page definition
-- so the Menu Rights admin screen can grant access to the new
-- /sales dashboard route (pageKey "sales-dashboard").

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'sales-dashboard' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('sales-dashboard', 'Sales Dashboard', 'Sales', 'Sales', 'view', 5, 1, 'migration', GETDATE());
END

SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Sales'
ORDER BY SortOrder;
