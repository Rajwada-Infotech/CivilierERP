-- Migration 411: Wire Loan and Records modules
-- Seeds PageDefinitions and RoleRights so non-admin users can access these modules.
-- Admin-tier (super_admin, admin, dba) bypass RoleRights entirely.
-- Roles seeded: Accountant (4), Account's Head (5), Director (14).

-- ── PageDefinitions ──────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'loan-dashboard')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('loan-dashboard', 'Loan Dashboard', 'Loan', 'Loan', 'view', 300, 1, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'loan-sanction')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('loan-sanction', 'Loan Sanction', 'Loan', 'Loan', 'view,add,edit', 301, 1, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'records')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('records', 'All Records', 'Records', 'Records', 'view', 310, 1, 'migration', GETDATE());

GO

-- ── RoleRights — Loan ────────────────────────────────────────────────────────
-- SubModule matches the kebab fallback: Module='Loan', SubModule='dashboard' → 'loan-dashboard'
--                                        Module='Loan', SubModule='sanction'  → 'loan-sanction'

INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
SELECT v.RoleId, v.Module, v.SubModule, v.CanView, v.CanAdd, v.CanEdit, v.CanDelete, v.CanPrint, v.CanExport, v.CanPostApproval
FROM (VALUES
  (4,  'Loan', 'dashboard', 1, 0, 0, 0, 0, 0, 0),
  (4,  'Loan', 'sanction',  1, 1, 1, 0, 1, 1, 0),
  (5,  'Loan', 'dashboard', 1, 0, 0, 0, 0, 0, 0),
  (5,  'Loan', 'sanction',  1, 1, 1, 0, 1, 1, 0),
  (14, 'Loan', 'dashboard', 1, 0, 0, 0, 0, 0, 0),
  (14, 'Loan', 'sanction',  1, 1, 1, 1, 1, 1, 0)
) AS v(RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights rr
  WHERE rr.RoleId = v.RoleId AND rr.Module = v.Module AND rr.SubModule = v.SubModule
);

-- ── RoleRights — Records ─────────────────────────────────────────────────────
-- Module='Records', SubModule='records' → candidate 'records' (SubModule itself)

INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
SELECT v.RoleId, v.Module, v.SubModule, v.CanView, v.CanAdd, v.CanEdit, v.CanDelete, v.CanPrint, v.CanExport, v.CanPostApproval
FROM (VALUES
  (4,  'Records', 'records', 1, 0, 0, 0, 0, 1, 0),
  (5,  'Records', 'records', 1, 0, 0, 0, 0, 1, 0),
  (14, 'Records', 'records', 1, 0, 0, 0, 0, 1, 0)
) AS v(RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights rr
  WHERE rr.RoleId = v.RoleId AND rr.Module = v.Module AND rr.SubModule = v.SubModule
);

PRINT '411-loan-records-module-wire applied successfully.';
GO
