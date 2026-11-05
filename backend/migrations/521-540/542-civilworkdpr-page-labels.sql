-- Migration 542: Civil Work DPR page labels match what the apps call them.
--   civilworkdpr-work-done          "Work Done"  -> "Work Allocation"  (route /civilworkdpr/work-allocation)
--   civilworkdpr-activity-reporting "Reporting"  -> "Work Reporting"
-- Only the display label changes; PageKey, rights and role grants are untouched.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PageDefinitions' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  UPDATE dbo.PageDefinitions SET Label = 'Work Allocation'
  WHERE PageKey = 'civilworkdpr-work-done' AND Label <> 'Work Allocation';

  UPDATE dbo.PageDefinitions SET Label = 'Work Reporting'
  WHERE PageKey = 'civilworkdpr-activity-reporting' AND Label <> 'Work Reporting';
END
GO

PRINT '542-civilworkdpr-page-labels applied successfully.';
GO
