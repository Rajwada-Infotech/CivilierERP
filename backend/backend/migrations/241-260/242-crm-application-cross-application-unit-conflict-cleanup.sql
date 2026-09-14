-- 242-crm-application-cross-application-unit-conflict-cleanup.sql
--
-- Context: an audit query found live (non-Cancelled/Rejected/Draft-dead-end)
-- CrmApplication rows whose PreferredUnitId points at a unit that already
-- has a genuinely live Booking (Approved/Pending, IsActive=1) belonging to
-- a DIFFERENT application — e.g. APP-2026-00010, APP-2026-00011,
-- APP-2026-00034, all pointing at a unit already booked under a different
-- Application since before any of the three were created.
--
-- assertEntityNotTaken()/placeHold() in crmHoldService.js, and the
-- pre-insert check in createCrmApplicationRecord (crmEntityCreation.js),
-- are written to prevent exactly this — but these three rows exist despite
-- that, each with a completely normal single CrmApplicationStatusLog entry
-- ("Application created"), which rules out these being seeded/bypass data.
-- The most likely explanation is these were created before that guard code
-- was actually live on the deployed server (manual EC2 deploy, not CI/CD —
-- a rebuild/restart gap between writing the fix and it going live would
-- produce exactly this). This migration does NOT attempt to fix the code
-- path itself (already verified correct in the current source) — it only
-- cleans up the resulting bad data, since re-deploying old code is a
-- deployment question, not a data one.
--
-- Action taken: clears PreferredUnitId/InterestedUnit/InterestedProject-
-- linked unit fields on affected rows (does NOT touch Application Status —
-- an Approved application just loses its invalid unit pick and needs a
-- human to reassign a real, free unit before it can be booked; a Pending
-- application simply continues through normal approval once given a valid
-- unit). A Note is appended explaining why, and the change is logged to
-- CrmApplicationStatusLog for the same audit trail every other automated
-- correction in this codebase uses.
--
-- Idempotent: the WHERE clause only matches rows still exhibiting the
-- conflict; already-cleared rows (PreferredUnitId IS NULL) won't match
-- again on re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplication')
   OR NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBooking')
BEGIN
  PRINT 'Migration 242 skipped: CrmApplication/CrmBooking table(s) not found.';
END
ELSE
BEGIN
  DECLARE @Cleared TABLE (ApplicationId INT, ApplicationNo NVARCHAR(30), OldUnitId INT, ConflictingBookingNo NVARCHAR(30));

  INSERT INTO @Cleared (ApplicationId, ApplicationNo, OldUnitId, ConflictingBookingNo)
  SELECT a.Id, a.ApplicationNo, a.PreferredUnitId, ob.BookingNo
  FROM dbo.CrmApplication a
  JOIN dbo.CrmBooking ob
    ON ob.UnitId = a.PreferredUnitId
   AND ob.IsActive = 1
   AND ob.Status NOT IN ('Cancelled', 'Rejected')
   AND ob.ApplicationId <> a.Id
  WHERE a.PreferredUnitId IS NOT NULL
    AND a.Status NOT IN ('Cancelled', 'Rejected'); -- dead-end applications left untouched; they need no correction

  UPDATE a
  SET a.PreferredUnitId = NULL,
      a.InterestedUnit = NULL,
      a.Notes = CONCAT(
        ISNULL(a.Notes + CHAR(13) + CHAR(10), ''),
        '[Migration 242] Preferred unit cleared — it was already booked (', c.ConflictingBookingNo,
        ') under a different application at the time this pick was made. Assign a valid unit before proceeding.'
      ),
      a.UpdatedAt = SYSDATETIME()
  FROM dbo.CrmApplication a
  JOIN @Cleared c ON c.ApplicationId = a.Id;

  DECLARE @ClearedCount INT = (SELECT COUNT(*) FROM @Cleared);
  PRINT CONCAT('Migration 242: cleared invalid PreferredUnitId on ', @ClearedCount, ' Application row(s).');

  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplicationStatusLog')
  BEGIN
    INSERT INTO dbo.CrmApplicationStatusLog
      (ApplicationId, FromStatus, ToStatus, TriggerSource, Remarks, ActorId, CreatedAt)
    SELECT
      c.ApplicationId, a.Status, a.Status, 'DataFix-Migration242',
      CONCAT('PreferredUnitId ', c.OldUnitId, ' cleared — unit was already booked under a different application (',
             c.ConflictingBookingNo, '). See migration 242.'),
      NULL, SYSDATETIME()
    FROM @Cleared c
    JOIN dbo.CrmApplication a ON a.Id = c.ApplicationId;
  END

  -- Report exactly which rows were touched, for a manual follow-up (each
  -- of these Applicants needs a staff member to pick and confirm a real,
  -- available unit for them).
  SELECT * FROM @Cleared;
END