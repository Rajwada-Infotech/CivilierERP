const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { getBlockLockReason, getBlockHardDeleteBlockers } = require("../services/crmHierarchyLocks");
const { getApplicablePaymentPlans } = require("../services/crmEntityCreation");

// A Block can be tagged with 1+ Payment Plans (dbo.CrmBlockPaymentPlan,
// many-to-many) — the middle tier of the Project -> Block -> Unit cascade
// (see crmEntityCreation.js's getApplicablePaymentPlans). Same
// deactivate-then-MERGE pattern as unitMaster.js's own
// syncUnitPaymentPlanTags / crmPaymentPlans.js's syncPaymentPlanProjectTags.
async function syncBlockPaymentPlanTags(pool, blockId, planIds) {
  await pool.request().input("bid", sql.Int, blockId)
    .query("UPDATE dbo.CrmBlockPaymentPlan SET IsActive = 0 WHERE BlockId = @bid");
  for (const planId of planIds) {
    if (!Number.isFinite(planId)) continue;
    await pool.request()
      .input("bid", sql.Int, blockId)
      .input("pid", sql.Int, planId)
      .query(`
        MERGE dbo.CrmBlockPaymentPlan AS tgt
        USING (SELECT @bid AS BlockId, @pid AS PlanId) AS src
        ON tgt.BlockId = src.BlockId AND tgt.PlanId = src.PlanId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (BlockId, PlanId, IsActive, CreatedAt) VALUES (src.BlockId, src.PlanId, 1, SYSDATETIME());
      `);
  }
}

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
        COALESCE(unitLock.LockHoldId, parkLock.LockHoldId) AS LockHoldId,
        planTags.PlanIds AS PaymentPlanIds, planTags.PlanNames AS PaymentPlanNames
      FROM dbo.BlockMaster b
      LEFT JOIN dbo.enterprise e
        ON e.id = b.ProjectId AND e.business_type = 'P'
      OUTER APPLY (
        SELECT STRING_AGG(CAST(bpp.PlanId AS VARCHAR(20)), ',') AS PlanIds,
               STRING_AGG(pp.PlanName, ', ') AS PlanNames
        FROM dbo.CrmBlockPaymentPlan bpp
        JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = bpp.PlanId
        WHERE bpp.BlockId = b.Id AND bpp.IsActive = 1
      ) planTags
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

// GET /applicable-payment-plans?projectId= — dropdown source for the
// Block-level Payment Plan tagger: the Project's own tagged plans (falling
// back further up the cascade — ultimately "all active plans" — only if the
// Project itself has nothing tagged, same rule the whole hierarchy uses).
router.get("/applicable-payment-plans", async (req, res) => {
  try {
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
    const pool = getPool();
    const plans = await getApplicablePaymentPlans(pool, { projectId });
    res.json(plans);
  } catch (err) {
    console.error("[block-master] GET /applicable-payment-plans error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add block
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { ProjectId, BlockName, IsActive, PaymentPlanIds } = req.body;
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Every tagged Payment Plan must actually be applicable to this Block's
    // Project (the whole point of the cascade — a Block can't offer a plan
    // its own Project never offered it). Same defensive shape
    // resolveApplicationPaymentPlan already uses to reject an out-of-scope
    // pick at the Unit level.
    let validPlanIds = [];
    if (Array.isArray(PaymentPlanIds) && PaymentPlanIds.length) {
      const requested = PaymentPlanIds.map((x) => parseInt(x, 10)).filter(Number.isFinite);
      const applicable = await getApplicablePaymentPlans(pool, { projectId: parseInt(ProjectId, 10) });
      const applicableIds = new Set(applicable.map((p) => p.Id));
      const invalid = requested.filter((id) => !applicableIds.has(id));
      if (invalid.length) {
        return res.status(400).json({ error: "One or more selected Payment Plans are not applicable to this Block's Project." });
      }
      validPlanIds = requested;
    }

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
      if (Array.isArray(PaymentPlanIds)) await syncBlockPaymentPlanTags(pool, existing.Id, validPlanIds);
      await bumpCacheVersion("block-master");
      return res.json({ message: "Block reactivated successfully" });
    }

    const inserted = await pool
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockName", sql.NVarChar(100), BlockName)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockName, @IsActive, @CreatedBy, @CreatedAt)
      `);
    if (validPlanIds.length) await syncBlockPaymentPlanTags(pool, inserted.recordset[0].Id, validPlanIds);
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
  const { ProjectId, BlockName, IsActive, PaymentPlanIds } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // Same defensive check as POST — every tagged plan must be applicable
    // to this Block's (possibly just-changed) Project.
    let validPlanIds = null;
    if (Array.isArray(PaymentPlanIds)) {
      const requested = PaymentPlanIds.map((x) => parseInt(x, 10)).filter(Number.isFinite);
      const applicable = await getApplicablePaymentPlans(pool, { projectId: parseInt(ProjectId, 10) });
      const applicableIds = new Set(applicable.map((p) => p.Id));
      const invalid = requested.filter((pid) => !applicableIds.has(pid));
      if (invalid.length) {
        return res.status(400).json({ error: "One or more selected Payment Plans are not applicable to this Block's Project." });
      }
      validPlanIds = requested;
    }

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

    // Tag sync deliberately runs AFTER the main UPDATE below, not before —
    // matching this file's own POST handler (insert/reactivate both write
    // the core row first, tags second) and unitMaster.js's PUT. The
    // duplicate check above is only a pre-check; the UPDATE itself can
    // still fail on a race the pre-check missed (see the UNIQUE backstop in
    // the catch block). Syncing tags first would leave them committed even
    // if that happens, while the client sees an error and assumes nothing
    // was saved.
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

    if (validPlanIds) await syncBlockPaymentPlanTags(pool, parseInt(id), validPlanIds);

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

// ── Unit Type Specs ────────────────────────────────────────────────────────────
// BlockUnitTypeSpec is the authoritative source for area breakdown per unit type
// per block. All units of the same type in a block share the same RERA-registered
// Carpet/Built-up/SBU areas — defining it once here avoids repeating it across
// every individual unit row in Unit Master.

// GET /api/block-master/:id/unit-type-specs
// Returns { unitTypes, specs }:
//   unitTypes — distinct unit types that actually exist in this block
//               (from Auto Setup template OR from real UnitMaster rows)
//   specs     — current BlockUnitTypeSpec rows for this block
// The frontend merges these: for every known unit type, show its spec values
// (empty if not yet set). Unit types are real data — never free-typed by staff.
router.get("/:id/unit-type-specs", async (req, res) => {
  const blockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(blockId)) return res.status(400).json({ error: "Invalid block id" });
  try {
    const pool = getPool();

    // Distinct unit types from the Auto Setup template + actual generated units
    const typesResult = await pool.request()
      .input("bid", sql.Int, blockId)
      .query(`
        SELECT DISTINCT UnitType FROM (
          SELECT UnitType FROM dbo.CrmProjectAutoSetupUnitTemplate
          WHERE BlockId = @bid AND IsActive = 1 AND UnitType IS NOT NULL
          UNION
          SELECT UnitType FROM dbo.UnitMaster
          WHERE BlockId = @bid AND IsActive = 1 AND UnitType IS NOT NULL
        ) t
        ORDER BY UnitType
      `);

    const specsResult = await pool.request()
      .input("bid", sql.Int, blockId)
      .query(`
        SELECT Id, BlockId, UnitType,
               CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt,
               OpenTerraceAreaSqFt, BaseRatePerSqFt
        FROM dbo.BlockUnitTypeSpec
        WHERE BlockId = @bid
        ORDER BY UnitType
      `);

    res.json({
      unitTypes: typesResult.recordset.map((r) => r.UnitType),
      specs: specsResult.recordset,
    });
  } catch (err) {
    console.error("[block-master] GET unit-type-specs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/block-master/:id/unit-type-specs — full replace for this block
// Receives an array of {UnitType, CarpetAreaSqFt, BuiltUpAreaSqFt,
// SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt}.
router.put("/:id/unit-type-specs", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const blockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(blockId)) return res.status(400).json({ error: "Invalid block id" });
  const specs = req.body;
  if (!Array.isArray(specs)) return res.status(400).json({ error: "Expected an array" });
  try {
    const pool = getPool();
    // Full replace — delete existing then re-insert, same pattern as payment plan tag sync.
    await pool.request().input("blockId", sql.Int, blockId)
      .query("DELETE FROM dbo.BlockUnitTypeSpec WHERE BlockId = @blockId");
    for (const s of specs) {
      if (!s.UnitType?.trim()) continue;
      const toDb = (v) => v != null && v !== "" ? parseFloat(v) : null;
      const carpet   = toDb(s.CarpetAreaSqFt);
      const builtUp  = toDb(s.BuiltUpAreaSqFt);
      const sbu      = toDb(s.SuperBuiltUpAreaSqFt);
      const openTerr = toDb(s.OpenTerraceAreaSqFt);
      const rate     = toDb(s.BaseRatePerSqFt);

      await pool.request()
        .input("blockId",    sql.Int, blockId)
        .input("unitType",   sql.NVarChar(50),   s.UnitType.trim())
        .input("carpet",     sql.Decimal(18, 2), carpet)
        .input("builtUp",    sql.Decimal(18, 2), builtUp)
        .input("sbu",        sql.Decimal(18, 2), sbu)
        .input("openTerr",   sql.Decimal(18, 2), openTerr)
        .input("rate",       sql.Decimal(18, 2), rate)
        .query(`
          INSERT INTO dbo.BlockUnitTypeSpec
            (BlockId, UnitType, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt,
             OpenTerraceAreaSqFt, BaseRatePerSqFt, UpdatedAt)
          VALUES
            (@blockId, @unitType, @carpet, @builtUp, @sbu, @openTerr, @rate, SYSDATETIME())
        `);

      // Cascade spec changes to every unit in this block that shares the
      // same unit type. The spec is the single source of truth — individual
      // unit rows must always reflect whatever the block-level spec says.
      // AreaSqFt is the legacy single-field kept in sync with SBU.
      await pool.request()
        .input("blockId",  sql.Int, blockId)
        .input("unitType", sql.NVarChar(50),   s.UnitType.trim())
        .input("carpet",   sql.Decimal(18, 2), carpet)
        .input("builtUp",  sql.Decimal(18, 2), builtUp)
        .input("sbu",      sql.Decimal(18, 2), sbu)
        .input("openTerr", sql.Decimal(18, 2), openTerr)
        .input("rate",     sql.Decimal(18, 2), rate)
        .query(`
          UPDATE dbo.UnitMaster SET
            CarpetAreaSqFt       = @carpet,
            BuiltUpAreaSqFt      = @builtUp,
            SuperBuiltUpAreaSqFt = @sbu,
            AreaSqFt             = COALESCE(@sbu, AreaSqFt),
            OpenTerraceAreaSqFt  = @openTerr,
            RatePerSqFt          = @rate,
            UpdatedAt            = SYSDATETIME()
          WHERE BlockId = @blockId AND UnitType = @unitType AND IsActive = 1
        `);
    }
    await bumpCacheVersion("block-master");
    await bumpCacheVersion("unit-master");
    res.json({ message: "Unit type specs saved" });
  } catch (err) {
    console.error("[block-master] PUT unit-type-specs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;