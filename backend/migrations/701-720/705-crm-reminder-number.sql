-- 705-crm-reminder-number.sql
-- Reminder Setup, the booking reminder as asked (2026-11-26): 7 days after the booking the reminders start, then go
-- out every day while the booking payment is pending, each counted — Reminder 1, 2, 3 … — to the Director role, the
-- chosen users and the customer's app and portal.
--  1. {ReminderNo} (the reminder's number) becomes a field every situation's wording may use.
--  2. The starting booking-payment rule from migration 700, only while it is still exactly as seeded (same start, offset,
--     repeat and notes): repeat every day instead of every 7 days, and the staff message starts with its number.
--  3. Never reviewed yet (no preview, i.e. a fresh database): its SMS and WhatsApp start off — the customer gets it in the
--     app and the portal; SMS / WhatsApp are switched on from the page once their provider is set up.
-- Rows changed by hand are left alone. Idempotent.

IF OBJECT_ID('dbo.CrmReminderSituation', 'U') IS NOT NULL
  UPDATE dbo.CrmReminderSituation
  SET FieldsJson = JSON_MODIFY(FieldsJson, 'append $', N'ReminderNo'), UpdatedAt = SYSDATETIME()
  WHERE ISJSON(FieldsJson) = 1 AND NOT EXISTS (SELECT 1 FROM OPENJSON(FieldsJson) WHERE value = N'ReminderNo');
GO

DECLARE @seed INT = (SELECT TOP 1 Id FROM dbo.CrmReminderRule
  WHERE Situation = N'bookingPayment' AND StartFrom = N'BookingDate' AND OffsetDays = 7 AND RepeatEveryDays = 7 AND MaxTimes IS NULL
    AND Notes = N'Starting rule (migration 700): review the recipients, channels and wording, then switch it on.'
  ORDER BY Id);
IF @seed IS NOT NULL
BEGIN
  UPDATE dbo.CrmReminderRule
  SET RepeatEveryDays = 1,
      Notes = N'Starting rule (migrations 700, 705): from 7 days after the booking, every day while the booking payment is pending. Review the recipients, channels and wording, then switch it on.'
  WHERE Id = @seed;

  UPDATE dbo.CrmReminderChannel
  SET Body = N'Reminder {ReminderNo}: ' + Body
  WHERE RuleId = @seed AND Audience = N'Staff' AND Channel = N'Bell'
    AND Body = N'{CustomerName} · {BookingNo} — booking payment {Amount} not received {DaysSinceStart} days after booking.';

  UPDATE c SET IsActive = 0
  FROM dbo.CrmReminderChannel c JOIN dbo.CrmReminderRule r ON r.Id = c.RuleId
  WHERE c.RuleId = @seed AND c.Audience = N'Customer' AND c.Channel IN (N'SMS', N'WhatsApp') AND r.LastPreviewedAt IS NULL;

  PRINT 'Migration 705: the starting booking-payment reminder now repeats daily and carries its number.';
END
GO
