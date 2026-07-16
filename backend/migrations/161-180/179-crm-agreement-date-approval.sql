-- Second, independent approval gate on CrmAgreement: once both the company
-- and the customer propose the same date, it no longer locks in instantly.
-- It goes to DateApprovalStatus='Pending' and needs a super_admin sign-off
-- (same LevelsData-driven pattern as Senior Approval — hardcoded to
-- super_admin for now, reassignable later via the Approval Setup UI without
-- any code change) before AgreementDate is actually written.
-- CrmAgreementApprovalLog.Action was NVARCHAR(30) — too narrow for the new
-- date-approval action names (e.g. 'AgreementDateSubmittedForApproval' is
-- 34 chars). Widened rather than shortening the names, since they're the
-- one thing that makes the log human-readable.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementApprovalLog') AND name = 'Action' AND max_length < 100)
BEGIN
  ALTER TABLE dbo.CrmAgreementApprovalLog ALTER COLUMN Action NVARCHAR(50) NOT NULL;
  PRINT 'Widened CrmAgreementApprovalLog.Action to NVARCHAR(50)';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreement') AND name = 'DateApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmAgreement ADD DateApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmAgreement_DateApprovalStatus DEFAULT 'NotRequired';
  PRINT 'Added CrmAgreement.DateApprovalStatus';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE '%"crm-agreement-date"%')
BEGIN
  INSERT INTO dbo.ApprovalWorkflows
    (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  VALUES
    (
      N'CRM Agreement Date Approval',
      N'CrmAgreementDate',
      1,
      NULL,
      N'Active',
      N'Single-level sign-off gate on CrmAgreement.DateApprovalStatus, confirming the agreement date once both company and customer have proposed matching dates. Currently restricted to super_admin only — reconfigure levels/roles anytime via Admin > Approval > Approval Setup.',
      N'migration-179',
      SYSDATETIME(),
      N'sequential',
      N'["crm-agreement-date"]',
      1,
      N'[]',
      N'[{"id":1,"label":"Agreement Date Approval","roles":["super_admin"]}]'
    );
  PRINT 'Seeded CRM Agreement Date Approval workflow';
END
ELSE
BEGIN
  PRINT 'A workflow already targets crm-agreement-date — skipped seeding to avoid duplicates';
END
GO
