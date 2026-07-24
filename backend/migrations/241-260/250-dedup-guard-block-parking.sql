-- Deep duplicate audit across Unit/Block/Project/Parking/Customer masters.
-- Findings: UnitMaster, CrmCustomer (Mobile) and the Project/Company name
-- space already have real unique constraints. BlockMaster, ParkingSlot and
-- ParkingMaster only had an application-level 409 guard (routes/*.js) with
-- no DB-level backstop — exactly the gap that let one real duplicate
-- through (ParkingMaster Id 2, an accidental double-submit of the same
-- Basement parking rate for Project 3 / Block 2, created 29s after Id 1).
-- Remove that duplicate first so the new unique index can be created. Hard
-- delete (not soft-deactivate) — the unique index below is unfiltered, same
-- as UnitMaster's own, so an inactive duplicate would still collide on the
-- same (ProjectId, BlockId, ParkingType) key. Id 2 is confirmed orphaned
-- (zero CrmParkingAllotment rows reference it; the one real allotment for
-- this Project/Block/Type points at Id 1, which is kept).
DELETE FROM dbo.ParkingMaster WHERE Id = 2;

-- Same shape as UnitMaster's own UX_UnitMaster_Project_Block_UnitName —
-- unfiltered (covers soft-deleted rows too), matching the "reactivate the
-- old row instead of inserting a new one" pattern each route already uses.
CREATE UNIQUE INDEX UX_BlockMaster_Project_BlockName
  ON dbo.BlockMaster (ProjectId, BlockName);

CREATE UNIQUE INDEX UX_ParkingSlot_Project_Block_SlotNo
  ON dbo.ParkingSlot (ProjectId, BlockId, SlotNo);

CREATE UNIQUE INDEX UX_ParkingMaster_Project_Block_ParkingType
  ON dbo.ParkingMaster (ProjectId, BlockId, ParkingType);
