-- Migration 014: Create UserPageRightsJson table
-- Used by /api/user-rights to store per-user page permission overrides
-- Run in SSMS on the Civilier database

PRINT '=== Migration 014: Creating UserPageRightsJson table ===';

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserPageRightsJson' AND xtype='U')
BEGIN
    CREATE TABLE dbo.UserPageRightsJson (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        UserId      INT NOT NULL,
        RightsJson  NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        IsActive    BIT NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2 DEFAULT SYSDATETIME(),
        UpdatedAt   DATETIME2 NULL,

        CONSTRAINT FK_UserPageRightsJson_UserId
            FOREIGN KEY (UserId) REFERENCES dbo.users(id) ON DELETE CASCADE,

        CONSTRAINT UQ_UserPageRightsJson_UserId
            UNIQUE (UserId)
    );

    CREATE INDEX IX_UserPageRightsJson_UserId ON dbo.UserPageRightsJson(UserId);

    PRINT 'UserPageRightsJson table created successfully.';
END
ELSE
BEGIN
    PRINT 'UserPageRightsJson table already exists — skipping.';
END

-- Also seed full RoleRights rows for all 4 roles so the permissions
-- middleware never 403s for standard operations.
-- First make sure we have the right RoleIds.

PRINT '';
PRINT '=== Seeding RoleRights for all 4 roles ===';

DECLARE @userRoleId   INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'user');
DECLARE @adminRoleId  INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'admin');
DECLARE @saRoleId     INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'super_admin');
DECLARE @dbaRoleId    INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'dba');

-- Helper: insert only if row doesn't exist
-- ── USER role ────────────────────────────────────────────────────────────────
IF @userRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @userRoleId AND Module = 'Users' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@userRoleId, 'Users', 'List', 0, 0, 0, 0);

IF @userRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @userRoleId AND Module = 'UserActivity' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@userRoleId, 'UserActivity', 'List', 1, 0, 0, 0);

-- ── ADMIN role ───────────────────────────────────────────────────────────────
IF @adminRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @adminRoleId AND Module = 'Users' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@adminRoleId, 'Users', 'List', 1, 1, 1, 1);

IF @adminRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @adminRoleId AND Module = 'Rights' AND SubModule = 'Menu')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@adminRoleId, 'Rights', 'Menu', 1, 1, 1, 0);

IF @adminRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @adminRoleId AND Module = 'UserActivity' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@adminRoleId, 'UserActivity', 'List', 1, 0, 0, 0);

-- ── SUPER_ADMIN role ─────────────────────────────────────────────────────────
IF @saRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @saRoleId AND Module = 'Users' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@saRoleId, 'Users', 'List', 1, 1, 1, 1);

IF @saRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @saRoleId AND Module = 'Rights' AND SubModule = 'Menu')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@saRoleId, 'Rights', 'Menu', 1, 1, 1, 1);

IF @saRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @saRoleId AND Module = 'UserActivity' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@saRoleId, 'UserActivity', 'List', 1, 0, 0, 0);

-- ── DBA role ─────────────────────────────────────────────────────────────────
IF @dbaRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @dbaRoleId AND Module = 'Users' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@dbaRoleId, 'Users', 'List', 1, 1, 1, 0);

IF @dbaRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @dbaRoleId AND Module = 'Rights' AND SubModule = 'Menu')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@dbaRoleId, 'Rights', 'Menu', 1, 1, 1, 0);

IF @dbaRoleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights WHERE RoleId = @dbaRoleId AND Module = 'UserActivity' AND SubModule = 'List')
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES (@dbaRoleId, 'UserActivity', 'List', 1, 0, 0, 0);

PRINT 'RoleRights seeding complete.';

-- Verify
SELECT r.RName AS Role, rr.Module, rr.SubModule, rr.CanView, rr.CanAdd, rr.CanEdit, rr.CanDelete
FROM dbo.RoleRights rr
JOIN dbo.Role r ON rr.RoleId = r.RId
ORDER BY r.RName, rr.Module;

PRINT '=== Migration 014 COMPLETE ✅ ===';
