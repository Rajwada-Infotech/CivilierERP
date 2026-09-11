-- ============================================================
-- Migration 419: Schema backstop for generate-units / generate-parking-slots
--               concurrent double-submit race
--
-- Bug: POST /generate-units and POST /generate-parking-slots in
-- crmProjectAutoSetup.js both use a plain SELECT-then-INSERT per row on
-- the bare pool, with no transaction and no locking hint around the
-- check-then-act. Two concurrent requests (two browser tabs, two staff
-- members) for the same project can both pass the dupe-check SELECT for
-- the same unit / slot before either INSERT commits, producing duplicate
-- catalog rows keyed against the same physical flat or parking bay.
--
-- Application-level fix (crmProjectAutoSetup.js, this commit):
--   Each per-unit / per-slot check+INSERT is now wrapped in a
--   pool.transaction() with WITH (UPDLOCK, ROWLOCK) on the SELECT --
--   mirroring the identical fix already applied to:
--     Unit double-bookings in services/crmEntityCreation.js
--     Parking slot double-allotments in routes/crmParking.js
--
-- This migration adds the hard DB-level backstop: filtered unique indexes
-- on both tables so that even if the application-level lock is bypassed
-- (direct DB write, future code path, seed script), the engine rejects
-- the second INSERT with a constraint violation rather than silently
-- creating a duplicate catalog entry.
--
-- Mirrors:
--   Migration 378 -- UQ_CrmParkingAllotment_ActiveSlot
--   Migration 173 -- UQ_CrmInventoryHold_ActiveEntity
-- ============================================================


-- Part 1: UnitMaster unique active name

-- Pre-flight: surface any existing active duplicates.
-- If this returns rows, investigate and resolve before re-running.
-- Each group = a block with two active UnitMaster rows of the same UnitName.
-- The index cannot be created until these are cleaned up.
PRINT 'Migration 419 pre-flight: checking UnitMaster for existing active duplicates...';
SELECT
  ProjectId,
  BlockId,
  UnitName,
  COUNT(*) AS ActiveCount,
  STRING_AGG(CAST(Id AS NVARCHAR(20)), ', ') AS UnitIds
FROM dbo.UnitMaster
WHERE IsActive = 1
GROUP BY ProjectId, BlockId, UnitName
HAVING COUNT(*) > 1;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_UnitMaster_ActiveName'
    AND object_id = OBJECT_ID('dbo.UnitMaster')
)
BEGIN
  CREATE UNIQUE INDEX UQ_UnitMaster_ActiveName
    ON dbo.UnitMaster (ProjectId, BlockId, UnitName)
    WHERE IsActive = 1;
  PRINT 'Migration 419: Created UQ_UnitMaster_ActiveName';
END
ELSE
BEGIN
  PRINT 'Migration 419: UQ_UnitMaster_ActiveName already exists -- skipped';
END
GO


-- Part 2: ParkingSlot unique active slot number

PRINT 'Migration 419 pre-flight: checking ParkingSlot for existing active duplicates...';
SELECT
  ProjectId,
  BlockId,
  SlotNo,
  COUNT(*) AS ActiveCount,
  STRING_AGG(CAST(Id AS NVARCHAR(20)), ', ') AS SlotIds
FROM dbo.ParkingSlot
WHERE IsActive = 1
  AND BlockId IS NOT NULL
GROUP BY ProjectId, BlockId, SlotNo
HAVING COUNT(*) > 1;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_ParkingSlot_ActiveSlotNo'
    AND object_id = OBJECT_ID('dbo.ParkingSlot')
)
BEGIN
  -- BlockId IS NOT NULL: orphan slots (no block) are excluded from the
  -- uniqueness constraint -- they predate block enforcement and we don't
  -- want this migration to fail on them.
  CREATE UNIQUE INDEX UQ_ParkingSlot_ActiveSlotNo
    ON dbo.ParkingSlot (ProjectId, BlockId, SlotNo)
    WHERE IsActive = 1 AND BlockId IS NOT NULL;
  PRINT 'Migration 419: Created UQ_ParkingSlot_ActiveSlotNo';
END
ELSE
BEGIN
  PRINT 'Migration 419: UQ_ParkingSlot_ActiveSlotNo already exists -- skipped';
END
GO

PRINT 'Migration 419 complete -- UnitMaster and ParkingSlot active-name uniqueness backstops added';
