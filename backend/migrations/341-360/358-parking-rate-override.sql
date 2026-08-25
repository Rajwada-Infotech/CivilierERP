-- Migration 358: allow a per-sale parking rate override
--
-- Parking price was hard-locked to dbo.ParkingMaster.Charge everywhere it's
-- sold (Application wizard's hold, Booking Detail's Add Parking, and the
-- standalone Parking Booking page) — staff had no way to type a different
-- amount for a genuine one-off negotiated price. RateOverride is optional;
-- when set it's used instead of ParkingMaster.Charge, and still flows into
-- CrmParkingAllotment.RateSnapshot exactly like the master rate always did.
--
-- Stored on CrmInventoryHold too (not just CrmParkingAllotment, which already
-- has RateSnapshot) because the Application-stage pick is only a hold until
-- the Booking is created (see crmParking.js POST /standalone) — the override
-- has to survive that hold -> real-allotment conversion in
-- crmEntityCreation.js, which re-fetches the rate fresh otherwise.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmInventoryHold') AND name = 'RateOverride'
)
  ALTER TABLE dbo.CrmInventoryHold ADD RateOverride DECIMAL(18,2) NULL;
GO

PRINT 'Migration 358 complete — RateOverride on CrmInventoryHold';
