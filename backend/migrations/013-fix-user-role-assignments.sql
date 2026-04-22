-- Migration 013: Fix user role assignments based on email
-- Run this if specific users have incorrect RoleId values
-- Safe to re-run (uses UPDATE WHERE to avoid duplicates)

PRINT '=== Migration 013: Fixing user role assignments ===';

-- Show current state before fix
SELECT u.email, u.RoleId, r.RName AS CurrentRole
FROM dbo.users u
LEFT JOIN dbo.Role r ON u.RoleId = r.RId
ORDER BY u.id;

-- Ensure the Role table has the required roles
-- Insert missing roles if they don't exist yet
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) IN ('super_admin','super admin'))
BEGIN
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('super_admin', 'SA', 'Highest privilege user', 'system');
    PRINT 'Inserted super_admin role';
END

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'admin')
BEGIN
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('admin', 'ADM', 'System Administrator', 'system');
    PRINT 'Inserted admin role';
END

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'dba')
BEGIN
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('dba', 'DBA', 'Database Administrator', 'system');
    PRINT 'Inserted dba role';
END

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'user')
BEGIN
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('user', 'USR', 'Standard User', 'system');
    PRINT 'Inserted user role';
END

-- Fix specific known users by email -> correct role
UPDATE u
SET u.RoleId = r.RId
FROM dbo.users u
JOIN dbo.Role r ON LOWER(r.RName) = 'super_admin'
WHERE LOWER(u.email) = 'superadmin@civilier.com'
  AND u.RoleId != r.RId;

UPDATE u
SET u.RoleId = r.RId
FROM dbo.users u
JOIN dbo.Role r ON LOWER(r.RName) = 'admin'
WHERE LOWER(u.email) = 'admin@civilier.com'
  AND u.RoleId != r.RId;

UPDATE u
SET u.RoleId = r.RId
FROM dbo.users u
JOIN dbo.Role r ON LOWER(r.RName) = 'dba'
WHERE LOWER(u.email) = 'dba@civilier.com'
  AND u.RoleId != r.RId;

PRINT 'Role assignments corrected.';

-- Show state after fix
SELECT u.email, u.RoleId, r.RName AS FixedRole
FROM dbo.users u
LEFT JOIN dbo.Role r ON u.RoleId = r.RId
ORDER BY u.id;

PRINT 'Migration 013 COMPLETE';
