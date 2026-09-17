-- Migration 454: Item Master gains a "Day of Supplies" field -- a numeric
-- lead-time/reorder value the item master can tag per item.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Item_Master_Group') AND name = 'M_DayOfSupplies')
  ALTER TABLE dbo.Item_Master_Group ADD M_DayOfSupplies INT NULL;
GO

PRINT '454-item-master-day-of-supplies applied successfully.';
GO
