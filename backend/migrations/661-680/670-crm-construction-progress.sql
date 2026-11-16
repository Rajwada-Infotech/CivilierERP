-- Migration 670: Construction progress read live from the DPR module.
--   * CrmMilestoneMaster.DprGroupId: the DPR work (a work group, ActivityMaster with activity_type = 0) a payment
--     milestone waits for. When that work reaches 100% for a booking's unit (else its tower, else the project), the
--     booking's milestone is shown as ready to demand; staff raise the demand. Left empty, the milestone is matched to
--     the DPR work of the same name (e.g. PLASTERING <-> 5. PLASTERING), if there is one.
--   * An index for reading every live step's current assignment in one pass.
-- Safe to run again.
IF COL_LENGTH('dbo.CrmMilestoneMaster', 'DprGroupId') IS NULL
  ALTER TABLE dbo.CrmMilestoneMaster ADD DprGroupId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityAssignment_Current' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment'))
  CREATE INDEX IX_DependencyActivityAssignment_Current ON dbo.DependencyActivityAssignment(DependencyMasterActivityId)
    INCLUDE (Status, ProgressPercent, Days, UpdatedAt, EndDate) WHERE IsCurrent = 1;
GO
PRINT 'Migration 670 complete: construction progress from DPR';
