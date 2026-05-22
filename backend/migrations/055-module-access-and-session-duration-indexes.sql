-- Migration: 055-module-access-and-session-duration-indexes.sql
-- Supports two new query patterns introduced by the logging fix:
--   1. "Which modules did user X access?" → filter by UserId + Resource
--   2. "Session duration for user X?" → filter by UserId + EventType + SessionDuration
-- Run after 054-fix-boq-foreign-keys.sql.
-- Uses the current migration connection database; do not hardcode DB name.

-- Index: fast lookup of all actions for a given user, ordered by time
IF NOT EXISTS (
  SELECT * FROM sys.indexes
  WHERE name = 'IX_UserActivityLog_UserId_EventType_CreatedAt'
    AND object_id = OBJECT_ID('dbo.UserActivityLog')
)
CREATE NONCLUSTERED INDEX IX_UserActivityLog_UserId_EventType_CreatedAt
  ON dbo.UserActivityLog (UserId, EventType, CreatedAt DESC)
  INCLUDE (Resource, ActionType, SessionId, SessionDuration);

-- Index: fast lookup of resource/module access patterns across all users
IF NOT EXISTS (
  SELECT * FROM sys.indexes
  WHERE name = 'IX_UserActivityLog_Resource_ActionType'
    AND object_id = OBJECT_ID('dbo.UserActivityLog')
)
CREATE NONCLUSTERED INDEX IX_UserActivityLog_Resource_ActionType
  ON dbo.UserActivityLog (Resource, ActionType)
  INCLUDE (UserId, UserName, UserRole, CreatedAt);

PRINT 'Migration 055 complete: module access and session duration indexes added.';
