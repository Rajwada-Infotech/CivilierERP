-- CrmPaymentMilestone rows auto-generated for an Extra Charge or a Parking
-- Allotment were only ever linked back to their source by matching
-- MilestoneName + AmountDue string/decimal equality (see crmExtraCharges.js
-- DELETE and crmParking.js DELETE) — a heuristic that silently breaks the
-- moment either value drifts (e.g. after recalculateRemainingMilestones
-- redistributes amounts, or two charges share the same description). Real
-- FK columns replace that guesswork and also make an Edit route possible
-- (find the linked milestone deterministically instead of re-guessing).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'ExtraChargeId')
  ALTER TABLE dbo.CrmPaymentMilestone ADD ExtraChargeId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'ParkingAllotmentId')
  ALTER TABLE dbo.CrmPaymentMilestone ADD ParkingAllotmentId INT NULL;
GO
