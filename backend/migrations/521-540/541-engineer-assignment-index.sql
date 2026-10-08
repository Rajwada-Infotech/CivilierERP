-- Migration 541: engineer -> assignments lookup. Work Transfer (and anything else that starts from an
-- engineer) joins DependencyActivityEngineer on EngineerId alone, but its only indexes lead with
-- AssignmentId (the unique key), so every lookup scanned the whole table. This index goes
-- engineer -> assignment directly.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DependencyActivityEngineer_Engineer' AND object_id = OBJECT_ID('dbo.DependencyActivityEngineer'))
BEGIN
  CREATE INDEX IX_DependencyActivityEngineer_Engineer
    ON dbo.DependencyActivityEngineer (EngineerId)
    INCLUDE (AssignmentId);
END
GO

PRINT '541-engineer-assignment-index applied successfully.';
GO
