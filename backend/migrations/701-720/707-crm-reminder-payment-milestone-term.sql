-- 707-crm-reminder-payment-milestone-term.sql
-- The CRM's term is "payment milestone", never "instalment" (decided 2026-11-26). Renames what migrations 700 / 702
-- wrote, only where it is still the original text (a name changed on the page is left alone). The internal key
-- instalmentDue is not shown anywhere and stays. Idempotent.
IF OBJECT_ID('dbo.CrmReminderSituation', 'U') IS NOT NULL
BEGIN
  UPDATE dbo.CrmReminderSituation SET Label = N'Payment milestone due or overdue', UpdatedAt = SYSDATETIME()
  WHERE Situation = N'instalmentDue' AND Label = N'Instalment due or overdue';
  UPDATE dbo.CrmReminderSituation SET Description = N'Any customer payment milestone with money still to pay. It stops once the payment is covered or being verified.', UpdatedAt = SYSDATETIME()
  WHERE Situation = N'instalmentDue' AND Description = N'Any customer instalment with money still to pay. It stops once the payment is covered or being verified.';
  UPDATE dbo.CrmReminderSituation SET Description = N'The booking''s first payment milestone is still to pay. It stops once the payment is covered or being verified.', UpdatedAt = SYSDATETIME()
  WHERE Situation = N'bookingPayment' AND Description = N'The booking''s first sale instalment is still to pay. It stops once the payment is covered or being verified.';
END
GO

UPDATE dbo.CrmReminderRule SET Name = N'Payment milestone overdue'
WHERE Name = N'Instalment overdue' AND Situation = N'instalmentDue';
GO
