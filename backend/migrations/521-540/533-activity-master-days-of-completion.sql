-- Migration 533: "Days of completion" on Activity Master (Civil Work DPR) — the
-- number of days an activity is expected to take. Activities only
-- (activity_type = 1); Groups (activity_type = 0) leave it NULL, the same
-- convention as hsn_code and gl_head_id. Optional: NULL = not set.
-- Safe to re-run.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityMaster') AND name = 'days_of_completion'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster ADD days_of_completion INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints WHERE name = 'CK_ActivityMaster_DaysOfCompletion'
)
BEGIN
  ALTER TABLE dbo.ActivityMaster
    ADD CONSTRAINT CK_ActivityMaster_DaysOfCompletion
    CHECK (days_of_completion IS NULL OR (days_of_completion BETWEEN 1 AND 3650));
END
GO

PRINT 'Migration 533: ActivityMaster.days_of_completion.';
GO
