-- Migration 268: Task Master timestamp columns were defaulting to
-- SYSDATETIME() (server LOCAL time), but the app/driver round-trips every
-- DATETIME2 value as UTC (mssql's default useUTC:true reads the raw stored
-- digits as UTC and the frontend converts from there). That mismatch made
-- CreatedAt/UpdatedAt/DoneAt display shifted by the server's UTC offset
-- versus a NextReminderAt typed directly by the user (which round-trips
-- correctly through JS Date parsing). Switching the defaults to
-- SYSUTCDATETIME() matches what taskMaster.js's route handlers now pass
-- explicitly, so every clock in Task Master agrees.

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TaskMaster_CreatedAt')
BEGIN
  ALTER TABLE dbo.TaskMaster DROP CONSTRAINT DF_TaskMaster_CreatedAt;
  ALTER TABLE dbo.TaskMaster ADD CONSTRAINT DF_TaskMaster_CreatedAt DEFAULT SYSUTCDATETIME() FOR CreatedAt;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TaskFollowUps_CreatedAt')
BEGIN
  ALTER TABLE dbo.TaskFollowUps DROP CONSTRAINT DF_TaskFollowUps_CreatedAt;
  ALTER TABLE dbo.TaskFollowUps ADD CONSTRAINT DF_TaskFollowUps_CreatedAt DEFAULT SYSUTCDATETIME() FOR CreatedAt;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TaskAttachments_UploadedAt')
BEGIN
  ALTER TABLE dbo.TaskAttachments DROP CONSTRAINT DF_TaskAttachments_UploadedAt;
  ALTER TABLE dbo.TaskAttachments ADD CONSTRAINT DF_TaskAttachments_UploadedAt DEFAULT SYSUTCDATETIME() FOR UploadedAt;
END
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TaskChatMessages_CreatedAt')
BEGIN
  ALTER TABLE dbo.TaskChatMessages DROP CONSTRAINT DF_TaskChatMessages_CreatedAt;
  ALTER TABLE dbo.TaskChatMessages ADD CONSTRAINT DF_TaskChatMessages_CreatedAt DEFAULT SYSUTCDATETIME() FOR CreatedAt;
END
GO
