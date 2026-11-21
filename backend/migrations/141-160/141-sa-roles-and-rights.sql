-- 02-sa-roles-and-rights.sql
-- Seeds Sales Automation roles (marketing_head, sales_team_lead, sales_person)
-- and their page-level rights in dbo.RoleRights.
-- Idempotent: roles guarded by NOT EXISTS; rights use DELETE + re-insert.

-- ── Roles ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RCode = 'STL')
  INSERT INTO dbo.Role (RCode, RName, RDesc, RCreatedBy, RCreatedAt)
  VALUES ('STL', 'sales_team_lead', 'Sales Team Leader role', 'migration', SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RCode = 'SP')
  INSERT INTO dbo.Role (RCode, RName, RDesc, RCreatedBy, RCreatedAt)
  VALUES ('SP', 'sales_person', 'Sales Person role', 'migration', SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM dbo.Role WHERE RName = 'marketing_head')
  INSERT INTO dbo.Role (RName, RCode, RDesc, RCreatedBy, RCreatedAt)
  VALUES ('marketing_head', 'MHD', 'Marketing Head - admin access to Sales and Sales Automation only', 'migration', SYSDATETIME());
GO

-- ── Role Rights ──────────────────────────────────────────────
DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
DECLARE @StlId INT = (SELECT RId FROM dbo.Role WHERE RName = 'sales_team_lead');
DECLARE @SpId  INT = (SELECT RId FROM dbo.Role WHERE RName = 'sales_person');

-- marketing_head: full CRUD on all SA + Sales pages
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT @MhdId, m, s, 1, 1, 1, 1
FROM (VALUES
  ('Sales Automation', 'sa-leads'),
  ('Sales Automation', 'sa-inquiry'),
  ('Sales Automation', 'sa-campaigns'),
  ('Sales Automation', 'sa-ads'),
  ('Sales Automation', 'sa-marketing-invoices'),
  ('Sales Automation', 'sa-site-visits'),
  ('Sales Automation', 'sa-social-media'),
  ('Sales Automation', 'sa-teams'),
  ('Sales Automation', 'sa-lead-distribution'),
  ('Sales Automation', 'sa-distribution-rules'),
  ('Sales Automation', 'sa-lead-transfers'),
  ('Sales Automation', 'sa-role-master'),
  ('Sales',            'sale-order'),
  ('Sales',            'sale-invoice'),
  ('Sales',            'sales-payment')
) AS v(m, s)
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights r
  WHERE r.RoleId = @MhdId AND r.Module = v.m AND r.SubModule = v.s
);

-- sales_team_lead rights
DELETE FROM dbo.RoleRights WHERE RoleId = @StlId;
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES
  (@StlId, 'Sales Automation', 'sa-leads',             1, 0, 1, 0),
  (@StlId, 'Sales Automation', 'sa-inquiry',            1, 1, 1, 0),
  (@StlId, 'Sales Automation', 'sa-site-visits',        1, 1, 1, 0),
  (@StlId, 'Sales Automation', 'sa-campaigns',          1, 0, 0, 0),
  (@StlId, 'Sales Automation', 'sa-ads',                1, 0, 0, 0),
  (@StlId, 'Sales Automation', 'sa-marketing-invoices', 1, 0, 0, 0),
  (@StlId, 'Sales Automation', 'sa-social-media',       1, 0, 0, 0),
  (@StlId, 'Sales Automation', 'sa-teams',              1, 0, 0, 0),
  (@StlId, 'Sales Automation', 'sa-lead-distribution',  1, 1, 0, 0),
  (@StlId, 'Sales Automation', 'sa-lead-transfers',     1, 1, 0, 0),
  (@StlId, 'Sales Automation', 'sa-distribution-rules', 1, 0, 0, 0);

-- sales_person rights
DELETE FROM dbo.RoleRights WHERE RoleId = @SpId;
INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete) VALUES
  (@SpId, 'Sales Automation', 'sa-leads',      1, 0, 1, 0),
  (@SpId, 'Sales Automation', 'sa-inquiry',     1, 1, 1, 0),
  (@SpId, 'Sales Automation', 'sa-site-visits', 1, 1, 1, 0);
GO

PRINT '02-sa-roles-and-rights: done';
