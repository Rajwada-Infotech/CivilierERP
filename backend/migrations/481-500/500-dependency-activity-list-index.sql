-- Migration 500: index to support GET /api/dependency-activity-assignment
-- (ActivityReporting.tsx's main list) — that query filters on IsCurrent
-- and sorts by UpdatedAt DESC, with no index covering either, so it was a
-- full clustered-index scan + sort over every row in the table on every
-- page load, before even reaching the per-row correlated subqueries
-- (engineer/QC names, QC status, materials). Grows worse every day as
-- more assignment rows accumulate — see the route's own comment and the
-- new pagination/limit added alongside this migration.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_DependencyActivityAssignment_Current_Updated'
    AND object_id = OBJECT_ID('dbo.DependencyActivityAssignment')
)
BEGIN
  CREATE INDEX IX_DependencyActivityAssignment_Current_Updated
    ON dbo.DependencyActivityAssignment (IsCurrent, UpdatedAt DESC)
    INCLUDE (Status, DependencyMasterActivityId);
END
GO

PRINT '500-dependency-activity-list-index applied successfully.';
GO
