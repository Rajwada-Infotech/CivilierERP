-- Migration 163: Register On A/C Adjustment page definition
MERGE dbo.PageDefinitions AS tgt
USING (VALUES (
  'on-account-adjustment',
  'On A/C Adjustment',
  'Finance',
  'Transactions',
  '["view","create"]',
  95,
  1
)) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive)
ON tgt.PageKey = src.PageKey
WHEN MATCHED THEN UPDATE SET
  Label     = src.Label,
  Module    = src.Module,
  GroupName = src.GroupName,
  SortOrder = src.SortOrder,
  IsActive  = src.IsActive
WHEN NOT MATCHED THEN INSERT
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive);

PRINT 'Seeded On A/C Adjustment page definition';
