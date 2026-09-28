-- Migration 491: restoring a Cancelled Civil Work DPR activity — only
-- super_admin, and only after reviewing its full detail (see the Restore
-- button in ActivityDetailModal.tsx). Needs to know what the activity's
-- Status actually was right before it got cancelled, since a Cancel is
-- now reachable from any stage (see the earlier "Cancel at any stage"
-- change) — restoring an activity that had already cleared its Approval
-- Setup should put it back at APPROVED, not silently reopen it; anything
-- else goes back to IN_PROGRESS regardless of exactly where it was
-- (PENDING/HOLD/COMPLETED/REWORK all just mean "not yet approved").
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DependencyActivityAssignment') AND name = 'PreCancelStatus'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityAssignment ADD PreCancelStatus NVARCHAR(20) NULL;
END
GO

PRINT '491-dependency-activity-restore-cancelled applied successfully.';
GO
