const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];

bumpCacheVersion("parking-slot-master").catch(() => {});

// Shared lock check — mirrors unitMaster.js's getUnitLockReason exactly,
// using the same join shape parkingMatrix.js uses to compute Status, so
// "locked" here can never drift from what the matrix shows. A slot is
// locked (cannot be edited or deleted) if it has:
//   - an active allotment — "Booked", whether it's tied to a CrmBooking
//     (BookingId set) or stands alone against just an Application
//     (BookingId NULL), or
//   - an active, unexpired inventory hold — "OnHold"
async function getParkingSlotLockReason(pool, id) {
  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(`
      SELECT TOP 1
        pa.Id AS AllotmentId,
        bk.BookingNo,
        h.Id AS HoldId
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

// GET all parking slots — includes per-row lock fields (same shape as
// unitMaster.js's LockBookingNo/LockHoldId) so the grid can grey out
// Edit/Delete without a second round trip, and matches the matrix's
// Blocked/Booked/OnHold/Available precedence exactly.
router.get("/", cache("parking-slot-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        s.Id, s.ProjectId, e.name AS ProjectName,
        s.BlockId, b.BlockName,
        s.SlotNo, s.ParkingType, s.IsActive,
        s.CreatedAt, s.UpdatedAt,
        pa.Id AS LockAllotmentId, bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId
      FROM dbo.ParkingSlot s
      LEFT JOIN dbo.enterprise  e ON e.id = s.ProjectId AND e.business_type = 'P'
      LEFT JOIN dbo.BlockMaster b ON b.Id = s.BlockId
      LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
      LEFT JOIN dbo.CrmBooking bk ON bk.Id = pa.BookingId
      LEFT JOIN dbo.CrmInventoryHold h
        ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      ORDER BY e.name, b.BlockName, s.SlotNo
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[parking-slot-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add a parking slot
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, BlockId, SlotNo, ParkingType, IsActive } = req.body;
  if (!SlotNo?.trim()) return res.status(400).json({ error: "SlotNo is required" });
  if (!PARKING_TYPES.includes(ParkingType)) {
    return res.status(400).json({ error: `Invalid ParkingType. Must be: ${PARKING_TYPES.join(", ")}` });
  }
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Guard against duplicate slots — same reasoning as unitMaster.js:
    // without this, deleting a slot and re-adding one with the same
    // Project+Block+SlotNo creates a second row instead of reactivating the
    // original. BlockId is optional so it's compared with ISNULL to treat
    // two NULLs as equal.
    const dupe = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId", sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("SlotNo", sql.NVarChar(50), SlotNo.trim())
      .query(`
        SELECT Id, IsActive FROM dbo.ParkingSlot
        WHERE ProjectId = @ProjectId
          AND ISNULL(BlockId, -1) = ISNULL(@BlockId, -1)
          AND SlotNo = @SlotNo
      `);

    if (dupe.recordset.length) {
      const existing = dupe.recordset[0];
      if (existing.IsActive) {
        return res.status(409).json({ error: `Parking slot "${SlotNo}" already exists in this Block.` });
      }
      await pool
        .request()
        .input("Id", sql.Int, existing.Id)
        .input("Type", sql.NVarChar(50), ParkingType)
        .input("UpdatedBy", sql.Int, createdBy)
        .query(`
          UPDATE dbo.ParkingSlot SET
            ParkingType = @Type,
            IsActive = 1,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = SYSDATETIME()
          WHERE Id = @Id
        `);
      await bumpCacheVersion("parking-slot-master");
      return res.json({ message: "Parking slot reactivated successfully" });
    }

    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("SlotNo",    sql.NVarChar(50), SlotNo.trim())
      .input("Type",      sql.NVarChar(50), ParkingType)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockId, @SlotNo, @Type, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: "Parking slot added successfully" });
  } catch (err) {
    console.error("[parking-slot-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update a parking slot
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, SlotNo, ParkingType, IsActive } = req.body;
  if (!SlotNo?.trim()) return res.status(400).json({ error: "SlotNo is required" });
  if (ParkingType && !PARKING_TYPES.includes(ParkingType)) {
    return res.status(400).json({ error: `Invalid ParkingType. Must be: ${PARKING_TYPES.join(", ")}` });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Same duplicate guard as POST — prevent editing a slot's number/block
    // into a collision with another existing row.
    const dupe = await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId", sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("SlotNo", sql.NVarChar(50), SlotNo.trim())
      .query(`
        SELECT Id FROM dbo.ParkingSlot
        WHERE ProjectId = @ProjectId
          AND ISNULL(BlockId, -1) = ISNULL(@BlockId, -1)
          AND SlotNo = @SlotNo
          AND Id <> @Id
      `);
    if (dupe.recordset.length) {
      return res.status(409).json({ error: `Parking slot "${SlotNo}" already exists in this Block.` });
    }

    // A Booked or OnHold slot can never be edited — not just deactivated —
    // same reasoning as unitMaster.js's PUT lock check.
    const lockReason = await getParkingSlotLockReason(pool, parseInt(id));
    if (lockReason) {
      return res.status(409).json({
        error: `Parking slot "${SlotNo}" ${lockReason} and cannot be edited. Cancel/release the booking or hold first.`,
      });
    }

    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, BlockId ? parseInt(BlockId) : null)
      .input("SlotNo",    sql.NVarChar(50), SlotNo.trim())
      .input("Type",      sql.NVarChar(50), ParkingType)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.ParkingSlot SET
          ProjectId = @ProjectId, BlockId = @BlockId, SlotNo = @SlotNo,
          ParkingType = @Type, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: "Parking slot updated successfully" });
  } catch (err) {
    console.error("[parking-slot-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft delete (IsActive = 0), matching the platform-wide convention
// (and unitMaster.js's fix for the same problem): there are no DB-level FK
// constraints here, so a hard DELETE would leave CrmParkingAllotment rows
// pointing at nothing. Refuses to delete a Booked or OnHold slot.
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT SlotNo FROM dbo.ParkingSlot WHERE Id = @Id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Parking slot not found" });
    const { SlotNo } = existing.recordset[0];

    const lockReason = await getParkingSlotLockReason(pool, id);
    if (lockReason) {
      return res.status(409).json({
        error: `Parking slot "${SlotNo}" ${lockReason} and cannot be deleted. Cancel/release the booking or hold first.`,
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query("UPDATE dbo.ParkingSlot SET IsActive = 0, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME() WHERE Id = @Id");
    await bumpCacheVersion("parking-slot-master");
    res.json({ message: `Parking slot "${SlotNo}" deactivated successfully` });
  } catch (err) {
    console.error("[parking-slot-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;