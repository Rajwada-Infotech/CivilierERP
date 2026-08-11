-- Migration 318: remove Cost Centre from Activity Master (migration 315) —
-- decided unnecessary; GL Head stays.

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActivityMaster_CostCenter'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster DROP CONSTRAINT FK_ActivityMaster_CostCenter;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityMaster') AND name = 'cost_center_id'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster DROP COLUMN cost_center_id;
END
GO

PRINT '318-drop-activity-master-cost-centre applied successfully.';
GO
