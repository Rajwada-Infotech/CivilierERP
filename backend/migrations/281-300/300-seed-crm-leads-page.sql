-- Migration 300: Page definition for the new CRM Leads pool page
-- (converted SA leads awaiting Application creation). Mirrors migration
-- 298's crm-query-payment / crm-registry pattern.

DECLARE @base INT = 850;

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-leads', 'Leads', 'CRM', 'CRM Leads', 'view,edit', @base, 1, 'migration-300')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey IN ('crm-leads');
GO
