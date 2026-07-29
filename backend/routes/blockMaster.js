const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { getBlockLockReason, getBlockHardDeleteBlockers } = require("../services/crmHierarchyLocks");

bumpCacheVersion("block-master").catch(() => {});

// Shared lock check — moved to services/crmHierarchyLocks.js so Block
// Master, Unit Master, the Auto Project Setup page, and Project-level
// deletion all agree on the exact same rule: a Block refuses deletion while
// it has ANY active Unit or Parking Slot under it, not just a booked/held
// one (a plain, never-booked Unit has to be deleted first too). Editing a
// Block is still allowed even when locked (ProjectId/BlockName changes are
// live-joined everywhere via BlockId, so they apply project-wide
// immediately) — only DELETE is gated.

// GET all blocks — includes per-row lock fields (same OUTER APPLY shape as
// unitMaster.js's LockBookingNo/LockHoldId columns) so the grid can grey out
// the Delete button without a second round trip.
router.get("/", cache("block-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id,
        b.ProjectId,
        e.name  AS ProjectName,
        b.BlockName,
        b.IsActive,
        b.CreatedAt,
        b.UpdatedAt,
        COALESCE(unitLock.LockBookingNo, parkLock.LockBookingNo) AS LockBookingNo,
        COALESCE(unitLock.LockHoldId, parkLock.LockHoldId) AS LockHoldId
      FROM dbo.BlockMaster b
      LEFT JOIN dbo.enterprise e
        ON e.id = b.ProjectId AND e.business_type = 'P'
      OUTER APPLY (
        SELECT TOP 1 bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId
        FROM dbo.UnitMaster u
        LEFT JOIN dbo.CrmBooking bk
          ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
        LEFT JOIN dbo.CrmInventoryHold h
          ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
        WHERE u.BlockId = b.Id AND (bk.Id IS NOT NULL OR h.Id IS NOT NULL)
      ) unitLock
      OUTER APPLY (
        SELECT TOP 1 bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId
        FROM dbo.ParkingSlot s
        LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
        LEFT JOIN dbo.CrmBooking bk ON bk.Id = pa.BookingId
        LEFT JOIN dbo.CrmInventoryHold h
          ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
        WHERE s.BlockId = b.Id AND (pa.Id IS NOT NULL OR h.Id IS NOT NULL)
      ) parkLock
      ORDER BY e.name, b.BlockName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[block-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects for dropdown (enterprise where business_type = P)
router.get(
  "/projects",
  cache("block-master-projects", 600),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT id AS Id, name AS Name
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[block-master] GET /projects error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST — add block
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, BlockName, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Guard against duplicate blocks — same reasoning as unitMaster.js:
    // without this, deleting a block and re-adding one with the same
    // Project+BlockName creates a second row instead of reactivating the
    // original, which is exactly how the duplicate A1 rows in the grid
    // happened.
    const dupe = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .query(`
        SELECT Id, IsActive FROM dbo.BlockMaster
        WHERE ProjectId = @ProjectId AND BlockName = @BlockName
      `);

    if (dupe.recordset.length) {
      const existing = dupe.recordset[0];
      if (existing.IsActive) {
        return res.status(409).json({ error: `Block "${BlockName}" already exists in this Project.` });
      }
      await pool
        .request()
        .input("Id", sql.Int, existing.Id)
        .input("UpdatedBy", sql.Int, createdBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.BlockMaster SET
            IsActive = 1,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = @UpdatedAt
          WHERE Id = @Id
        `);
      await bumpCacheVersion("block-master");
      return res.json({ message: "Block reactivated successfully" });
    }

    await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedBy, CreatedAt)
        VALUES (@ProjectId, @BlockName, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("block-master");
    res.json({ message: "Block added successfully" });
  } catch (err) {
    // Backstop for the race-condition case the pre-check above can't catch
    // (two concurrent requests both passing it before either commits) —
    // UX_BlockMaster_Project_BlockName is the actual guarantee.
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: `Block "${BlockName}" already exists in this Project.` });
    }
    console.error("[block-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update block
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockName, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Same duplicate guard as POST — prevent renaming a block into a
    // collision with another existing row. Edit itself is never locked
    // (unlike delete) — it's expected to propagate project-wide since
    // every consumer live-joins on BlockId rather than snapshotting.
    const dupe = await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .query(`
        SELECT Id FROM dbo.BlockMaster
        WHERE ProjectId = @ProjectId AND BlockName = @BlockName AND Id <> @Id
      `);
    if (dupe.recordset.length) {
      return res.status(409).json({ error: `Block "${BlockName}" already exists in this Project.` });
    }

    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.BlockMaster SET
          ProjectId = @ProjectId,
          BlockName = @BlockName,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("block-master");
    res.json({ message: "Block updated successfully" });
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: `Block "${BlockName}" already exists in this Project.` });
    }
    console.error("[block-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — a real, permanent removal (not a soft IsActive=0 flag left
// sitting in the grid forever). Two checks run first, in order:
//   1. getBlockLockReason — the usual business rule: refuses while any
//      ACTIVE Unit/Parking Slot exists under it (booked, held, applied, or
//      even just plain unbooked — "clear the child first").
//   2. getBlockHardDeleteBlockers — dbo.BlockMaster is the target of real SQL
//      Server FK constraints (UnitMaster.BlockId, ParkingSlot.BlockId,
//      RoomMaster.BlockId, ParkingMaster.BlockId, DailyLabourEntry.BlockId —
//      confirmed via sys.foreign_keys), so even a fully deactivated child row
//      still physically blocks a hard DELETE. This check catches that and
//      reports it clearly instead of letting a raw SQL FK-violation surface.
// Only once BOTH come back clear does the row actually get removed.
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT BlockName FROM dbo.BlockMaster WHERE Id = @Id");

    if (!existing.recordset.length)
      return res.status(404).json({ error: "Block not found" });

    const { BlockName } = existing.recordset[0];

    const lockReason = await getBlockLockReason(pool, id);
    if (lockReason) {
      return res.status(409).json({
        error: `Block "${BlockName}" ${lockReason} and cannot be deleted. Cancel/release it first.`,
      });
    }

    const hardBlockers = await getBlockHardDeleteBlockers(pool, id);
    if (hardBlockers) {
      return res.status(409).json({
        error: `Block "${BlockName}" ${hardBlockers}.`,
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.BlockMaster WHERE Id = @Id");

    await bumpCacheVersion("block-master");
    res.json({ message: `Block "${BlockName}" deleted` });
  } catch (err) {
    console.error("[block-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;