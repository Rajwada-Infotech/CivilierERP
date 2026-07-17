-- Migration 008: Create RoleRights table + seed data

PRINT '=== Migration 008: Creating RoleRights table ===';

-- Create table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='RoleRights' AND xtype='U')
BEGIN
    CREATE TABLE dbo.RoleRights (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        RoleId INT NOT NULL,
        Module NVARCHAR(100) NOT NULL,
        SubModule NVARCHAR(100) NOT NULL,
        CanView BIT NOT NULL DEFAULT 0,
        CanAdd BIT NOT NULL DEFAULT 0,
        CanEdit BIT NOT NULL DEFAULT 0,
        CanDelete BIT NOT NULL DEFAULT 0,
        
        -- Audit
        CreatedAt DATETIME2 DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2 NULL
    );

    -- FK
    ALTER TABLE dbo.RoleRights 
    ADD CONSTRAINT FK_RoleRights_RoleId FOREIGN KEY (RoleId) REFERENCES dbo.Role(RId);

    -- Indexes
    CREATE INDEX IX_RoleRights_RoleId ON dbo.RoleRights(RoleId);
    CREATE INDEX IX_RoleRights_Module_SubModule ON dbo.RoleRights(Module, SubModule);

    PRINT 'RoleRights table created successfully.';
END ELSE BEGIN
    PRINT 'RoleRights table already exists.';
END

-- Seed sample data (only if empty)
IF NOT EXISTS (SELECT 1 FROM dbo.RoleRights)
BEGIN
    PRINT 'Seeding sample RoleRights data...';

    -- Assume RoleId=1 is Admin (adjust if needed)
    INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
    VALUES
    -- User Control
    (1, 'User Control', 'Manage Users', 1, 1, 1, 1),
    (1, 'User Control', 'Activity Browser', 1, 0, 0, 0),
    
    -- Rights
    (1, 'Rights', 'Menu', 1, 1, 1, 0),
    (1, 'Rights', 'Widgets', 1, 1, 1, 0),
    (1, 'Rights', 'Financial Year', 1, 1, 1, 0),
    
    -- Viewer role sample (RoleId=2 if exists)
    (2, 'User Control', 'Manage Users', 0, 0, 0, 0),
    (2, 'Rights', 'Menu', 1, 0, 0, 0);

    PRINT 'Sample data seeded.';
END

SELECT * FROM dbo.RoleRights ORDER BY RoleId, Module, SubModule;

PRINT 'Migration 008 COMPLETE ✅';
PRINT 'RoleRights system ready!';

