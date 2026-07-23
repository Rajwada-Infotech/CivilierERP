-- The Unit Master now decides a unit's default Payment Plan up front (at
-- Project/Unit setup time), instead of staff re-picking one every time a
-- unit gets applied for. Application wizard auto-fetches this the moment a
-- unit is selected (locked by default, unlockable if the deal genuinely
-- needs a different plan) and CrmApplication.PaymentPlanId — which already
-- flows through to the auto-created Booking at approval time
-- (crmApplications.js PUT /:id/approve) — carries it forward from there.
-- No hard FK, matching this schema's existing convention for cross-master
-- references (PaymentPlanId on CrmApplication/CrmBooking has none either).
ALTER TABLE dbo.UnitMaster ADD DefaultPaymentPlanId INT NULL;
