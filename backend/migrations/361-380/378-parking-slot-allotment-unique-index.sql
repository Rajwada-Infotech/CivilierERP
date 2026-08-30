-- ============================================================
-- Migration 378: Schema backstop for parking-slot double-allotment race
--
-- Bug: assertSlotAvailable() was a plain SELECT on the bare pool with no
-- transaction and no locking hint — two concurrent POST /standalone (or
-- booking-linked) requests for the same slot could both pass the check
-- before either INSERT committed, resulting in one physical slot being
-- sold twice.
--
-- Application-level fix: applyAddParking() and POST /standalone now wrap
-- the availability re-check + INSERT inside a pool.transaction() with
-- WITH (UPDLOCK, ROWLOCK) — mirroring the identical fix already applied
-- to Unit bookings in services/crmEntityCreation.js.
--
-- This migration adds a hard DB-level backstop: a filtered unique index
-- on CrmParkingAllotment(ParkingSlotId) WHERE IsActive = 1 so that even
-- if the application-level lock were somehow bypassed (direct DB writes,
-- a future code path, or a migration/seed script), the engine itself
-- rejects the second INSERT with a constraint violation rather than
-- silently double-selling the slot.
--
-- Mirrors the pattern already used for holds:
--   CrmInventoryHold: UNIQUE INDEX UQ_CrmInventoryHold_ActiveEntity
--   ON (EntityType, EntityId) WHERE Status = 'Active'  (migration 173)
-- ============================================================

-- Diagnostic: surface any existing duplicates (safe read-only check).
-- If this returns rows, investigate before proceeding — each group
-- represents a slot that was double-sold and must be manually resolved.
SELECT
  ParkingSlotId,
  COUNT(*) AS ActiveCount,
  STRING_AGG(CAST(Id AS NVARCHAR(20)), ', ') AS AllotmentIds
FROM dbo.CrmParkingAllotment
WHERE IsActive = 1
  AND ParkingSlotId IS NOT NULL
GROUP BY ParkingSlotId
HAVING COUNT(*) > 1;
GO

-- Filtered on IsActive = 1 so soft-deleted rows for recycled slots
-- (IsActive = 0) do not collide with legitimately re-sold ones.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_CrmParkingAllotment_ActiveSlot'
    AND object_id = OBJECT_ID('dbo.CrmParkingAllotment')
)
BEGIN
  CREATE UNIQUE INDEX UQ_CrmParkingAllotment_ActiveSlot
    ON dbo.CrmParkingAllotment (ParkingSlotId)
    WHERE IsActive = 1 AND ParkingSlotId IS NOT NULL;
  PRINT 'Migration 378: Created UQ_CrmParkingAllotment_ActiveSlot';
END
ELSE
BEGIN
  PRINT 'Migration 378: UQ_CrmParkingAllotment_ActiveSlot already exists -- skipped';
END
GO

PRINT 'Migration 378 complete -- parking slot double-allotment backstop index added';
