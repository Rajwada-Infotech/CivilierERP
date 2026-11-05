-- Migration 553: default approval workflow for Property Resale & Buy-back.
--
--   Level 1 "Marketing Head" — role marketing_head
--   Level 2 "Director"       — role director
--
-- Each level names its role AND the users who hold that role when this runs
-- (looked up from dbo.users / dbo.Role, never a fixed id), so those people
-- can act at their level straight away. Nothing about it lives in code: who
-- approves is edited later in Approval Setup (levels, people), with no
-- migration or code change. Seeded only when no workflow targets
-- "crm-resales" yet, so a workflow set up by hand is never overwritten.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE modules LIKE '%"crm-resales"%')
BEGIN
  DECLARE @mh NVARCHAR(MAX) = (
    SELECT STRING_AGG(CAST(u.id AS NVARCHAR(20)), ',') FROM dbo.users u
    JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE LOWER(REPLACE(r.RName, ' ', '_')) = 'marketing_head' AND ISNULL(u.discontinue, 0) = 0);
  DECLARE @dir NVARCHAR(MAX) = (
    SELECT STRING_AGG(CAST(u.id AS NVARCHAR(20)), ',') FROM dbo.users u
    JOIN dbo.Role r ON r.RId = u.RoleId
    WHERE LOWER(REPLACE(r.RName, ' ', '_')) = 'director' AND ISNULL(u.discontinue, 0) = 0);

  DECLARE @levels NVARCHAR(MAX) = CONCAT(
    N'[{"id":1,"label":"Marketing Head","mode":"any","roles":["marketing_head"],"userIds":[', ISNULL(@mh, N''), N']},',
    N'{"id":2,"label":"Director","mode":"any","roles":["director"],"userIds":[', ISNULL(@dir, N''), N']}]');

  INSERT INTO dbo.ApprovalWorkflows
    (Name, Module, Levels, Approvers, Status, Description, CreatedBy, CreatedAt, type, modules, active, LevelsJson, LevelsData)
  VALUES
    (N'Property Resale & Buy-back', N'CrmUnitResale', 2, NULL, N'Active',
     N'A sold property passing to a new buyer, or bought back by us: Marketing Head, then Director. Edit levels and people in Approval Setup.',
     N'migration-553', SYSDATETIME(), N'sequential', N'["crm-resales"]', 1, N'[]', @levels);

  PRINT CONCAT('Migration 553: seeded Property Resale & Buy-back approval (marketing head user(s): ', ISNULL(@mh, 'none'),
               '; director user(s): ', ISNULL(@dir, 'none — add them in Approval Setup'), ').');
END
ELSE
  PRINT 'Migration 553: a workflow already targets crm-resales — left as it is.';
GO
