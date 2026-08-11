-- Migration 315: Cost Centre + GL Head fields on Activity Master, for
-- Activities only (activity_type = 1) — Groups (activity_type = 0) leave
-- both NULL, same convention already used for hsn_code.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityMaster') AND name = 'cost_center_id'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster ADD cost_center_id INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityMaster') AND name = 'gl_head_id'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster ADD gl_head_id INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActivityMaster_CostCenter'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster
    ADD CONSTRAINT FK_ActivityMaster_CostCenter FOREIGN KEY (cost_center_id)
    REFERENCES dbo.CostCenter(CostCenterId);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActivityMaster_GLHead'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster
    ADD CONSTRAINT FK_ActivityMaster_GLHead FOREIGN KEY (gl_head_id)
    REFERENCES dbo.AccountHeadMaster(LHeadId);
END
GO

PRINT '315-activity-master-cost-centre-gl-head applied successfully.';
GO
