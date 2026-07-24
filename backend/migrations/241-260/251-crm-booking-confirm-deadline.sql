-- ConfirmDeadline snapshots the original Unit-hold HoldUntil at the moment a
-- CrmBooking is created (see crmEntityCreation.js's createCrmBookingRecord).
-- The raw CrmInventoryHold row itself gets flipped to Status='Converted' the
-- instant the Booking exists (guardAndConvertHold), which would otherwise
-- destroy the only record of "how much longer does this customer have to
-- pay and get approved before the unit goes back to Available" — this
-- column is that surviving deadline, read by unitMatrix.js/parkingMatrix.js
-- to keep showing a live countdown on a still-Pending/unpaid Booking, and by
-- the crm-booking-confirm-expiry SLA sweep to auto-expire it if the window
-- passes with the Booking still unconfirmed.
ALTER TABLE dbo.CrmBooking ADD ConfirmDeadline DATETIME2(3) NULL;
GO
