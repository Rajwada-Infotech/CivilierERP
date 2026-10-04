const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const { PARKING_TYPES } = require("../constants/parkingTypes");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { isValidShortCode, ensureProjectShortCode } = require("../services/projectShortCode");
const { getBlockLockReason, getFloorLockReason, getBlockHardDeleteBlockers } = require("../services/crmHierarchyLocks");
const { getApplicablePaymentPlans } = require("../services/crmEntityCreation");
const { resolveUnitTypeInput, LayoutValidationError, syncUnitRooms, bumpFlatMasterCaches, removeOverridesFor } = require("../services/unitLayout");
const { getEffectiveType } = require("../services/projectType");

// Mirrors unitMaster.js's syncUnitPaymentPlanTags — deactivate all, then
// upsert each valid plan ID back in. Called after generating each unit so
// the block's payment plans propagate down to every generated unit.
async function syncUnitPaymentPlanTags(pool, unitId, planIds) {
  await pool.request().input("uid", sql.Int, unitId)
    .query("UPDATE dbo.CrmUnitPaymentPlan SET IsActive = 0 WHERE UnitId = @uid");
  for (const pid of planIds) {
    await pool.request()
      .input("uid", sql.Int, unitId)
      .input("pid", sql.Int, pid)
      .query(`
        MERGE dbo.CrmUnitPaymentPlan AS tgt
        USING (SELECT @uid AS UnitId, @pid AS PlanId) AS src
          ON tgt.UnitId = src.UnitId AND tgt.PlanId = src.PlanId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (UnitId, PlanId, IsActive, CreatedAt) VALUES (src.UnitId, src.PlanId, 1, SYSDATETIME());
      `);
  }
}

// Mirrors blockMaster.js's syncBlockPaymentPlanTags.
async function syncBlockPaymentPlanTags(pool, blockId, planIds) {
  await pool.request().input("bid", sql.Int, blockId)
    .query("UPDATE dbo.CrmBlockPaymentPlan SET IsActive = 0 WHERE BlockId = @bid");
  for (const pid of planIds) {
    await pool.request()
      .input("bid", sql.Int, blockId)
      .input("pid", sql.Int, pid)
      .query(`
        MERGE dbo.CrmBlockPaymentPlan AS tgt
        USING (SELECT @bid AS BlockId, @pid AS PlanId) AS src
          ON tgt.BlockId = src.BlockId AND tgt.PlanId = src.PlanId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (BlockId, PlanId, IsActive, CreatedAt) VALUES (src.BlockId, src.PlanId, 1, SYSDATETIME());
      `);
  }
}

router.use(authMiddleware);
router.use(apiRateLimit);


async function getProject(pool, projectId) {
  const r = await pool.request().input("id", sql.Int, projectId).query(`
    SELECT id AS Id, name AS Name, short_name AS ShortName, business_identity AS Code
    FROM dbo.enterprise
    WHERE id = @id AND business_type = 'P' AND ISNULL(discontinue, 0) = 0
  `);
  return r.recordset[0] || null;
}

function resolveShortCode(project) {
  return String(project.ShortName || project.Code || "").trim();
}

// Backfills the Floor scaffold from whatever real Units already exist under
// a project's Blocks — this is what makes a project with pre-existing,
// manually-created Blocks/Units (from Block Master/Unit Master, predating
// this wizard entirely) show up here instead of being refused outright.
// Every (BlockId, FloorNo) combination already in active use on a Unit gets
// a CrmProjectAutoSetupFloor row if one doesn't already exist, marked
// IsGenerated=1 (real Units are already there — this only ever adds a
// missing scaffold row, never touches an existing one) with UnitCount set to
// the real count on that floor. Units with FloorNo IS NULL can't be
// represented in the per-floor tree and are left untouched in Unit Master —
// this sync is additive/read-modeling only, it never changes real inventory.
async function syncExistingStructure(pool, projectId) {
  // ── Scaffold backward fill (existing behaviour) ──────────────────────────
  // Sync floor-level unit counts from real UnitMaster rows, and create
  // scaffold entries for any Block/FloorNo pair that has live units but no
  // wizard floor row yet.
  await pool.request().input("pid", sql.Int, projectId).query(`
    UPDATE f SET
      UnitCount = realUnits.UnitCount,
      HasUnits = CASE WHEN realUnits.UnitCount > 0 THEN 1 ELSE f.HasUnits END,
      IsGenerated = CASE WHEN realUnits.UnitCount > 0 THEN 1 ELSE 0 END,
      UpdatedAt = SYSDATETIME()
    FROM dbo.CrmProjectAutoSetupFloor f
    OUTER APPLY (
      SELECT COUNT(*) AS UnitCount
      FROM dbo.UnitMaster u
      WHERE u.BlockId = f.BlockId AND u.FloorNo = f.FloorNo AND u.IsActive = 1
    ) realUnits
    WHERE f.ProjectId = @pid AND f.IsActive = 1 AND f.IsGenerated = 1
      AND ISNULL(realUnits.UnitCount, 0) <> ISNULL(f.UnitCount, 0)
  `);

  const rows = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT DISTINCT u.BlockId, u.FloorNo,
      COUNT(*) OVER (PARTITION BY u.BlockId, u.FloorNo) AS UnitCount
    FROM dbo.UnitMaster u
    JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE b.ProjectId = @pid AND b.IsActive = 1 AND u.IsActive = 1 AND u.FloorNo IS NOT NULL
  `);
  for (const r of rows.recordset) {
    const existing = await pool.request().input("bid", sql.Int, r.BlockId).input("fno", sql.Int, r.FloorNo)
      .query("SELECT Id FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @bid AND FloorNo = @fno AND IsActive = 1");
    if (existing.recordset.length) continue;
    const label = r.FloorNo === 0 ? "G" : String(r.FloorNo);
    await pool.request()
      .input("pid", sql.Int, projectId).input("bid", sql.Int, r.BlockId).input("fno", sql.Int, r.FloorNo)
      .input("label", sql.NVarChar(20), label).input("uc", sql.Int, r.UnitCount)
      .query(`
        INSERT INTO dbo.CrmProjectAutoSetupFloor (ProjectId, BlockId, FloorNo, FloorLabel, UnitCount, HasUnits, IsGenerated, IsActive, CreatedAt)
        VALUES (@pid, @bid, @fno, @label, @uc, 1, 1, 1, SYSDATETIME())
      `);
  }

  // ── "Unassigned" synthetic bucket (Option B) ──────────────────────────────
  // For each block that has active UnitMaster rows with FloorNo IS NULL (i.e.
  // units that predate this wizard and were created without a floor), create or
  // maintain a synthetic CrmProjectAutoSetupFloor row keyed at FloorNo = -1,
  // FloorLabel = 'Unassigned'. This makes those units visible in the wizard's
  // floor tree so staff can expand the bucket, click Edit on each unit, and
  // assign a real floor — instead of just seeing a count in an amber banner
  // with no actionable path inside this page.
  //
  // IsGenerated = 1: the generate-units handler filters IsGenerated = 0, so
  //   this row is permanently excluded from generation — the units already exist.
  // Auto-cleanup: when the real count reaches 0 (all units fixed), the row is
  //   deleted so it disappears from the tree without staff having to do anything.
  // Option A (FloorNo required in unitMaster.js) prevents this bucket from
  //   ever growing from new data; this section handles the legacy backlog only.
  const blocksWithOrphanUnits = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT b.Id AS BlockId, COUNT(*) AS OrphanCount
    FROM dbo.UnitMaster u
    JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE b.ProjectId = @pid AND b.IsActive = 1 AND u.IsActive = 1 AND u.FloorNo IS NULL
    GROUP BY b.Id
  `);
  // Also collect blocks that HAD the bucket but now have no orphans (for cleanup).
  const blocksWithBucket = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT BlockId FROM dbo.CrmProjectAutoSetupFloor
    WHERE ProjectId = @pid AND FloorNo = -1 AND IsActive = 1
  `);
  const orphanMap = new Map(blocksWithOrphanUnits.recordset.map((r) => [r.BlockId, r.OrphanCount]));
  const bucketBlockIds = new Set(blocksWithBucket.recordset.map((r) => r.BlockId));

  for (const { BlockId, OrphanCount } of blocksWithOrphanUnits.recordset) {
    if (bucketBlockIds.has(BlockId)) {
      // Update existing bucket's count if it changed.
      await pool.request()
        .input("bid", sql.Int, BlockId).input("uc", sql.Int, OrphanCount)
        .query(`
          UPDATE dbo.CrmProjectAutoSetupFloor SET UnitCount = @uc, UpdatedAt = SYSDATETIME()
          WHERE BlockId = @bid AND FloorNo = -1 AND IsActive = 1
            AND UnitCount <> @uc
        `);
    } else {
      // Create the synthetic bucket for the first time.
      await pool.request()
        .input("pid", sql.Int, projectId).input("bid", sql.Int, BlockId)
        .input("uc", sql.Int, OrphanCount)
        .query(`
          INSERT INTO dbo.CrmProjectAutoSetupFloor
            (ProjectId, BlockId, FloorNo, FloorLabel, UnitCount, HasUnits, IsGenerated, IsActive, CreatedAt)
          VALUES (@pid, @bid, -1, 'Unassigned', @uc, 1, 1, 1, SYSDATETIME())
        `);
    }
  }
  // Remove stale buckets for blocks that no longer have any floor-less units.
  for (const BlockId of bucketBlockIds) {
    if (!orphanMap.has(BlockId)) {
      await pool.request().input("bid", sql.Int, BlockId)
        .query("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @bid AND FloorNo = -1");
    }
  }

  // ── Template backward fill ────────────────────────────────────────────────
  // For each block that has live units but NO active unit-template rows:
  // derive the template from the actual UnitType distribution in UnitMaster
  // (group by UnitType, count rows, average areas) and write it through to
  // both CrmProjectAutoSetupUnitTemplate and BlockUnitTypeSpec.
  // Only runs when the template slot is empty — never overwrites a template
  // the user has already intentionally saved.
  const blocksWithUnits = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT DISTINCT b.Id AS BlockId
    FROM dbo.BlockMaster b
    JOIN dbo.UnitMaster u ON u.BlockId = b.Id AND u.IsActive = 1
    WHERE b.ProjectId = @pid AND b.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmProjectAutoSetupUnitTemplate t
        WHERE t.BlockId = b.Id AND t.IsActive = 1
      )
  `);
  for (const { BlockId } of blocksWithUnits.recordset) {
    const typeRows = await pool.request().input("bid", sql.Int, BlockId).query(`
      SELECT
        UnitType,
        MAX(LayoutTypeId) AS LayoutTypeId,
        -- Units-per-floor: total / distinct floors — that is what the template
        -- Count column means. Minimum 1 so the template row is never a no-op.
        GREATEST(1, COUNT(*) / NULLIF(COUNT(DISTINCT FloorNo), 0)) AS Cnt,
        AVG(NULLIF(CarpetAreaSqFt, 0))       AS AvgCarpet,
        AVG(NULLIF(BuiltUpAreaSqFt, 0))      AS AvgBuiltUp,
        AVG(NULLIF(SuperBuiltUpAreaSqFt, 0)) AS AvgSBU,
        AVG(NULLIF(OpenTerraceAreaSqFt, 0))  AS AvgOT,
        AVG(NULLIF(RatePerSqFt, 0))          AS AvgRate
      FROM dbo.UnitMaster
      WHERE BlockId = @bid AND IsActive = 1 AND UnitType IS NOT NULL AND FloorNo IS NOT NULL
      GROUP BY UnitType
      ORDER BY COUNT(*) DESC
    `);
    if (!typeRows.recordset.length) continue;
    let so = 1;
    for (const tr of typeRows.recordset) {
      await pool.request()
        .input("bid",  sql.Int,          BlockId)
        .input("so",   sql.Int,          so++)
        .input("type", sql.NVarChar(50), tr.UnitType)
        .input("lt",   sql.Int,          tr.LayoutTypeId ?? null)
        .input("cnt",  sql.Int,          tr.Cnt)
        .input("ca",   sql.Decimal(18,2), tr.AvgCarpet  ?? null)
        .input("bua",  sql.Decimal(18,2), tr.AvgBuiltUp ?? null)
        .input("sbu",  sql.Decimal(18,2), tr.AvgSBU     ?? null)
        .input("ot",   sql.Decimal(18,2), tr.AvgOT      ?? null)
        .input("rate", sql.Decimal(18,2), tr.AvgRate    ?? null)
        .query(`
          INSERT INTO dbo.CrmProjectAutoSetupUnitTemplate
            (BlockId, SortOrder, UnitType, LayoutTypeId, Count, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, CreatedAt)
          VALUES (@bid, @so, @type, @lt, @cnt, @ca, @bua, @sbu, @ot, @rate, 1, SYSDATETIME())
        `);
      // Also write-through to BlockUnitTypeSpec (forward-fill anchor).
      if (tr.AvgCarpet || tr.AvgBuiltUp || tr.AvgSBU || tr.AvgRate) {
        await pool.request()
          .input("bid",  sql.Int,          BlockId)
          .input("ut",   sql.NVarChar(50), tr.UnitType)
          .input("lt",   sql.Int,          tr.LayoutTypeId ?? null)
          .input("ca",   sql.Decimal(18,2), tr.AvgCarpet  ?? null)
          .input("bua",  sql.Decimal(18,2), tr.AvgBuiltUp ?? null)
          .input("sbu",  sql.Decimal(18,2), tr.AvgSBU     ?? null)
          .input("ot",   sql.Decimal(18,2), tr.AvgOT      ?? null)
          .input("rate", sql.Decimal(18,2), tr.AvgRate    ?? null)
          .query(`
            MERGE dbo.BlockUnitTypeSpec AS tgt
            USING (SELECT @bid AS BlockId, @ut AS UnitType) AS src
              ON tgt.BlockId = src.BlockId AND tgt.UnitType = src.UnitType
            WHEN MATCHED AND (tgt.CarpetAreaSqFt IS NULL AND tgt.SuperBuiltUpAreaSqFt IS NULL) THEN
              UPDATE SET CarpetAreaSqFt=@ca, BuiltUpAreaSqFt=@bua, SuperBuiltUpAreaSqFt=@sbu,
                         OpenTerraceAreaSqFt=@ot, BaseRatePerSqFt=@rate,
                         LayoutTypeId=ISNULL(tgt.LayoutTypeId, @lt), UpdatedAt=SYSDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (BlockId, UnitType, LayoutTypeId, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt)
              VALUES (@bid, @ut, @lt, @ca, @bua, @sbu, @ot, @rate);
          `);
      }
    }
  }

  // ── Parking template backward fill ───────────────────────────────────────
  // For each block that has live ParkingSlot rows but NO active parking-
  // template rows: derive the template from the actual ParkingType distribution
  // in ParkingSlot (group by type, count). Only runs when the template slot is
  // empty — never overwrites an intentionally saved parking template.
  const blocksWithParking = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT DISTINCT b.Id AS BlockId
    FROM dbo.BlockMaster b
    JOIN dbo.ParkingSlot ps ON ps.BlockId = b.Id AND ps.IsActive = 1
    WHERE b.ProjectId = @pid AND b.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmProjectAutoSetupParkingTemplate t
        WHERE t.BlockId = b.Id AND t.IsActive = 1
      )
  `);
  for (const { BlockId } of blocksWithParking.recordset) {
    // Also try blocks that have ParkingMaster pricing but no slots yet.
    const parkingRows = await pool.request().input("bid", sql.Int, BlockId).query(`
      SELECT ParkingType, COUNT(*) AS Cnt
      FROM dbo.ParkingSlot
      WHERE BlockId = @bid AND IsActive = 1 AND ParkingType IS NOT NULL
      GROUP BY ParkingType
      ORDER BY COUNT(*) DESC
    `);
    if (!parkingRows.recordset.length) continue;
    // Pull pricing from ParkingMaster — block-specific wins over project-wide.
    const pmRows = await pool.request().input("bid", sql.Int, BlockId).input("pid", sql.Int, projectId).query(`
      SELECT ParkingType, Charge, GstRate
      FROM dbo.ParkingMaster
      WHERE ProjectId = @pid AND IsActive = 1
        AND (BlockId = @bid OR BlockId IS NULL)
      ORDER BY CASE WHEN BlockId = @bid THEN 0 ELSE 1 END
    `);
    const pricingMap = {};
    for (const pm of pmRows.recordset) {
      if (!pricingMap[pm.ParkingType]) pricingMap[pm.ParkingType] = { Charge: pm.Charge, GstRate: pm.GstRate };
    }
    let so = 1;
    for (const pr of parkingRows.recordset) {
      await pool.request()
        .input("bid",  sql.Int,          BlockId)
        .input("so",   sql.Int,          so++)
        .input("type", sql.NVarChar(50), pr.ParkingType)
        .input("cnt",  sql.Int,          pr.Cnt)
        .query(`
          INSERT INTO dbo.CrmProjectAutoSetupParkingTemplate
            (BlockId, SortOrder, ParkingType, Count, IsActive, CreatedAt)
          VALUES (@bid, @so, @type, @cnt, 1, SYSDATETIME())
        `);
    }
  }

  // ── ParkingMaster backward fill ───────────────────────────────────────────
  // For each block that has ParkingMaster pricing rows but NO parking template
  // yet: build a template from ParkingMaster types (Count = 0 placeholder so
  // the UI shows the types with pricing for the user to fill in slot counts).
  const blocksWithPricingOnly = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT DISTINCT b.Id AS BlockId
    FROM dbo.BlockMaster b
    JOIN dbo.ParkingMaster pm ON pm.BlockId = b.Id AND pm.ProjectId = b.ProjectId AND pm.IsActive = 1
    WHERE b.ProjectId = @pid AND b.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmProjectAutoSetupParkingTemplate t
        WHERE t.BlockId = b.Id AND t.IsActive = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM dbo.ParkingSlot ps WHERE ps.BlockId = b.Id AND ps.IsActive = 1
      )
  `);
  for (const { BlockId } of blocksWithPricingOnly.recordset) {
    const pmRows = await pool.request().input("bid", sql.Int, BlockId).input("pid", sql.Int, projectId).query(`
      SELECT DISTINCT ParkingType FROM dbo.ParkingMaster
      WHERE ProjectId = @pid AND BlockId = @bid AND IsActive = 1
      ORDER BY ParkingType
    `);
    let so = 1;
    for (const pm of pmRows.recordset) {
      await pool.request()
        .input("bid",  sql.Int,          BlockId)
        .input("so",   sql.Int,          so++)
        .input("type", sql.NVarChar(50), pm.ParkingType)
        .query(`
          INSERT INTO dbo.CrmProjectAutoSetupParkingTemplate
            (BlockId, SortOrder, ParkingType, Count, IsActive, CreatedAt)
          VALUES (@bid, @so, @type, 0, 1, SYSDATETIME())
        `);
    }
  }

  // ── Payment plan backward fill ────────────────────────────────────────────
  // For each block that has CrmUnitPaymentPlan entries on its units but NO
  // active CrmBlockPaymentPlan rows: union the unit-level plan IDs and write
  // them up to the block. Only runs when the block slot is empty — never
  // overwrites a block-level assignment the user has already saved.
  const blocksNeedingPlanSync = await pool.request().input("pid", sql.Int, projectId).query(`
    SELECT DISTINCT b.Id AS BlockId
    FROM dbo.BlockMaster b
    JOIN dbo.UnitMaster u ON u.BlockId = b.Id AND u.IsActive = 1
    JOIN dbo.CrmUnitPaymentPlan upp ON upp.UnitId = u.Id AND upp.IsActive = 1
    WHERE b.ProjectId = @pid AND b.IsActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmBlockPaymentPlan bpp
        WHERE bpp.BlockId = b.Id AND bpp.IsActive = 1
      )
  `);
  for (const { BlockId } of blocksNeedingPlanSync.recordset) {
    const planIds = await pool.request().input("bid", sql.Int, BlockId).query(`
      SELECT DISTINCT upp.PlanId
      FROM dbo.CrmUnitPaymentPlan upp
      JOIN dbo.UnitMaster u ON u.Id = upp.UnitId AND u.IsActive = 1
      WHERE u.BlockId = @bid AND upp.IsActive = 1
    `);
    for (const { PlanId } of planIds.recordset) {
      await pool.request()
        .input("bid", sql.Int, BlockId)
        .input("pid", sql.Int, PlanId)
        .query(`
          MERGE dbo.CrmBlockPaymentPlan AS tgt
          USING (SELECT @bid AS BlockId, @pid AS PlanId) AS src
            ON tgt.BlockId = src.BlockId AND tgt.PlanId = src.PlanId
          WHEN MATCHED THEN UPDATE SET IsActive = 1
          WHEN NOT MATCHED THEN INSERT (BlockId, PlanId, IsActive, CreatedAt) VALUES (src.BlockId, src.PlanId, 1, SYSDATETIME());
        `);
    }
  }
}

// GET /status?projectId= — everything the wizard needs to render/resume at
// the right step: the project, its Blocks (manually-created or wizard-made,
// no distinction), and each Block's Floor scaffold (synced against real
// Units first, so pre-existing structure is always visible).
router.get("/status", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  try {
    const projectId = parseInt(req.query.projectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });

    const pool = getPool();
    const project = await getProject(pool, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    await syncExistingStructure(pool, projectId);

    const blocks = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT
        b.Id, b.BlockName,
        (SELECT COUNT(*) FROM dbo.ParkingSlot ps WHERE ps.BlockId = b.Id AND ps.IsActive = 1) AS ParkingSlotCount
      FROM dbo.BlockMaster b
      WHERE b.ProjectId = @pid AND b.IsActive = 1
      ORDER BY b.Id
    `);

    const floors = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT
        f.Id, f.BlockId, f.FloorNo, f.FloorLabel, f.UnitCount, f.HasUnits, f.IsGenerated,
        (SELECT COUNT(*) FROM dbo.UnitMaster u
         WHERE u.BlockId = f.BlockId AND u.IsActive = 1
           AND (
             (f.FloorNo = -1 AND u.FloorNo IS NULL)
             OR
             (f.FloorNo <> -1 AND u.FloorNo = f.FloorNo)
           )
        ) AS GeneratedUnitCount
      FROM dbo.CrmProjectAutoSetupFloor f
      WHERE f.ProjectId = @pid AND f.IsActive = 1
      ORDER BY f.BlockId, f.FloorNo
    `);

    // Auto-derives and persists a Short Name straight onto Project Master's
    // own record the moment a project without one is opened here — this used
    // to block the whole wizard behind a "go set it in Project Master first"
    // message; now it just happens, so it's returned already valid below.
    const shortCode = await ensureProjectShortCode(pool, {
      Id: project.Id, Name: project.Name, ShortName: resolveShortCode(project),
    });

    // Surfaces the exact class of gap that caused the Royal Garden mix-up:
    // real, active Units under this project with no FloorNo at all can't be
    // represented in the per-floor tree (syncExistingStructure above only
    // ever backfills Units that already have one), so they'd otherwise sit
    // invisible here while still showing up in Unit Matrix — returned as a
    // full list (Id + UnitName + BlockName) so the UI can show which units
    // are affected, not just how many. legacyUnitCount kept for back-compat
    // with any other consumer that reads the count directly.
    const legacyUnitsRes = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT u.Id, u.UnitName, b.BlockName
      FROM dbo.UnitMaster u
      JOIN dbo.BlockMaster b ON b.Id = u.BlockId
      WHERE b.ProjectId = @pid AND b.IsActive = 1 AND u.IsActive = 1 AND u.FloorNo IS NULL
      ORDER BY b.BlockName, u.UnitName
    `);

    // Parking slots whose BlockId IS NULL are visible in the parking matrix
    // but completely invisible to the wizard's per-block totals — the same
    // structural gap as floor-less units, but for parking. parkingSlotMaster.js
    // POST allows BlockId to be optional, so this can accumulate silently.
    // No equivalent of legacyUnitCount existed here before; adding it so the
    // Parking tab can surface the same class of warning.
    const orphanParkingRes = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT COUNT(*) AS c FROM dbo.ParkingSlot
      WHERE ProjectId = @pid AND IsActive = 1 AND BlockId IS NULL
    `);

    // The effective project type, and each block's own, so the wizard knows
    // whether to render the floor path or the plot path. Resolved server-side
    // rather than left to the client to work out, and returned as FLAGS — the
    // UI must branch on HasFloors, never on the type's name.
    const projectType = await getEffectiveType(pool, { projectId });
    const plotTemplates = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT t.BlockId, t.PlotCount, t.NumberPrefix, t.StartNumber,
             t.DefaultAreaSqFt, t.DefaultRatePerSqFt, t.DefaultFacing, t.DefaultRoadWidthFt,
             t.IsGenerated,
             (SELECT COUNT(*) FROM dbo.PlotMaster p
               WHERE p.BlockId = t.BlockId AND p.IsActive = 1) AS PlotsCreated
      FROM dbo.CrmProjectAutoSetupPlotTemplate t
      WHERE t.ProjectId = @pid AND t.IsActive = 1
    `);
    const tplByBlock = new Map(plotTemplates.recordset.map((t) => [t.BlockId, t]));
    // Plots entered directly in Plot Master (or imported) have no layout
    // template. Such a block is already laid out: report its real plots as a
    // generated layout, so the wizard neither shows 0 plots nor offers to
    // generate a second set on top of them.
    const plotCounts = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT BlockId, COUNT(*) AS n FROM dbo.PlotMaster WHERE ProjectId = @pid AND IsActive = 1 GROUP BY BlockId`);
    for (const { BlockId, n } of plotCounts.recordset) {
      if (!tplByBlock.has(BlockId)) {
        tplByBlock.set(BlockId, { BlockId, PlotCount: n, PlotsCreated: n, IsGenerated: true, NumberPrefix: null, StartNumber: null,
          DefaultAreaSqFt: null, DefaultRatePerSqFt: null, DefaultFacing: null, DefaultRoadWidthFt: null, FromPlotMaster: true });
      }
    }

    // Per-block effective type: a mixed township can hold both kinds, so this
    // cannot be answered once for the whole project.
    const blocksOut = [];
    for (const b of blocks.recordset) {
      const bType = await getEffectiveType(pool, { blockId: b.Id, projectId });
      blocksOut.push({
        ...b,
        HasFloors: bType.HasFloors,
        ProjectTypeName: bType.Name,
        ProjectTypeCode: bType.Code,
        PlotTemplate: tplByBlock.get(b.Id) || null,
      });
    }

    res.json({
      project: { Id: project.Id, Name: project.Name, ShortCode: shortCode },
      shortCodeValid: isValidShortCode(shortCode),
      projectType,
      legacyUnitCount: legacyUnitsRes.recordset.length,
      legacyUnits: legacyUnitsRes.recordset,
      orphanParkingSlotCount: orphanParkingRes.recordset[0].c,
      blocks: blocksOut,
      floors: floors.recordset,
    });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /status error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /blocks — Step 1's "OK". Bulk-creates every Block in one transaction.
// Names are always sent final by the frontend (it pre-fills them from the
// chosen Alphabetical/Numeric/Custom scheme and lets the user edit any of
// them before submit) — this route just validates and persists them.
router.post("/blocks", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const pool = getPool();
  const createdBy = req.user?.userId || null;
  try {
    const projectId = parseInt(req.body.ProjectId, 10);
    const names = Array.isArray(req.body.Names) ? req.body.Names.map((n) => String(n || "").trim()) : [];
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "ProjectId is required" });
    if (!names.length || names.length > 100) return res.status(400).json({ error: "Provide between 1 and 100 block names" });
    if (names.some((n) => !n)) return res.status(400).json({ error: "Every block name is required" });
    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) return res.status(400).json({ error: "Block names must be unique" });

    const project = await getProject(pool, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Auto-derives one if missing rather than blocking — see
    // ensureProjectShortCode. It's what becomes the first segment of every
    // generated unit name (RYG/A/1001), so it always exists by this point.
    await ensureProjectShortCode(pool, { Id: project.Id, Name: project.Name, ShortName: resolveShortCode(project) });

    // No longer refuses on a project with pre-existing manually-created
    // Blocks — this just adds more Blocks alongside whatever's already
    // there, guarded by the same name-collision check as Block Master
    // itself. (See syncExistingStructure in GET /status for how existing
    // Blocks/Units become visible to the wizard in the first place.)
    const existing = await pool.request().input("pid", sql.Int, projectId)
      .query("SELECT BlockName FROM dbo.BlockMaster WHERE ProjectId = @pid AND IsActive = 1");
    const existingLower = new Set(existing.recordset.map((r) => String(r.BlockName).toLowerCase()));
    const collision = names.find((n) => existingLower.has(n.toLowerCase()));
    if (collision) return res.status(409).json({ error: `Block "${collision}" already exists in this Project.` });

    const tx = pool.transaction();
    await tx.begin();
    try {
      const created = [];
      for (const name of names) {
        const result = await tx.request()
          .input("pid", sql.Int, projectId)
          .input("name", sql.NVarChar(100), name)
          .input("cb", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id, INSERTED.BlockName
            VALUES (@pid, @name, 1, @cb, SYSDATETIME())
          `);
        created.push(result.recordset[0]);
      }
      await tx.commit();
      await bumpCacheVersion("block-master");
      await bumpFlatMasterCaches();
      res.status(201).json({ blocks: created });
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } catch (e) {
    console.error("[crm-project-auto-setup] POST /blocks error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /blocks/:id — rename a Block without leaving this page. Thin wrapper
// around the same update Block Master's own PUT does; duplicate-name guard
// matches it too.
router.put("/blocks/:id", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const name = String(req.body.BlockName || "").trim();
    if (!name) return res.status(400).json({ error: "BlockName is required" });

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, ProjectId FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Block not found" });
    const { ProjectId } = existing.recordset[0];

    const dupe = await pool.request().input("id", sql.Int, id).input("pid", sql.Int, ProjectId).input("name", sql.NVarChar(100), name)
      .query("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @pid AND BlockName = @name AND Id <> @id AND IsActive = 1");
    if (dupe.recordset.length) return res.status(409).json({ error: `Block "${name}" already exists in this Project.` });

    await pool.request().input("id", sql.Int, id).input("name", sql.NVarChar(100), name).input("ub", sql.Int, updatedBy)
      .query("UPDATE dbo.BlockMaster SET BlockName = @name, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    await bumpCacheVersion("block-master");
    await bumpFlatMasterCaches();
    res.json({ message: "Block renamed", Id: id, BlockName: name });
  } catch (e) {
    console.error("[crm-project-auto-setup] PUT /blocks/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /blocks/:id — refuses via the shared, hierarchy-wide lock check
// (getBlockLockReason: any active Unit or Parking Slot under it, booked or
// not). Once clear, also soft-deletes this Block's own
// CrmProjectAutoSetupFloor scaffold rows in the same transaction — they're
// this Block's children in that table and would otherwise dangle, pointing
// at a now-inactive Block, once it's gone.
router.delete("/blocks/:id", requirePageRight("crm-auto-project-setup", "delete"), async (req, res) => {
  const pool = getPool();
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BlockName FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Block not found" });
    const { BlockName } = existing.recordset[0];

    const lockReason = await getBlockLockReason(pool, id);
    if (lockReason) {
      return res.status(409).json({ error: `Block "${BlockName}" ${lockReason} and cannot be deleted. Delete its Units/Parking Slots first.` });
    }

    // Real, permanent removal — dbo.BlockMaster is the target of real SQL
    // Server FK constraints (see blockMaster.js's own DELETE route for the
    // full list), so a hard delete still has to check for those regardless
    // of the business-lock check above already passing.
    const hardBlockers = await getBlockHardDeleteBlockers(pool, id);
    if (hardBlockers) {
      return res.status(409).json({ error: `Block "${BlockName}" ${hardBlockers}.` });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await removeOverridesFor(tx, { blockId: id });
      await tx.request().input("id", sql.Int, id).query("DELETE FROM dbo.BlockMaster WHERE Id = @id");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @bid");
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    await bumpCacheVersion("block-master");
    await bumpFlatMasterCaches();
    res.json({ message: `Block "${BlockName}" deleted` });
  } catch (e) {
    console.error("[crm-project-auto-setup] DELETE /blocks/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /blocks/:id/unit-template — the Block's "typical floor" unit mix
// (e.g. 2x 2BHK + 2x 3BHK), in SortOrder, plus the computed total. Empty
// array for a block that hasn't set one up yet — generate-units falls back
// to today's behavior (UnitType left NULL) in that case.
router.get("/blocks/:id/unit-template", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const items = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT Id, SortOrder, UnitType, LayoutTypeId, Count, AreaSqFt,
             CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt
      FROM dbo.CrmProjectAutoSetupUnitTemplate
      WHERE BlockId = @bid AND IsActive = 1
      ORDER BY SortOrder
    `);
    const planRows = await pool.request().input("bid", sql.Int, blockId)
      .query("SELECT PlanId FROM dbo.CrmBlockPaymentPlan WHERE BlockId = @bid AND IsActive = 1");
    const total = items.recordset.reduce((s, r) => s + r.Count, 0);
    res.json({ items: items.recordset, total, paymentPlanIds: planRows.recordset.map((r) => r.PlanId) });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /blocks/:id/unit-template error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /blocks/:id/unit-template — replaces the block's whole template in
// one transaction (deactivate-then-reinsert, same pattern as
// unitMaster.js's syncUnitPaymentPlanTags) — simpler and safer than trying
// to diff/patch individual rows for what's always a short, fully-replaced
// list edited as a unit in the UI.
router.put("/blocks/:id/unit-template", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const items = Array.isArray(req.body.Items) ? req.body.Items : [];
    if (!items.length) return res.status(400).json({ error: "At least one Unit Type row is required" });
    for (const it of items) {
      const count = parseInt(it.Count, 10);
      if (!String(it.UnitType || "").trim()) return res.status(400).json({ error: "Every row needs a Unit Type" });
      if (!Number.isFinite(count) || count < 1 || count > 100) return res.status(400).json({ error: "Count must be between 1 and 100" });
    }
    const requestedPlanIds = Array.isArray(req.body.PaymentPlanIds)
      ? req.body.PaymentPlanIds.map((x) => parseInt(x, 10)).filter(Number.isFinite)
      : [];

    const block = await pool.request().input("id", sql.Int, blockId)
      .query("SELECT Id, ProjectId FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!block.recordset.length) return res.status(404).json({ error: "Block not found" });
    const projectId = block.recordset[0].ProjectId;

    // Every row's Unit Type must be a Unit Composition layout type with its
    // rooms defined (that's what the generated units' rooms are built
    // from). A type this block's template ALREADY uses may stay even if its
    // layout isn't defined yet, so re-saving an older template never fails
    // over a row nobody touched. Each row's UnitType is normalized to the
    // layout's own Label and its LayoutTypeId stored alongside.
    const currentRows = await pool.request().input("bid", sql.Int, blockId)
      .query("SELECT UnitType, LayoutTypeId FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE BlockId = @bid AND IsActive = 1");
    const keepLayoutIds = currentRows.recordset.map((r) => r.LayoutTypeId).filter(Boolean);
    const keepTexts = new Set(currentRows.recordset.filter((r) => !r.LayoutTypeId).map((r) => String(r.UnitType || "").trim()));
    for (const it of items) {
      const text = String(it.UnitType || "").trim();
      const resolved = await resolveUnitTypeInput(
        pool,
        { LayoutTypeId: it.LayoutTypeId, UnitType: text },
        { requireComposition: true, keepLayoutIds, keepText: keepTexts.has(text) ? text : null },
      );
      it.UnitType = resolved.unitType;
      it.LayoutTypeId = resolved.layoutTypeId;
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("bid", sql.Int, blockId)
        .query("UPDATE dbo.CrmProjectAutoSetupUnitTemplate SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE BlockId = @bid AND IsActive = 1");
      for (let i = 0; i < items.length; i++) {
        await tx.request()
          .input("bid", sql.Int, blockId)
          .input("so", sql.Int, i + 1)
          .input("type", sql.NVarChar(50), String(items[i].UnitType).trim())
          .input("lt", sql.Int, items[i].LayoutTypeId ?? null)
          .input("count", sql.Int, parseInt(items[i].Count, 10))
          .input("area", sql.Decimal(18, 2), items[i].AreaSqFt != null && items[i].AreaSqFt !== "" ? parseFloat(items[i].AreaSqFt) : null)
          .input("carpetArea", sql.Decimal(18, 2), items[i].CarpetAreaSqFt != null && items[i].CarpetAreaSqFt !== "" ? parseFloat(items[i].CarpetAreaSqFt) : null)
          .input("builtUpArea", sql.Decimal(18, 2), items[i].BuiltUpAreaSqFt != null && items[i].BuiltUpAreaSqFt !== "" ? parseFloat(items[i].BuiltUpAreaSqFt) : null)
          .input("superBuiltUpArea", sql.Decimal(18, 2), items[i].SuperBuiltUpAreaSqFt != null && items[i].SuperBuiltUpAreaSqFt !== "" ? parseFloat(items[i].SuperBuiltUpAreaSqFt) : null)
          .input("openTerraceArea", sql.Decimal(18, 2), items[i].OpenTerraceAreaSqFt != null && items[i].OpenTerraceAreaSqFt !== "" ? parseFloat(items[i].OpenTerraceAreaSqFt) : null)
          .input("rate", sql.Decimal(18, 2), items[i].RatePerSqFt != null && items[i].RatePerSqFt !== "" ? parseFloat(items[i].RatePerSqFt) : null)
          .input("cb", sql.Int, updatedBy)
          .query(`
            INSERT INTO dbo.CrmProjectAutoSetupUnitTemplate
              (BlockId, SortOrder, UnitType, LayoutTypeId, Count, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, CreatedBy, CreatedAt)
            VALUES (@bid, @so, @type, @lt, @count, @area, @carpetArea, @builtUpArea, @superBuiltUpArea, @openTerraceArea, @rate, 1, @cb, SYSDATETIME())
          `);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    // Write-through to BlockUnitTypeSpec so Unit Master inherits these areas
    // automatically for any new unit of this type in this block.
    // MERGE ensures we upsert (update if exists, insert if not) without wiping
    // unrelated rows for other unit types in the same block.
    for (const item of items) {
      const carpetArea  = item.CarpetAreaSqFt  != null && item.CarpetAreaSqFt  !== "" ? parseFloat(item.CarpetAreaSqFt)  : null;
      const builtUpArea = item.BuiltUpAreaSqFt != null && item.BuiltUpAreaSqFt !== "" ? parseFloat(item.BuiltUpAreaSqFt) : null;
      const sbuArea     = item.SuperBuiltUpAreaSqFt != null && item.SuperBuiltUpAreaSqFt !== "" ? parseFloat(item.SuperBuiltUpAreaSqFt) : null;
      const openTerrace = item.OpenTerraceAreaSqFt  != null && item.OpenTerraceAreaSqFt  !== "" ? parseFloat(item.OpenTerraceAreaSqFt)  : null;
      const baseRate    = item.RatePerSqFt != null && item.RatePerSqFt !== "" ? parseFloat(item.RatePerSqFt) : null;
      if (!sbuArea && !carpetArea && !builtUpArea && !baseRate) continue;
      await pool.request()
        .input("bid",  sql.Int,          blockId)
        .input("ut",   sql.NVarChar(50), String(item.UnitType).trim())
        .input("lt",   sql.Int,          item.LayoutTypeId ?? null)
        .input("ca",   sql.Decimal(18,2), carpetArea)
        .input("bua",  sql.Decimal(18,2), builtUpArea)
        .input("sbu",  sql.Decimal(18,2), sbuArea)
        .input("ot",   sql.Decimal(18,2), openTerrace)
        .input("rate", sql.Decimal(18,2), baseRate)
        .query(`
          MERGE dbo.BlockUnitTypeSpec AS tgt
          USING (SELECT @bid AS BlockId, @ut AS UnitType) AS src
            ON tgt.BlockId = src.BlockId AND tgt.UnitType = src.UnitType
          WHEN MATCHED THEN
            UPDATE SET
              CarpetAreaSqFt       = @ca,
              BuiltUpAreaSqFt      = @bua,
              SuperBuiltUpAreaSqFt = @sbu,
              OpenTerraceAreaSqFt  = @ot,
              BaseRatePerSqFt      = @rate,
              LayoutTypeId         = ISNULL(@lt, tgt.LayoutTypeId),
              UpdatedAt            = SYSDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (BlockId, UnitType, LayoutTypeId, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt)
            VALUES (@bid, @ut, @lt, @ca, @bua, @sbu, @ot, @rate);
        `);
    }

    // Validate and sync block-level payment plan tags if provided.
    if (requestedPlanIds.length) {
      const applicable = await getApplicablePaymentPlans(pool, { projectId });
      const applicableIds = new Set(applicable.map((p) => p.Id));
      const invalid = requestedPlanIds.filter((pid) => !applicableIds.has(pid));
      if (invalid.length) return res.status(400).json({ error: "One or more selected Payment Plans are not applicable to this Block." });
      await syncBlockPaymentPlanTags(pool, blockId, requestedPlanIds);
    } else if (req.body.PaymentPlanIds !== undefined) {
      // Explicit empty array = clear all plan tags for this block.
      await syncBlockPaymentPlanTags(pool, blockId, []);
    }

    const total = items.reduce((s, it) => s + parseInt(it.Count, 10), 0);
    res.json({ message: "Template saved", total });
  } catch (e) {
    if (e instanceof LayoutValidationError) return res.status(400).json({ error: e.message });
    console.error("[crm-project-auto-setup] PUT /blocks/:id/unit-template error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /blocks/:id/unit-template/apply — applies this Block's own template
// total onto every one of its own non-generated, HasUnits=1 floors — the
// per-Block equivalent of the project-wide PUT /floors/bulk-apply (still
// left in place, just unused by this page's UI now that templates are
// scoped per Block instead of one global count).
router.post("/blocks/:id/unit-template/apply", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const totalRes = await pool.request().input("bid", sql.Int, blockId)
      .query("SELECT ISNULL(SUM(Count), 0) AS total FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE BlockId = @bid AND IsActive = 1");
    const total = totalRes.recordset[0].total;
    if (!total) return res.status(400).json({ error: "Save a Unit Type template for this block first" });

    const result = await pool.request()
      .input("bid", sql.Int, blockId)
      .input("uc", sql.Int, total)
      .input("ub", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.CrmProjectAutoSetupFloor SET
          UnitCount = @uc, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.Id
        WHERE BlockId = @bid AND IsActive = 1 AND IsGenerated = 0 AND HasUnits = 1 AND FloorNo <> 0
      `);
    res.json({ message: "Applied to this block's floors", updatedCount: result.recordset.length, total });
  } catch (e) {
    console.error("[crm-project-auto-setup] POST /blocks/:id/unit-template/apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /blocks/:id/parking-template — the Block's Parking mix (e.g. 10x Open
// + 5x Covered) joined with ParkingMaster pricing (Charge + GstRate) so the
// UI can show and edit both in one place. Pricing comes from ParkingMaster
// keyed by ProjectId + BlockId + ParkingType — block-specific rate wins
// over project-wide rate, same precedence the booking flow uses.
router.get("/blocks/:id/parking-template", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const blockRow = await pool.request().input("bid", sql.Int, blockId)
      .query("SELECT ProjectId FROM dbo.BlockMaster WHERE Id = @bid AND IsActive = 1");
    const projectId = blockRow.recordset[0]?.ProjectId ?? null;

    const items = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT t.Id, t.SortOrder, t.ParkingType, t.Count
      FROM dbo.CrmProjectAutoSetupParkingTemplate t
      WHERE t.BlockId = @bid AND t.IsActive = 1
      ORDER BY t.SortOrder
    `);

    // Fetch pricing from ParkingMaster — block-specific wins over project-wide.
    let pricingMap = {};
    if (projectId) {
      const pm = await pool.request()
        .input("pid", sql.Int, projectId)
        .input("bid", sql.Int, blockId)
        .query(`
          SELECT ParkingType, Charge, GstRate
          FROM dbo.ParkingMaster
          WHERE ProjectId = @pid AND IsActive = 1
            AND (BlockId = @bid OR BlockId IS NULL)
          ORDER BY CASE WHEN BlockId = @bid THEN 0 ELSE 1 END
        `);
      // Block-specific wins — first-seen per type.
      for (const row of pm.recordset) {
        if (!pricingMap[row.ParkingType]) {
          pricingMap[row.ParkingType] = { Charge: row.Charge, GstRate: row.GstRate };
        }
      }
    }

    const merged = items.recordset.map((it) => ({
      ...it,
      Charge: pricingMap[it.ParkingType]?.Charge ?? null,
      GstRate: pricingMap[it.ParkingType]?.GstRate ?? null,
    }));

    const total = items.recordset.reduce((s, r) => s + r.Count, 0);
    res.json({ items: merged, total, projectId });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /blocks/:id/parking-template error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /blocks/:id/parking-template — replaces the block's whole Parking
// template and forward-fills ParkingMaster pricing (Charge + GstRate) per type.
// Items accept optional Charge + GstRate — when present and non-empty the
// ParkingMaster row for this ProjectId + BlockId + ParkingType is upserted.
router.put("/blocks/:id/parking-template", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const items = Array.isArray(req.body.Items) ? req.body.Items : [];
    if (!items.length) return res.status(400).json({ error: "At least one Parking Type row is required" });
    for (const it of items) {
      const count = parseInt(it.Count, 10);
      if (!PARKING_TYPES.includes(it.ParkingType)) {
        return res.status(400).json({ error: `Invalid Parking Type. Must be: ${PARKING_TYPES.join(", ")}` });
      }
      if (!Number.isFinite(count) || count < 1 || count > 500) return res.status(400).json({ error: "Count must be between 1 and 500" });
    }

    const blockRow = await pool.request().input("id", sql.Int, blockId)
      .query("SELECT Id, ProjectId FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!blockRow.recordset.length) return res.status(404).json({ error: "Block not found" });
    const projectId = blockRow.recordset[0].ProjectId;

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("bid", sql.Int, blockId)
        .query("UPDATE dbo.CrmProjectAutoSetupParkingTemplate SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE BlockId = @bid AND IsActive = 1");
      for (let i = 0; i < items.length; i++) {
        await tx.request()
          .input("bid", sql.Int, blockId)
          .input("so", sql.Int, i + 1)
          .input("type", sql.NVarChar(50), items[i].ParkingType)
          .input("count", sql.Int, parseInt(items[i].Count, 10))
          .input("cb", sql.Int, updatedBy)
          .query(`
            INSERT INTO dbo.CrmProjectAutoSetupParkingTemplate (BlockId, SortOrder, ParkingType, Count, IsActive, CreatedBy, CreatedAt)
            VALUES (@bid, @so, @type, @count, 1, @cb, SYSDATETIME())
          `);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    // Forward-fill ParkingMaster pricing — only for items that supply Charge or GstRate.
    if (projectId) {
      for (const it of items) {
        const charge = it.Charge !== undefined && it.Charge !== "" ? parseFloat(it.Charge) : null;
        const gst    = it.GstRate !== undefined && it.GstRate !== "" ? parseFloat(it.GstRate) : null;
        if (charge === null && gst === null) continue;
        await pool.request()
          .input("pid",  sql.Int,           projectId)
          .input("bid",  sql.Int,           blockId)
          .input("type", sql.NVarChar(50),  it.ParkingType)
          .input("chg",  sql.Decimal(18,2), charge ?? 0)
          .input("gst",  sql.Decimal(5,2),  gst ?? 0)
          .query(`
            MERGE dbo.ParkingMaster AS tgt
            USING (SELECT @pid AS ProjectId, @bid AS BlockId, @type AS ParkingType) AS src
              ON tgt.ProjectId = src.ProjectId AND tgt.BlockId = src.BlockId AND tgt.ParkingType = src.ParkingType
            WHEN MATCHED THEN
              UPDATE SET Charge = @chg, GstRate = @gst, IsActive = 1
            WHEN NOT MATCHED THEN
              INSERT (ProjectId, BlockId, ParkingType, Charge, GstRate, IsActive)
              VALUES (src.ProjectId, src.BlockId, src.ParkingType, @chg, @gst, 1);
          `);
      }
    }

    const total = items.reduce((s, it) => s + parseInt(it.Count, 10), 0);
    res.json({ message: "Parking template saved", total });
  } catch (e) {
    console.error("[crm-project-auto-setup] PUT /blocks/:id/parking-template error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /blocks/:id/parking-slots — real dbo.ParkingSlot rows generated for
// this Block, for Step 4's tree to expand into and offer per-slot edit/
// delete straight through the existing parking-slot-master endpoints (which
// already enforce the shared booking/hold lock check — not duplicated
// here).
router.get("/blocks/:id/parking-slots", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const blockId = parseId(req.params.id);
    if (blockId === null) return res.status(400).json({ error: "Invalid id" });
    const block = await pool.request().input("id", sql.Int, blockId)
      .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!block.recordset.length) return res.status(404).json({ error: "Block not found" });

    const slots = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT s.Id, s.ProjectId, s.BlockId, s.SlotNo, s.ParkingType, s.IsActive,
        pa.Id AS LockAllotmentId, bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId
      FROM dbo.ParkingSlot s
      LEFT JOIN dbo.CrmParkingAllotment pa ON pa.ParkingSlotId = s.Id AND pa.IsActive = 1
      LEFT JOIN dbo.CrmBooking bk ON bk.Id = pa.BookingId
      LEFT JOIN dbo.CrmInventoryHold h
        ON h.EntityType = 'Parking' AND h.EntityId = s.Id AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
      WHERE s.BlockId = @bid AND s.IsActive = 1
      ORDER BY s.SlotNo
    `);
    res.json({ slots: slots.recordset });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /blocks/:id/parking-slots error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /floors — Step 2's "OK". Additive/idempotent per block: only inserts
// FloorNo rows that don't already exist (0..FloorCount-1); never shrinks or
// touches an already-generated floor, so re-running with a bigger count just
// adds new floors on top.
router.post("/floors", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const pool = getPool();
  const createdBy = req.user?.userId || null;
  try {
    const projectId = parseInt(req.body.ProjectId, 10);
    const blocks = Array.isArray(req.body.Blocks) ? req.body.Blocks : [];
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "ProjectId is required" });
    if (!blocks.length) return res.status(400).json({ error: "At least one block's floor count is required" });

    for (const b of blocks) {
      const blockId = parseInt(b.BlockId, 10);
      const floorCount = parseInt(b.FloorCount, 10);
      // A plotted block has no floors. Refused here rather than silently
      // creating floor rows that could never hold anything, which is what made
      // choosing "Plotted Development" still walk the user into a floor step.
      // Decided by the type's HasFloors flag, never by its name — see
      // services/projectType.js.
      if (Number.isFinite(blockId)) {
        const effType = await getEffectiveType(pool, { blockId, projectId });
        if (!effType.HasFloors) {
          return res.status(400).json({
            error: `This block is part of a ${effType.Name} project, which has no floors — lay it out with a plot template instead.`,
          });
        }
      }
      if (!Number.isFinite(blockId) || !Number.isFinite(floorCount) || floorCount < 1 || floorCount > 100) {
        return res.status(400).json({ error: "Each block needs a valid FloorCount between 1 and 100" });
      }
      const block = await pool.request().input("id", sql.Int, blockId).input("pid", sql.Int, projectId)
        .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @id AND ProjectId = @pid AND IsActive = 1");
      if (!block.recordset.length) return res.status(404).json({ error: `Block ${blockId} not found on this project` });

      const existingFloors = await pool.request().input("bid", sql.Int, blockId)
        .query("SELECT FloorNo FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @bid AND IsActive = 1");
      const existingNos = new Set(existingFloors.recordset.map((r) => r.FloorNo));

      for (let floorNo = 0; floorNo < floorCount; floorNo++) {
        if (existingNos.has(floorNo)) continue;
        const label = floorNo === 0 ? "G" : String(floorNo);
        const hasUnits = floorNo === 0 ? 0 : 1;
        await pool.request()
          .input("pid", sql.Int, projectId)
          .input("bid", sql.Int, blockId)
          .input("fno", sql.Int, floorNo)
          .input("label", sql.NVarChar(20), label)
          .input("hu", sql.Bit, hasUnits)
          .input("cb", sql.Int, createdBy)
          .query(`
            INSERT INTO dbo.CrmProjectAutoSetupFloor (ProjectId, BlockId, FloorNo, FloorLabel, UnitCount, HasUnits, IsGenerated, IsActive, CreatedBy, CreatedAt)
            VALUES (@pid, @bid, @fno, @label, 0, @hu, 0, 1, @cb, SYSDATETIME())
          `);
      }
    }

    const floors = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT Id, BlockId, FloorNo, FloorLabel, UnitCount, HasUnits, IsGenerated
      FROM dbo.CrmProjectAutoSetupFloor WHERE ProjectId = @pid AND IsActive = 1 ORDER BY BlockId, FloorNo
    `);
    await bumpFlatMasterCaches();
    res.status(201).json({ floors: floors.recordset });
  } catch (e) {
    console.error("[crm-project-auto-setup] POST /floors error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /floors/bulk-apply — the Unit step's "Apply to all". Persists
// immediately (not just a client-side prefill) onto every non-generated
// floor with HasUnits=1 for the project — deliberately skips HasUnits=0
// floors (Ground, by default) so this never silently seeds a count onto a
// floor nobody's marked sellable yet.
//
// Registered BEFORE PUT /floors/:id deliberately — Express matches routes in
// registration order, and "/:id" is a single-segment param that would
// otherwise greedily match the literal path "/bulk-apply" too (as if
// "bulk-apply" were an id), the exact bug this codebase's own crmParking.js
// "/standalone" ordering comment warns about.
// PUT /floors/:id — a single floor's planned unit count and/or its
// sellable-floor toggle (this is also what the Ground floor's "has sellable
// units" toggle calls). Locked once IsGenerated=1 — real Units already exist
// for it, so further changes belong in Unit Master, not here.
router.put("/floors/:id", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, IsGenerated, HasUnits, UnitCount FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Floor not found" });
    if (existing.recordset[0].IsGenerated) {
      return res.status(409).json({ error: "Units have already been generated for this floor — edit them in Unit Master instead." });
    }

    const hasUnits = req.body.HasUnits !== undefined ? !!req.body.HasUnits : !!existing.recordset[0].HasUnits;
    // Turning a floor off always zeroes its count so a stray value can't
    // survive a re-toggle later.
    const unitCount = !hasUnits ? 0
      : (req.body.UnitCount !== undefined ? parseInt(req.body.UnitCount, 10) : existing.recordset[0].UnitCount);
    if (!Number.isFinite(unitCount) || unitCount < 0 || unitCount > 500) {
      return res.status(400).json({ error: "UnitCount must be between 0 and 500" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("uc", sql.Int, unitCount)
      .input("hu", sql.Bit, hasUnits ? 1 : 0)
      .input("ub", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.CrmProjectAutoSetupFloor SET
          UnitCount = @uc, HasUnits = @hu, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await bumpFlatMasterCaches();
    res.json({ message: "Floor updated", Id: id, UnitCount: unitCount, HasUnits: hasUnits });
  } catch (e) {
    console.error("[crm-project-auto-setup] PUT /floors/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /floors/:id — refuses via getFloorLockReason (any active Unit on
// that floor, booked or not — the child has to go first). Once clear,
// soft-deletes the Floor scaffold row itself.
router.delete("/floors/:id", requirePageRight("crm-auto-project-setup", "delete"), async (req, res) => {
  const pool = getPool();
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BlockId, FloorNo, FloorLabel FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id AND IsActive = 1");
    if (!existing.recordset.length) return res.status(404).json({ error: "Floor not found" });
    const floor = existing.recordset[0];

    const lockReason = await getFloorLockReason(pool, floor.BlockId, floor.FloorNo);
    if (lockReason) {
      return res.status(409).json({ error: `Floor "${floor.FloorLabel}" ${lockReason} and cannot be deleted. Delete the unit(s) first.` });
    }

    // No FK references this table (it's just this wizard's own scaffold),
    // so a real permanent delete is safe here with no further checks.
    await pool.request().input("id", sql.Int, id)
      .query("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id");
    await bumpFlatMasterCaches();
    res.json({ message: `Floor "${floor.FloorLabel}" deleted` });
  } catch (e) {
    console.error("[crm-project-auto-setup] DELETE /floors/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /floors/:id/units — real UnitMaster rows on this floor, for Step 3's
// tree to expand into and offer per-unit delete (via the existing
// DELETE /api/unit-master/:id, which already enforces the — now
// Application-aware — Unit-level lock check; not duplicated here).
router.get("/floors/:id/units", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const floor = await pool.request().input("id", sql.Int, id)
      .query("SELECT BlockId, FloorNo FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id AND IsActive = 1");
    if (!floor.recordset.length) return res.status(404).json({ error: "Floor not found" });
    const { BlockId, FloorNo } = floor.recordset[0];

    // Synthetic Unassigned bucket (FloorNo = -1) holds units whose FloorNo
    // IS NULL in UnitMaster — a regular equality filter would return nothing.
    // All other floors use the normal equality join.
    const unitsQuery = FloorNo === -1
      ? pool.request().input("bid", sql.Int, BlockId).query(`
          SELECT u.Id, u.ProjectId, u.BlockId, u.UnitName, u.FloorNo, u.UnitType,
            u.AreaSqFt, u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
            u.IsActive,
            tags.PlanIds AS PaymentPlanIds,
            bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId, app.ApplicationNo AS LockApplicationNo
          FROM dbo.UnitMaster u
          OUTER APPLY (
            SELECT STRING_AGG(CAST(upp.PlanId AS VARCHAR(20)), ',') AS PlanIds
            FROM dbo.CrmUnitPaymentPlan upp
            WHERE upp.UnitId = u.Id AND upp.IsActive = 1
          ) tags
          LEFT JOIN dbo.CrmBooking bk ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')
          LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
          LEFT JOIN dbo.CrmApplication app ON app.PreferredUnitId = u.Id AND app.IsActive = 1 AND app.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')
          WHERE u.BlockId = @bid AND u.FloorNo IS NULL AND u.IsActive = 1
          ORDER BY u.UnitName
        `)
      : pool.request().input("bid", sql.Int, BlockId).input("fno", sql.Int, FloorNo).query(`
          SELECT u.Id, u.ProjectId, u.BlockId, u.UnitName, u.FloorNo, u.UnitType,
            u.AreaSqFt, u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
            u.IsActive,
            tags.PlanIds AS PaymentPlanIds,
            bk.BookingNo AS LockBookingNo, h.Id AS LockHoldId, app.ApplicationNo AS LockApplicationNo
          FROM dbo.UnitMaster u
          OUTER APPLY (
            SELECT STRING_AGG(CAST(upp.PlanId AS VARCHAR(20)), ',') AS PlanIds
            FROM dbo.CrmUnitPaymentPlan upp
            WHERE upp.UnitId = u.Id AND upp.IsActive = 1
          ) tags
          LEFT JOIN dbo.CrmBooking bk ON bk.UnitId = u.Id AND bk.IsActive = 1 AND bk.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')
          LEFT JOIN dbo.CrmInventoryHold h ON h.EntityType = 'Unit' AND h.EntityId = u.Id AND h.Status = '${CrmStatus.ACTIVE}' AND h.HoldUntil >= SYSDATETIME()
          LEFT JOIN dbo.CrmApplication app ON app.PreferredUnitId = u.Id AND app.IsActive = 1 AND app.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')
          WHERE u.BlockId = @bid AND u.FloorNo = @fno AND u.IsActive = 1
          ORDER BY u.UnitName
        `);
    const units = await unitsQuery;
    res.json({ units: units.recordset });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /floors/:id/units error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Expands a Block's CrmProjectAutoSetupUnitTemplate rows (ordered by
// SortOrder) into a flat per-unit sequence, e.g. [{2BHK,2},{3BHK,2}] ->
// [{UnitType:2BHK,AreaSqFt},{UnitType:2BHK,AreaSqFt},{UnitType:3BHK,...},{UnitType:3BHK,...}].
// A floor's unit `seq` (1-based) is assigned sequence[(seq-1) % length] —
// this is what makes a floor whose count doesn't match the template total
// (e.g. a terrace-setback floor with fewer units) still get a sensible,
// repeating type pattern instead of nothing. Empty array (no template set
// for this block) means every generated unit keeps UnitType/AreaSqFt NULL,
// exactly like before this feature existed.
async function getBlockUnitSequence(pool, blockId) {
  const rows = await pool.request().input("bid", sql.Int, blockId).query(`
    SELECT UnitType, LayoutTypeId, Count, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt
    FROM dbo.CrmProjectAutoSetupUnitTemplate
    WHERE BlockId = @bid AND IsActive = 1 ORDER BY SortOrder
  `);
  const sequence = [];
  for (const r of rows.recordset) {
    for (let i = 0; i < r.Count; i++) {
      sequence.push({
        UnitType: r.UnitType,
        LayoutTypeId: r.LayoutTypeId,
        AreaSqFt: r.AreaSqFt,
        CarpetAreaSqFt: r.CarpetAreaSqFt,
        BuiltUpAreaSqFt: r.BuiltUpAreaSqFt,
        SuperBuiltUpAreaSqFt: r.SuperBuiltUpAreaSqFt,
        OpenTerraceAreaSqFt: r.OpenTerraceAreaSqFt,
        RatePerSqFt: r.RatePerSqFt,
      });
    }
  }
  return sequence;
}

// Same expansion as getBlockUnitSequence, for dbo.CrmProjectAutoSetupParkingTemplate
// (e.g. [{Open,10},{Covered,5},{Stack,3}] -> 18-long flat array of
// ParkingType). Unlike Units, this sequence's own length IS the block's
// total slot count to generate — there's no separate per-floor count step,
// since dbo.ParkingSlot has no FloorNo (Parking is Block-scoped only).
async function getBlockParkingSequence(pool, blockId) {
  const rows = await pool.request().input("bid", sql.Int, blockId).query(`
    SELECT ParkingType, Count FROM dbo.CrmProjectAutoSetupParkingTemplate
    WHERE BlockId = @bid AND IsActive = 1 ORDER BY SortOrder
  `);
  const sequence = [];
  for (const r of rows.recordset) {
    for (let i = 0; i < r.Count; i++) sequence.push(r.ParkingType);
  }
  return sequence;
}

// POST /generate-units — the final commit. For every eligible floor
// (non-generated, HasUnits=1, UnitCount>0 — all three re-checked here as a
// backstop, not just trusted from the UI), bulk-creates real UnitMaster rows
// named `${ProjectShortCode}/${BlockName}/${unitCode}`, where unitCode is the
// floor's label ('G' or the floor number) + a 2-digit sequence reset per
// floor (G01, G02, ..., 1001, 1002, ...). UnitType/AreaSqFt come from the
// Block's own Unit Type template (see getBlockUnitSequence above) if one has
// been set up; otherwise left NULL exactly like before this feature
// existed, filled in afterward via the existing Unit Master edit page.
router.post("/generate-units", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const pool = getPool();
  const createdBy = req.user?.userId || null;
  try {
    const projectId = parseInt(req.body.ProjectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "ProjectId is required" });
    const floorIds = Array.isArray(req.body.FloorIds) ? req.body.FloorIds.map((x) => parseInt(x, 10)).filter(Number.isFinite) : null;

    const project = await getProject(pool, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const shortCode = await ensureProjectShortCode(pool, { Id: project.Id, Name: project.Name, ShortName: resolveShortCode(project) });

    const req0 = pool.request().input("pid", sql.Int, projectId);
    let query = `
      SELECT f.Id, f.BlockId, f.FloorNo, f.FloorLabel, f.UnitCount, b.BlockName
      FROM dbo.CrmProjectAutoSetupFloor f
      JOIN dbo.BlockMaster b ON b.Id = f.BlockId
      WHERE f.ProjectId = @pid AND f.IsActive = 1 AND f.IsGenerated = 0 AND f.HasUnits = 1 AND f.UnitCount > 0
    `;
    if (floorIds && floorIds.length) {
      req0.input("ids", sql.NVarChar(sql.MAX), floorIds.join(","));
      query += ` AND f.Id IN (SELECT value FROM STRING_SPLIT(@ids, ','))`;
    }
    query += " ORDER BY f.BlockId, f.FloorNo";
    const floors = await req0.query(query);

    let totalCreated = 0;
    let roomsCreated = 0;
    // Units that got NO rooms because their Unit Type has no layout (or no
    // type at all) — reported back so the user knows to set the layout up in
    // Unit Composition and then run Flat Master's bulk "Generate Rooms".
    const noRoomTypes = new Map(); // type label -> unit count
    const tallyRooms = (rs, unitType) => {
      roomsCreated += rs.created + rs.reactivated;
      if (rs.skipped === "no-layout" || rs.skipped === "no-composition") {
        const key = unitType || "No Unit Type";
        noRoomTypes.set(key, (noRoomTypes.get(key) || 0) + 1);
      }
    };
    const sample = [];
    const sequenceByBlock = new Map();
    // Pre-fetch payment plan tags per block — forward-fill to each generated unit.
    const plansByBlock = new Map();
    for (const floor of floors.recordset) {
      if (!plansByBlock.has(floor.BlockId)) {
        const pr = await pool.request().input("bid", sql.Int, floor.BlockId)
          .query("SELECT PlanId FROM dbo.CrmBlockPaymentPlan WHERE BlockId = @bid AND IsActive = 1");
        plansByBlock.set(floor.BlockId, pr.recordset.map((r) => r.PlanId));
      }
    }
    for (const floor of floors.recordset) {
      if (!sequenceByBlock.has(floor.BlockId)) {
        sequenceByBlock.set(floor.BlockId, await getBlockUnitSequence(pool, floor.BlockId));
      }
      const sequence = sequenceByBlock.get(floor.BlockId);

      for (let seq = 1; seq <= floor.UnitCount; seq++) {
        const unitCode = `${floor.FloorLabel}${String(seq).padStart(2, "0")}`;
        const unitName = `${shortCode}/${floor.BlockName}/${unitCode}`;
        const typeSlot = sequence.length ? sequence[(seq - 1) % sequence.length] : null;
        const blockPlanIds = plansByBlock.get(floor.BlockId) || [];

        // Wrap the check+INSERT in a transaction with UPDLOCK so that two
        // concurrent generate-units requests for the same project serialise
        // on a per-unit-name basis. Without this, both can pass the dupe-check
        // SELECT before either INSERT commits and produce duplicate rows.
        // Mirrors the identical fix in applyAddParking() / crmEntityCreation.js.
        const tx = pool.transaction();
        await tx.begin();
        try {
          const dupe = await tx.request()
            .input("pid", sql.Int, projectId).input("bid", sql.Int, floor.BlockId).input("name", sql.NVarChar(100), unitName)
            .query("SELECT Id, IsActive FROM dbo.UnitMaster WITH (UPDLOCK, ROWLOCK) WHERE ProjectId = @pid AND BlockId = @bid AND UnitName = @name");

          if (dupe.recordset.length) {
            if (!dupe.recordset[0].IsActive) {
              const reactivatedId = dupe.recordset[0].Id;
              await tx.request()
                .input("id",             sql.Int,         reactivatedId)
                .input("fno",            sql.Int,         floor.FloorNo)
                .input("utype",          sql.NVarChar(50),typeSlot?.UnitType || null)
                .input("ltype",          sql.Int,         typeSlot?.LayoutTypeId ?? null)
                .input("area",           sql.Decimal(18,2),typeSlot?.AreaSqFt ?? null)
                .input("carpetArea",     sql.Decimal(18,2),typeSlot?.CarpetAreaSqFt ?? null)
                .input("builtUp",        sql.Decimal(18,2),typeSlot?.BuiltUpAreaSqFt ?? null)
                .input("superBuiltUp",   sql.Decimal(18,2),typeSlot?.SuperBuiltUpAreaSqFt ?? null)
                .input("openTerrace",    sql.Decimal(18,2),typeSlot?.OpenTerraceAreaSqFt ?? null)
                .input("rate",           sql.Decimal(18,2),typeSlot?.RatePerSqFt ?? null)
                .query(`UPDATE dbo.UnitMaster SET
                  IsActive = 1, FloorNo = @fno,
                  UnitType           = ISNULL(UnitType, @utype),
                  -- SET clauses read pre-update values: only take the slot's
                  -- layout when the slot's UnitType is the one being taken.
                  LayoutTypeId       = CASE WHEN UnitType IS NULL THEN @ltype ELSE LayoutTypeId END,
                  AreaSqFt           = ISNULL(AreaSqFt, @area),
                  CarpetAreaSqFt     = ISNULL(CarpetAreaSqFt, @carpetArea),
                  BuiltUpAreaSqFt    = ISNULL(BuiltUpAreaSqFt, @builtUp),
                  SuperBuiltUpAreaSqFt = ISNULL(SuperBuiltUpAreaSqFt, @superBuiltUp),
                  OpenTerraceAreaSqFt  = ISNULL(OpenTerraceAreaSqFt, @openTerrace),
                  RatePerSqFt          = ISNULL(RatePerSqFt, @rate),
                  UpdatedAt = SYSDATETIME()
                WHERE Id = @id`);
              // Its rooms, from its layout, in the same transaction (add-only;
              // a reactivated unit's existing rooms are kept).
              const rs = await syncUnitRooms(tx, reactivatedId, { removeUnused: false, createdBy });
              tallyRooms(rs, rs.layout?.label ?? typeSlot?.UnitType);
              await tx.commit();
              if (blockPlanIds.length) await syncUnitPaymentPlanTags(pool, reactivatedId, blockPlanIds);
              totalCreated++;
            } else {
              // Already active — leave it alone, it's already real inventory.
              await tx.commit();
            }
          } else {
            const ins = await tx.request()
              .input("pid",          sql.Int,          projectId)
              .input("bid",          sql.Int,          floor.BlockId)
              .input("name",         sql.NVarChar(100),unitName)
              .input("fno",          sql.Int,          floor.FloorNo)
              .input("utype",        sql.NVarChar(50), typeSlot?.UnitType || null)
              .input("ltype",        sql.Int,          typeSlot?.LayoutTypeId ?? null)
              .input("area",         sql.Decimal(18,2),typeSlot?.AreaSqFt ?? null)
              .input("carpetArea",   sql.Decimal(18,2),typeSlot?.CarpetAreaSqFt ?? null)
              .input("builtUp",      sql.Decimal(18,2),typeSlot?.BuiltUpAreaSqFt ?? null)
              .input("superBuiltUp", sql.Decimal(18,2),typeSlot?.SuperBuiltUpAreaSqFt ?? null)
              .input("openTerrace",  sql.Decimal(18,2),typeSlot?.OpenTerraceAreaSqFt ?? null)
              .input("rate",         sql.Decimal(18,2),typeSlot?.RatePerSqFt ?? null)
              .input("cb",           sql.Int,          createdBy)
              .query(`
                INSERT INTO dbo.UnitMaster
                  (ProjectId, BlockId, UnitName, FloorNo, UnitType, LayoutTypeId,
                   AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt,
                   IsActive, CreatedBy, CreatedAt)
                OUTPUT INSERTED.Id
                VALUES
                  (@pid, @bid, @name, @fno, @utype, @ltype,
                   @area, @carpetArea, @builtUp, @superBuiltUp, @openTerrace, @rate,
                   1, @cb, SYSDATETIME())
              `);
            const newId = ins.recordset[0]?.Id;
            // The new unit's rooms (Bedroom 1, Kitchen, ...) from its layout,
            // in the same transaction as the unit itself.
            if (newId) {
              const rs = await syncUnitRooms(tx, newId, { removeUnused: false, createdBy });
              tallyRooms(rs, rs.layout?.label ?? typeSlot?.UnitType);
            }
            await tx.commit();
            if (newId && blockPlanIds.length) await syncUnitPaymentPlanTags(pool, newId, blockPlanIds);
            totalCreated++;
          }
        } catch (txErr) {
          try { await tx.rollback(); } catch (_) { /* already rolled back */ }
          throw txErr;
        }
        if (sample.length < 5) sample.push(unitName);
      }

      // IsGenerated flag is a progress marker, not inventory — kept outside
      // the per-unit transaction so a unit-level failure doesn't prevent the
      // floor from being marked done once the remaining units succeed.
      await pool.request().input("id", sql.Int, floor.Id)
        .query("UPDATE dbo.CrmProjectAutoSetupFloor SET IsGenerated = 1, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }

    if (totalCreated > 0) await bumpCacheVersion("unit-master");
    // Flat Master shows these units (and the rooms just built for them)
    // under its Block > Floor tree — refresh its caches so they appear
    // immediately rather than after the cache TTL.
    if (totalCreated > 0 || roomsCreated > 0 || floors.recordset.length > 0) await bumpFlatMasterCaches();
    res.status(201).json({
      message: "Units generated",
      createdCount: totalCreated,
      roomsCreated,
      unitsWithoutRooms: [...noRoomTypes.entries()].map(([unitType, count]) => ({ unitType, count })),
      sample,
      floorsGenerated: floors.recordset.length,
    });
  } catch (e) {
    console.error("[crm-project-auto-setup] POST /generate-units error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /generate-parking-slots — the Parking commit, mirroring
// POST /generate-units but Block-scoped (dbo.ParkingSlot has no FloorNo).
// For every Block that has a saved Parking template with a total > 0
// (optionally filtered to BlockIds), generates real dbo.ParkingSlot rows
// named `${ProjectShortCode}/${BlockName}/P${seq}` where seq is a 2-digit,
// per-block sequence (P01, P02, ...) — plain, not type-prefixed. ParkingType
// for each seq comes from cycling the Block's own template sequence (see
// getBlockParkingSequence), same repeating-pattern behavior generate-units
// uses for UnitType. Idempotent/additive: re-running after raising a
// template's total only fills in the new seq numbers; an existing active
// slot at a given seq is left untouched (its ParkingType is NOT rewritten
// even if the template changed — matches generate-units' "already active,
// leave it alone" rule for real inventory).
router.post("/generate-parking-slots", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const pool = getPool();
  const createdBy = req.user?.userId || null;
  try {
    const projectId = parseInt(req.body.ProjectId, 10);
    if (!Number.isFinite(projectId)) return res.status(400).json({ error: "ProjectId is required" });
    const blockIds = Array.isArray(req.body.BlockIds) ? req.body.BlockIds.map((x) => parseInt(x, 10)).filter(Number.isFinite) : null;

    const project = await getProject(pool, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const shortCode = await ensureProjectShortCode(pool, { Id: project.Id, Name: project.Name, ShortName: resolveShortCode(project) });

    const req0 = pool.request().input("pid", sql.Int, projectId);
    let query = `
      SELECT b.Id AS BlockId, b.BlockName,
        ISNULL(t.total, 0) AS TemplateTotal
      FROM dbo.BlockMaster b
      OUTER APPLY (
        SELECT SUM(Count) AS total FROM dbo.CrmProjectAutoSetupParkingTemplate
        WHERE BlockId = b.Id AND IsActive = 1
      ) t
      WHERE b.ProjectId = @pid AND b.IsActive = 1 AND ISNULL(t.total, 0) > 0
    `;
    if (blockIds && blockIds.length) {
      req0.input("ids", sql.NVarChar(sql.MAX), blockIds.join(","));
      query += ` AND b.Id IN (SELECT value FROM STRING_SPLIT(@ids, ','))`;
    }
    query += " ORDER BY b.Id";
    const blocks = await req0.query(query);

    let totalCreated = 0;
    const sample = [];
    for (const block of blocks.recordset) {
      const sequence = await getBlockParkingSequence(pool, block.BlockId);

      for (let seq = 1; seq <= sequence.length; seq++) {
        const slotNo = `${shortCode}/${block.BlockName}/P${String(seq).padStart(2, "0")}`;
        const parkingType = sequence[seq - 1];

        // Wrap the check+INSERT in a transaction with UPDLOCK so that two
        // concurrent generate-parking-slots requests for the same project
        // serialise on a per-slot-number basis — same fix as generate-units.
        const tx = pool.transaction();
        await tx.begin();
        try {
          const dupe = await tx.request()
            .input("pid", sql.Int, projectId).input("bid", sql.Int, block.BlockId).input("slot", sql.NVarChar(50), slotNo)
            .query("SELECT Id, IsActive FROM dbo.ParkingSlot WITH (UPDLOCK, ROWLOCK) WHERE ProjectId = @pid AND BlockId = @bid AND SlotNo = @slot");

          if (dupe.recordset.length) {
            if (!dupe.recordset[0].IsActive) {
              await tx.request().input("id", sql.Int, dupe.recordset[0].Id).input("type", sql.NVarChar(50), parkingType)
                .query("UPDATE dbo.ParkingSlot SET IsActive = 1, ParkingType = ISNULL(ParkingType, @type), UpdatedAt = SYSDATETIME() WHERE Id = @id");
              await tx.commit();
              totalCreated++;
            } else {
              // Already active — leave it alone, it's already real inventory.
              await tx.commit();
            }
          } else {
            await tx.request()
              .input("pid", sql.Int, projectId).input("bid", sql.Int, block.BlockId)
              .input("slot", sql.NVarChar(50), slotNo).input("type", sql.NVarChar(50), parkingType)
              .input("cb", sql.Int, createdBy)
              .query(`
                INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedBy, CreatedAt)
                VALUES (@pid, @bid, @slot, @type, 1, @cb, SYSDATETIME())
              `);
            await tx.commit();
            totalCreated++;
          }
        } catch (txErr) {
          try { await tx.rollback(); } catch (_) { /* already rolled back */ }
          throw txErr;
        }
        if (sample.length < 5) sample.push(slotNo);
      }
    }

    if (totalCreated > 0) await bumpCacheVersion("parking-slot-master");
    res.status(201).json({ message: "Parking slots generated", createdCount: totalCreated, sample, blocksGenerated: blocks.recordset.length });
  } catch (e) {
    console.error("[crm-project-auto-setup] POST /generate-parking-slots error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Plotted layouts ────────────────────────────────────────────────────────
// The floor-driven routes above cannot express a plotted block: there are no
// floors to hang units off. These three do the equivalent job — a template on
// the BLOCK, because in a plotted development the block IS the layout.

router.get("/blocks/:id/plot-template", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const blockId = parseId(req.params.id);
  if (blockId === null) return res.status(400).json({ error: "Invalid block id" });
  try {
    const pool = getPool();
    const r = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT Id, BlockId, ProjectId, PlotCount, NumberPrefix, StartNumber,
             DefaultAreaSqFt, DefaultRatePerSqFt, DefaultFacing, DefaultRoadWidthFt,
             IsGenerated, GeneratedAt
      FROM dbo.CrmProjectAutoSetupPlotTemplate
      WHERE BlockId = @bid AND IsActive = 1
    `);
    // An absent template is a normal state (nothing laid out yet), not an
    // error — the UI renders an empty form from it.
    res.json(r.recordset[0] || null);
  } catch (e) {
    console.error("[auto-setup] GET plot-template:", e.message);
    res.status(500).json({ error: "Failed to load the plot template" });
  }
});

router.put("/blocks/:id/plot-template", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const blockId = parseId(req.params.id);
  if (blockId === null) return res.status(400).json({ error: "Invalid block id" });
  const b = req.body || {};
  const plotCount = parseInt(b.PlotCount, 10);
  if (!Number.isFinite(plotCount) || plotCount < 1 || plotCount > 500)
    return res.status(400).json({ error: "PlotCount must be between 1 and 500" });

  try {
    const pool = getPool();
    const blk = await pool.request().input("bid", sql.Int, blockId)
      .query("SELECT Id, ProjectId, BlockName FROM dbo.BlockMaster WHERE Id = @bid");
    const block = blk.recordset[0];
    if (!block) return res.status(404).json({ error: "Block not found" });

    // A block whose plots already exist (entered or imported in Plot Master)
    // is laid out; a template here would generate a second, duplicate set.
    const existing = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT (SELECT COUNT(*) FROM dbo.PlotMaster WHERE BlockId = @bid AND IsActive = 1) AS plots,
             (SELECT COUNT(*) FROM dbo.CrmProjectAutoSetupPlotTemplate WHERE BlockId = @bid AND IsActive = 1) AS tpl`);
    if (existing.recordset[0].plots > 0 && existing.recordset[0].tpl === 0)
      return res.status(409).json({ error: `Block ${block.BlockName} already has ${existing.recordset[0].plots} plot(s) in Plot Master — manage them there.` });

    // Mirror of the floors guard: a tower block must not be laid out as plots.
    const effType = await getEffectiveType(pool, { blockId, projectId: block.ProjectId });
    if (effType.HasFloors)
      return res.status(400).json({ error: `This block is part of a ${effType.Name} project, which uses floors — define floors instead of a plot layout.` });

    const startNumber = Number.isFinite(parseInt(b.StartNumber, 10)) ? parseInt(b.StartNumber, 10) : 1;
    const num = (v) => (v != null && v !== "" ? Number(v) : null);

    await pool.request()
      .input("bid", sql.Int, blockId)
      .input("pid", sql.Int, block.ProjectId)
      .input("count", sql.Int, plotCount)
      .input("prefix", sql.NVarChar(20), b.NumberPrefix || null)
      .input("start", sql.Int, startNumber)
      .input("area", sql.Decimal(18, 2), num(b.DefaultAreaSqFt))
      .input("rate", sql.Decimal(18, 2), num(b.DefaultRatePerSqFt))
      .input("facing", sql.NVarChar(20), b.DefaultFacing || null)
      .input("road", sql.Decimal(18, 2), num(b.DefaultRoadWidthFt))
      .input("by", sql.Int, req.user?.userId || null)
      .query(`
        MERGE dbo.CrmProjectAutoSetupPlotTemplate AS tgt
        USING (SELECT @bid AS BlockId) AS src ON tgt.BlockId = src.BlockId AND tgt.IsActive = 1
        WHEN MATCHED THEN UPDATE SET
          PlotCount = @count, NumberPrefix = @prefix, StartNumber = @start,
          DefaultAreaSqFt = @area, DefaultRatePerSqFt = @rate,
          DefaultFacing = @facing, DefaultRoadWidthFt = @road,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT
          (BlockId, ProjectId, PlotCount, NumberPrefix, StartNumber,
           DefaultAreaSqFt, DefaultRatePerSqFt, DefaultFacing, DefaultRoadWidthFt, CreatedBy)
          VALUES (@bid, @pid, @count, @prefix, @start, @area, @rate, @facing, @road, @by);
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[auto-setup] PUT plot-template:", e.message);
    res.status(500).json({ error: "Failed to save the plot template" });
  }
});

// Lays the plots out as real UnitMaster rows with UnitKind = 'PLOT'.
//
// Sizes are seeded from the template and then edited per plot: a real layout
// has plots of differing sizes, each with its own dimensions, facing and survey
// number. Generating uniform plots and refining them beats hand-creating sixty
// rows, which is the same bargain the floor path already makes.
router.post("/generate-plots", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const pool = getPool();
  const createdBy = req.user?.userId || null;
  try {
    const blockId = parseInt(req.body.BlockId, 10);
    if (!Number.isFinite(blockId)) return res.status(400).json({ error: "BlockId is required" });

    // Columns listed explicitly rather than `t.*` plus b.ProjectId: both tables
    // carry a ProjectId, and the duplicate name collapsed in the recordset so
    // tpl.ProjectId came back undefined.
    const tplRow = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT t.Id, t.BlockId, t.ProjectId, t.PlotCount, t.NumberPrefix, t.StartNumber,
             t.DefaultAreaSqFt, t.DefaultRatePerSqFt, t.DefaultFacing, t.DefaultRoadWidthFt,
             t.IsGenerated, b.BlockName
      FROM dbo.CrmProjectAutoSetupPlotTemplate t
      JOIN dbo.BlockMaster b ON b.Id = t.BlockId
      WHERE t.BlockId = @bid AND t.IsActive = 1
    `);
    const tpl = tplRow.recordset[0];
    if (!tpl) return res.status(400).json({ error: "No plot template defined for this block" });
    if (tpl.IsGenerated)
      return res.status(400).json({ error: "Plots have already been generated for this block — add further plots from Unit Master." });

    const effType = await getEffectiveType(pool, { blockId, projectId: tpl.ProjectId });
    if (effType.HasFloors)
      return res.status(400).json({ error: `This block is part of a ${effType.Name} project, which uses floors.` });

    const prefix = tpl.NumberPrefix || "P";
    let created = 0;
    const skipped = [];

    for (let i = 0; i < tpl.PlotCount; i++) {
      const plotNo = `${prefix}${tpl.StartNumber + i}`;
      // Existing names are skipped rather than erroring the whole run, so a
      // partially-generated block can be completed without manual cleanup.
      const dupe = await pool.request()
        .input("pid", sql.Int, tpl.ProjectId).input("bid", sql.Int, blockId).input("n", sql.NVarChar(100), plotNo)
        .query("SELECT Id FROM dbo.PlotMaster WHERE ProjectId = @pid AND BlockId = @bid AND PlotName = @n AND IsActive = 1");
      if (dupe.recordset.length) { skipped.push(plotNo); continue; }

      await pool.request()
        .input("pid", sql.Int, tpl.ProjectId)
        .input("bid", sql.Int, blockId)
        .input("name", sql.NVarChar(100), plotNo)
        .input("plotNo", sql.NVarChar(50), plotNo)
        .input("area", sql.Decimal(18, 2), tpl.DefaultAreaSqFt)
        .input("rate", sql.Decimal(18, 2), tpl.DefaultRatePerSqFt)
        .input("facing", sql.NVarChar(20), tpl.DefaultFacing)
        .input("road", sql.Decimal(18, 2), tpl.DefaultRoadWidthFt)
        .input("by", sql.Int, createdBy)
        .query(`
          INSERT INTO dbo.PlotMaster
            (ProjectId, BlockId, PlotName, PlotNo, AreaSqFt, RatePerSqFt,
             Facing, RoadWidthFt, IsActive, CreatedBy, CreatedAt)
          VALUES (@pid, @bid, @name, @plotNo, @area, @rate,
                  @facing, @road, 1, @by, SYSDATETIME())
        `);
      created++;
    }

    await pool.request().input("id", sql.Int, tpl.Id)
      .query("UPDATE dbo.CrmProjectAutoSetupPlotTemplate SET IsGenerated = 1, GeneratedAt = SYSDATETIME() WHERE Id = @id");
    await bumpCacheVersion("unit-master");

    res.json({ success: true, created, skipped, blockName: tpl.BlockName });
  } catch (e) {
    console.error("[auto-setup] POST generate-plots:", e.message);
    res.status(500).json({ error: "Failed to generate plots" });
  }
});

// GET /blocks/:blockId/plots — lists all PLOT-kind units in this block so the
// Auto Setup UI can show a drill-down browse panel (same pattern as
// /floors/:id/units for the floor path). No pagination — plot counts are
// bounded by the template (≤ 500); returning them all in one shot is fine.
router.get("/blocks/:blockId/plots", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const blockId = parseInt(req.params.blockId, 10);
    if (!Number.isFinite(blockId)) return res.status(400).json({ error: "blockId required" });

    const r = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT
        p.Id, p.PlotName AS UnitName, p.PlotNo, p.AreaSqFt, p.RatePerSqFt, p.Facing, p.RoadWidthFt,
        p.IsActive, N'PLOT' AS UnitKind,
        -- booking / hold / application locks (same pattern as /floors/:id/units)
        (SELECT TOP 1 b.BookingNo FROM dbo.CrmBooking b
           JOIN dbo.CrmBookingPlot bp ON bp.BookingId = b.Id
           WHERE bp.PlotId = p.Id AND b.IsActive = 1
             AND b.Status NOT IN ('Cancelled', 'Draft')) AS LockBookingNo,
        (SELECT TOP 1 CAST(h.Id AS NVARCHAR) FROM dbo.CrmInventoryHold h
           WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id AND h.Status = N'Active'
             AND h.HoldUntil > SYSDATETIME()) AS LockHoldId,
        (SELECT TOP 1 a.ApplicationNo FROM dbo.CrmApplication a
           JOIN dbo.CrmApplicationPlot ap ON ap.ApplicationId = a.Id
           WHERE ap.PlotId = p.Id AND a.IsActive = 1
             AND a.Status NOT IN ('Cancelled', 'Draft')) AS LockApplicationNo
      FROM dbo.PlotMaster p
      WHERE p.BlockId = @bid AND p.IsActive = 1
      ORDER BY p.PlotName
    `);
    res.json({ plots: r.recordset });
  } catch (e) {
    console.error("[auto-setup] GET /blocks/:blockId/plots:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/plots/:id", requirePageRight("crm-auto-project-setup", "delete"), async (req, res) => {
  const plotId = parseInt(req.params.id, 10);
  if (!Number.isFinite(plotId)) return res.status(400).json({ error: "Invalid plot id" });
  try {
    const pool = getPool();
    const blocked = await pool.request().input("pid", sql.Int, plotId).query(`
      SELECT TOP 1 1 AS IsBlocked FROM dbo.CrmBookingPlot WHERE PlotId = @pid AND Status = N'Active'
      UNION ALL
      SELECT TOP 1 1 FROM dbo.CrmApplicationPlot WHERE PlotId = @pid AND Status = N'Active'
      UNION ALL
      SELECT TOP 1 1 FROM dbo.PlotMaster WHERE Id = @pid AND ConvertedUnitId IS NOT NULL
    `);
    if (blocked.recordset.length) return res.status(409).json({ error: "This plot is booked, applied for, or converted and cannot be deleted" });
    const result = await pool.request().input("pid", sql.Int, plotId)
      .query("UPDATE dbo.PlotMaster SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @pid AND IsActive = 1");
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Plot not found" });
    res.json({ success: true, message: "Plot deleted" });
  } catch (e) {
    console.error("[auto-setup] DELETE plot:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Convert one or more adjacent plots into one constructed asset. The source
// plots remain in PlotMaster for land-sale history; UnitMaster begins here.
router.post("/plots/convert", requirePageRight("crm-auto-project-setup", "create"), async (req, res) => {
  const plotIds = Array.isArray(req.body?.PlotIds) ? req.body.PlotIds.map(Number).filter(Number.isInteger) : [];
  const unitName = String(req.body?.UnitName || "").trim();
  const unitType = String(req.body?.UnitType || "").trim();
  const unitKind = String(req.body?.UnitKind || "").trim();
  if (!plotIds.length || !unitName || !unitType || !unitKind) return res.status(400).json({ error: "PlotIds, UnitName, UnitType, and UnitKind are required" });
  // Merging plots into one villa cannot be undone, so it must be asked for
  // explicitly; one villa per plot is the default and needs no flag.
  if (new Set(plotIds).size > 1 && req.body?.Combine !== true) {
    return res.status(400).json({ error: "Several plots make ONE villa only when Combine is confirmed. To build one villa per plot, convert each plot on its own." });
  }
  // The villa's own construction rate. Never the plot's land rate: the plot's
  // owner has already paid for the land, and a villa priced at the land rate
  // would charge them for it again.
  const villaRate = Number(req.body?.RatePerSqFt);
  if (!Number.isFinite(villaRate) || villaRate <= 0) {
    return res.status(400).json({ error: "Enter the villa's construction rate per sq ft — the plot's land rate is not used for the villa." });
  }
  // A villa's built-up area is its own (per villa design), never the land
  // area. Super built-up is optional; when given it is the saleable area, as
  // for flats (AreaSqFt = SBU), otherwise the built-up area is.
  // A villa type (dbo.VillaTypeMaster) supplies the areas a field leaves blank.
  const optArea = (v) => (v != null && v !== "" ? Number(v) : null);
  const villaTypeId = req.body?.VillaTypeId != null && req.body.VillaTypeId !== "" ? Number(req.body.VillaTypeId) : null;
  if (villaTypeId != null && !(Number.isInteger(villaTypeId) && villaTypeId > 0)) return res.status(400).json({ error: "Invalid villa type" });
  let villaType = null;
  if (villaTypeId != null) {
    villaType = (await getPool().request().input("id", sql.Int, villaTypeId)
      .query("SELECT Id, ProjectId, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt FROM dbo.VillaTypeMaster WHERE Id = @id AND IsActive = 1")).recordset[0];
    if (!villaType) return res.status(400).json({ error: "Select an active villa type" });
  }
  const builtUpArea = optArea(req.body?.BuiltUpAreaSqFt ?? req.body?.AreaSqFt) ?? (villaType ? Number(villaType.BuiltUpAreaSqFt) : null);
  const superBuiltUpArea = optArea(req.body?.SuperBuiltUpAreaSqFt)
    ?? (villaType && villaType.SuperBuiltUpAreaSqFt != null ? Number(villaType.SuperBuiltUpAreaSqFt) : null);
  if (builtUpArea == null || !Number.isFinite(builtUpArea) || builtUpArea <= 0) {
    return res.status(400).json({ error: "Built-up area of the villa is required (sq ft)" });
  }
  if (superBuiltUpArea != null && (!Number.isFinite(superBuiltUpArea) || superBuiltUpArea < builtUpArea)) {
    return res.status(400).json({ error: "Super built-up area must be a number not less than the built-up area" });
  }
  try {
    const pool = getPool();
    const kind = await pool.request().input("kind", sql.NVarChar(20), unitKind)
      .query("SELECT Code FROM dbo.CrmConstructedAssetKind WHERE Code = @kind AND IsActive = 1");
    if (!kind.recordset.length) return res.status(400).json({ error: "Select an active constructed asset kind" });
    const resolvedType = await resolveUnitTypeInput(
      pool, { UnitType: unitType }, { requireComposition: true },
    );
    const tx = pool.transaction();
    await tx.begin();
    try {
      // Lock source plots and re-check all inventory claims inside this
      // transaction. UI availability is advisory; this is the authority.
      //
      // A SOLD plot can be built on — that is the business: plot first, the
      // villa after, bought separately by the plot's owner (services/
      // villaLand.js). What must not be built on is a plot whose ownership is
      // still in flux: applied for but not yet booked, or on hold. The owner
      // check below then requires one owner across all the plots.
      const plots = await tx.request().query(`
        SELECT p.Id, p.ProjectId, p.BlockId, p.AreaSqFt, p.RatePerSqFt,
               (SELECT TOP 1 a.CustomerId
                  FROM dbo.CrmBookingPlot bp
                  JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
                  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
                 WHERE bp.PlotId = p.Id AND bp.Status = N'Active'
                   AND b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired')) AS OwnerCustomerId
        FROM dbo.PlotMaster p WITH (UPDLOCK, HOLDLOCK)
        WHERE p.Id IN (${plotIds.join(",")})
          AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM dbo.CrmApplicationPlot ap
            JOIN dbo.CrmApplication a ON a.Id = ap.ApplicationId
            WHERE ap.PlotId = p.Id AND ap.Status = N'Active'
              AND a.IsActive = 1 AND a.Status NOT IN (N'Rejected', N'Cancelled', N'Expired', N'Converted')
              -- An application that already became a booking is ownership,
              -- not an open claim.
              AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking ab WHERE ab.ApplicationId = a.Id AND ab.IsActive = 1
                                AND ab.Status NOT IN (N'Cancelled', N'Rejected', N'Expired'))
          )
          AND NOT EXISTS (
            SELECT 1 FROM dbo.CrmInventoryHold h
            WHERE h.EntityType = N'Plot' AND h.EntityId = p.Id
              AND h.Status = N'Active' AND h.HoldUntil > SYSDATETIME()
          )
      `);
      const owners = new Set(plots.recordset.map((p) => p.OwnerCustomerId ?? "unsold"));
      if (plots.recordset.length === plotIds.length && owners.size > 1) {
        const mixed = new Error("A villa must stand on plots with one owner — these plots belong to different owners, or some are sold and some are not");
        mixed.status = 409;
        throw mixed;
      }
      if (plots.recordset.length !== plotIds.length) {
        const conflict = new Error("One or more plots are applied for but not yet booked, on hold, inactive, or already converted");
        conflict.status = 409;
        throw conflict;
      }
      const first = plots.recordset[0];
      if (!plots.recordset.every((p) => p.ProjectId === first.ProjectId && p.BlockId === first.BlockId)) {
        const invalid = new Error("All converted plots must belong to the same project and block");
        invalid.status = 400;
        throw invalid;
      }
      if (villaType && villaType.ProjectId !== first.ProjectId) {
        const invalid = new Error("The villa type belongs to a different project");
        invalid.status = 400;
        throw invalid;
      }
      if (plotIds.length > 1) {
        const adjacency = await tx.request().query(`
          SELECT PlotId, AdjacentPlotId FROM dbo.PlotAdjacency
          WHERE PlotId IN (${plotIds.join(",")}) AND AdjacentPlotId IN (${plotIds.join(",")})
        `);
        const neighbours = new Map(plotIds.map((id) => [id, new Set()]));
        adjacency.recordset.forEach(({ PlotId, AdjacentPlotId }) => {
          neighbours.get(PlotId)?.add(AdjacentPlotId);
          neighbours.get(AdjacentPlotId)?.add(PlotId);
        });
        const connected = new Set([plotIds[0]]);
        const queue = [plotIds[0]];
        while (queue.length) {
          const current = queue.shift();
          for (const next of neighbours.get(current) || []) {
            if (!connected.has(next)) { connected.add(next); queue.push(next); }
          }
        }
        if (connected.size !== plotIds.length) {
          const invalid = new Error("Selected plots must form one connected adjacent group before conversion");
          invalid.status = 409;
          throw invalid;
        }
      }
      const area = superBuiltUpArea ?? builtUpArea;
      const created = await tx.request()
        .input("pid", sql.Int, first.ProjectId).input("bid", sql.Int, first.BlockId)
        .input("name", sql.NVarChar(100), unitName).input("type", sql.NVarChar(50), resolvedType.unitType)
        .input("layoutTypeId", sql.Int, resolvedType.layoutTypeId)
        .input("kind", sql.NVarChar(20), unitKind)
        .input("area", sql.Decimal(18, 2), area).input("rate", sql.Decimal(18, 2), villaRate)
        .input("bua", sql.Decimal(18, 2), builtUpArea).input("sbu", sql.Decimal(18, 2), superBuiltUpArea)
        .input("villaType", sql.Int, villaType?.Id ?? null)
        .input("by", sql.Int, req.user?.userId || null)
        .query(`INSERT INTO dbo.UnitMaster (ProjectId, BlockId, UnitName, UnitType, LayoutTypeId, UnitKind, AreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, VillaTypeId, RatePerSqFt, IsActive, CreatedBy, CreatedAt)
                OUTPUT INSERTED.Id VALUES (@pid, @bid, @name, @type, @layoutTypeId, @kind, @area, @bua, @sbu, @villaType, @rate, 1, @by, SYSDATETIME())`);
      const unitId = created.recordset[0].Id;
      await syncUnitRooms(tx, unitId, { removeUnused: false, createdBy: req.user?.userId || null });
      await tx.request().input("uid", sql.Int, unitId)
        .query(`UPDATE dbo.PlotMaster SET ConvertedUnitId = @uid, ConvertedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME()
                WHERE Id IN (${plotIds.join(",")})`);
      await tx.commit();
      await bumpCacheVersion("unit-master");
      res.status(201).json({ success: true, UnitId: unitId, PlotIds: plotIds });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (e) {
    if (e instanceof LayoutValidationError) return res.status(400).json({ error: e.message });
    console.error("[auto-setup] POST convert-plots:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
