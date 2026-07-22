-- New CRM Setup item: "Project Bank Mapping" (crmProjectBanks.js /
-- CrmProjectBanks.tsx). Same crm- prefixed pageKey convention as migrations
-- 239-241 so marketing_head gets it automatically via the "crm-" prefix
-- match in requirePageRight.js/isMarketingHeadPage().
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'crm-project-banks', 'Project Bank Mapping', 'CRM', 'CRM Setup', 'view,create,edit,delete', 175, 1, 'migration-244', SYSDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'crm-project-banks' AND pd.IsActive = 1
);

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-project-banks'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'CRM', 'crm-project-banks', 1, 1, 1, 1);
END;

PRINT 'crm-project-banks page key seeded and granted to marketing_head.';
