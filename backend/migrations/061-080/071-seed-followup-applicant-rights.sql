-- Migration 071: Seed RoleRights for Followup / Applicants

DECLARE @PrivilegedRoles TABLE (RoleId INT PRIMARY KEY);

INSERT INTO @PrivilegedRoles (RoleId)
SELECT RId
FROM dbo.Role
WHERE LOWER(REPLACE(RName, ' ', '_')) IN ('admin', 'super_admin', 'sa', 'dba');

INSERT INTO dbo.RoleRights (
  RoleId,
  Module,
  SubModule,
  CanView,
  CanAdd,
  CanEdit,
  CanDelete
)
SELECT
  pr.RoleId,
  'Followup',
  'Applicants',
  1,
  1,
  1,
  1
FROM @PrivilegedRoles pr
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.RoleRights rr
  WHERE rr.RoleId = pr.RoleId
    AND rr.Module = 'Followup'
    AND rr.SubModule = 'Applicants'
);

UPDATE rr
SET
  CanView = 1,
  CanAdd = 1,
  CanEdit = 1,
  CanDelete = 1
FROM dbo.RoleRights rr
JOIN @PrivilegedRoles pr ON pr.RoleId = rr.RoleId
WHERE rr.Module = 'Followup'
  AND rr.SubModule = 'Applicants'
  AND (
    ISNULL(rr.CanView, 0) <> 1
    OR ISNULL(rr.CanAdd, 0) <> 1
    OR ISNULL(rr.CanEdit, 0) <> 1
    OR ISNULL(rr.CanDelete, 0) <> 1
  );
