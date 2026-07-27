const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { logAudit } = require("../utils/auditLog");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");

bumpCacheVersion("unit-master").catch(() => {});

// Shared lock check — mirrors the exact Booked/OnHold definitions used by
// unitMatrix.js, so "locked" here always matches what the matrix displays.
// A unit is locked (cannot be edited or deleted) if it has:
//   - a live, non-cancelled/non-rejected booking ("Booked" / "Bought"), or
//   - an active, unexpired inventory hold ("OnHold")
// Returns a short reason string if locked, or null if the unit is free to
// edit/delete.
async function getUnitLockReason(pool, id) {
  const result = await pool
    .request()
    .input("Id", sql.Int, id)
    .query(`
      SELECT TOP 1
        bk.BookingNo,
        h.Id AS HoldId
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.CrmBooking bk
        ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
      LEFT JOIN dbo.CrmInventoryHold h
        ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      WHERE u.Id = @Id AND (bk.Id IS NOT NULL OR h.Id IS NOT NULL)
    `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (row.BookingNo) return `has an active booking (${row.BookingNo})`;
  return "is currently on hold";
}

// A unit can be tagged with multiple Payment Plans (dbo.CrmUnitPaymentPlan,
// many-to-many) — plans themselves are created independently in Payment Plan
// Master; this just decides which of them apply to this specific unit, for
// the Application wizard's Payment Plan dropdown to offer. Existing tags are
// deactivated and the new set (re-)activated in one pass — same
// deactivate-then-upsert pattern the old CrmPaymentPlanProject scope table
// used, so a removed tag doesn't leave a dangling active row behind.
async function syncUnitPaymentPlanTags(pool, unitId, planIds) {
  await pool.request().input("uid", sql.Int, unitId)
    .query("UPDATE dbo.CrmUnitPaymentPlan SET IsActive = 0 WHERE UnitId = @uid");
  for (const planId of planIds) {
    if (!Number.isFinite(planId)) continue;
    await pool.request()
      .input("uid", sql.Int, unitId)
      .input("pid", sql.Int, planId)
      .query(`
        MERGE dbo.CrmUnitPaymentPlan AS tgt
        USING (SELECT @uid AS UnitId, @pid AS PlanId) AS src
        ON tgt.UnitId = src.UnitId AND tgt.PlanId = src.PlanId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (UnitId, PlanId, IsActive, CreatedAt) VALUES (src.UnitId, src.PlanId, 1, SYSDATETIME());
      `);
  }
}

// GET all units — ?isActive=1 filters out soft-deleted units (used by unit
// pickers like CrmBooking's; the Unit Master admin grid itself omits this
// param so it can still see/reactivate deactivated units).
router.get("/", cache("unit-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const where = req.query.isActive != null ? "WHERE u.IsActive = 1" : "";
    const result = await req0.query(`
      SELECT
        u.Id,
        u.ProjectId,
        ep.name   AS ProjectName,
        u.BlockId,
        b.BlockName,
        u.UnitName,
        u.FloorNo,
        u.UnitType,
        u.AreaSqFt,
        u.IsActive,
        u.CreatedAt,
        u.UpdatedAt,
        tags.PlanIds AS PaymentPlanIds,
        tags.PlanNames AS PaymentPlanNames,
        bk.BookingNo AS LockBookingNo,
        h.Id AS LockHoldId
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise  ep ON ep.id = u.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster  b ON b.Id  = u.BlockId
      OUTER APPLY (
        SELECT STRING_AGG(CAST(upp.PlanId AS VARCHAR(20)), ',') AS PlanIds,
               STRING_AGG(pp.PlanName, ', ') AS PlanNames
        FROM dbo.CrmUnitPaymentPlan upp
        JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = upp.PlanId
        WHERE upp.UnitId = u.Id AND upp.IsActive = 1
      ) tags
      LEFT JOIN dbo.CrmBooking bk
        ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected')
      LEFT JOIN dbo.CrmInventoryHold h
        ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      ${where}
      ORDER BY ep.name, b.BlockName, u.UnitName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET projects dropdown (enterprise where business_type = P)
router.get("/projects", cache("unit-master-projects", 600), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id AS Id, name AS Name, company_id AS CompanyId
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND ISNULL(discontinue, 0) = 0
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET /projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET blocks dropdown — filtered by projectId query param
router.get("/blocks", async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  try {
    const pool = getPool();
    const request = pool.request();
    let query = `
      SELECT Id, BlockName AS Name, ProjectId
      FROM dbo.BlockMaster
      WHERE IsActive = 1
    `;
    if (Number.isFinite(projectId) && projectId > 0) {
      request.input("ProjectId", sql.Int, projectId);
      query += ` AND ProjectId = @ProjectId`;
    }
    query += ` ORDER BY BlockName`;
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[unit-master] GET /blocks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add unit
router.post("/", requirePageRight("followup-unit-master", "create"), async (req, res) => {
  const { ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive, PaymentPlanIds } = req.body;
  const planIds = Array.isArray(PaymentPlanIds) ? PaymentPlanIds.map((x) => parseInt(x)).filter(Number.isFinite) : [];
  const createdBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  try {
    const pool = getPool();

    // Guard against duplicate units. Without this, deleting (soft-deleting)
    // a unit and later re-adding one with the same Project+Block+UnitName
    // creates a second row instead of reactivating the original — leaving
    // one active row and one dangling inactive duplicate, both with the
    // same name (this is how the current duplicates got created).
    const dupe = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId", sql.Int, parseInt(BlockId))
      .input("UnitName", sql.NVarChar(100), UnitName)
      .query(`
        SELECT Id, IsActive FROM dbo.UnitMaster
        WHERE ProjectId = @ProjectId AND BlockId = @BlockId AND UnitName = @UnitName
      `);

    if (dupe.recordset.length) {
      const existing = dupe.recordset[0];
      if (existing.IsActive) {
        return res.status(409).json({ error: `Unit "${UnitName}" already exists in this Block.` });
      }
      // A soft-deleted unit with this exact name already exists — reactivate
      // and update it instead of inserting a duplicate row.
      await pool
        .request()
        .input("Id", sql.Int, existing.Id)
        .input("FloorNo", sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
        .input("UnitType", sql.NVarChar(50), UnitType || null)
        .input("Area", sql.Decimal(18, 2), AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null)
        .input("UpdatedBy", sql.Int, createdBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.UnitMaster SET
            FloorNo = @FloorNo,
            UnitType = @UnitType,
            AreaSqFt = @Area,
            IsActive = 1,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = @UpdatedAt
          WHERE Id = @Id
        `);
      await syncUnitPaymentPlanTags(pool, existing.Id, planIds);
      await bumpCacheVersion("unit-master");
      logAudit({ module: "UnitMaster", recordId: existing.Id, recordNo: UnitName, action: "Reactivated", changedBy: userName });
      return res.json({ message: "Unit reactivated successfully" });
    }

    const result = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("Area",      sql.Decimal(18,2), AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockId, @UnitName, @FloorNo, @UnitType, @Area, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await syncUnitPaymentPlanTags(pool, result.recordset[0].Id, planIds);
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: result.recordset[0].Id, recordNo: UnitName, action: "Created", changedBy: userName });
    res.json({ message: "Unit added successfully" });
  } catch (err) {
    console.error("[unit-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update unit
router.put("/:id", requirePageRight("followup-unit-master", "edit"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, UnitName, FloorNo, UnitType, AreaSqFt, IsActive, PaymentPlanIds } = req.body;
  const planIds = Array.isArray(PaymentPlanIds) ? PaymentPlanIds.map((x) => parseInt(x)).filter(Number.isFinite) : [];
  const updatedBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  try {
    const pool = getPool();

    // Same duplicate guard as POST — prevent editing a unit's name/block
    // into a collision with another existing row.
    const dupe = await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId", sql.Int, parseInt(BlockId))
      .input("UnitName", sql.NVarChar(100), UnitName)
      .query(`
        SELECT Id FROM dbo.UnitMaster
        WHERE ProjectId = @ProjectId AND BlockId = @BlockId AND UnitName = @UnitName AND Id <> @Id
      `);
    if (dupe.recordset.length) {
      return res.status(409).json({ error: `Unit "${UnitName}" already exists in this Block.` });
    }

    // A Booked or OnHold unit can never be edited — not just deactivated.
    // Locking down every field, not only IsActive, since letting staff
    // silently change a sold unit's block/name/area/etc. underneath a live
    // booking is exactly the kind of drift that caused the A1-1001 mess.
    const lockReason = await getUnitLockReason(pool, parseInt(id));
    if (lockReason) {
      return res.status(409).json({
        error: `Unit "${UnitName}" ${lockReason} and cannot be edited. Cancel/release the booking or hold first.`,
      });
    }

    await pool
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("Area",      sql.Decimal(18,2), AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.UnitMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitName  = @UnitName,
          FloorNo   = @FloorNo,
          UnitType  = @UnitType,
          AreaSqFt  = @Area,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await syncUnitPaymentPlanTags(pool, parseInt(id), planIds);
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: parseInt(id), recordNo: UnitName, action: "Updated", changedBy: userName });
    res.json({ message: "Unit updated successfully" });
  } catch (err) {
    console.error("[unit-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft delete (IsActive = 0), matching the platform-wide convention
// used everywhere else. Previously this was a hard DELETE, the one place in
// the module that didn't follow that pattern: since there are no DB-level FK
// constraints in this system, a unit referenced by CrmBooking.UnitId (or any
// other table's UnitId column) would silently become a dangling reference —
// a NULL/broken join surfacing later — rather than a clean, reversible
// deactivation. Bookings themselves are unaffected either way since
// CrmBooking snapshots UnitNo/BlockName/UnitType/AreaSqFt onto its own row
// at creation time rather than re-joining UnitMaster live.
//
// Refuses to delete/deactivate a Booked or OnHold unit (see getUnitLockReason
// above) — deactivating a booked unit makes it read as "Blocked" instead of
// "Booked" in the unit matrix, which is what happened to A1-1001 and is the
// most likely reason it got recreated as a duplicate row rather than the
// underlying problem being noticed and fixed.
router.delete("/:id", requirePageRight("followup-unit-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  const userName = req.user?.name || req.user?.email || null;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Unit not found" });
    const { UnitName } = existing.recordset[0];

    const lockReason = await getUnitLockReason(pool, id);
    if (lockReason) {
      return res.status(409).json({
        error: `Unit "${UnitName}" ${lockReason} and cannot be deleted. Cancel/release the booking or hold first.`,
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date())
      .query("UPDATE dbo.UnitMaster SET IsActive = 0, UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt WHERE Id = @Id");
    await bumpCacheVersion("unit-master");
    logAudit({ module: "UnitMaster", recordId: id, recordNo: UnitName, action: "Deleted", changedBy: userName });
    res.json({ message: `Unit "${UnitName}" deactivated successfully` });
  } catch (err) {
    console.error("[unit-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;