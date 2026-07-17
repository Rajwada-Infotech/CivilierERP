-- Migration 006: Add RoleId FK to users, migrate data, drop old role column

PRINT '=== Migration 006: Adding RoleId to users table ===';

-- 1. Add RoleId column (nullable first)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'RoleId')
BEGIN
    ALTER TABLE dbo.users ADD RoleId INT NULL;
    PRINT 'RoleId column added (nullable).';
END

-- 2. Migrate existing string role -> RoleId
-- Map existing string role values to dbo.Role.RName.
UPDATE u
SET RoleId = r.RId
FROM dbo.users u
JOIN dbo.Role r
    ON LOWER(REPLACE(r.RName, ' ', '_')) = LOWER(REPLACE(u.role, ' ', '_'))
WHERE u.RoleId IS NULL
  AND u.role IS NOT NULL;

PRINT 'Manual role string -> RoleId migration complete.';

-- Check migration results
SELECT 
    'Unmigrated users' AS Status, COUNT(*) AS Count
FROM dbo.users 
WHERE RoleId IS NULL AND role IS NOT NULL
UNION ALL
SELECT 
    'Migrated users', COUNT(*)
FROM dbo.users 
WHERE RoleId IS NOT NULL;

PRINT 'Data migration complete.';

-- 3. Make RoleId NOT NULL (fail if any unmigrated)
ALTER TABLE dbo.users ALTER COLUMN RoleId INT NOT NULL;

-- 4. Add FK constraint
IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_users_role')
BEGIN
    ALTER TABLE dbo.users 
    ADD CONSTRAINT FK_users_role FOREIGN KEY (RoleId) REFERENCES dbo.Role(RId);
    PRINT 'FK constraint added.';
END

-- 5. DROP old role column
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.users') AND name = 'role')
BEGIN
    ALTER TABLE dbo.users DROP COLUMN role;
    PRINT 'Old role column dropped.';
END

PRINT 'Migration 006 COMPLETE ✅';
PRINT 'users table now uses RoleId FK to Role.RId';

