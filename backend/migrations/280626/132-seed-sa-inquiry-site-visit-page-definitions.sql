-- 132-seed-sa-inquiry-site-visit-page-definitions.sql
-- Seeds page keys for Inquiry Dashboard and Site Visits.
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
('sa-inquiry',    'Inquiry Dashboard', 'Sales Automation', 'Sales Automation Inquiry', 'view,create,edit,delete,print,export', 450),
('sa-site-visits', 'Site Visits',      'Sales Automation', 'Sales Automation Inquiry', 'view,create,edit,delete,print,export', 460)
;

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration-132', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 132 complete';
GO
