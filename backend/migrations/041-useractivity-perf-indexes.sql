-- Migration 041: UserActivityLog performance indexes
-- Fixes: /api/user-activity?period=this-week (and other period/filter combos)
-- consistently taking 1–2.3 s on every request because:
--   1. No cache — DB hit on every poll cycle
--   2. Two separate queries (COUNT + data) — double scan
--   3. No composite index for (CreatedAt, EventType, UserRole) filter pattern
--
-- The route fix (userActivity.optimized.js) eliminates issues 1 & 2.
-- This migration eliminates issue 3 at the DB level.
-- All statements are guarded — safe to re-run.

-- ── 1. Composite covering index for the most common filter pattern ─────────────
-- Covers: WHERE CreatedAt BETWEEN @from AND @to [AND EventType = x] [AND UserRole = y]
-- ORDER BY CreatedAt DESC  →  no sort needed, index is already ordered DESC.
-- INCLUDE columns satisfy the SELECT list so the engine never touches the heap.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.UserActivityLog')
    AND name = N'IX_UserActivityLog_CreatedAt_Filters'
)
  CREATE NONCLUSTERED INDEX IX_UserActivityLog_CreatedAt_Filters
    ON dbo.UserActivityLog (CreatedAt DESC, EventType, UserRole)
    INCLUDE (
      Id, UserId, UserName, UserEmail,
      IpAddress, DeviceInfo, DeviceFingerprint,
      ActionType, Resource, Details,
      SessionId, SessionDuration,
      RequestMethod, RequestUrl
    );
GO

-- ── 2. Index to accelerate UserId-scoped queries (cache is per-user) ───────────
-- When a specific userId filter is added later, this avoids a full table scan.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.UserActivityLog')
    AND name = N'IX_UserActivityLog_UserId_CreatedAt'
)
  CREATE NONCLUSTERED INDEX IX_UserActivityLog_UserId_CreatedAt
    ON dbo.UserActivityLog (UserId, CreatedAt DESC);
GO

-- ── 3. Drop the now-redundant single-column CreatedAt index (if it exists) ─────
-- The new composite index (CreatedAt DESC, EventType, UserRole) covers all
-- queries the old IX_UserActivityLog_CreatedAt handled, so keeping both
-- wastes write amplification on every INSERT.
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.UserActivityLog')
    AND name = N'IX_UserActivityLog_CreatedAt'
)
  DROP INDEX IX_UserActivityLog_CreatedAt ON dbo.UserActivityLog;
GO

PRINT 'Migration 041 applied — UserActivityLog composite indexes created.';
GO
