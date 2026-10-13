-- Migration 561: page key for the Transfer Deeds legal pages (migration 560):
-- the deed workspace, its stamp duty and its registry (routes/crmTransferDeeds.js
-- gates every endpoint on requirePageRight('crm-transfer-deeds')).
--
-- Who may work on them starts from who works on agreements today: every role
-- holding rights on 'crm-agreements' gets the same rights here (copied when
-- this runs, never a fixed role). Role Rights edits them separately later.

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-transfer-deeds' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  SELECT 'crm-transfer-deeds', 'Transfer Deeds (Resale & Buy-back)', 'CRM', ISNULL(
           (SELECT TOP 1 GroupName FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales' AND IsActive = 1), 'CRM Transactions'),
         'view,create,edit,delete',
         ISNULL((SELECT TOP 1 SortOrder FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales' AND IsActive = 1), 182) + 1,
         1, 'migration-561', SYSDATETIME();
  PRINT 'Migration 561: seeded PageDefinitions row for crm-transfer-deeds.';
END
GO

INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT rr.RoleId, rr.Module, 'crm-transfer-deeds', rr.CanView, rr.CanAdd, rr.CanEdit, rr.CanDelete
FROM dbo.RoleRights rr
WHERE rr.SubModule = 'crm-agreements'
  AND NOT EXISTS (SELECT 1 FROM dbo.RoleRights x WHERE x.RoleId = rr.RoleId AND x.SubModule = 'crm-transfer-deeds');
PRINT CONCAT('Migration 561: crm-transfer-deeds rights copied from crm-agreements for ', @@ROWCOUNT, ' role(s).');
GO
