-- ============================================================
-- CivilierERP — Seed default users (RoleId-aware version)
-- Run this in SSMS against your CivilierERP / Civilier database.
-- ============================================================

-- Step 1: Ensure roles exist
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'super_admin')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('super_admin', 'SA', 'Super administrator', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'admin')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('admin', 'ADM', 'System administrator', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'dba')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('dba', 'DBA', 'Database administrator', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'user')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('user', 'USR', 'Standard user', 'system');

-- Step 2: Insert users with correct RoleId lookups
DECLARE @saRoleId   INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'super_admin');
DECLARE @admRoleId  INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'admin');
DECLARE @dbaRoleId  INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'dba');
DECLARE @usrRoleId  INT = (SELECT RId FROM dbo.Role WHERE LOWER(RName) = 'user');

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'superadmin@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Super Admin', 'superadmin@civilier.com',
        '$2b$12$UXlP3vthDMP7HkyHGb9QsOHmvkzj9w.INndERImAQOs/DMoKpdz/6',
        'super_admin', @saRoleId,
        SYSDATETIME(), 0, 1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'admin@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Admin', 'admin@civilier.com',
        '$2b$12$FgaclKwDNzfYSVJVoNVA.eI9YFnF6XrcnA1.bU7Kjg9qFsFtakVya',
        'admin', @admRoleId,
        SYSDATETIME(), 0, 1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'dba@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'DBA', 'dba@civilier.com',
        '$2b$12$53vNqzPqNfvgfsH3NaN6kuijOHSGYNk8OkaBbEqlQwKDKCVHakH1.',
        'dba', @dbaRoleId,
        SYSDATETIME(), 0, 1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'engineer@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, RoleId, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Engineer', 'engineer@civilier.com',
        '$2b$12$4ehDpvoHA6AVCWPlOzCgZ.IcoH8WyF140TgoqCar4NUezVwq1/jvK',
        'user', @usrRoleId,
        SYSDATETIME(), 0, 1
    );

-- Verify
SELECT u.id, u.name, u.email, u.role, r.RName AS RoleName, u.discontinue
FROM dbo.users u
LEFT JOIN dbo.Role r ON r.RId = u.RoleId
ORDER BY u.id;
