-- 134-seed-sa-marketing-invoice-page-definition.sql
-- Seeds page key for Marketing Invoices.
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
('sa-marketing-invoices', 'Marketing Invoices', 'Sales Automation', 'Sales Automation Finance', 'view,create,edit,delete,print,export', 470)
;

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT
  p.PageKey, p.Label, p.Module, p.GroupName, p.Actions, p.SortOrder, 1, 'migration-134', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd
  WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 134 complete';
GO
