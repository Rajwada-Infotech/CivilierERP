-- Migration: Create Roles table for Role Master
-- Run this SQL in your SQL Server database

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Role' AND xtype='U')
BEGIN
    CREATE TABLE dbo.Role (
        RId INT IDENTITY(1,1) PRIMARY KEY,
        RName NVARCHAR(100) NOT NULL UNIQUE,  -- Unique enforced
        RCode NVARCHAR(20) NULL,              -- Auto-generated acronym
        RDesc NVARCHAR(255) NULL,
        RCreatedBy NVARCHAR(100) NOT NULL,
        RCreatedAt DATETIME2 DEFAULT SYSDATETIME(),
        RUpdatedBy NVARCHAR(100) NULL,
        RUpdatedAt DATETIME2 NULL,
        RApprovedBy NVARCHAR(100) NULL,
        RApprovedAt DATETIME2 NULL
    );

    -- Index for faster lookups
    CREATE INDEX IX_Role_RName ON dbo.Role(RName);
    CREATE INDEX IX_Role_RCode ON dbo.Role(RCode);

    PRINT 'Role table created successfully.';
END
ELSE
BEGIN
    PRINT 'Role table already exists.';
END

-- Optional: Insert sample data
-- INSERT INTO dbo.Roles (RName, RCode, RDesc, RCreatedBy) VALUES
-- ('Admin', 'ADM', 'System Administrator', 'system'),
-- ('Super Admin', 'SA', 'Highest privilege user', 'system'),
-- ('DBA', 'DBA', 'Database Administrator', 'system');

