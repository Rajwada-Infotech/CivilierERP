-- 580-sa-lead-cancelled-booking-to-pool.sql
-- When a CRM booking is cancelled or deleted, its SA lead now goes back into
-- the CRM Leads pool (Status 'Converted') and is unlinked from the booking —
-- see returnLeadToPool in backend/services/saHandoff.js. This applies the
-- same rule to bookings that were already cancelled or deleted before that.
--
-- Covers leads still linked to a booking that is inactive (deleted) or in a
-- dead status (DEAD_BOOKING_STATUSES in backend/constants/crmStatuses.js).
-- Leads whose booking link was already cleared by an earlier delete can't be
-- told apart from a manual 'Booking' and are left alone.
-- Run after 579 (which renamed 'Booked' to 'Booking').
-- Idempotent: once unlinked, a lead no longer matches.

UPDATE l
SET Status = CASE WHEN l.Status IN (N'Booking', N'Booked') THEN N'Converted' ELSE l.Status END,
    CrmBookingId = NULL,
    UpdatedAt = SYSDATETIME()
FROM dbo.SaLead l
JOIN dbo.CrmBooking b ON b.Id = l.CrmBookingId
WHERE b.IsActive = 0
   OR b.Status IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred');
