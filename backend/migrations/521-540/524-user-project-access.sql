-- Migration 524: per-user project scoping.
--
-- A user with NO rows here is unrestricted (sees every project), so deploying
-- this locks nobody out. Once a user has one or more rows, every project-aware
-- list, lookup and write is limited to exactly those projects. Admin roles
-- (super_admin/sa/dba/admin) are never restricted regardless of rows.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'UserProjectAccess' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.UserProjectAccess (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    UserId     INT NOT NULL,
    ProjectId  INT NOT NULL,
    CreatedBy  NVARCHAR(200) NULL,
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_UserProjectAccess_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_UserProjectAccess_User FOREIGN KEY (UserId) REFERENCES dbo.users(id) ON DELETE CASCADE,
    CONSTRAINT UX_UserProjectAccess_User_Project UNIQUE (UserId, ProjectId)
  );
  CREATE INDEX IX_UserProjectAccess_User ON dbo.UserProjectAccess (UserId);
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PageDefinitions' AND schema_id = SCHEMA_ID('dbo'))
   AND NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'project-access')
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('project-access', 'Project Access', 'Admin', 'Admin Rights', 'view,edit', 105, 1, 'migration', GETDATE());
END
GO

PRINT 'Migration 524: dbo.UserProjectAccess + project-access page.';
GO
