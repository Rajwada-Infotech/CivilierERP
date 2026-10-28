-- Migration 582: retire the CRM Setup "Pending Tasks" and "Reminders" pages.
--
-- Both pages (src/pages/admin/masters/PendingTasks.tsx, Reminders.tsx) were removed: nothing linked to them but their
-- own CRM Setup menu entries, and the data they showed lives on elsewhere —
--   * tasks (/api/tasks): Task Detail, the task context and the home dashboard;
--   * tenant reminders (/api/tenant-reminders): the DBA Reminders Manager (writes were admin-only anyway).
-- No table, route or service is dropped.
--
-- Their page keys now match no code, so they are deactivated (not deleted) the same way migration 438 retired orphaned
-- keys: Menu Rights stops listing them, and any role / user grant that names them is left as it was (inert).

UPDATE dbo.PageDefinitions
   SET IsActive = 0, UpdatedAt = SYSDATETIME()
 WHERE PageKey IN ('followup-pending-tasks', 'followup-reminders')
   AND IsActive = 1;

PRINT 'Retired page keys followup-pending-tasks, followup-reminders';
