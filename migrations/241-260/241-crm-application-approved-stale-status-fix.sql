-- 241-crm-application-approved-stale-status-fix.sql
--
-- Context: crmApplications.js's Stage CASE was just changed so 'Converted'
-- requires a LIVE booking (bk.Status NOT IN ('Cancelled','Rejected')), not
-- merely a booking having existed at some point. That change is only safe
-- against re-booking the same unit twice because syncApplicationOnBookingTerminal
-- (crmApplicationWorkflow.js, called from crmCancellations.js /:id/approve)
-- force-advances CrmApplication.Status the moment its Booking dies — so a
-- dead-booking Application also drops out of the forBooking dropdown, since
-- that dropdown requires Status = 'Approved'.
--
-- That sync cascade did not always exist. Any Application whose Booking was
-- cancelled/rejected BEFORE it was wired in can still be sitting at
-- Status = 'Approved' with a dead Booking underneath. Left alone, the new
-- Stage logic would make exactly those rows fall out of 'Converted' AND
-- re-qualify for forBooking — i.e. the same unit could be booked twice.
--
-- This migration finds and corrects that stale state, and writes the same
-- audit trail entry the live sync path would have written, so the fix is
-- traceable in CrmApplicationStatusLog rather than a silent UPDATE.
--
-- Idempotent: only touches rows still in the stale state (Status='Approved'
-- with an active Cancelled/Rejected booking). Safe to re-run; a second run
-- affects zero rows once the first has applied.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplication')
   OR NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBooking')
BEGIN
  PRINT 'Migration 241 skipped: CrmApplication/CrmBooking table(s) not found.';
END
ELSE
BEGIN
  DECLARE @Fixed TABLE (ApplicationId INT, FromStatus NVARCHAR(30), ToStatus NVARCHAR(30));

  UPDATE a
  SET a.Status = bk.Status,
      a.UpdatedAt = SYSDATETIME()
  OUTPUT inserted.Id, deleted.Status, inserted.Status INTO @Fixed(ApplicationId, FromStatus, ToStatus)
  FROM dbo.CrmApplication a
  JOIN dbo.CrmBooking bk
    ON bk.ApplicationId = a.Id
   AND bk.IsActive = 1
  WHERE a.Status = 'Approved'
    AND bk.Status IN ('Cancelled', 'Rejected');

  DECLARE @FixedCount INT = (SELECT COUNT(*) FROM @Fixed);
  PRINT CONCAT('Migration 241: corrected ', @FixedCount, ' stale Application status row(s).');

  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplicationStatusLog')
  BEGIN
    INSERT INTO dbo.CrmApplicationStatusLog
      (ApplicationId, FromStatus, ToStatus, TriggerSource, Remarks, ActorId, CreatedAt)
    SELECT
      ApplicationId, FromStatus, ToStatus, 'DataFix-Migration241',
      'One-time backfill: Application was stale at Approved with a dead (Cancelled/Rejected) Booking underneath, from before syncApplicationOnBookingTerminal existed. Corrected to match the booking status. See migration 241.',
      NULL, SYSDATETIME()
    FROM @Fixed;
  END
END