-- Migration: 003-fix-useractivitylog-id-column.sql
-- Fixes the UserActivityLog.Id column if it was accidentally created as
-- INT IDENTITY instead of NVARCHAR(50) PRIMARY KEY.
--
-- The error "Cannot insert explicit value for identity column in table
-- 'UserActivityLog' when IDENTITY_INSERT is set to OFF" means the live table
-- has Id as an IDENTITY column. The backend generates UUID strings for Id, so
-- the column must be NVARCHAR(50) with no IDENTITY property.
--
-- ⚠️  Back up your data before running this migration.
-- Run in SQL Server Management Studio against the correct database.

USE [CivilierERP]; -- Update if your database name differs

-- Check current column type
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    COLUMNPROPERTY(OBJECT_ID('dbo.UserActivityLog'), COLUMN_NAME, 'IsIdentity') AS IsIdentity
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'UserActivityLog' AND COLUMN_NAME = 'Id';

-- ── Option A: Safe rebuild (preserves all existing data) ─────────────────────
-- Use this if the table has data you want to keep.
-- It renames the old table, recreates it correctly, copies data over, then drops the old table.

IF COLUMNPROPERTY(OBJECT_ID('dbo.UserActivityLog'), 'Id', 'IsIdentity') = 1
BEGIN
    PRINT 'Id column is IDENTITY — rebuilding table to fix schema...';

    -- Step 1: Rename existing table
    EXEC sp_rename 'dbo.UserActivityLog', 'UserActivityLog_OLD';

    -- Step 2: Create new table with correct schema (matches migration 002)
    CREATE TABLE dbo.UserActivityLog (
        Id                NVARCHAR(50)  NOT NULL PRIMARY KEY,
        UserId            NVARCHAR(50)  NOT NULL,
        UserName          NVARCHAR(100) NOT NULL,
        UserEmail         NVARCHAR(100) NULL,
        UserRole          NVARCHAR(50)  NULL,
        EventType         NVARCHAR(20)  NOT NULL,
        IpAddress         NVARCHAR(50)  NULL DEFAULT 'unknown',
        DeviceInfo        NVARCHAR(255) NULL DEFAULT 'unknown',
        DeviceFingerprint NVARCHAR(100) NULL,
        ActionType        NVARCHAR(50)  NULL CHECK (ActionType IN ('read','create','update','delete','export','settings_change')),
        Resource          NVARCHAR(200) NULL,
        Details           NVARCHAR(MAX) NULL,
        SessionId         NVARCHAR(50)  NULL,
        SessionDuration   INT           NULL,
        RequestMethod     NVARCHAR(10)  NULL,
        RequestUrl        NVARCHAR(500) NULL,
        CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );

    -- Step 3: Copy existing rows, converting the old INT Id to NVARCHAR
    INSERT INTO dbo.UserActivityLog (
        Id, UserId, UserName, UserEmail, UserRole, EventType,
        IpAddress, DeviceInfo, DeviceFingerprint,
        ActionType, Resource, Details,
        SessionId, SessionDuration,
        RequestMethod, RequestUrl, CreatedAt
    )
    SELECT
        CAST(Id AS NVARCHAR(50)),
        UserId, UserName, UserEmail, UserRole, EventType,
        ISNULL(IpAddress, 'unknown'), ISNULL(DeviceInfo, 'unknown'), DeviceFingerprint,
        ActionType, Resource, Details,
        SessionId, SessionDuration,
        RequestMethod, RequestUrl,
        ISNULL(CreatedAt, GETUTCDATE())
    FROM dbo.UserActivityLog_OLD;

    -- Step 4: Recreate indexes
    CREATE NONCLUSTERED INDEX IX_UserActivityLog_SessionId ON dbo.UserActivityLog(SessionId);
    CREATE NONCLUSTERED INDEX IX_UserActivityLog_ActionType ON dbo.UserActivityLog(ActionType);
    CREATE NONCLUSTERED INDEX IX_UserActivityLog_CreatedAt  ON dbo.UserActivityLog(CreatedAt DESC);
    CREATE NONCLUSTERED INDEX IX_UserActivityLog_UserId     ON dbo.UserActivityLog(UserId);

    -- Step 5: Drop the old table
    DROP TABLE dbo.UserActivityLog_OLD;

    PRINT '✅ UserActivityLog schema fixed. Id is now NVARCHAR(50).';
END
ELSE
BEGIN
    PRINT 'ℹ️  Id column is NOT an IDENTITY column — no changes needed.';
END

-- ── Option B: Drop & recreate (only if table is empty / data doesn't matter) ─
-- Uncomment and run instead of Option A if you have no data to preserve.
/*
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'UserActivityLog')
    DROP TABLE dbo.UserActivityLog;

CREATE TABLE dbo.UserActivityLog (
    Id                NVARCHAR(50)  NOT NULL PRIMARY KEY,
    UserId            NVARCHAR(50)  NOT NULL,
    UserName          NVARCHAR(100) NOT NULL,
    UserEmail         NVARCHAR(100) NULL,
    UserRole          NVARCHAR(50)  NULL,
    EventType         NVARCHAR(20)  NOT NULL,
    IpAddress         NVARCHAR(50)  NULL DEFAULT 'unknown',
    DeviceInfo        NVARCHAR(255) NULL DEFAULT 'unknown',
    DeviceFingerprint NVARCHAR(100) NULL,
    ActionType        NVARCHAR(50)  NULL CHECK (ActionType IN ('read','create','update','delete','export','settings_change')),
    Resource          NVARCHAR(200) NULL,
    Details           NVARCHAR(MAX) NULL,
    SessionId         NVARCHAR(50)  NULL,
    SessionDuration   INT           NULL,
    RequestMethod     NVARCHAR(10)  NULL,
    RequestUrl        NVARCHAR(500) NULL,
    CreatedAt         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

CREATE NONCLUSTERED INDEX IX_UserActivityLog_SessionId ON dbo.UserActivityLog(SessionId);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_ActionType ON dbo.UserActivityLog(ActionType);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_CreatedAt  ON dbo.UserActivityLog(CreatedAt DESC);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_UserId     ON dbo.UserActivityLog(UserId);

PRINT '✅ UserActivityLog recreated cleanly.';
*/
