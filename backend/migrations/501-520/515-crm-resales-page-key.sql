-- Migration 515: page key for the investor Resale screen.
--
-- routes/crmResales.js gates every endpoint on requirePageRight('crm-resales'),
-- so without this row nobody can reach it — including an admin.
--
-- A resale moves ownership of a plot between two customers and records money
-- that is NOT the developer's (the outgoing investor's proceeds), so it is kept
-- as its own right rather than folded into crm-bookings.

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-resales', 'Plot Resale (Investor Exit)', 'CRM', 'CRM Transactions', 'view,create,edit,delete', 182, 1, 'migration-495', SYSDATETIME());
  PRINT 'Migration 515: seeded PageDefinitions row for crm-resales.';
END
ELSE
  PRINT 'Migration 515: crm-resales page key already exists — skipped.';
GO

DECLARE @MhdId INT = (SELECT RId FROM dbo.Role WHERE RName = 'marketing_head');
IF @MhdId IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM dbo.RoleRights WHERE RoleId = @MhdId AND Module = 'CRM' AND SubModule = 'crm-resales'
)
BEGIN
  INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
  VALUES (@MhdId, 'CRM', 'crm-resales', 1, 1, 1, 0);
  PRINT 'Migration 515: granted crm-resales to marketing_head (no delete).';
END
GO
