-- Migration 455: Item Master gains a "Days of Supply" field -- a second,
-- distinct numeric field from Day of Supplies (migration 454).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Item_Master_Group') AND name = 'M_DaysOfSupply')
  ALTER TABLE dbo.Item_Master_Group ADD M_DaysOfSupply INT NULL;
GO

PRINT '455-item-master-days-of-supply applied successfully.';
GO
