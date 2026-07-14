-- ============================================================
-- Migration 186: Welcome Call — Payment Plan confirmation
-- The telecaller now confirms the assigned payment plan with the customer
-- during the call — this records that it happened and when, distinct from
-- Outcome (which tracks whether the call itself connected).
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCall') AND name = 'PaymentPlanConfirmed')
BEGIN
  ALTER TABLE dbo.CrmWelcomeCall ADD PaymentPlanConfirmed BIT NOT NULL CONSTRAINT DF_CrmWelcomeCall_PlanConfirmed DEFAULT 0;
  ALTER TABLE dbo.CrmWelcomeCall ADD PaymentPlanConfirmedAt DATETIME2(3) NULL;
  PRINT 'Added CrmWelcomeCall.PaymentPlanConfirmed / PaymentPlanConfirmedAt';
END
GO
