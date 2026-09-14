-- Migration 383: New columns on CrmSalesDeed for full Agreement-parity workflow.
--
-- LegalExecutiveId — the staff member responsible for shepherding the deed
--   through legal preparation; must be assigned before Senior Approval.
--
-- SeniorApprovalStatus — NEW approval gate that sits BEFORE Director Approval.
--   Sequence: Deed created → Legal Exec assigned → Deed draft uploaded →
--   Senior Approval (admin) → Auto-send to customer → Customer Approval →
--   Director Approval → QP → Registry → Registration.
--   Previously the deed had NO senior approval, meaning any staff could prepare
--   a deed and push it to the customer without admin review — corrected here.
--
-- VersionNo — increments on each senior rejection so the revision history
--   table (CrmSalesDeedRevision, migration 384) can track exactly which
--   version was rejected and why.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'LegalExecutiveId')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD LegalExecutiveId INT NULL;
  PRINT 'Added CrmSalesDeed.LegalExecutiveId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'SeniorApprovalStatus')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD SeniorApprovalStatus  NVARCHAR(30)     NULL;
  ALTER TABLE dbo.CrmSalesDeed ADD SeniorApprovedBy      INT              NULL;
  ALTER TABLE dbo.CrmSalesDeed ADD SeniorApprovedAt      DATETIME2(3)     NULL;
  ALTER TABLE dbo.CrmSalesDeed ADD SeniorApprovalRemarks NVARCHAR(MAX)    NULL;
  PRINT 'Added CrmSalesDeed Senior Approval columns';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmSalesDeed') AND name = 'VersionNo')
BEGIN
  ALTER TABLE dbo.CrmSalesDeed ADD VersionNo INT NOT NULL DEFAULT 1;
  PRINT 'Added CrmSalesDeed.VersionNo';
END
GO

-- Seed the Senior Approval workflow module (mirrors Director Approval pattern
-- in migration 209, but for admin/dba/super_admin rather than super_admin only).
IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE '%"crm-sales-deed-senior"%')
BEGIN
  INSERT INTO dbo.ApprovalWorkflows
    (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  VALUES
    (
      N'CRM Sales Deed Senior Approval',
      N'CrmSalesDeedSenior',
      1,
      NULL,
      N'Active',
      N'Senior-level sign-off on CrmSalesDeed.SeniorApprovalStatus, required after deed draft is uploaded and before the deed is sent to the customer portal. Mirrors the Agreement Senior Approval gate. Currently restricted to admin/dba/super_admin — reconfigure via Admin > Approval > Approval Setup.',
      N'migration-383',
      SYSDATETIME(),
      N'sequential',
      N'["crm-sales-deed-senior"]',
      1,
      N'[]',
      N'[{"id":1,"label":"Sales Deed Senior Approval","roles":["admin","dba","super_admin"]}]'
    );
  PRINT 'Seeded CRM Sales Deed Senior Approval workflow';
END
ELSE
BEGIN
  PRINT 'A workflow already targets crm-sales-deed-senior — skipped seeding';
END
GO

PRINT 'Migration 383 complete — CrmSalesDeed Senior Approval columns';
GO
