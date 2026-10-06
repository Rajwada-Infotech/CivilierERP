-- Migration 538: indexes behind Reporting's project filter (GET
-- /api/dependency-activity-assignment/scope-summary?projectId=). With 400k+
-- current assignments the per-project aggregates had no way to go from a
-- project to its assignments except scanning every current row: the existing
-- filtered unique index on (DependencyMasterActivityId) WHERE IsCurrent = 1
-- doesn't carry Status, so every counted row cost a lookup too.

-- Project -> its chains, with the location columns the room grouping needs.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyMaster_Project_Cover' AND object_id = OBJECT_ID('dbo.DependencyMaster'))
BEGIN
  CREATE INDEX IX_DependencyMaster_Project_Cover
    ON dbo.DependencyMaster (ProjectId)
    INCLUDE (TowerId, Floor, FlatId, RoomId, Alias);
END
GO

-- Chain -> its rungs, carrying the activity id so the join needs no lookup.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyMasterActivity_Master_Cover' AND object_id = OBJECT_ID('dbo.DependencyMasterActivity'))
BEGIN
  CREATE INDEX IX_DependencyMasterActivity_Master_Cover
    ON dbo.DependencyMasterActivity (DependencyMasterId)
    INCLUDE (ActivityId);
END
GO

-- Rung -> its current assignment's status, index-only.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityAssignment_Rung_Current_Status' AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment'))
BEGIN
  CREATE INDEX IX_DependencyActivityAssignment_Rung_Current_Status
    ON dbo.DependencyActivityAssignment (DependencyMasterActivityId)
    INCLUDE (Status)
    WHERE IsCurrent = 1;
END
GO

PRINT '538-reporting-project-filter-indexes applied successfully.';
GO
