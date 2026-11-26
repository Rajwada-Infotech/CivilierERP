-- Migration 307: Page definition for the new Brokerage Rate Tier master
-- (companion to migration 306's dbo.CrmBrokerageRateTier table).

MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-brokerage-rate-tiers', 'Brokerage Rate Tiers', 'CRM', 'CRM Setup', 'view,create,edit,delete', 870, 1, 'migration-307')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey IN ('crm-brokerage-rate-tiers');
GO
