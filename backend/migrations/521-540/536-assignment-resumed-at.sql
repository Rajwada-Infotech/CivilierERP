-- Migration 536: when an activity was put back In Progress after being on Hold.
-- Work Reporting shows such an activity as "Resumed" (and its timeline hint counts the days left,
-- with the days on hold still on the clock). Set when Status goes HOLD → IN_PROGRESS, cleared when
-- it goes on hold again; NULL for everything else, so existing rows are unchanged.

IF COL_LENGTH('dbo.DependencyActivityAssignment', 'ResumedAt') IS NULL
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD ResumedAt DATETIME2 NULL;
  PRINT 'Migration 536: added DependencyActivityAssignment.ResumedAt.';
END
GO
