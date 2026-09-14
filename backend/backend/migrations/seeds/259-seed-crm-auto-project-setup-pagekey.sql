-- New CRM Setup item: "Auto Project Setup" (crmProjectAutoSetup.js /
-- CrmProjectAutoSetup.tsx). Same crm- prefixed pageKey convention as
-- migration 244 so marketing_head gets it automatically via the "crm-"
-- prefix match in requirePageRight.js/isMarketingHeadPage().
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'crm-auto-project-setup', 'Auto Project Setup', 'CRM', 'CRM Setup', 'view,create,edit,delete', 160, 1, 'migration-259', SYSDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'crm-auto-project-setup' AND pd.IsActive = 1
);

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-auto-project-setup'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'CRM', 'crm-auto-project-setup', 1, 1, 1, 1);
END;

PRINT 'crm-auto-project-setup page key seeded and granted to marketing_head.';
