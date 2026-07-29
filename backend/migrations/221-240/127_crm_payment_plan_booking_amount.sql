-- Migration 127: dbo.CrmPaymentPlanTemplate.BookingAmount
--
-- Booking is now a fixed ₹ amount decided at Payment-Plan-creation time
-- (CrmPaymentPlans.tsx), not typed fresh on every booking and never a % of
-- the plan. This column is what generateMilestonesForBooking
-- (crmEntityCreation.js) treats as authoritative once a booking is tagged
-- to a plan.
--
-- Adjust the migration number if 127 is already taken in your environment.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'BookingAmount'
)
BEGIN
  ALTER TABLE dbo.CrmPaymentPlanTemplate ADD BookingAmount DECIMAL(18,2) NULL;
END
GO

-- Existing plans predate this rule and have no default yet — they fall back
-- to whatever the Booking/Application form sends (see crmEntityCreation.js).
-- No backfill is attempted here since there's no reliable single ₹ figure
-- to infer per plan; staff should open each existing plan in
-- CrmPaymentPlans.tsx and set its Booking Amount once.

IF NOT EXISTS (SELECT 1 FROM dbo.__Migrations WHERE MigrationName = '127_crm_payment_plan_booking_amount')
BEGIN
  INSERT INTO dbo.__Migrations (MigrationName, AppliedAt) VALUES ('127_crm_payment_plan_booking_amount', SYSDATETIME());
END
GO