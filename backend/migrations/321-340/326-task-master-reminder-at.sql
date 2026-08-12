-- Migration 326: Task Master reminder date/time — lets a task carry its own
-- "pop the reminder bell at this date/time" moment, set directly on the
-- task (Add/Edit form) rather than requiring a Follow-Up note first.
--
-- GET /followup-board (backend/routes/taskMaster.js) folds this into the
-- same NextFollowUpAt value the bell/login-popup pipeline already reads
-- (src/hooks/useReminders.ts's fetchFollowUpReminders), picking whichever
-- is sooner between this and the latest open follow-up note's
-- NextReminderAt — no separate reminder type needed.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'ReminderAt'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD ReminderAt DATETIME2 NULL;
END
GO
