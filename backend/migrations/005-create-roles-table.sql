-- Migration: Create Roles table for Role Master
-- Run this SQL in your SQL Server database

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Roles' AND xtype='U')
BEGIN
    CREATE TABLE dbo.Roles (
        RId INT IDENTITY(1,1) PRIMARY KEY,
        RName NVARCHAR(100) NOT NULL UNIQUE,  -- Unique enforced
        RCode NVARCHAR(20) NULL,              -- Auto-generated acronym
        RDesc NVARCHAR(255) NULL,
        RCreatedBy NVARCHAR(50) NOT NULL,
        RCreatedAt DATETIME2 DEFAULT SYSDATETIME(),
        RUpdatedBy NVARCHAR(50) NULL,
        RUpdatedAt DATETIME2 NULL,
        RApprovedBy NVARCHAR(50) NULL,
        RApprovedAt DATETIME2 NULL
    );

    -- Index for faster lookups
    CREATE INDEX IX_Roles_RName ON dbo.Roles(RName);
    CREATE INDEX IX_Roles_RCode ON dbo.Roles(RCode);

    PRINT 'Roles table created successfully.';
END
ELSE
BEGIN
    PRINT 'Roles table already exists.';
END

-- Optional: Insert sample data
-- INSERT INTO dbo.Roles (RName, RCode, RDesc, RCreatedBy) VALUES
-- ('Admin', 'ADM', 'System Administrator', 'system'),
-- ('Super Admin', 'SA', 'Highest privilege user', 'system'),
-- ('DBA', 'DBA', 'Database Administrator', 'system');

