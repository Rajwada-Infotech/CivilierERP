-- Migration 168: Role-level widget visibility baseline
--
-- dbo.UserWidgetRights only ever supported per-user overrides, defaulting
-- to "all active widgets" when no row exists for a user. This adds a
-- parallel role-level table so a role can set a baseline widget list that
-- every user with that role gets by default — a user's own per-user row
-- (if present) still fully overrides it, same relationship as
-- RoleRights vs UserPageRightsJson for page permissions.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'RoleWidgetRights'
)
BEGIN
  CREATE TABLE dbo.RoleWidgetRights (
    RoleId      INT            NOT NULL PRIMARY KEY,
    WidgetsJson NVARCHAR(MAX)  NULL,
    IsActive    BIT            NOT NULL CONSTRAINT DF_RoleWidgetRights_IsActive DEFAULT 1,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_RoleWidgetRights_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedAt   DATETIME2      NULL,
    CONSTRAINT FK_RoleWidgetRights_RoleId FOREIGN KEY (RoleId) REFERENCES dbo.Role(RId)
  );
  PRINT 'Created dbo.RoleWidgetRights';
END
ELSE
  PRINT 'dbo.RoleWidgetRights already exists';
GO
