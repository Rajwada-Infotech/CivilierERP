-- Migration 456: removes M_DayOfSupplies (migration 454) -- superseded by
-- the separate Days of Supply field (M_DaysOfSupply, migration 455); the
-- singular-named field was not needed and is dropped.

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Item_Master_Group') AND name = 'M_DayOfSupplies')
  ALTER TABLE dbo.Item_Master_Group DROP COLUMN M_DayOfSupplies;
GO

PRINT '456-item-master-drop-day-of-supplies applied successfully.';
GO
