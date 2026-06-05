-- ─────────────────────────────────────────────────────────────────────────────
-- Run this SQL to add WelcomeCalls permission entries for all existing roles
-- that already have Followup module access.
-- Run ONCE in your SQL Server database.
-- ─────────────────────────────────────────────────────────────────────────────

-- First, check what roles have Followup access currently:
SELECT DISTINCT RoleId, Module, SubModule
FROM   dbo.RoleRights
WHERE  Module = 'Followup'
ORDER  BY RoleId, SubModule;

-- Seed WelcomeCalls rights for any role that has Followup/Bookings rights
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT DISTINCT
  rr.RoleId,
  'Followup'     AS Module,
  'WelcomeCalls' AS SubModule,
  1 AS CanView,
  1 AS CanAdd,
  1 AS CanEdit,
  1 AS CanDelete
FROM   dbo.RoleRights rr
WHERE  rr.Module = 'Followup'
  AND  rr.SubModule = 'Bookings'
  AND  NOT EXISTS (
    SELECT 1 FROM dbo.RoleRights rr2
    WHERE  rr2.RoleId    = rr.RoleId
      AND  rr2.Module    = 'Followup'
      AND  rr2.SubModule = 'WelcomeCalls'
  );

-- Verify:
SELECT RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
FROM   dbo.RoleRights
WHERE  Module = 'Followup' AND SubModule = 'WelcomeCalls';
