-- ============================================================
-- Migration 165: Backfill existing Welcome Calls into Communication Log
-- crmWelcomeCalls.js now auto-seeds every newly logged call into
-- CrmCommunicationLog, but that only applies going forward. Any welcome
-- call logged before this feature existed never got a matching
-- Communication Log entry, so it looked like nothing had ever been
-- communicated for that booking. Backfill once, skipping any booking that
-- somehow already has a 'Welcome Call%' entry.
-- ============================================================

INSERT INTO dbo.CrmCommunicationLog
  (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
SELECT
  b.ApplicationId,
  wc.BookingId,
  'Call',
  'Outbound',
  CONCAT('Welcome Call', CASE WHEN wc.Outcome IS NOT NULL THEN CONCAT(' — ', wc.Outcome) ELSE '' END),
  wc.Notes,
  wc.CallDate,
  wc.CreatedBy,
  wc.CreatedAt
FROM dbo.CrmWelcomeCall wc
JOIN dbo.CrmBooking b ON b.Id = wc.BookingId
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.CrmCommunicationLog cl
  WHERE cl.BookingId = wc.BookingId AND cl.Subject LIKE 'Welcome Call%'
);
GO

PRINT 'Migration 165 complete — backfilled Welcome Call entries into Communication Log';
