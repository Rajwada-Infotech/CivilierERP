-- 706-crm-reminder-staff-link.sql
-- A staff reminder's bell / push points at the booking (every reminder is about one), so a tap opens its payments:
-- RefType crm_payment = /crm/payments?bookingId=… on the web, the booking screen in the Civilier CRM app. The old
-- payment_milestone reference opened nothing on the web. Only rows still on the old value change. Idempotent.
IF OBJECT_ID('dbo.CrmReminderSituation', 'U') IS NOT NULL
  UPDATE dbo.CrmReminderSituation SET RefType = N'crm_payment', UpdatedAt = SYSDATETIME()
  WHERE RefType = N'payment_milestone';
GO
