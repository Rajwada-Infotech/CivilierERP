-- Migration 410: Seed RoleRights for Maintenance module
-- Grants standard access to Accountant (RId=4) and Director (RId=14)
-- Admin-tier roles (super_admin, admin, dba) bypass RoleRights entirely via isAdminTier check.

-- Pages covered:
--   maintenance-dashboard   → Module='Maintenance', SubModule='dashboard'
--   maintenance-directory   → Module='Maintenance', SubModule='directory'
--   maintenance-bills       → Module='Maintenance', SubModule='bills'
--   charge-head-master      → Module='Maintenance', SubModule='charge-head-master'
--   maintenance-customer-charges → Module='Maintenance', SubModule='customer-charges'

-- Accountant (RId=4) — view + add + edit access
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
SELECT v.RoleId, v.Module, v.SubModule, v.CanView, v.CanAdd, v.CanEdit, v.CanDelete, v.CanPrint, v.CanExport, v.CanPostApproval
FROM (VALUES
  (4, 'Maintenance', 'dashboard',          1, 0, 0, 0, 0, 0, 0),
  (4, 'Maintenance', 'directory',          1, 1, 1, 0, 1, 1, 0),
  (4, 'Maintenance', 'bills',              1, 1, 1, 0, 1, 1, 0),
  (4, 'Maintenance', 'charge-head-master', 1, 1, 1, 0, 0, 0, 0),
  (4, 'Maintenance', 'customer-charges',   1, 1, 1, 0, 1, 1, 0)
) AS v(RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights rr
  WHERE rr.RoleId = v.RoleId AND rr.Module = v.Module AND rr.SubModule = v.SubModule
);

-- Director (RId=14) — full access
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
SELECT v.RoleId, v.Module, v.SubModule, v.CanView, v.CanAdd, v.CanEdit, v.CanDelete, v.CanPrint, v.CanExport, v.CanPostApproval
FROM (VALUES
  (14, 'Maintenance', 'dashboard',          1, 0, 0, 0, 0, 0, 0),
  (14, 'Maintenance', 'directory',          1, 1, 1, 1, 1, 1, 0),
  (14, 'Maintenance', 'bills',              1, 1, 1, 1, 1, 1, 0),
  (14, 'Maintenance', 'charge-head-master', 1, 1, 1, 1, 0, 0, 0),
  (14, 'Maintenance', 'customer-charges',   1, 1, 1, 1, 1, 1, 0)
) AS v(RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights rr
  WHERE rr.RoleId = v.RoleId AND rr.Module = v.Module AND rr.SubModule = v.SubModule
);
