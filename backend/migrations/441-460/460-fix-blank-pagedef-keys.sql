-- Migration 460: Fix two PageDefinitions rows with a NULL PageKey/Label.
--
-- Migrations 330 and 333 each inserted a literal PageKey/Label in their
-- INSERT ... SELECT, but the rows that actually landed in the table
-- (PageDefId 244 and 247) have both columns NULL. Root cause unclear (both
-- migrations' literal SELECT values were correct), but the effect is
-- concrete: GET /api/page-definitions returns these two rows with no `key`
-- and no `label`, so their Menu Rights checkbox renders with page=undefined
-- and can never be granted or matched back to a saved permission.
--
-- Fixed in place by PageDefId (confirmed via the migration source + no
-- existing row already holds either PageKey) rather than a fresh INSERT, so
-- any existing RoleRights/UserPageRightsJson rows already pointing at these
-- PageDefIds stay attached to the same row.
UPDATE dbo.PageDefinitions
SET PageKey = 'task-performance-report',
    Label = 'Task Performance Report'
WHERE PageDefId = 244 AND (PageKey IS NULL OR PageKey = '');
GO

UPDATE dbo.PageDefinitions
SET PageKey = 'entry-type-doc-followup-report',
    Label = 'Entry Type & Document Follow-Up Report'
WHERE PageDefId = 247 AND (PageKey IS NULL OR PageKey = '');
GO
