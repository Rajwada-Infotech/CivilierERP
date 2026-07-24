-- One-time backfill for CrmApplication rows left stuck at Status='Approved'
-- because their linked Booking became Cancelled/Rejected/Expired BEFORE the
-- cascade existed (syncApplicationOnBookingTerminal, now wired into
-- crmCancellations.js's cancellation-approval flow, crmBookings.js's
-- reject route, and crmSlaEngine.js's crm-booking-confirm-expiry sweep).
-- Mirrors the exact same status mapping the live cascade uses going
-- forward: Booking Cancelled/Rejected -> Application Cancelled; Booking
-- Expired -> Application Expired. Never deletes anything — same "no hard
-- delete, named status" rule as every other terminal transition in this
-- module.
--
-- Idempotent: the WHERE a.Status = 'Approved' guard means a row no longer
-- matches once corrected, so re-running this file after the first
-- application is a no-op.
--
-- Log first (while a.Status is still readable as 'Approved' for the
-- FromStatus column), then apply the actual UPDATE — same two-step order,
-- same audit trail (CrmApplicationStatusLog) every runtime cascade writes.
INSERT INTO dbo.CrmApplicationStatusLog (ApplicationId, FromStatus, ToStatus, TriggerSource, Remarks, ActorId, CreatedAt)
SELECT a.Id, a.Status, CASE WHEN b.Status = 'Expired' THEN 'Expired' ELSE 'Cancelled' END,
       'BackfillBookingTerminalCascade',
       'One-time backfill — application status corrected to match its already-dead booking (' + b.BookingNo + ', ' + b.Status + ')',
       NULL, SYSDATETIME()
FROM dbo.CrmApplication a
JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id AND b.IsActive = 1
WHERE a.IsActive = 1 AND a.Status = 'Approved'
  AND b.Status IN ('Cancelled', 'Rejected', 'Expired');
GO

UPDATE a
SET a.Status = CASE WHEN b.Status = 'Expired' THEN 'Expired' ELSE 'Cancelled' END,
    a.UpdatedAt = SYSDATETIME()
FROM dbo.CrmApplication a
JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id AND b.IsActive = 1
WHERE a.IsActive = 1 AND a.Status = 'Approved'
  AND b.Status IN ('Cancelled', 'Rejected', 'Expired');
GO
