-- Migration: 051-add-index-users-roleid.sql
-- Adds an index on dbo.users(RoleId) to speed up joins like:
--   u LEFT JOIN dbo.Role r ON u.RoleId = r.RId
-- used by GET /api/user-profile/:id/profile

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_users_RoleId'
    AND object_id = OBJECT_ID(N'dbo.users')
)
BEGIN
  PRINT 'Creating index IX_users_RoleId on dbo.users(RoleId)...';
  CREATE NONCLUSTERED INDEX IX_users_RoleId
    ON dbo.users (RoleId);
END
ELSE
BEGIN
  PRINT 'Index IX_users_RoleId already exists — skipping.';
END
