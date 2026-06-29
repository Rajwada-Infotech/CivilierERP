-- 03-sa-page-definitions.sql
-- Seeds all Sales Automation page keys into dbo.PageDefinitions.
-- Idempotent: guarded by NOT EXISTS on PageKey.

DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  Module    NVARCHAR(100),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages VALUES
  ('sa-social-media',       'Social Media Master',     'Sales Automation', 'Sales Automation Masters', 'view,create,edit,delete,print,export', 400),
  ('sa-campaigns',          'Campaign Master',          'Sales Automation', 'Sales Automation Masters', 'view,create,edit,delete,print,export', 410),
  ('sa-ads',                'Ad Master',                'Sales Automation', 'Sales Automation Masters', 'view,create,edit,delete,print,export', 420),
  ('sa-leads',              'Lead Management',          'Sales Automation', 'Sales Automation Leads',   'view,create,edit,delete,print,export', 430),
  ('sa-lead-distribution',  'Lead Distribution',        'Sales Automation', 'Sales Automation Leads',   'view,create,edit,delete,print,export', 440),
  ('sa-inquiry',            'Inquiry Dashboard',        'Sales Automation', 'Sales Automation Inquiry', 'view,create,edit,delete,print,export', 450),
  ('sa-site-visits',        'Site Visits',              'Sales Automation', 'Sales Automation Inquiry', 'view,create,edit,delete,print,export', 460),
  ('sa-marketing-invoices', 'Marketing Invoices',       'Sales Automation', 'Sales Automation Finance', 'view,create,edit,delete,print,export', 470),
  ('sa-teams',              'Sales Team Management',    'Sales Automation', 'Sales Automation Admin',   'view,create,edit,delete',              475),
  ('sa-distribution-rules', 'Distribution Rules Setup', 'Sales Automation', 'Sales Automation Admin',   'view,create,edit,delete',              478),
  ('sa-lead-transfers',     'Lead Transfers',           'Sales Automation', 'Sales Automation Leads',   'view,create,edit,delete',              480),
  ('sa-role-master',        'SA Role Master',           'Sales Automation', 'Sales Automation Admin',   'view,create,edit,delete,print',        490);

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration-280626', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);
GO

PRINT '03-sa-page-definitions: done';
