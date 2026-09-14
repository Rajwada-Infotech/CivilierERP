-- Migration 267: "Done" workflow for Task Follow-Ups — lets a user mark the
-- current/latest follow-up reminder as completed before logging the next
-- one, instead of the reminder just silently rolling off once its date
-- passes.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskFollowUps') AND name = 'IsDone'
)
BEGIN
  ALTER TABLE dbo.TaskFollowUps ADD IsDone BIT NOT NULL CONSTRAINT DF_TaskFollowUps_IsDone DEFAULT 0;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskFollowUps') AND name = 'DoneAt'
)
BEGIN
  ALTER TABLE dbo.TaskFollowUps ADD DoneAt DATETIME2 NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TaskFollowUps') AND name = 'DoneBy'
)
BEGIN
  ALTER TABLE dbo.TaskFollowUps ADD DoneBy INT NULL;
  ALTER TABLE dbo.TaskFollowUps
    ADD CONSTRAINT FK_TaskFollowUps_DoneBy FOREIGN KEY (DoneBy) REFERENCES dbo.users(id);
END
GO
