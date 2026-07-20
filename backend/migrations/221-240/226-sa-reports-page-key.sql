-- The "Reports" sidebar item (SalesAutomationSidebar.ts) and its route
-- guard (App.tsx: /sales-automation/reports) both reused pageKey="sa-leads"
-- — the same key as the unrelated "All Leads" page. That meant Reports had
-- no permission identity of its own: a user without sa-leads access lost
-- Reports too, and rights couldn't be granted/revoked for one without the
-- other. This seeds a real "sa-reports" page definition (mirroring
-- migration 142's pattern) and grants it to marketing_head (the role with
-- full CRUD across all SA pages today) so existing access isn't lost once
-- the sidebar/route are switched to it.
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'sa-reports', 'Reports', 'Sales Automation', 'Sales Automation Inquiry', 'view,print,export', 465, 1, 'migration-226', GETDATE()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'sa-reports' AND pd.IsActive = 1
);

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'Sales Automation' AND SubModule = 'sa-reports'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'Sales Automation', 'sa-reports', 1, 0, 0, 0);
END;

PRINT 'sa-reports page key seeded and granted to marketing_head.';
