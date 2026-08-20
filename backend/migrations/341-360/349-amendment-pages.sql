-- Migration 349: PageDefinitions rows for the three rebuilt Amendment pages
-- (audit trail of post-approval edits, one per module — see
-- backend/services/amendmentLog.js, backend/routes/amendmentLog.js,
-- src/pages/finance/FinanceAmendment.tsx, src/pages/material/MaterialAmendment.tsx,
-- src/pages/engineering/EngineeringAmendment.tsx). Read-only, view-only pages.

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'finance-amendment', 'Amendment', 'Finance', 'Finance', 'view', 90, 1, 'migration-349', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'finance-amendment' AND pd.IsActive = 1
);
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'material-amendment', 'Amendment', 'Material', 'Material', 'view', 90, 1, 'migration-349', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'material-amendment' AND pd.IsActive = 1
);
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'engineering-amendment', 'Amendment', 'Engineering', 'Engineering', 'view', 90, 1, 'migration-349', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'engineering-amendment' AND pd.IsActive = 1
);
GO

PRINT '349-amendment-pages applied successfully.';
GO
