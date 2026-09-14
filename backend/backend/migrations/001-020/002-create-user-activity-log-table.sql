-- Migration: 002-create-user-activity-log-table.sql
-- Full CREATE TABLE for UserActivityLog + all required columns/indexes
-- Run this in SQL Server Management Studio after updating USE [CivilierERP];

USE [CivilierERP]; -- Update database name if different

-- Drop table if exists (backup data first if needed)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'UserActivityLog')
BEGIN
    PRINT 'Dropping existing UserActivityLog table...';
    DROP TABLE dbo.UserActivityLog;
END

-- Create UserActivityLog table with ALL required columns
CREATE TABLE dbo.UserActivityLog (
    Id NVARCHAR(50) PRIMARY KEY,
    UserId NVARCHAR(50) NOT NULL,
    UserName NVARCHAR(100) NOT NULL,
    UserEmail NVARCHAR(100) NULL,
    UserRole NVARCHAR(50) NULL,
    EventType NVARCHAR(20) NOT NULL,  -- 'login', 'logout', 'action'
    IpAddress NVARCHAR(50) NULL DEFAULT 'unknown',
    DeviceInfo NVARCHAR(255) NULL DEFAULT 'unknown',
    DeviceFingerprint NVARCHAR(100) NULL,
    ActionType NVARCHAR(50) NULL CHECK (ActionType IN ('read','create','update','delete','export','settings_change')),
    Resource NVARCHAR(200) NULL,
    Details NVARCHAR(MAX) NULL,
    SessionId NVARCHAR(50) NULL,
    SessionDuration INT NULL,
    RequestMethod NVARCHAR(10) NULL,
    RequestUrl NVARCHAR(500) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

-- Performance indexes
CREATE NONCLUSTERED INDEX IX_UserActivityLog_SessionId ON dbo.UserActivityLog(SessionId);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_ActionType ON dbo.UserActivityLog(ActionType);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_CreatedAt ON dbo.UserActivityLog(CreatedAt DESC);
CREATE NONCLUSTERED INDEX IX_UserActivityLog_UserId ON dbo.UserActivityLog(UserId);

PRINT '✅ UserActivityLog table created successfully with all columns and indexes.';
PRINT 'Table ready for backend queries. Test with: SELECT TOP 10 * FROM dbo.UserActivityLog;';

-- Optional: Insert sample data for testing
/*
INSERT INTO dbo.UserActivityLog (Id, UserId, UserName, UserEmail, UserRole, EventType, CreatedAt)
VALUES 
    (NEWID(), 'user1', 'Test Admin', 'admin@test.com', 'admin', 'login', GETUTCDATE()),
    (NEWID(), 'user1', 'Test Admin', 'admin@test.com', 'admin', 'logout', DATEADD(minute, 30, GETUTCDATE()));
*/

