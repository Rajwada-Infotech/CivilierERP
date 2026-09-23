-- 469: Per-Activity checkpoint template — restores migration 337's original
-- intent ("each Activity gets its own list of named checkpoints ... to
-- check off later during work reporting/verification"), which migration 461
-- had flattened into one general catalog picked manually per rung in Work
-- Allocation instead. This adds back the per-Activity link, this time as its
-- own junction table (ActivityCheckpointTemplate) so the general catalog
-- (dbo.ActivityCheckpoint, "Work Checkpoint Master") stays reusable across
-- activities rather than reverting to one-row-per-activity.
--
-- New flow: Activity Master tags which catalog checkpoints apply to an
-- Activity (this table). A rung's assignment auto-seeds its own checklist
-- from this the first time it's viewed (dependencyActivityAssignment.js GET
-- /:rungId), instead of being picked by hand in Work Allocation. Work
-- Allocation (RungAssignmentModal, "allocation" context) then only shows
-- them read-only; Work Reporting (ActivityDetailModal's new Checkpoints tab)
-- is where the actual check-off happens.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ActivityCheckpointTemplate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ActivityCheckpointTemplate (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    ActivityId   INT NOT NULL,
    CheckpointId INT NOT NULL,
    SortOrder    INT NOT NULL DEFAULT 0,
    CreatedBy    NVARCHAR(200) NULL,
    CreatedAt    DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityCheckpointTemplate_Activity
      FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id) ON DELETE CASCADE,
    -- NO ACTION (not CASCADE) — dbo.ActivityCheckpoint already has its own
    -- (unused, nullable) ON DELETE CASCADE path back to ActivityMaster
    -- (migration 337), so a second cascade path from ActivityMaster through
    -- this table to ActivityCheckpoint would give SQL Server two ways to
    -- reach the same row ("may cause cycles or multiple cascade paths") and
    -- the CREATE TABLE is rejected outright. Deleting a still-tagged
    -- catalog checkpoint fails loudly with an FK error instead — detach it
    -- from every activity in Activity Master first.
    CONSTRAINT FK_ActivityCheckpointTemplate_Checkpoint
      FOREIGN KEY (CheckpointId) REFERENCES dbo.ActivityCheckpoint(Id)
  );
  CREATE UNIQUE INDEX UX_ActivityCheckpointTemplate_Activity_Checkpoint
    ON dbo.ActivityCheckpointTemplate(ActivityId, CheckpointId);

  PRINT 'Created dbo.ActivityCheckpointTemplate';
END
ELSE
  PRINT 'dbo.ActivityCheckpointTemplate already exists — skipping create';
GO
