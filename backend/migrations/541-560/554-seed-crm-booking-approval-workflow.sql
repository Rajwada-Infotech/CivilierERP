-- Migration 554: the CRM booking approval workflow, where it is missing.
--
-- Migration 308 seeded "CRM Booking Approval (Marketing Head -> Director)",
-- but on a database whose migration history was baselined after 308 the row
-- never existed — booking approval then ran as ONE level: the first approver
-- finished it, the stage stayed at Director Approval and the booking was
-- never Confirmed. This seeds it only when no active workflow targets
-- "crm-bookings", so an existing one (e.g. on dev) is left exactly as it is.
--
--   Level 1 "Marketing Head" — role marketing_head + whoever holds it now
--   Level 2 "Director"       — role director       + whoever holds it now
--
-- admin / super_admin hold every right and may act at either level without
-- being listed (services/approvalService.js). People are looked up by role,
-- never a fixed id; everything is edited later in Approval Setup.

IF NOT EXISTS (SELECT 1 FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE '%"crm-bookings"%')
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
    (N'CRM Booking Approval (Marketing Head -> Director)', N'crm-bookings', 2, NULL, N'Active',
     N'Booking approval: Marketing Head, then Director. Admin and super admin may act at either level. Edit levels and people in Approval Setup.',
     N'migration-554', SYSDATETIME(), N'sequential', N'["crm-bookings"]', 1, N'[]', @levels);

  PRINT CONCAT('Migration 554: seeded CRM booking approval (marketing head user(s): ', ISNULL(@mh, 'none'),
               '; director user(s): ', ISNULL(@dir, 'none — add them in Approval Setup'), ').');
END
ELSE
  PRINT 'Migration 554: an active workflow already targets crm-bookings — left as it is.';
GO
