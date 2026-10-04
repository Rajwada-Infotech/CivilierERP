-- Migration 475: PageDefinitions row for the new "GL Posting Failures"
-- DBA page (src/pages/dba/GLPostingFailures.tsx, backend/routes/dba.js's
-- existing GET /gl-posting-failures + new POST /gl-posting-failures/:id/retry).
-- Read-only + a retry action, gated to DBA/Admin same as the sibling
-- Payment Logs page.

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'dba-gl-posting-failures', 'GL Posting Failures', 'Admin', 'DBA', 'view,edit', 360, 1, 'migration-475', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'dba-gl-posting-failures' AND pd.IsActive = 1
);
GO

PRINT '475-gl-posting-failures-page applied successfully.';
GO
