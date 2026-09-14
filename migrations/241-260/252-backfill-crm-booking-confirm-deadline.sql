-- Migration 251 added CrmBooking.ConfirmDeadline as NULL for every existing
-- row (correct at the time — new column, no way to know a real deadline for
-- history). But the crm-booking-confirm-expiry SLA sweep and the Unit/
-- Parking Matrix's countdown display both key off it, and both explicitly
-- treat NULL as "not covered" (the sweep's WHERE requires
-- ConfirmDeadline IS NOT NULL) rather than "already overdue" — so any
-- pre-existing, still-unconfirmed Booking silently sits outside the new
-- auto-expiry mechanism forever, with no visible countdown, until someone
-- notices.
--
-- Backfilled to "3 days from whenever this migration runs", NOT derived
-- from the Booking's original BookingDate/CreatedAt — a date-derived
-- deadline for old bookings would already be in the past for most of them,
-- and the very next hourly sweep run would then mass-expire every
-- legitimate in-flight Pending booking in the system the moment this ships.
-- A fresh grace window is the safe choice; Approved bookings are excluded
-- entirely since ConfirmDeadline plays no role once a Booking is already
-- Approved+Paid (the Matrix's Booked check doesn't reference it).
UPDATE dbo.CrmBooking
SET ConfirmDeadline = DATEADD(DAY, 3, SYSDATETIME())
WHERE IsActive = 1
  AND Status NOT IN ('Approved', 'Cancelled', 'Rejected', 'Expired')
  AND ConfirmDeadline IS NULL;
GO
