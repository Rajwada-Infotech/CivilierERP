-- Migration 462: daily-update checkpoints.
--
-- Some Work Checkpoint Master entries ("Curing", "Watering") aren't a one-off yes/no
-- — they're something the site does every day for a stretch. Marking a checkpoint
-- IsDaily makes Work Allocation show a calendar + live-camera control on it, so a
-- daily update (photo + optional note) can be logged for each date.
--
--   dbo.ActivityCheckpoint.IsDaily            — the master flag (the "calendar mark")
--   dbo.DependencyActivityCheckpoint.IsDaily  — snapshot taken when it's attached to a
--                                               rung, same convention as MinWaitDays
--   dbo.DependencyActivityCheckpointUpdate    — one row per checkpoint per date

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ActivityCheckpoint') AND name = 'IsDaily')
BEGIN
  ALTER TABLE dbo.ActivityCheckpoint ADD IsDaily BIT NOT NULL CONSTRAINT DF_ActivityCheckpoint_IsDaily DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.DependencyActivityCheckpoint') AND name = 'IsDaily')
BEGIN
  ALTER TABLE dbo.DependencyActivityCheckpoint ADD IsDaily BIT NOT NULL CONSTRAINT DF_DependencyActivityCheckpoint_IsDaily DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DependencyActivityCheckpointUpdate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DependencyActivityCheckpointUpdate (
    Id                     INT IDENTITY(1,1) PRIMARY KEY,
    AssignmentCheckpointId INT NOT NULL,
    UpdateDate             DATE NOT NULL,
    Photo                  VARBINARY(MAX) NULL,
    PhotoMime              NVARCHAR(100) NULL,
    Note                   NVARCHAR(500) NULL,
    CreatedBy              NVARCHAR(200) NULL,
    CreatedAt              DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy              NVARCHAR(200) NULL,
    UpdatedAt              DATETIME2(3) NULL,
    CONSTRAINT FK_CheckpointUpdate_Checkpoint
      FOREIGN KEY (AssignmentCheckpointId) REFERENCES dbo.DependencyActivityCheckpoint(Id) ON DELETE CASCADE,
    -- One update per checkpoint per day; retaking the photo replaces it.
    CONSTRAINT UQ_CheckpointUpdate_Day UNIQUE (AssignmentCheckpointId, UpdateDate)
  );
END
GO

PRINT '462-checkpoint-daily-updates applied successfully.';
GO
