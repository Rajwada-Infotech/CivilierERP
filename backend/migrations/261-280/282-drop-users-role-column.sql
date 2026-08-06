-- Migration 282: drop the legacy dbo.users.role text column.
-- All application code now resolves role via RoleId -> dbo.Role (RName),
-- confirmed via a full backend grep — the last raw u.role/su.role
-- references (accountHeadMaster.js, saLeads.js, saRoleMaster.js,
-- saTeams.js) were fixed to join dbo.Role instead. FK_users_role is on
-- RoleId, not this column, so dropping it is safe.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.users') AND name = 'role'
)
BEGIN
  -- Drop any default constraint on the column first (DROP COLUMN fails otherwise).
  DECLARE @constraintName NVARCHAR(200) = (
    SELECT dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.users') AND c.name = 'role'
  );
  IF @constraintName IS NOT NULL
    EXEC('ALTER TABLE dbo.users DROP CONSTRAINT ' + @constraintName);

  ALTER TABLE dbo.users DROP COLUMN role;
END
GO
