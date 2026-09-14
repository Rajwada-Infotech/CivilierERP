-- Migration 298: Page definitions for the new Query Payment / Registry
-- CRM stages (mirrors migration 152's crm-noc / crm-sales-deed pattern).

DECLARE @base INT = 900;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-query-payment', 'Query Payment (Stamp Duty / Registration)', 'CRM', 'CRM Legal', 'view,create,edit', @base + 5,  1, 'migration-298'),
  ('crm-registry',      'Registry',                                  'CRM', 'CRM Legal', 'view,create,edit', @base + 10, 1, 'migration-298')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey IN ('crm-query-payment', 'crm-registry');
GO
