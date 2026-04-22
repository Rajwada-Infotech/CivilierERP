-- Migration 009: Create BusinessUnit table
-- Run: node run-migration.cjs 009-create-businessunit-table.sql

USE [CivilierERP]; -- Update if your DB name differs

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BusinessUnit')
BEGIN
  CREATE TABLE BusinessUnit (
    BusinessUnitID int IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    Code NVARCHAR(50) UNIQUE,
    Description NVARCHAR(500) NULL,
    IsActive bit NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 DEFAULT GETDATE(),
    UpdatedAt DATETIME2 NULL
  );

  -- Seed initial data
  INSERT INTO BusinessUnit (Name, Code, Description) VALUES
    (N'Head Office', 'HO', N'Main corporate headquarters'),
    (N'North Region', 'NR', N'Northern regional operations'),
    (N'South Region', 'SR', N'Southern regional operations'),
    (N'East Region', 'ER', N'Eastern regional operations'),
    (N'West Region', 'WR', N'Western regional operations');

  PRINT 'BusinessUnit table created and seeded with 5 records.';
END
ELSE
  PRINT 'BusinessUnit table already exists';

PRINT 'Migration 009 complete. Verify: SELECT * FROM BusinessUnit';

