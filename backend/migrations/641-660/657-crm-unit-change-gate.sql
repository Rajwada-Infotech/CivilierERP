-- Migration 657: changing a booking's unit (same project or a linked move to another project) is set in Approval Setup.
--
-- Until now it was allowed in code to full access and to the Marketing Head switch. From now on it is the Approval
-- Setup entry "CRM Unit Change" (module "crm-unit-change"), checked with isApproverFor: super admin always, everyone
-- else when the entry names their role or them. So nobody's access changes on deploy, the entry is written naming the
-- admin and dba roles (those that exist in Role Master) plus every role and user the active Marketing Head entry
-- names. An existing active entry is left as it is. Safe to run again.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE N'%"crm-unit-change"%')
BEGIN
  DECLARE @roles NVARCHAR(MAX), @users NVARCHAR(MAX);
  SELECT @roles = STRING_AGG(N'"' + STRING_ESCAPE(x.r, 'json') + N'"', N',')
  FROM (
    SELECT r.RName AS r FROM dbo.Role r WHERE LOWER(r.RName) IN (N'admin', N'dba')
    UNION
    SELECT CAST(j.value AS NVARCHAR(200)) FROM dbo.ApprovalWorkflows w
      CROSS APPLY OPENJSON(w.LevelsData) l CROSS APPLY OPENJSON(l.value, '$.roles') j
    WHERE w.active = 1 AND w.modules LIKE N'%"marketing-head"%' AND ISJSON(w.LevelsData) = 1
  ) x WHERE x.r IS NOT NULL AND x.r <> N'';
  SELECT @users = STRING_AGG(CAST(x.u AS NVARCHAR(20)), N',')
  FROM (
    SELECT DISTINCT TRY_CAST(j.value AS INT) AS u FROM dbo.ApprovalWorkflows w
      CROSS APPLY OPENJSON(w.LevelsData) l CROSS APPLY OPENJSON(l.value, '$.userIds') j
    WHERE w.active = 1 AND w.modules LIKE N'%"marketing-head"%' AND ISJSON(w.LevelsData) = 1
  ) x WHERE x.u IS NOT NULL;
  INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
  VALUES (N'CRM Unit Change', 'sequential', N'["crm-unit-change"]',
          N'[{"id":1,"label":"CRM Unit Change","mode":"any","userIds":[' + ISNULL(@users, N'') + N'],"roles":[' + ISNULL(@roles, N'') + N']}]',
          1, N'migration 657', SYSDATETIME(), N'crm-unit-change', 1, 'Active');
END
GO

PRINT 'Migration 657 complete: CRM Unit Change in Approval Setup';
