-- 609 · One approval setup page.
-- Approval Workflow and Approval Control were two Setup pages for one job. Who verifies and approves is now set
-- per user in Approval Control; a workflow keeps only its route details (SLA days, escalation, dates) and is
-- shown on the Approval Control page. The old L1 / L2 role columns are no longer asked for.
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.LegalApprovalWorkflow', N'L1RoleId') IS NOT NULL
  ALTER TABLE dbo.LegalApprovalWorkflow ALTER COLUMN L1RoleId INT NULL;
IF COL_LENGTH(N'dbo.LegalApprovalWorkflow', N'L2RoleId') IS NOT NULL
  ALTER TABLE dbo.LegalApprovalWorkflow ALTER COLUMN L2RoleId INT NULL;
GO

-- The workflow is managed from the Approval Control page now, under that page's right.
UPDATE dbo.PageDefinitions SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE PageKey = N'legal-approval-workflow-master';
UPDATE dbo.PageDefinitions SET Label = N'Approval Control (approvers, routes & SLA)', UpdatedAt = SYSDATETIME()
WHERE PageKey = N'legal-approval-authority-master';
GO
