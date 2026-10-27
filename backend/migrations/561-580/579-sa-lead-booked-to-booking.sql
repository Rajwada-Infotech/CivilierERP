-- 579-sa-lead-booked-to-booking.sql
-- CRM used to write CrmStatus.BOOKED ('Booked') onto dbo.SaLead.Status when
-- an application became a booking (crmApplications.js). SA's own terminal
-- status is 'Booking' (backend/constants/saStatuses.js), so those leads fell
-- off the Pipeline board, the dashboard workflow strip and STATUS_TRANSITIONS.
-- The code now writes SA_LEAD_BOOKED; this moves existing rows across.
-- Only the Status value changes — CrmBookingId and every other column stay.
-- Idempotent: once no 'Booked' rows remain, the UPDATE touches nothing.

UPDATE dbo.SaLead
SET Status = N'Booking', UpdatedAt = SYSDATETIME()
WHERE Status = N'Booked';
