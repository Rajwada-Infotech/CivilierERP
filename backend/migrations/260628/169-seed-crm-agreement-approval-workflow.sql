-- migration: 169-seed-crm-agreement-approval-workflow.sql
-- Seeds a real, genuinely multi-level ApprovalWorkflows row for the
-- "crm-agreements" module (Stage 7 of the CRM spec: "configurable approval
-- hierarchy... Legal Executive -> Legal Manager -> Director").
--
-- Without any workflow row, getWorkflow('crm-agreements') returns null and
-- senior approval defaults to a single open level, gated only by the
-- module-wide coarse check in approvalService.js's
-- MODULE_APPROVER_ROLE_OVERRIDES (admin/super_admin/marketing_head — set
-- earlier per explicit instruction: "the senior approval will be accessed
-- and can be approved by the marketing head login, admin and super admin
-- logins only. only these 3 loggins"). This seed keeps that same 3-role
-- pool but splits it into two real levels instead of one open gate:
--   Level 1 "Marketing Review"  — marketing_head or admin
--   Level 2 "Final Sign-off"    — super_admin or admin
-- admin can act at either level (a flexible approver); marketing_head only
-- opens it, super_admin only finalizes it — nobody outside the original
-- 3-role set gains any access.
--
-- Further levels/approvers can be added later purely via the Approval
-- Setup UI (LevelsData), no further migration or code change required.
-- Safe to re-run: skips insert if a row already targets this module.

IF NOT EXISTS (
  SELECT 1 FROM dbo.ApprovalWorkflows
  WHERE modules LIKE '%"crm-agreements"%'
)
BEGIN
  INSERT INTO dbo.ApprovalWorkflows
    (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  VALUES
    (
      N'CRM Agreement Senior Approval',
      N'CrmAgreement',
      2,
      NULL,
      N'Active',
      N'Two-level senior sign-off gate on CrmAgreement.SeniorApprovalStatus before an agreement can be sent to the customer portal: Marketing Review, then Final Sign-off.',
      N'migration-169',
      SYSDATETIME(),
      N'sequential',
      N'["crm-agreements"]',
      1,
      N'[]',
      N'[{"id":1,"label":"Marketing Review","roles":["marketing_head","admin"]},{"id":2,"label":"Final Sign-off","roles":["super_admin","admin"]}]'
    );
  PRINT 'Seeded CRM Agreement Senior Approval workflow (2 levels: Marketing Review, Final Sign-off)';
END
ELSE
BEGIN
  PRINT 'A workflow already targets crm-agreements — skipped seeding to avoid duplicates';
END
