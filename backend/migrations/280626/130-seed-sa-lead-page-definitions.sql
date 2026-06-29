-- 130-seed-sa-lead-page-definitions.sql
-- Seeds page keys for Lead Management and Lead Distribution.
-- Idempotent: guarded by NOT EXISTS.

DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  Module    NVARCHAR(100),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, Module, GroupName, Actions, SortOrder) VALUES
('sa-leads',             'Lead Management',  'Sales Automation', 'Sales Automation Leads', 'view,create,edit,delete,print,export', 430),
('sa-lead-distribution', 'Lead Distribution', 'Sales Automation', 'Sales Automation Leads', 'view,create,edit,delete,print,export', 440)
;

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration-130', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 130 complete';
GO
