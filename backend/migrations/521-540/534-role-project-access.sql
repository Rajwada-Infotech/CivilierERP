-- Migration 534: role-wise project scoping (companion to 524's per-user table).
--
-- A role with NO rows here is unrestricted. Once a role has rows, every user in
-- that role who has no personal list (dbo.UserProjectAccess) sees only those
-- projects. A user's own rows, when present, take precedence over the role's —
-- the same "personal override wins" rule the page-rights model uses. Admin
-- roles (super_admin/sa/dba/admin) are never restricted regardless of rows.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RoleProjectAccess' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.RoleProjectAccess (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    RoleId     INT NOT NULL,
    ProjectId  INT NOT NULL,
    CreatedBy  NVARCHAR(200) NULL,
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_RoleProjectAccess_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_RoleProjectAccess_Role FOREIGN KEY (RoleId) REFERENCES dbo.Role(RId) ON DELETE CASCADE,
    CONSTRAINT UX_RoleProjectAccess_Role_Project UNIQUE (RoleId, ProjectId)
  );
  CREATE INDEX IX_RoleProjectAccess_Role ON dbo.RoleProjectAccess (RoleId);
END
GO

PRINT 'Migration 534: dbo.RoleProjectAccess.';
GO
