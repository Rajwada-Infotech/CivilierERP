// Single source of truth for "can this be deleted?" across the whole
// Project -> Block -> Floor -> Unit/Parking hierarchy. Previously
// blockMaster.js/unitMaster.js/parkingSlotMaster.js each carried their own
// copy of this logic (booked/held checks only); this module centralizes
// them AND adds two rules that were missing everywhere:
//   1. A Unit is also locked while a live (non-Cancelled/Rejected)
//      CrmApplication.PreferredUnitId points at it — "applied", not just
//      booked/held.
//   2. A parent (Block/Project) refuses deletion while it has ANY active
//      child at all, not just a booked one — a plain, never-booked Unit
//      still has to be deleted first, one level at a time.
// Booking/Hold definitions are kept byte-identical to what unitMatrix.js
// treats as "Booked"/"OnHold" (IsActive=1 AND Status NOT IN
// ('Cancelled','Rejected') for a Booking; Status='Active' AND
// HoldUntil>=SYSDATETIME() for a Hold) — every function below reuses that
// exact shape so nothing here can drift from what the matrix displays.
const { sql } = require("../db");

// A Unit is locked (cannot be edited/deleted) if it has:
//  - a live booking, or
//  - an active, unexpired hold, or
//  - a live Application (Draft/Submitted/Approved — anything not
//    Cancelled/Rejected) whose PreferredUnitId points at it.
async function getUnitLockReason(pool, unitId) {
  const result = await pool.request().input("Id", sql.Int, unitId).query(`
    SELECT TOP 1
      bk.BookingNo, h.Id AS HoldId, app.ApplicationNo
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.CrmBooking bk
      ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
    LEFT JOIN dbo.CrmInventoryHold h
      ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
    LEFT JOIN dbo.CrmApplication app
      ON app.PreferredUnitId = u.Id AND app.IsActive = 1 AND app.Status NOT IN ('Cancelled', 'Rejected')
    WHERE u.Id = @Id AND (bk.Id IS NOT NULL OR h.Id IS NOT NULL OR app.Id IS NOT NULL)
  `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (row.BookingNo) return `has an active booking (${row.BookingNo})`;
  if (row.HoldId) return "is currently on hold";
  return `has a live Application (${row.ApplicationNo}) pointing at it`;
}

// A Parking Slot is locked if it has an active allotment (booked, whether
// tied to a real CrmBooking or standing alone against just an Application)
// or an active hold. Parking Slots have no children of their own, and
// Applications don't reference a Parking Slot directly (only a Unit via
// PreferredUnitId), so there's no separate "applied" check here.
async function getParkingSlotLockReason(pool, id) {
  const result = await pool.request().input("Id", sql.Int, id).query(`
    SELECT TOP 1
      pa.Id AS AllotmentId, bk.BookingNo, h.Id AS HoldId
    FROM dbo.ParkingSlot s
    LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
    LEFT JOIN dbo.CrmBooking bk ON bk.Id = pa.BookingId
    LEFT JOIN dbo.CrmInventoryHold h
      ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
    WHERE s.Id = @Id AND (pa.Id IS NOT NULL OR h.Id IS NOT NULL)
  `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (row.AllotmentId) return row.BookingNo ? `has an active booking (${row.BookingNo})` : "is currently allotted";
  return "is currently on hold";
}

// A Floor's only children are Units matched by (BlockId, FloorNo) value —
// there's no real FK (see CrmProjectAutoSetupFloor), so this is a plain
// existence count rather than a join. Refuses on ANY active unit, booked or
// not — the child has to be deleted first, one level at a time.
async function getFloorLockReason(pool, blockId, floorNo) {
  const result = await pool.request().input("bid", sql.Int, blockId).input("fno", sql.Int, floorNo).query(`
    SELECT COUNT(*) AS c FROM dbo.UnitMaster WHERE BlockId = @bid AND FloorNo = @fno AND IsActive = 1
  `);
  const c = result.recordset[0].c;
  return c > 0 ? `has ${c} active unit(s) on it` : null;
}

// A Block refuses deletion while it has ANY active Unit or Parking Slot at
// all. This fully subsumes the old booked/held-only check: a booked/held/
// applied Unit can't itself be deleted (see getUnitLockReason), so it stays
// active, so this count is never zero while one exists underneath —
// no need to separately re-check booking status here.
async function getBlockLockReason(pool, blockId) {
  const units = await pool.request().input("bid", sql.Int, blockId)
    .query("SELECT COUNT(*) AS c FROM dbo.UnitMaster WHERE BlockId = @bid AND IsActive = 1");
  if (units.recordset[0].c > 0) return `has ${units.recordset[0].c} active unit(s) under it`;

  const parking = await pool.request().input("bid", sql.Int, blockId)
    .query("SELECT COUNT(*) AS c FROM dbo.ParkingSlot WHERE BlockId = @bid AND IsActive = 1");
  if (parking.recordset[0].c > 0) return `has ${parking.recordset[0].c} active parking slot(s) under it`;

  return null;
}

// A Project refuses deletion while it has ANY active Block, Unit, or
// Parking Slot — same "any child at all" rule as Block, one level up. Also
// runs a defensive direct check for a live Booking/Application still
// carrying this ProjectId even if (through some pre-existing data
// inconsistency) the Unit/Parking row it points at was already deactivated
// — belt-and-suspenders at the highest, least-reversible level.
async function getProjectLockReason(pool, projectId) {
  const blocks = await pool.request().input("pid", sql.Int, projectId)
    .query("SELECT COUNT(*) AS c FROM dbo.BlockMaster WHERE ProjectId = @pid AND IsActive = 1");
  if (blocks.recordset[0].c > 0) return `has ${blocks.recordset[0].c} active Block(s) under it`;

  const units = await pool.request().input("pid", sql.Int, projectId)
    .query("SELECT COUNT(*) AS c FROM dbo.UnitMaster WHERE ProjectId = @pid AND IsActive = 1");
  if (units.recordset[0].c > 0) return `has ${units.recordset[0].c} active Unit(s) under it`;

  const parking = await pool.request().input("pid", sql.Int, projectId)
    .query("SELECT COUNT(*) AS c FROM dbo.ParkingSlot WHERE ProjectId = @pid AND IsActive = 1");
  if (parking.recordset[0].c > 0) return `has ${parking.recordset[0].c} active Parking Slot(s) under it`;

  const direct = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT TOP 1 bk.BookingNo, app.ApplicationNo
    FROM dbo.enterprise e
    LEFT JOIN dbo.CrmBooking bk ON bk.ProjectId = e.id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
    LEFT JOIN dbo.CrmApplication app ON app.ProjectId = e.id AND app.IsActive = 1 AND app.Status NOT IN ('Cancelled', 'Rejected')
    WHERE e.id = @pid AND (bk.Id IS NOT NULL OR app.Id IS NOT NULL)
  `);
  if (direct.recordset.length) {
    const row = direct.recordset[0];
    return row.BookingNo ? `has an active booking (${row.BookingNo})` : `has a live Application (${row.ApplicationNo})`;
  }

  return null;
}

// ── Hard-delete blockers ────────────────────────────────────────────────────
// The getXLockReason functions above only ever check "active" business state
// (booked/held/applied) — that's the right rule for the platform's normal
// soft-delete (IsActive=0). A real hard DELETE is a different, stricter
// question: dbo.BlockMaster/UnitMaster are targets of REAL SQL Server FK
// constraints (confirmed via sys.foreign_keys — despite scattered comments
// elsewhere in this codebase claiming "no DB-level FK constraints", several
// do exist), so SQL Server itself will refuse the DELETE if ANY row in a
// child table still references it — active OR inactive/soft-deleted. These
// functions check that broader condition up front so the caller gets one
// clear, specific reason instead of a raw SQL FK-violation error message.
const BLOCK_HARD_DELETE_REFS = [
  { table: "UnitMaster", column: "BlockId", label: "Unit(s)" },
  { table: "ParkingSlot", column: "BlockId", label: "Parking Slot(s)" },
  { table: "RoomMaster", column: "BlockId", label: "Room(s)" },
  { table: "ParkingMaster", column: "BlockId", label: "Parking rate row(s)" },
  { table: "DailyLabourEntry", column: "BlockId", label: "Daily Labour entry/entries" },
];

async function getBlockHardDeleteBlockers(pool, blockId) {
  for (const ref of BLOCK_HARD_DELETE_REFS) {
    const r = await pool.request().input("id", sql.Int, blockId)
      .query(`SELECT COUNT(*) AS c FROM dbo.${ref.table} WHERE ${ref.column} = @id`);
    if (r.recordset[0].c > 0) {
      return `still has ${r.recordset[0].c} ${ref.label} referencing it (including any already-deactivated ones) — those must be permanently removed first, not just deactivated`;
    }
  }
  return null;
}

const UNIT_HARD_DELETE_REFS = [
  { table: "CrmApplication", column: "PreferredUnitId", label: "Application(s)" },
  { table: "CrmBooking", column: "UnitId", label: "Booking(s)" },
  { table: "CrmUnitChangeLog", column: "OldUnitId", label: "Unit change log entry/entries" },
  { table: "CrmUnitChangeLog", column: "NewUnitId", label: "Unit change log entry/entries" },
  { table: "DailyLabourEntry", column: "UnitId", label: "Daily Labour entry/entries" },
  { table: "FollowupApplications", column: "UnitId", label: "Follow-Up Application(s)" },
  { table: "RoomMaster", column: "UnitId", label: "Room(s)" },
];

async function getUnitHardDeleteBlockers(pool, unitId) {
  for (const ref of UNIT_HARD_DELETE_REFS) {
    const r = await pool.request().input("id", sql.Int, unitId)
      .query(`SELECT COUNT(*) AS c FROM dbo.${ref.table} WHERE ${ref.column} = @id`);
    if (r.recordset[0].c > 0) {
      return `still has ${r.recordset[0].c} ${ref.label} referencing it (including historical/cancelled ones) — those must be resolved first`;
    }
  }
  return null;
}

const PARKING_SLOT_HARD_DELETE_REFS = [
  { table: "CrmParkingAllotment", column: "ParkingSlotId", label: "Allotment(s)" },
];

async function getParkingSlotHardDeleteBlockers(pool, slotId) {
  for (const ref of PARKING_SLOT_HARD_DELETE_REFS) {
    const r = await pool.request().input("id", sql.Int, slotId)
      .query(`SELECT COUNT(*) AS c FROM dbo.${ref.table} WHERE ${ref.column} = @id`);
    if (r.recordset[0].c > 0) {
      return `still has ${r.recordset[0].c} ${ref.label} referencing it (including historical/inactive ones) — those must be resolved first`;
    }
  }
  return null;
}

module.exports = {
  getUnitLockReason,
  getParkingSlotLockReason,
  getFloorLockReason,
  getBlockLockReason,
  getProjectLockReason,
  getBlockHardDeleteBlockers,
  getUnitHardDeleteBlockers,
  getParkingSlotHardDeleteBlockers,
};
