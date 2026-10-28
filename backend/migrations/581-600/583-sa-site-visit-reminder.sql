-- 583-sa-site-visit-reminder.sql
-- The day-before site-visit reminder (services/saSiteVisitReminders.js) records
-- which visit date it reminded the customer about, so each visit is reminded
-- once — and again if the visit is moved to a new date.
-- Idempotent: guarded.

IF COL_LENGTH('dbo.SaSiteVisit', 'ReminderSentFor') IS NULL
  ALTER TABLE dbo.SaSiteVisit ADD ReminderSentFor DATE NULL;
GO
