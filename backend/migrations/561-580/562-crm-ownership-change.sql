-- Migration 562: Ownership Changes — recording a new owner AFTER conveyance.
--
-- Once a property's sale deed is registered it belongs to its owner; if they
-- sell it on, that is a private sale between owners (the developer is not a
-- party, no NOC or deed of assignment — Resale & Buy-back refuses it). We only
-- RECORD the new owner from their registered sale deed, so maintenance,
-- service tickets, the portal and the customer record follow the right
-- person. dbo.CrmOwnershipChange (migration 558) holds the record; this adds
-- its number, both applications, and the approval it goes through.
--
-- Draft -> Pending (approval workflow 'crm-ownership-changes') -> Approved
-- (the booking moves to the new owner's application) | Rejected (fix, send
-- again) | Cancelled.

IF COL_LENGTH('dbo.CrmOwnershipChange', 'ChangeNo') IS NULL
  ALTER TABLE dbo.CrmOwnershipChange ADD ChangeNo NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.CrmOwnershipChange', 'FromApplicationId') IS NULL
  ALTER TABLE dbo.CrmOwnershipChange ADD FromApplicationId INT NULL, ToApplicationId INT NULL;
IF COL_LENGTH('dbo.CrmOwnershipChange', 'SubmittedAt') IS NULL
  ALTER TABLE dbo.CrmOwnershipChange ADD SubmittedAt DATETIME2 NULL, SubmittedBy INT NULL;
GO

-- A record starts as a Draft until it is sent for approval.
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_CrmOwnershipChange_Status')
BEGIN
  ALTER TABLE dbo.CrmOwnershipChange DROP CONSTRAINT DF_CrmOwnershipChange_Status;
  ALTER TABLE dbo.CrmOwnershipChange ADD CONSTRAINT DF_CrmOwnershipChange_Status2 DEFAULT N'Draft' FOR Status;
END
GO

-- Approval: starts from the resale approval (same people decide who owns a
-- property). Approval Setup edits it separately later.
IF OBJECT_ID('dbo.ApprovalWorkflows', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE N'%"crm-ownership-changes"%')
BEGIN
  INSERT INTO dbo.ApprovalWorkflows (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  SELECT TOP 1 N'CRM Ownership Change', N'CrmOwnershipChange', w.Levels, w.Approvers, N'Active',
         N'A new owner recorded from their registered sale deed, after conveyance. Started from the resale approval.',
         N'migration-562', SYSDATETIME(), ISNULL(w.type, N'sequential'), N'["crm-ownership-changes"]', 1, ISNULL(w.LevelsJson, N'[]'), w.LevelsData
  FROM dbo.ApprovalWorkflows w WHERE w.modules LIKE N'%"crm-resales"%' AND w.active = 1 ORDER BY w.Id;
  IF @@ROWCOUNT = 0 PRINT 'Migration 562: no crm-resales workflow to start crm-ownership-changes from — set it up in Approval Setup.';
END
GO

-- Page key: who works on it starts from who works on resales.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-ownership-changes' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  SELECT 'crm-ownership-changes', 'Ownership Changes (Resale & Buy-back)', 'CRM', ISNULL(
           (SELECT TOP 1 GroupName FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales' AND IsActive = 1), 'CRM Transactions'),
         'view,create,edit,delete',
         ISNULL((SELECT TOP 1 SortOrder FROM dbo.PageDefinitions WHERE PageKey = 'crm-resales' AND IsActive = 1), 182) + 2,
         1, 'migration-562', SYSDATETIME();
END
GO

INSERT INTO dbo.RoleRights (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete)
SELECT rr.RoleId, rr.Module, 'crm-ownership-changes', rr.CanView, rr.CanAdd, rr.CanEdit, rr.CanDelete
FROM dbo.RoleRights rr
WHERE rr.SubModule = 'crm-resales'
  AND NOT EXISTS (SELECT 1 FROM dbo.RoleRights x WHERE x.RoleId = rr.RoleId AND x.SubModule = 'crm-ownership-changes');
PRINT CONCAT('Migration 562: crm-ownership-changes rights copied from crm-resales for ', @@ROWCOUNT, ' role(s).');
GO
