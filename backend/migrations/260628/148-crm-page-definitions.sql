-- Migration 148: Page definitions for new CRM pages.
DECLARE @Pages TABLE (
  PageKey   NVARCHAR(100),
  Label     NVARCHAR(200),
  GroupName NVARCHAR(150),
  Actions   NVARCHAR(200),
  SortOrder INT
);

INSERT INTO @Pages (PageKey, Label, GroupName, Actions, SortOrder) VALUES
('sa-channel-partners', 'Channel Partners',   'Sales Automation Admin',  'view,create,edit,delete',        500),
('sa-lead-activities',  'Lead Activities',     'Sales Automation Leads',  'view,create,edit,delete',        495),
('sa-lead-tasks',       'Lead Tasks',          'Sales Automation Leads',  'view,create,edit,delete',        496),
('sa-commissions',      'Commission Tracking', 'Sales Automation Finance', 'view,create,edit,delete',       510);

INSERT INTO dbo.PageDefinitions
  (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, 'Sales Automation', p.GroupName, p.Actions, p.SortOrder, 1, 'migration-148', GETDATE()
FROM @Pages p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey AND pd.IsActive = 1
);

PRINT 'Migration 148 complete — CRM page definitions seeded';
