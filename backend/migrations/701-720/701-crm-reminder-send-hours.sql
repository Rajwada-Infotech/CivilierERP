-- 701-crm-reminder-send-hours.sql
-- Reminder Setup, second pass (2026-11-26):
--  * Send hours per rule (SendFromTime / SendUntilTime, India time). A reminder falls due at midnight; without hours the
--    hourly run would text customers at 00:xx. Outside the hours the run waits; NULL = any time. From later than Until
--    = overnight hours (e.g. 22:00 to 06:00).
--  * Attempts on each log row, for "Send again" on a failed reminder from the setup page.
-- Starting data: rules that already have a customer SMS / WhatsApp / e-mail channel get 10:00 to 19:00 (editable on the
-- page). Staff-only rules keep any time. Idempotent.

IF COL_LENGTH('dbo.CrmReminderRule', 'SendFromTime') IS NULL
  ALTER TABLE dbo.CrmReminderRule ADD SendFromTime TIME(0) NULL, SendUntilTime TIME(0) NULL;
GO

IF COL_LENGTH('dbo.CrmReminderLog', 'Attempts') IS NULL
  ALTER TABLE dbo.CrmReminderLog ADD Attempts INT NOT NULL CONSTRAINT DF_CrmReminderLog_Attempts DEFAULT 1;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CrmReminderRule WHERE SendFromTime IS NOT NULL OR SendUntilTime IS NOT NULL)
  UPDATE r SET SendFromTime = '10:00', SendUntilTime = '19:00'
  FROM dbo.CrmReminderRule r
  WHERE EXISTS (SELECT 1 FROM dbo.CrmReminderChannel c
                WHERE c.RuleId = r.Id AND c.Audience = N'Customer' AND c.Channel IN (N'SMS', N'WhatsApp', N'Email'));
GO
