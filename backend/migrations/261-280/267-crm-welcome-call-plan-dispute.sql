-- Migration 267: Payment Plan dispute tracking on Welcome Call
-- PaymentPlanConfirmed was a plain BIT NOT NULL DEFAULT 0 — "not confirmed"
-- and "never asked" were indistinguishable. Widened to nullable so NULL
-- genuinely means "not yet asked", distinct from an explicit customer
-- disagreement (0 + a mandatory reason).

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCall') AND name = 'PaymentPlanConfirmed' AND is_nullable = 0)
BEGIN
  ALTER TABLE dbo.CrmWelcomeCall ALTER COLUMN PaymentPlanConfirmed BIT NULL;
  PRINT 'Widened CrmWelcomeCall.PaymentPlanConfirmed to nullable';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmWelcomeCall') AND name = 'PaymentPlanDisputeReason')
BEGIN
  ALTER TABLE dbo.CrmWelcomeCall ADD PaymentPlanDisputeReason NVARCHAR(500) NULL;
  PRINT 'Added CrmWelcomeCall.PaymentPlanDisputeReason';
END
GO
