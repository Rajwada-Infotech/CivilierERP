-- 708-crm-reminder-one-per-booking.sql
-- "Payment milestone due or overdue" reminds once per booking (decided 2026-11-26): the booking's payment milestones
-- already due go in one message — names, total still to pay, oldest due date — numbered from the oldest one, instead
-- of one bell per payment milestone (17 bookings had made 95 bells a day). The grouping lives in
-- services/crmReminderEngine.js; here the situation's description and its new {MilestoneCount} field. Only the
-- original description (migration 707) is replaced. Idempotent.
IF OBJECT_ID('dbo.CrmReminderSituation', 'U') IS NOT NULL
BEGIN
  UPDATE dbo.CrmReminderSituation
  SET Description = N'A booking''s payment milestones with money still to pay, in one reminder per booking: their names and total, counted from the oldest one''s due date or demand date. It stops once they are paid or the money is received.',
      UpdatedAt = SYSDATETIME()
  WHERE Situation = N'instalmentDue'
    AND Description = N'Any customer payment milestone with money still to pay. It stops once the payment is covered or being verified.';

  UPDATE dbo.CrmReminderSituation
  SET FieldsJson = JSON_MODIFY(FieldsJson, 'append $', N'MilestoneCount'), UpdatedAt = SYSDATETIME()
  WHERE Situation = N'instalmentDue' AND ISJSON(FieldsJson) = 1
    AND NOT EXISTS (SELECT 1 FROM OPENJSON(FieldsJson) WHERE value = N'MilestoneCount');
END
GO
