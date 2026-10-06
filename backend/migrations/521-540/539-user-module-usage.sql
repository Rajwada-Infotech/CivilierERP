-- Migration 539: per-user module usage — how often and how recently each user
-- has worked in each module (Finance, Material, Engineering, CRM). Feeds the
-- Home page's personalised widgets: the modules a user lives in get their
-- widgets shown first.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserModuleUsage' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.UserModuleUsage (
    UserId        INT           NOT NULL,
    Module        NVARCHAR(40)  NOT NULL,
    VisitCount    INT           NOT NULL CONSTRAINT DF_UserModuleUsage_Count DEFAULT (0),
    LastVisitedAt DATETIME2(3)  NOT NULL CONSTRAINT DF_UserModuleUsage_Last DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_UserModuleUsage PRIMARY KEY (UserId, Module)
  );
END
GO

PRINT '539-user-module-usage applied successfully.';
GO
