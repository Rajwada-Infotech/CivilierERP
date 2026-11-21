-- Migration 622: indexes for the queries that cost the database the most time
--
-- Measured on production (sys.dm_exec_query_stats / sys.dm_db_missing_index_*, 2026-11-04). Each index below is
-- one the database itself reported missing, for a query that was among the most expensive:
--   - the DPR tag list counts every activity per tag (26,500 runs, a 412,000-row scan each time) → TagId;
--   - work lists and counts keep only live chains of a project → DependencyMaster (IsActive, ProjectId);
--   - the DPR dashboard's 14-day "assigned" / "completed" charts → CreatedAt, and Status + UpdatedAt;
--   - overdue / due-soon counts over current attempts → Status + EndDate, current attempts only;
--   - each activity's photos (600,000 look-ups) → ActivityPhoto by activity;
--   - bank and account pickers filter account heads by type and status (91% estimated gain).
-- Only adds indexes; no data changes. Safe to re-run.

IF COL_LENGTH('dbo.DependencyMasterActivity', 'TagId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyMasterActivity_Tag' AND object_id = OBJECT_ID('dbo.DependencyMasterActivity'))
BEGIN
  CREATE INDEX IX_DependencyMasterActivity_Tag ON dbo.DependencyMasterActivity (TagId) WHERE TagId IS NOT NULL;
  PRINT 'Added IX_DependencyMasterActivity_Tag';
END
GO

IF COL_LENGTH('dbo.DependencyMaster', 'IsActive') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyMaster_Active_Project' AND object_id = OBJECT_ID('dbo.DependencyMaster'))
BEGIN
  CREATE INDEX IX_DependencyMaster_Active_Project ON dbo.DependencyMaster (IsActive, ProjectId);
  PRINT 'Added IX_DependencyMaster_Active_Project';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityAssignment_CreatedAt' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment'))
BEGIN
  CREATE INDEX IX_DependencyActivityAssignment_CreatedAt
    ON dbo.DependencyActivityAssignment (CreatedAt) INCLUDE (DependencyMasterActivityId);
  PRINT 'Added IX_DependencyActivityAssignment_CreatedAt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityAssignment_Status_Updated' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment'))
BEGIN
  CREATE INDEX IX_DependencyActivityAssignment_Status_Updated
    ON dbo.DependencyActivityAssignment (Status, UpdatedAt) INCLUDE (DependencyMasterActivityId);
  PRINT 'Added IX_DependencyActivityAssignment_Status_Updated';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityAssignment_Current_Status_End' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment'))
BEGIN
  CREATE INDEX IX_DependencyActivityAssignment_Current_Status_End
    ON dbo.DependencyActivityAssignment (Status, EndDate) INCLUDE (DependencyMasterActivityId, ProgressPercent)
    WHERE IsCurrent = 1;
  PRINT 'Added IX_DependencyActivityAssignment_Current_Status_End';
END
GO

IF COL_LENGTH('dbo.ActivityPhoto', 'DependencyMasterActivityId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ActivityPhoto_Rung' AND object_id = OBJECT_ID('dbo.ActivityPhoto'))
BEGIN
  CREATE INDEX IX_ActivityPhoto_Rung ON dbo.ActivityPhoto (DependencyMasterActivityId);
  PRINT 'Added IX_ActivityPhoto_Rung';
END
GO

IF COL_LENGTH('dbo.AccountHeadMaster', 'LHeadType') IS NOT NULL AND COL_LENGTH('dbo.AccountHeadMaster', 'LHeadStatus') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccountHeadMaster_Type_Status' AND object_id = OBJECT_ID('dbo.AccountHeadMaster'))
BEGIN
  CREATE INDEX IX_AccountHeadMaster_Type_Status ON dbo.AccountHeadMaster (LHeadType, LHeadStatus);
  PRINT 'Added IX_AccountHeadMaster_Type_Status';
END
GO

PRINT '622-performance-indexes applied successfully.';
