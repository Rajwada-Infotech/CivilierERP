-- Migration 413: Backfill CrmBooking.ProjectId from UnitMaster for bookings
-- where the unit's ProjectId is known but the booking's ProjectId is NULL.
--
-- Root cause: bookings created before UnitMaster.ProjectId was populated
-- (or created through a code path that didn't stamp ProjectId from the unit)
-- end up with ProjectId = NULL even though the unit clearly belongs to a project.
-- This breaks every workflow query that joins CrmOccupancyCertificate,
-- CrmNoc, etc. on b.ProjectId, because NULL = anything is always FALSE in SQL.
--
-- Safe to re-run: the WHERE clause only touches rows still NULL.

UPDATE dbo.CrmBooking
SET ProjectId = u.ProjectId,
    UpdatedAt = SYSDATETIME()
FROM dbo.CrmBooking b
JOIN dbo.UnitMaster u ON u.Id = b.UnitId
WHERE b.ProjectId IS NULL
  AND u.ProjectId IS NOT NULL;

DECLARE @fixed INT = @@ROWCOUNT;
PRINT CAST(@fixed AS NVARCHAR) + ' booking(s) backfilled with ProjectId from UnitMaster.';
GO
