-- Migration 123: Dependency master table + page definition seed
-- Adds dbo.DependencyType (mirrors dbo.ContractorCategoryType pattern) and
-- registers the "dependency-master" page under Inside Work > Setup so it
-- shows up in the Menu Rights admin screen / /api/page-definitions.
-- Safe to re-run: table creation and seed are both guarded.

IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DependencyType' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.DependencyType (
    DpId INT IDENTITY(1,1) PRIMARY KEY,
    DpCode NVARCHAR(50) NOT NULL,
    DpName NVARCHAR(255) NOT NULL,
    DpIsActive BIT NOT NULL DEFAULT 1,
    DpCreatedBy NVARCHAR(100) NULL,
    DpCreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    DpUpdatedBy NVARCHAR(100) NULL,
    DpUpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_DependencyType_Code UNIQUE (DpCode)
  );

  PRINT 'Created dbo.DependencyType';
END
ELSE
  PRINT 'dbo.DependencyType already exists — skipping create';

-- Seed: Inside Work > Setup > Dependency page definition
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'dependency-master' AND IsActive = 1)
  BEGIN
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('dependency-master', 'Dependency', 'Inside Work', 'Setup', 'view,create,edit,delete', 20, 1, 'migration', GETDATE());
  END
END

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Inside Work'
ORDER BY SortOrder;
