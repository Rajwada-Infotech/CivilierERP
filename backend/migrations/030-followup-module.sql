-- Migration 030: Followup module support
-- Adds task module filtering support and creates the FollowupLog table.

IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME = 'Tasks'
    AND COLUMN_NAME = 'Module'
)
BEGIN
  ALTER TABLE dbo.Tasks ADD Module NVARCHAR(50) NULL;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_Tasks_Module'
    AND object_id = OBJECT_ID('dbo.Tasks')
)
BEGIN
  CREATE INDEX IX_Tasks_Module ON dbo.Tasks(Module);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FollowupLog (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    LogDate DATE NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    LogType NVARCHAR(20) NOT NULL DEFAULT 'note',
    Customer NVARCHAR(255) NOT NULL,
    Amount DECIMAL(18,2) NULL,
    RefId INT NULL,
    Notes NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(100) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(100) NULL,
    UpdatedAt DATETIME2 NULL,
    IsDeleted BIT NOT NULL DEFAULT 0
  );
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_FollowupLog_LogDate'
    AND object_id = OBJECT_ID('dbo.FollowupLog')
)
BEGIN
  CREATE INDEX IX_FollowupLog_LogDate ON dbo.FollowupLog(LogDate);
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = 'IX_FollowupLog_Customer'
    AND object_id = OBJECT_ID('dbo.FollowupLog')
)
BEGIN
  CREATE INDEX IX_FollowupLog_Customer ON dbo.FollowupLog(Customer);
END

PRINT 'Followup module migration applied successfully';
