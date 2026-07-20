-- =============================================================================
-- Migration 064: Fix FollowupLog and TenantReminders schema to match routes
-- Safe, idempotent, data-preserving version of the SSMS cleanup script.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) FollowupLog
--    backend/routes/followupLog.js expects:
--      Id, LogDate, LogType, Module, Customer, Amount, RefId, Notes,
--      CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, IsDeleted
-- -----------------------------------------------------------------------------

IF OBJECT_ID('dbo.FollowupLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupLog (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    LogDate    DATE           NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    LogType    NVARCHAR(20)   NOT NULL DEFAULT 'note',
    Module     NVARCHAR(100)  NULL,
    Customer   NVARCHAR(255)  NOT NULL,
    Amount     DECIMAL(18,2)  NULL,
    RefId      INT            NULL,
    Notes      NVARCHAR(MAX)  NULL,
    CreatedBy  NVARCHAR(100)  NULL,
    CreatedAt  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy  NVARCHAR(100)  NULL,
    UpdatedAt  DATETIME2      NULL,
    IsDeleted  BIT            NOT NULL DEFAULT 0
  );

  CREATE INDEX IX_FollowupLog_LogDate ON dbo.FollowupLog (LogDate);
  CREATE INDEX IX_FollowupLog_Customer ON dbo.FollowupLog (Customer);
  CREATE INDEX IX_FollowupLog_RefId ON dbo.FollowupLog (RefId);
END
ELSE
BEGIN
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Date')
    EXEC sp_rename 'dbo.FollowupLog.Date', 'LogDate', 'COLUMN';

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Type')
    EXEC sp_rename 'dbo.FollowupLog.Type', 'LogType', 'COLUMN';

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'User')
  BEGIN
    IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'CreatedBy')
      ALTER TABLE dbo.FollowupLog DROP COLUMN [User];
    ELSE
      EXEC sp_rename 'dbo.FollowupLog.[User]', 'CreatedBy', 'COLUMN';
  END

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'LogDate')
    ALTER TABLE dbo.FollowupLog ADD LogDate DATE NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'LogType')
    ALTER TABLE dbo.FollowupLog ADD LogType NVARCHAR(20) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Module')
    ALTER TABLE dbo.FollowupLog ADD Module NVARCHAR(100) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Customer')
    ALTER TABLE dbo.FollowupLog ADD Customer NVARCHAR(255) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Amount')
    ALTER TABLE dbo.FollowupLog ADD Amount DECIMAL(18,2) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'RefId')
    ALTER TABLE dbo.FollowupLog ADD RefId INT NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'Notes')
    ALTER TABLE dbo.FollowupLog ADD Notes NVARCHAR(MAX) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'CreatedBy')
    ALTER TABLE dbo.FollowupLog ADD CreatedBy NVARCHAR(100) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'CreatedAt')
    ALTER TABLE dbo.FollowupLog ADD CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_FollowupLog_CreatedAt DEFAULT SYSDATETIME();

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'UpdatedBy')
    ALTER TABLE dbo.FollowupLog ADD UpdatedBy NVARCHAR(100) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'UpdatedAt')
    ALTER TABLE dbo.FollowupLog ADD UpdatedAt DATETIME2 NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'IsDeleted')
    ALTER TABLE dbo.FollowupLog ADD IsDeleted BIT NOT NULL CONSTRAINT DF_FollowupLog_IsDeleted DEFAULT 0;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'IX_FollowupLog_LogDate'
  )
    CREATE INDEX IX_FollowupLog_LogDate ON dbo.FollowupLog (LogDate);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'IX_FollowupLog_Customer'
  )
    CREATE INDEX IX_FollowupLog_Customer ON dbo.FollowupLog (Customer);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.FollowupLog') AND name = 'IX_FollowupLog_RefId'
  )
    CREATE INDEX IX_FollowupLog_RefId ON dbo.FollowupLog (RefId);
END

PRINT 'Fixed: dbo.FollowupLog schema matches backend/routes/followupLog.js';
GO

-- -----------------------------------------------------------------------------
-- 2) TenantReminders
--    backend/routes/tenantReminders.js expects:
--      ReminderId, Title, Message, Module, RefId, DueDate, SentAt,
--      IsSent, CreatedBy, CreatedAt
-- -----------------------------------------------------------------------------

IF OBJECT_ID('dbo.TenantReminders', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TenantReminders (
    ReminderId INT            IDENTITY(1,1) PRIMARY KEY,
    Title      NVARCHAR(255)  NOT NULL,
    Message    NVARCHAR(MAX)  NULL,
    Module     NVARCHAR(100)  NULL,
    RefId      INT            NULL,
    DueDate    DATE           NULL,
    SentAt     DATETIME2      NULL,
    IsSent     BIT            NOT NULL DEFAULT 0,
    CreatedBy  NVARCHAR(100)  NULL,
    CreatedAt  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
  );

  CREATE INDEX IX_TenantReminders_Module ON dbo.TenantReminders (Module);
  CREATE INDEX IX_TenantReminders_RefId ON dbo.TenantReminders (RefId);
  CREATE INDEX IX_TenantReminders_DueDate ON dbo.TenantReminders (DueDate);
END
ELSE
BEGIN
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'Id')
    EXEC sp_rename 'dbo.TenantReminders.Id', 'ReminderId', 'COLUMN';

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'TenantName')
    EXEC sp_rename 'dbo.TenantReminders.TenantName', 'Title', 'COLUMN';

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'LastSentOn')
    EXEC sp_rename 'dbo.TenantReminders.LastSentOn', 'SentAt', 'COLUMN';

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'ReminderId')
    ALTER TABLE dbo.TenantReminders ADD ReminderId INT IDENTITY(1,1);

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'Title')
    ALTER TABLE dbo.TenantReminders ADD Title NVARCHAR(255) NOT NULL DEFAULT('');

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'Message')
    ALTER TABLE dbo.TenantReminders ADD Message NVARCHAR(MAX) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'Module')
    ALTER TABLE dbo.TenantReminders ADD Module NVARCHAR(100) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'RefId')
    ALTER TABLE dbo.TenantReminders ADD RefId INT NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'DueDate')
    ALTER TABLE dbo.TenantReminders ADD DueDate DATE NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'SentAt')
    ALTER TABLE dbo.TenantReminders ADD SentAt DATETIME2 NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'IsSent')
    ALTER TABLE dbo.TenantReminders ADD IsSent BIT NOT NULL CONSTRAINT DF_TenantReminders_IsSent DEFAULT 0;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'CreatedBy')
    ALTER TABLE dbo.TenantReminders ADD CreatedBy NVARCHAR(100) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'CreatedAt')
    ALTER TABLE dbo.TenantReminders ADD CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantReminders_CreatedAt DEFAULT SYSDATETIME();

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'IX_TenantReminders_Module'
  )
    CREATE INDEX IX_TenantReminders_Module ON dbo.TenantReminders (Module);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'IX_TenantReminders_RefId'
  )
    CREATE INDEX IX_TenantReminders_RefId ON dbo.TenantReminders (RefId);

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TenantReminders') AND name = 'IX_TenantReminders_DueDate'
  )
    CREATE INDEX IX_TenantReminders_DueDate ON dbo.TenantReminders (DueDate);
END

PRINT 'Fixed: dbo.TenantReminders schema matches backend/routes/tenantReminders.js';
GO

-- -----------------------------------------------------------------------------
-- 3) Verification helper
-- -----------------------------------------------------------------------------
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN (
  'FollowupLog',
  'TenantReminders'
)
ORDER BY TABLE_NAME;
GO
