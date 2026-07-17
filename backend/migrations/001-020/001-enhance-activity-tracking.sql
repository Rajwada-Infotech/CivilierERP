-- Migration: 001-enhance-activity-tracking.sql
-- Replace [YourDatabaseName] with actual DB name before running
USE [CivilierERP]; -- Update this line

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserActivityLog')
BEGIN
    PRINT 'UserActivityLog table does not exist. Create first.';
    RETURN;
END

-- Add DeviceFingerprint (privacy-friendly device ID)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'DeviceFingerprint')
ALTER TABLE dbo.UserActivityLog ADD DeviceFingerprint NVARCHAR(100) NULL;

-- Add ActionType
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'ActionType')
ALTER TABLE dbo.UserActivityLog ADD ActionType NVARCHAR(50) NULL CHECK (ActionType IN ('read','create','update','delete','export','settings_change'));

-- Add Resource
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'Resource')
ALTER TABLE dbo.UserActivityLog ADD Resource NVARCHAR(200) NULL;

-- Add Details
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'Details')
ALTER TABLE dbo.UserActivityLog ADD Details NVARCHAR(MAX) NULL;

-- Add SessionId
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'SessionId')
ALTER TABLE dbo.UserActivityLog ADD SessionId NVARCHAR(50) NULL;

-- Add SessionDuration
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'SessionDuration')
ALTER TABLE dbo.UserActivityLog ADD SessionDuration INT NULL;

-- Add RequestMethod
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'RequestMethod')
ALTER TABLE dbo.UserActivityLog ADD RequestMethod NVARCHAR(10) NULL;

-- Add RequestUrl
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserActivityLog') AND name = 'RequestUrl')
ALTER TABLE dbo.UserActivityLog ADD RequestUrl NVARCHAR(500) NULL;

-- Indexes for performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserActivityLog_SessionId')
CREATE INDEX IX_UserActivityLog_SessionId ON UserActivityLog(SessionId);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserActivityLog_ActionType')
CREATE INDEX IX_UserActivityLog_ActionType ON UserActivityLog(ActionType);

PRINT 'Migration complete. Verify schema before proceeding.';

