-- Migration 005a: repair/create base auth schema expected by 006+
-- Some local databases have dbo.Roles from 005, while the app expects dbo.Role.

PRINT '=== Migration 005a: Creating base auth schema ===';

IF OBJECT_ID('dbo.Role', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Role (
        RId INT IDENTITY(1,1) PRIMARY KEY,
        RName NVARCHAR(100) NOT NULL UNIQUE,
        RCode NVARCHAR(20) NULL,
        RDesc NVARCHAR(255) NULL,
        RCreatedBy NVARCHAR(100) NOT NULL,
        RCreatedAt DATETIME2 DEFAULT SYSDATETIME(),
        RUpdatedBy NVARCHAR(100) NULL,
        RUpdatedAt DATETIME2 NULL,
        RApprovedBy NVARCHAR(100) NULL,
        RApprovedAt DATETIME2 NULL
    );

    CREATE INDEX IX_Role_RName ON dbo.Role(RName);
    CREATE INDEX IX_Role_RCode ON dbo.Role(RCode);

    PRINT 'Created dbo.Role.';
END
ELSE
BEGIN
    PRINT 'dbo.Role already exists.';
END

IF OBJECT_ID('dbo.Roles', 'U') IS NOT NULL
BEGIN
    SET IDENTITY_INSERT dbo.Role ON;

    INSERT INTO dbo.Role (
        RId, RName, RCode, RDesc, RCreatedBy, RCreatedAt,
        RUpdatedBy, RUpdatedAt, RApprovedBy, RApprovedAt
    )
    SELECT
        old.RId, old.RName, old.RCode, old.RDesc,
        CAST(old.RCreatedBy AS NVARCHAR(100)), old.RCreatedAt,
        CAST(old.RUpdatedBy AS NVARCHAR(100)), old.RUpdatedAt,
        CAST(old.RApprovedBy AS NVARCHAR(100)), old.RApprovedAt
    FROM dbo.Roles old
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.Role currentRole WHERE currentRole.RId = old.RId
    );

    SET IDENTITY_INSERT dbo.Role OFF;

    PRINT 'Copied existing dbo.Roles rows into dbo.Role.';
END

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'admin')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('admin', 'ADM', 'System administrator', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'user')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('user', 'USR', 'Standard user', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'super_admin')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('super_admin', 'SA', 'Highest privilege user', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'dba')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('dba', 'DBA', 'Database administrator', 'system');

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE LOWER(RName) = 'engineer')
    INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy)
    VALUES ('engineer', 'ENG', 'Engineering user', 'system');

IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(150) NOT NULL,
        email NVARCHAR(255) NOT NULL,
        password NVARCHAR(255) NOT NULL,
        role NVARCHAR(100) NULL,
        RoleId INT NULL,
        created_datetime DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        discontinue BIT NOT NULL DEFAULT 0,
        can_accept_tickets BIT NOT NULL DEFAULT 0,
        avatar_url NVARCHAR(500) NULL,
        CONSTRAINT UQ_users_email UNIQUE (email)
    );

    PRINT 'Created dbo.users.';
END
ELSE
BEGIN
    PRINT 'dbo.users already exists.';
END

IF COL_LENGTH('dbo.users', 'role') IS NULL
    ALTER TABLE dbo.users ADD role NVARCHAR(100) NULL;

IF COL_LENGTH('dbo.users', 'RoleId') IS NULL
    ALTER TABLE dbo.users ADD RoleId INT NULL;

IF COL_LENGTH('dbo.users', 'can_accept_tickets') IS NULL
    ALTER TABLE dbo.users ADD can_accept_tickets BIT NOT NULL
        CONSTRAINT DF_users_can_accept_tickets DEFAULT (0);

IF COL_LENGTH('dbo.users', 'avatar_url') IS NULL
    ALTER TABLE dbo.users ADD avatar_url NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'superadmin@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Super Admin',
        'superadmin@civilier.com',
        '$2b$12$UXlP3vthDMP7HkyHGb9QsOHmvkzj9w.INndERImAQOs/DMoKpdz/6',
        'super_admin',
        SYSDATETIME(),
        0,
        1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'admin@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Admin',
        'admin@civilier.com',
        '$2b$12$FgaclKwDNzfYSVJVoNVA.eI9YFnF6XrcnA1.bU7Kjg9qFsFtakVya',
        'admin',
        SYSDATETIME(),
        0,
        1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'dba@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'DBA',
        'dba@civilier.com',
        '$2b$12$53vNqzPqNfvgfsH3NaN6kuijOHSGYNk8OkaBbEqlQwKDKCVHakH1.',
        'dba',
        SYSDATETIME(),
        0,
        1
    );

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE LOWER(email) = 'engineer@civilier.com')
    INSERT INTO dbo.users (name, email, password, role, created_datetime, discontinue, can_accept_tickets)
    VALUES (
        'Engineer',
        'engineer@civilier.com',
        '$2b$12$4ehDpvoHA6AVCWPlOzCgZ.IcoH8WyF140TgoqCar4NUezVwq1/jvK',
        'engineer',
        SYSDATETIME(),
        0,
        1
    );

PRINT '=== Migration 005a COMPLETE ===';
