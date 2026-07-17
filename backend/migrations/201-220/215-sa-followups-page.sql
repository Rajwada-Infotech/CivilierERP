-- Migration 192: Follow-Up page definition (Sales Automation)
-- New workflow stage between Inquiry and Site Visits: leads due for their
-- next follow-up touch (reminders via SaLeadActivity.NextFollowupDate),
-- interest-level marking, and the hand-off into scheduling a site visit.
-- Mirrors sa-lead-activities' PageDefinitions row exactly — no RoleRights
-- seeded here either, matching that same precedent: marketing_head gets
-- access via requirePageRight.js's "sa-" prefix bypass, and sales_team_lead/
-- sales_person were likewise never granted sa-lead-activities rights.
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('sa-followups', 'Follow-Up', 'Sales Automation', 'Sales Automation Leads', 'view,create,edit', 496, 1, 'migration-192')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, GETDATE());
GO

PRINT '192-sa-followups-page: done';
