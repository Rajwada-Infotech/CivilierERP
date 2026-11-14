-- Migration 638: voiding a CRM invoice and releasing a parking slot are set in Approval Setup, not in code.
--
-- Until now voiding an invoice was allowed to a fixed role list in code (admin, super_admin, dba, then admin/dba/
-- super_admin), and releasing a parking slot to super admin only. From now on each is an Approval Setup entry
-- (modules "crm-invoice-void" and "crm-parking-release"), checked with isApproverFor: super admin always, everyone else
-- when the entry names their role or them. So nobody's access changes on deploy, invoice void is written naming the
-- admin and dba roles (only those that exist in Role Master) and parking release with nobody named (super admin only,
-- as before). An existing active entry is left as it is. Safe to run again.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"crm-invoice-void"%')
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  SELECT N'CRM Invoice Void', 'sequential', N'["crm-invoice-void"]',
         N'[{"id":1,"label":"CRM Invoice Void","mode":"any","userIds":[],"roles":['
           + ISNULL((SELECT STRING_AGG(N'"' + r.RName + N'"', N',') FROM dbo.Role r WHERE LOWER(r.RName) IN (N'admin', N'dba')), N'')
           + N']}]',
         1, N'migration 638', SYSDATETIME(), N'crm-invoice-void', 1, 'Active';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"crm-parking-release"%')
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  VALUES (N'CRM Parking Release', 'sequential', N'["crm-parking-release"]',
          N'[{"id":1,"label":"CRM Parking Release","mode":"any","userIds":[],"roles":[]}]',
          1, N'migration 638', SYSDATETIME(), N'crm-parking-release', 1, 'Active');
GO

PRINT 'Migration 638 complete: CRM Invoice Void and CRM Parking Release in Approval Setup';
