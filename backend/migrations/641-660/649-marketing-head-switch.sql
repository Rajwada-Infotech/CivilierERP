-- Migration 649: the "Marketing Head" switch in Approval Setup.
--
-- Until now the code itself let the marketing_head role see and manage every Sales Automation record and run a
-- few CRM admin actions (saAccess.js isSaAdmin: "full access, or role is marketing_head"), and named that role
-- for two notices. From now on that is decided by this switch (module "marketing-head"), set on the Approval
-- Setup screen like every other gate; the full-access roles always pass.
--
-- So nobody's access changes, the switch is written naming the marketing_head role, the one role the code
-- allowed until now (written only if that role exists in Role Master). An existing active switch is left as
-- it is. Safe to run again.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"marketing-head"%')
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  SELECT N'Marketing Head',
         'sequential',
         N'["marketing-head"]',
         N'[{"id":1,"label":"Marketing Head","mode":"any","userIds":[],"roles":['
           + ISNULL((SELECT STRING_AGG(N'"' + r.RName + N'"', N',') FROM dbo.Role r WHERE LOWER(r.RName) = N'marketing_head'), N'')
           + N']}]',
         1, N'migration 654', SYSDATETIME(), N'marketing-head', 1, 'Active';
GO

PRINT 'Migration 649 complete: Marketing Head switch';
