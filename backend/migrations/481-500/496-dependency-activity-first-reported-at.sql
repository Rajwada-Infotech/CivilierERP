-- Migration 496: StartDate on a Civil Work DPR assignment is only ever a
-- tentative plan — the real measure of how promptly work actually began is
-- when the assigned engineer reports progress for the first time (see
-- migration 495 / the ALLOCATED -> IN_PROGRESS fix in
-- dependencyActivityAssignment.js). FirstReportedAt captures that exact
-- date, set once (never overwritten) the first time PATCH /:rungId/status
-- flips a PENDING/ALLOCATED activity to IN_PROGRESS, so
-- (FirstReportedAt - StartDate) is the actual delay before work began —
-- 0 or negative means it started on time, positive means that many days late.
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'DependencyActivityAssignment' AND COLUMN_NAME = 'FirstReportedAt'
)
  ALTER TABLE dbo.DependencyActivityAssignment ADD FirstReportedAt DATE NULL;
GO

PRINT '496-dependency-activity-first-reported-at applied successfully.';
GO
