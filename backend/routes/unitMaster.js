const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { logAudit } = require("../utils/auditLog");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { getUnitLockReason, getUnitHardDeleteBlockers } = require("../services/crmHierarchyLocks");
const { getApplicablePaymentPlans } = require("../services/crmEntityCreation");
const { resolveUnitTypeInput, LayoutValidationError, syncUnitRooms, removeUnitRoomsForDelete, removeOverridesFor, moveUnitOverrides, bumpFlatMasterCaches } = require("../services/unitLayout");

// Compact, client-facing view of a syncUnitRooms() result.
function summarizeRoomSync(r) {
  if (!r) return null;
  return {
    layout: r.layout?.label ?? null,
    added: r.created + r.reactivated,
    renamed: r.renamed,
    deactivated: r.deactivated,
    keptWithWork: r.keptWithWork,
  };
}

bumpCacheVersion("unit-master").catch(() => {});

// Shared lock check — moved to services/crmHierarchyLocks.js (also reused
// by blockMaster.js's roll-up and the Auto Project Setup page). Mirrors the
// exact Booked/OnHold definitions unitMatrix.js uses, so "locked" here
// always matches what the matrix displays, PLUS a live (non-Cancelled/
// Rejected) Application whose PreferredUnitId points at this unit —
// "applied", not just booked/held.

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
        u.LayoutTypeId,
        u.AreaSqFt,
        u.CarpetAreaSqFt,
        u.BuiltUpAreaSqFt,
        u.SuperBuiltUpAreaSqFt,
        u.OpenTerraceAreaSqFt,
        u.RatePerSqFt,
        -- BlockUnitTypeSpec: block-level area defaults. Joined so Unit Master
        -- can show inherited values vs. per-unit overrides without re-querying.
        spec.CarpetAreaSqFt       AS SpecCarpetAreaSqFt,
        spec.BuiltUpAreaSqFt      AS SpecBuiltUpAreaSqFt,
        spec.SuperBuiltUpAreaSqFt AS SpecSuperBuiltUpAreaSqFt,
        spec.OpenTerraceAreaSqFt  AS SpecOpenTerraceAreaSqFt,
        spec.BaseRatePerSqFt      AS SpecBaseRatePerSqFt,
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
        ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('Cancelled', 'Rejected', 'Expired') AND (bk.Status = 'Approved' OR bk.ConfirmDeadline IS NULL OR bk.ConfirmDeadline >= SYSDATETIME())
      LEFT JOIN dbo.CrmInventoryHold h
        ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
      LEFT JOIN dbo.BlockUnitTypeSpec spec
        ON spec.BlockId = u.BlockId AND spec.UnitType = u.UnitType
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

// GET /applicable-payment-plans?blockId=&projectId= — the bottom tier of
// the cascade (see crmEntityCreation.js's getApplicablePaymentPlans): the
// Block's own tagged plans if any, else the Project's, else every active
// plan. This is what Unit Master's own Payment Plan chip-picker now offers,
// instead of always listing every active plan regardless of hierarchy.
router.get("/applicable-payment-plans", async (req, res) => {
  try {
    const blockId = parseInt(req.query.blockId, 10);
    const projectId = parseInt(req.query.projectId, 10);
    const pool = getPool();
    const plans = await getApplicablePaymentPlans(pool, {
      blockId: Number.isFinite(blockId) ? blockId : null,
      projectId: Number.isFinite(projectId) ? projectId : null,
    });
    res.json(plans);
  } catch (err) {
    console.error("[unit-master] GET /applicable-payment-plans error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add unit
router.post("/", requirePageRight("followup-unit-master", "create"), async (req, res) => {
  const { ProjectId, BlockId, UnitName, FloorNo, LayoutTypeId, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, PaymentPlanIds } = req.body;
  const requestedPlanIds = Array.isArray(PaymentPlanIds) ? PaymentPlanIds.map((x) => parseInt(x)).filter(Number.isFinite) : [];
  const createdBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  // SuperBuiltUpAreaSqFt is the saleable area used for pricing (Rate × SBU = Total).
  // AreaSqFt is the legacy field kept in sync for backward compat — SBU wins, falls back to raw AreaSqFt.
  // If neither is provided, fall back to the BlockUnitTypeSpec for this Block+UnitType.
  if (FloorNo == null || FloorNo === "") {
    return res.status(400).json({ error: "Floor No. is required — every unit must be assigned to a floor." });
  }

  try {
    const pool = getPool();

    // Unit Type must be a Unit Composition layout type with its rooms
    // defined — that's what the unit's Room Master rows are built from.
    // Stored as both the FK (LayoutTypeId) and the layout's own Label
    // (UnitType, the display copy bookings/reports read).
    const { layoutTypeId, unitType: UnitType } = await resolveUnitTypeInput(
      pool, { LayoutTypeId, UnitType: req.body.UnitType }, { requireComposition: true },
    );

    // Fetch block-level spec for this unit type.
    // Inheritance chain: explicit value → block spec → null.
    let blockSpec = null;
    if (BlockId && UnitType) {
      const bsr = await pool.request()
        .input("bid", sql.Int, parseInt(BlockId))
        .input("ut",  sql.NVarChar(50), UnitType)
        .query("SELECT * FROM dbo.BlockUnitTypeSpec WHERE BlockId=@bid AND UnitType=@ut");
      blockSpec = bsr.recordset[0] ?? null;
    }

    const fromSpec = (val, field) => {
      if (val != null && val !== "") return parseFloat(val);
      if (blockSpec?.[field] != null) return Number(blockSpec[field]);
      return null;
    };

    const carpetArea    = fromSpec(CarpetAreaSqFt,       "CarpetAreaSqFt");
    const builtUpArea   = fromSpec(BuiltUpAreaSqFt,      "BuiltUpAreaSqFt");
    const sbuArea       = fromSpec(SuperBuiltUpAreaSqFt, "SuperBuiltUpAreaSqFt");
    const openTerrace   = fromSpec(OpenTerraceAreaSqFt,  "OpenTerraceAreaSqFt");
    const ratePerSqFt   = fromSpec(RatePerSqFt,          "BaseRatePerSqFt");
    const effectiveArea = sbuArea ?? (AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null);

    // Every tagged plan must be within this Unit's own applicable cascade
    // (Block's tags -> Project's tags -> all active) — same defensive shape
    // blockMaster.js uses one tier up.
    let planIds = [];
    if (requestedPlanIds.length) {
      const applicable = await getApplicablePaymentPlans(pool, { blockId: parseInt(BlockId, 10), projectId: parseInt(ProjectId, 10) });
      const applicableIds = new Set(applicable.map((p) => p.Id));
      const invalid = requestedPlanIds.filter((pid) => !applicableIds.has(pid));
      if (invalid.length) {
        return res.status(400).json({ error: "One or more selected Payment Plans are not applicable to this Unit." });
      }
      planIds = requestedPlanIds;
    }

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
      // and update it instead of inserting a duplicate row. The unit write
      // and its room sync are one transaction.
      const rtx = pool.transaction();
      await rtx.begin();
      let roomSync;
      try {
      await rtx
        .request()
        .input("Id", sql.Int, existing.Id)
        .input("FloorNo", sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
        .input("UnitType", sql.NVarChar(50), UnitType || null)
        .input("LayoutTypeId", sql.Int, layoutTypeId)
        .input("Area",         sql.Decimal(18, 2), effectiveArea)
        .input("CarpetArea",   sql.Decimal(18, 2), carpetArea)
        .input("BuiltUpArea",  sql.Decimal(18, 2), builtUpArea)
        .input("SuperBuiltUpArea", sql.Decimal(18, 2), sbuArea)
        .input("OpenTerraceArea",  sql.Decimal(18, 2), openTerrace)
        .input("Rate",         sql.Decimal(18, 2), ratePerSqFt)
        .input("UpdatedBy", sql.Int, createdBy)
        .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
          UPDATE dbo.UnitMaster SET
            FloorNo = @FloorNo,
            UnitType = @UnitType,
            LayoutTypeId = @LayoutTypeId,
            AreaSqFt = @Area,
            CarpetAreaSqFt = @CarpetArea,
            BuiltUpAreaSqFt = @BuiltUpArea,
            SuperBuiltUpAreaSqFt = @SuperBuiltUpArea,
            OpenTerraceAreaSqFt = @OpenTerraceArea,
            RatePerSqFt = @Rate,
            IsActive = 1,
            UpdatedBy = @UpdatedBy,
            UpdatedAt = @UpdatedAt
          WHERE Id = @Id
        `);
        // Reactivated with a (possibly different) type — same rule as a type
        // change on PUT: add the layout's rooms, retire unused ones that
        // have no work.
        roomSync = await syncUnitRooms(rtx, existing.Id, { removeUnused: true, createdBy });
        await rtx.commit();
      } catch (e) {
        try { await rtx.rollback(); } catch (_) { /* already rolled back */ }
        throw e;
      }
      await syncUnitPaymentPlanTags(pool, existing.Id, planIds);
      await bumpCacheVersion("unit-master");
      await bumpFlatMasterCaches();
      await logAudit({ module: "UnitMaster", recordId: existing.Id, recordNo: UnitName, action: "Reactivated", changedBy: req.user?.userId ?? null });
      return res.json({ message: "Unit reactivated successfully", roomSync: summarizeRoomSync(roomSync) });
    }

    // Unit insert + its rooms (from the layout) in one transaction.
    const tx = pool.transaction();
    await tx.begin();
    let result;
    let roomSync;
    try {
    result = await tx
      .request()
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("LayoutTypeId", sql.Int, layoutTypeId)
      .input("Area",      sql.Decimal(18,2), effectiveArea)
      .input("CarpetArea",      sql.Decimal(18,2), carpetArea)
      .input("BuiltUpArea",     sql.Decimal(18,2), builtUpArea)
      .input("SuperBuiltUpArea", sql.Decimal(18,2), sbuArea)
      .input("OpenTerraceArea", sql.Decimal(18,2), openTerrace)
      .input("Rate",      sql.Decimal(18,2), ratePerSqFt)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, FloorNo, UnitType, LayoutTypeId, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@ProjectId, @BlockId, @UnitName, @FloorNo, @UnitType, @LayoutTypeId, @Area, @CarpetArea, @BuiltUpArea, @SuperBuiltUpArea, @OpenTerraceArea, @Rate, @IsActive, @CreatedBy, @CreatedAt)
      `);
      roomSync = await syncUnitRooms(tx, result.recordset[0].Id, { removeUnused: false, createdBy });
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      throw e;
    }
    await syncUnitPaymentPlanTags(pool, result.recordset[0].Id, planIds);
    await bumpCacheVersion("unit-master");
    await bumpFlatMasterCaches();
    await logAudit({ module: "UnitMaster", recordId: result.recordset[0].Id, recordNo: UnitName, action: "Created", changedBy: req.user?.userId ?? null });
    res.json({ message: "Unit added successfully", roomSync: summarizeRoomSync(roomSync) });
  } catch (err) {
    if (err instanceof LayoutValidationError) return res.status(400).json({ error: err.message });
    console.error("[unit-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update unit
router.put("/:id", requirePageRight("followup-unit-master", "edit"), async (req, res) => {
  const { id } = req.params;
  const { ProjectId, BlockId, UnitName, FloorNo, LayoutTypeId, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, PaymentPlanIds } = req.body;
  const requestedPlanIds = Array.isArray(PaymentPlanIds) ? PaymentPlanIds.map((x) => parseInt(x)).filter(Number.isFinite) : [];
  const updatedBy = req.user?.userId || null;
  const userName = req.user?.name || req.user?.email || null;
  if (FloorNo == null || FloorNo === "") {
    return res.status(400).json({ error: "Floor No. is required — every unit must be assigned to a floor." });
  }
  try {
    const pool = getPool();

    const currentRes = await pool.request().input("Id", sql.Int, parseInt(id))
      .query("SELECT UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE Id = @Id");
    if (!currentRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const current = currentRes.recordset[0];

    // Same rule as POST, except the unit may keep the type it already has
    // even if that layout's rooms aren't defined yet (or, for a legacy
    // unlinked value, even if it isn't registered) — only a NEW pick has to
    // be a type with a defined layout.
    const { layoutTypeId, unitType: UnitType } = await resolveUnitTypeInput(
      pool,
      { LayoutTypeId, UnitType: req.body.UnitType },
      { requireComposition: true, keepLayoutIds: current.LayoutTypeId ? [current.LayoutTypeId] : [], keepText: current.UnitType },
    );
    const typeChanged = layoutTypeId !== (current.LayoutTypeId ?? null)
      || (layoutTypeId == null && (UnitType ?? null) !== (current.UnitType ?? null));

    // Fetch block-level spec for this unit type.
    // Inheritance chain: explicit value → block spec → null.
    let blockSpec = null;
    if (BlockId && UnitType) {
      const bsr = await pool.request()
        .input("bid", sql.Int, parseInt(BlockId))
        .input("ut",  sql.NVarChar(50), UnitType)
        .query("SELECT * FROM dbo.BlockUnitTypeSpec WHERE BlockId=@bid AND UnitType=@ut");
      blockSpec = bsr.recordset[0] ?? null;
    }
    const fromSpec = (val, field) => {
      if (val != null && val !== "") return parseFloat(val);
      if (blockSpec?.[field] != null) return Number(blockSpec[field]);
      return null;
    };
    const carpetArea  = fromSpec(CarpetAreaSqFt,       "CarpetAreaSqFt");
    const builtUpArea = fromSpec(BuiltUpAreaSqFt,      "BuiltUpAreaSqFt");
    const sbuArea     = fromSpec(SuperBuiltUpAreaSqFt, "SuperBuiltUpAreaSqFt");
    const openTerrace = fromSpec(OpenTerraceAreaSqFt,  "OpenTerraceAreaSqFt");
    const ratePerSqFt = fromSpec(RatePerSqFt,          "BaseRatePerSqFt");
    const effectiveArea = sbuArea ?? (AreaSqFt != null && AreaSqFt !== "" ? parseFloat(AreaSqFt) : null);

    let planIds = [];
    if (requestedPlanIds.length) {
      const applicable = await getApplicablePaymentPlans(pool, { blockId: parseInt(BlockId, 10), projectId: parseInt(ProjectId, 10) });
      const applicableIds = new Set(applicable.map((p) => p.Id));
      const invalid = requestedPlanIds.filter((pid) => !applicableIds.has(pid));
      if (invalid.length) {
        return res.status(400).json({ error: "One or more selected Payment Plans are not applicable to this Unit." });
      }
      planIds = requestedPlanIds;
    }

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

    // Unit update + keeping its rooms in step with it, in one transaction.
    const tx = pool.transaction();
    await tx.begin();
    let roomSync = null;
    try {
    await tx
      .request()
      .input("Id",        sql.Int, parseInt(id))
      .input("ProjectId", sql.Int, parseInt(ProjectId))
      .input("BlockId",   sql.Int, parseInt(BlockId))
      .input("UnitName",  sql.NVarChar(100), UnitName)
      .input("FloorNo",   sql.Int, FloorNo != null && FloorNo !== "" ? parseInt(FloorNo) : null)
      .input("UnitType",  sql.NVarChar(50), UnitType || null)
      .input("LayoutTypeId", sql.Int, layoutTypeId)
      .input("Area",      sql.Decimal(18,2), effectiveArea)
      .input("CarpetArea",      sql.Decimal(18,2), carpetArea)
      .input("BuiltUpArea",     sql.Decimal(18,2), builtUpArea)
      .input("SuperBuiltUpArea",sql.Decimal(18,2), sbuArea)
      .input("OpenTerraceArea", sql.Decimal(18,2), openTerrace)
      .input("Rate",            sql.Decimal(18,2), ratePerSqFt)
      .input("IsActive",  sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.UnitMaster SET
          ProjectId = @ProjectId,
          BlockId   = @BlockId,
          UnitName  = @UnitName,
          FloorNo   = @FloorNo,
          UnitType  = @UnitType,
          LayoutTypeId = @LayoutTypeId,
          AreaSqFt  = @Area,
          CarpetAreaSqFt = @CarpetArea,
          BuiltUpAreaSqFt = @BuiltUpArea,
          SuperBuiltUpAreaSqFt = @SuperBuiltUpArea,
          OpenTerraceAreaSqFt = @OpenTerraceArea,
          RatePerSqFt = @Rate,
          IsActive  = @IsActive,
          UpdatedBy = @UpdatedBy,
          UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
      // A room carries its unit's Project/Block/Floor — keep them in step if
      // the unit was moved.
      await tx.request()
        .input("Id",        sql.Int, parseInt(id))
        .input("ProjectId", sql.Int, parseInt(ProjectId))
        .input("BlockId",   sql.Int, parseInt(BlockId))
        .input("Floor",     sql.NVarChar(50), FloorNo != null && FloorNo !== "" ? (parseInt(FloorNo) === 0 ? "G" : String(parseInt(FloorNo))) : null)
        .query(`
          UPDATE dbo.RoomMaster SET ProjectId = @ProjectId, BlockId = @BlockId, Floor = @Floor
          WHERE UnitId = @Id AND (ProjectId <> @ProjectId OR BlockId <> @BlockId OR ISNULL(Floor, '') <> ISNULL(@Floor, ''))
        `);
      await moveUnitOverrides(tx, parseInt(id), parseInt(ProjectId), parseInt(BlockId));
      // Type changed: add the new layout's rooms, soft-deactivate rooms it
      // doesn't have — only those with no DPR work (kept ones are reported).
      if (typeChanged) {
        roomSync = await syncUnitRooms(tx, parseInt(id), { removeUnused: true, createdBy: updatedBy });
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      throw e;
    }
    if (Array.isArray(PaymentPlanIds)) {
      await syncUnitPaymentPlanTags(pool, parseInt(id), planIds);
    }
    await bumpCacheVersion("unit-master");
    await bumpFlatMasterCaches();
    await logAudit({ module: "UnitMaster", recordId: parseInt(id), recordNo: UnitName, action: "Updated", changedBy: req.user?.userId ?? null });
    res.json({ message: "Unit updated successfully", roomSync: summarizeRoomSync(roomSync) });
  } catch (err) {
    if (err instanceof LayoutValidationError) return res.status(400).json({ error: err.message });
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
// Refuses to delete a Booked or OnHold unit (see getUnitLockReason above) —
// deactivating a booked unit made it read as "Blocked" instead of "Booked"
// in the unit matrix, which is what happened to A1-1001 and is the most
// likely reason it got recreated as a duplicate row rather than the
// underlying problem being noticed and fixed.
//
// This is now a real, permanent DELETE, not a soft IsActive=0 flag left
// sitting in the grid as a ghost "Inactive" row. Two checks run first:
//   1. getUnitLockReason — booked/held/applied.
//   2. getUnitHardDeleteBlockers — dbo.UnitMaster is the target of real SQL
//      Server FK constraints (CrmApplication.PreferredUnitId,
//      CrmBooking.UnitId, CrmUnitChangeLog, DailyLabourEntry.UnitId,
//      FollowupApplications.UnitId, RoomMaster.UnitId — confirmed via
//      sys.foreign_keys), so even a HISTORICAL/terminal reference (e.g. a
//      long-Cancelled Application) still physically blocks a hard DELETE.
// Only once both come back clear does the row actually get removed.
router.delete("/:id", requirePageRight("followup-unit-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  const userName = req.user?.name || req.user?.email || null;
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

    // RoomMaster is handled below instead: the unit's rooms (auto-generated
    // from its layout) go with it, unless any of them has DPR work.
    const hardBlockers = await getUnitHardDeleteBlockers(pool, id, { skipTables: ["RoomMaster"] });
    if (hardBlockers) {
      return res.status(409).json({
        error: `Unit "${UnitName}" ${hardBlockers}.`,
      });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const roomBlocker = await removeUnitRoomsForDelete(tx, id);
      if (roomBlocker) {
        await tx.rollback();
        return res.status(409).json({ error: `Unit "${UnitName}" ${roomBlocker}.` });
      }
      // its own layout overrides (settings of this unit) go with it
      await removeOverridesFor(tx, { unitId: id });
      await tx.request().input("Id", sql.Int, id).query("DELETE FROM dbo.UnitMaster WHERE Id = @Id");
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* already rolled back */ }
      throw e;
    }
    await bumpCacheVersion("unit-master");
    await bumpFlatMasterCaches();
    await logAudit({ module: "UnitMaster", recordId: id, recordNo: UnitName, action: "Deleted", changedBy: req.user?.userId ?? null });
    res.json({ message: `Unit "${UnitName}" deleted` });
  } catch (err) {
    console.error("[unit-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
