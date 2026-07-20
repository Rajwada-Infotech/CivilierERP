-- Migration 122: Seed Inside Work module page definition
-- (insidework-dashboard) used by the Menu Rights admin screen and the
-- /api/page-definitions endpoint that drives sidebar/route access control.
-- Safe to re-run: table creation and insert are both guarded.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  CREATE TABLE dbo.PageDefinitions (
    PageDefId   INT           IDENTITY(1,1) PRIMARY KEY,
    PageKey     NVARCHAR(100) NOT NULL,
    Label       NVARCHAR(200) NOT NULL,
    Module      NVARCHAR(100) NOT NULL,
    GroupName   NVARCHAR(150) NOT NULL,
    Actions     NVARCHAR(200) NOT NULL,            -- comma-separated: view,create,edit,delete,print,export
    SortOrder   INT           NOT NULL CONSTRAINT DF_PD_SortOrder DEFAULT 100,
    IsActive    BIT           NOT NULL CONSTRAINT DF_PD_IsActive  DEFAULT 1,
    CreatedBy   NVARCHAR(100) NULL,
    CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_PD_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt   DATETIME2     NULL
  );

  CREATE UNIQUE INDEX UX_PageDefinitions_PageKey_Active
    ON dbo.PageDefinitions(PageKey) WHERE IsActive = 1;

  PRINT 'Created dbo.PageDefinitions';
END
ELSE
  PRINT 'dbo.PageDefinitions already exists — skipping create';

-- Seed: Inside Work Dashboard
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'insidework-dashboard' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('insidework-dashboard', 'Dashboard', 'Inside Work', 'Inside Work', 'view', 10, 1, 'migration', GETDATE());
END

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Inside Work'
ORDER BY SortOrder;
