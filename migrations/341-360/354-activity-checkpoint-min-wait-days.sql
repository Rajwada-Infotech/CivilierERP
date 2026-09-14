-- Migration 354: Minimum wait duration on checkpoints — some checkpoints
-- ("Curing done for 7 days") aren't just a yes/no, they can't honestly be
-- checked off until N days have passed since the activity's own start
-- date. MinWaitDays is optional (NULL = no wait, checkable any time, same
-- as today's behavior).
--
-- Added to both the master template (dbo.ActivityCheckpoint) and the
-- per-assignment snapshot (dbo.DependencyActivityCheckpoint, migration
-- 338) — the snapshot already copies FieldName off the master at the
-- moment a checkpoint is added to a rung's checklist rather than joining
-- live, and MinWaitDays follows that same convention so a later edit to
-- the master template doesn't retroactively change the wait rule for
-- checklists already in progress.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityCheckpoint') AND name = 'MinWaitDays'
)
BEGIN
  ALTER TABLE dbo.ActivityCheckpoint ADD MinWaitDays INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityCheckpoint') AND name = 'MinWaitDays'
)
BEGIN
  ALTER TABLE dbo.DependencyActivityCheckpoint ADD MinWaitDays INT NULL;
END
GO
