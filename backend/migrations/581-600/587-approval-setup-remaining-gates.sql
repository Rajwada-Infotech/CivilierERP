-- Migration 587: the last approval gates move into Approval Setup.
--
-- Account head approval, Activity Master / Engineering Activity Master approval and
-- SA lead-transfer approval still decided who may approve in code (fixed role lists).
-- From this release they go through the shared engine like every other approval:
-- Approval Setup names the approvers, and a super admin can approve every kind of
-- approval alongside them.
--
-- So nothing changes on the day of the deploy, each gate that has NO active workflow
-- gets one here with the roles the code allowed until now (only roles that exist in
-- Role Master are written) — the same one-time carry-over as migration 582. Change
-- them any time in Admin → Approval → Approval Setup. Safe to run again.

DECLARE @seed TABLE (Module NVARCHAR(100) NOT NULL, Roles NVARCHAR(400) NOT NULL, Label NVARCHAR(200) NOT NULL);
INSERT INTO @seed (Module, Roles, Label) VALUES
  (N'account-heads', N'admin,super_admin', N'Account Head'),
  (N'activity-master', N'admin,super_admin,dba', N'Activity Master'),
  (N'engineering-activity-master', N'admin,super_admin,dba', N'Engineering Activity Master'),
  (N'sa-lead-transfers', N'admin,super_admin,sa,dba,marketing_head', N'SA Lead Transfer');

INSERT INTO dbo.ApprovalWorkflows (Name, type, modules, LevelsData, active, CreatedBy, CreatedAt, Module, Levels, Status)
SELECT s.Label,
       'sequential',
       N'["' + s.Module + N'"]',
       N'[{"id":1,"label":"Approval","mode":"any","userIds":[],"roles":['
         + ISNULL((SELECT STRING_AGG(N'"' + r.RName + N'"', N',') FROM dbo.Role r
                   WHERE N',' + s.Roles + N',' LIKE N'%,' + LOWER(r.RName) + N',%'), N'')
         + N']}]',
       1, N'migration 587', SYSDATETIME(), s.Module, 1, 'Active'
FROM @seed s
WHERE NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows w
                  WHERE w.active = 1 AND w.modules LIKE N'%"' + s.Module + N'"%');
GO
