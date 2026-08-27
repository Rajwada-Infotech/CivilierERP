const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { isValidShortCode, ensureProjectShortCode } = require("../services/projectShortCode");
const { getBlockLockReason, getFloorLockReason, getBlockHardDeleteBlockers } = require("../services/crmHierarchyLocks");

router.use(authMiddleware);
router.use(apiRateLimit);

// Same vocabulary as parkingSlotMaster.js's own PARKING_TYPES — kept in sync
// by hand (no shared module for it there either) so a type picked in the
// Parking Template here always lands as a valid ParkingType on the real
// dbo.ParkingSlot row.
const PARKING_TYPES = [CrmStatus.OPEN, "Covered", "Stack", "Basement"];

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
        (SELECT COUNT(*) FROM dbo.UnitMaster u WHERE u.BlockId = f.BlockId AND u.FloorNo = f.FloorNo AND u.IsActive = 1) AS GeneratedUnitCount
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
    // invisible here while still showing up in Unit Matrix — flagged to the
    // UI instead of silently doing nothing about them.
    const legacyCount = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT COUNT(*) AS c FROM dbo.UnitMaster u
      JOIN dbo.BlockMaster b ON b.Id = u.BlockId
      WHERE b.ProjectId = @pid AND b.IsActive = 1 AND u.IsActive = 1 AND u.FloorNo IS NULL
    `);

    res.json({
      project: { Id: project.Id, Name: project.Name, ShortCode: shortCode },
      shortCodeValid: isValidShortCode(shortCode),
      legacyUnitCount: legacyCount.recordset[0].c,
      blocks: blocks.recordset,
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
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
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
      await tx.request().input("id", sql.Int, id).query("DELETE FROM dbo.BlockMaster WHERE Id = @id");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmProjectAutoSetupFloor WHERE BlockId = @bid");
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    await bumpCacheVersion("block-master");
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
    const blockId = parseInt(req.params.id, 10);
    const items = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT Id, SortOrder, UnitType, Count, AreaSqFt,
             CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt
      FROM dbo.CrmProjectAutoSetupUnitTemplate
      WHERE BlockId = @bid AND IsActive = 1
      ORDER BY SortOrder
    `);
    const total = items.recordset.reduce((s, r) => s + r.Count, 0);
    res.json({ items: items.recordset, total });
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
    const blockId = parseInt(req.params.id, 10);
    const items = Array.isArray(req.body.Items) ? req.body.Items : [];
    if (!items.length) return res.status(400).json({ error: "At least one Unit Type row is required" });
    for (const it of items) {
      const count = parseInt(it.Count, 10);
      if (!String(it.UnitType || "").trim()) return res.status(400).json({ error: "Every row needs a Unit Type" });
      if (!Number.isFinite(count) || count < 1 || count > 100) return res.status(400).json({ error: "Count must be between 1 and 100" });
    }

    const block = await pool.request().input("id", sql.Int, blockId)
      .query("SELECT Id, ProjectId FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!block.recordset.length) return res.status(404).json({ error: "Block not found" });
    const projectId = block.recordset[0].ProjectId;

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
              (BlockId, SortOrder, UnitType, Count, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt, IsActive, CreatedBy, CreatedAt)
            VALUES (@bid, @so, @type, @count, @area, @carpetArea, @builtUpArea, @superBuiltUpArea, @openTerraceArea, @rate, 1, @cb, SYSDATETIME())
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
              UpdatedAt            = SYSDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (BlockId, UnitType, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, BaseRatePerSqFt)
            VALUES (@bid, @ut, @ca, @bua, @sbu, @ot, @rate);
        `);
    }

    const total = items.reduce((s, it) => s + parseInt(it.Count, 10), 0);
    res.json({ message: "Template saved", total });
  } catch (e) {
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
    const blockId = parseInt(req.params.id, 10);
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
// + 5x Covered), in SortOrder, plus the computed total. Same shape as
// GET /blocks/:id/unit-template. Empty array for a block that hasn't set
// one up yet.
router.get("/blocks/:id/parking-template", requirePageRight("crm-auto-project-setup", "view"), async (req, res) => {
  const pool = getPool();
  try {
    const blockId = parseInt(req.params.id, 10);
    const items = await pool.request().input("bid", sql.Int, blockId).query(`
      SELECT Id, SortOrder, ParkingType, Count
      FROM dbo.CrmProjectAutoSetupParkingTemplate
      WHERE BlockId = @bid AND IsActive = 1
      ORDER BY SortOrder
    `);
    const total = items.recordset.reduce((s, r) => s + r.Count, 0);
    res.json({ items: items.recordset, total });
  } catch (e) {
    console.error("[crm-project-auto-setup] GET /blocks/:id/parking-template error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /blocks/:id/parking-template — replaces the block's whole Parking
// template in one transaction (deactivate-then-reinsert), same pattern as
// PUT /blocks/:id/unit-template.
router.put("/blocks/:id/parking-template", requirePageRight("crm-auto-project-setup", "edit"), async (req, res) => {
  const pool = getPool();
  const updatedBy = req.user?.userId || null;
  try {
    const blockId = parseInt(req.params.id, 10);
    const items = Array.isArray(req.body.Items) ? req.body.Items : [];
    if (!items.length) return res.status(400).json({ error: "At least one Parking Type row is required" });
    for (const it of items) {
      const count = parseInt(it.Count, 10);
      if (!PARKING_TYPES.includes(it.ParkingType)) {
        return res.status(400).json({ error: `Invalid Parking Type. Must be: ${PARKING_TYPES.join(", ")}` });
      }
      if (!Number.isFinite(count) || count < 1 || count > 500) return res.status(400).json({ error: "Count must be between 1 and 500" });
    }

    const block = await pool.request().input("id", sql.Int, blockId)
      .query("SELECT Id FROM dbo.BlockMaster WHERE Id = @id AND IsActive = 1");
    if (!block.recordset.length) return res.status(404).json({ error: "Block not found" });

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
    const blockId = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
    const floor = await pool.request().input("id", sql.Int, id)
      .query("SELECT BlockId, FloorNo FROM dbo.CrmProjectAutoSetupFloor WHERE Id = @id AND IsActive = 1");
    if (!floor.recordset.length) return res.status(404).json({ error: "Floor not found" });
    const { BlockId, FloorNo } = floor.recordset[0];

    const units = await pool.request().input("bid", sql.Int, BlockId).input("fno", sql.Int, FloorNo).query(`
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
    SELECT UnitType, Count, AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt
    FROM dbo.CrmProjectAutoSetupUnitTemplate
    WHERE BlockId = @bid AND IsActive = 1 ORDER BY SortOrder
  `);
  const sequence = [];
  for (const r of rows.recordset) {
    for (let i = 0; i < r.Count; i++) {
      sequence.push({
        UnitType: r.UnitType,
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
    const sample = [];
    const sequenceByBlock = new Map();
    for (const floor of floors.recordset) {
      if (!sequenceByBlock.has(floor.BlockId)) {
        sequenceByBlock.set(floor.BlockId, await getBlockUnitSequence(pool, floor.BlockId));
      }
      const sequence = sequenceByBlock.get(floor.BlockId);

      for (let seq = 1; seq <= floor.UnitCount; seq++) {
        const unitCode = `${floor.FloorLabel}${String(seq).padStart(2, "0")}`;
        const unitName = `${shortCode}/${floor.BlockName}/${unitCode}`;
        const typeSlot = sequence.length ? sequence[(seq - 1) % sequence.length] : null;

        const dupe = await pool.request()
          .input("pid", sql.Int, projectId).input("bid", sql.Int, floor.BlockId).input("name", sql.NVarChar(100), unitName)
          .query("SELECT Id, IsActive FROM dbo.UnitMaster WHERE ProjectId = @pid AND BlockId = @bid AND UnitName = @name");

        if (dupe.recordset.length) {
          if (!dupe.recordset[0].IsActive) {
            await pool.request()
              .input("id",             sql.Int,         dupe.recordset[0].Id)
              .input("fno",            sql.Int,         floor.FloorNo)
              .input("utype",          sql.NVarChar(50),typeSlot?.UnitType || null)
              .input("area",           sql.Decimal(18,2),typeSlot?.AreaSqFt ?? null)
              .input("carpetArea",     sql.Decimal(18,2),typeSlot?.CarpetAreaSqFt ?? null)
              .input("builtUp",        sql.Decimal(18,2),typeSlot?.BuiltUpAreaSqFt ?? null)
              .input("superBuiltUp",   sql.Decimal(18,2),typeSlot?.SuperBuiltUpAreaSqFt ?? null)
              .input("openTerrace",    sql.Decimal(18,2),typeSlot?.OpenTerraceAreaSqFt ?? null)
              .input("rate",           sql.Decimal(18,2),typeSlot?.RatePerSqFt ?? null)
              .query(`UPDATE dbo.UnitMaster SET
                IsActive = 1, FloorNo = @fno,
                UnitType           = ISNULL(UnitType, @utype),
                AreaSqFt           = ISNULL(AreaSqFt, @area),
                CarpetAreaSqFt     = ISNULL(CarpetAreaSqFt, @carpetArea),
                BuiltUpAreaSqFt    = ISNULL(BuiltUpAreaSqFt, @builtUp),
                SuperBuiltUpAreaSqFt = ISNULL(SuperBuiltUpAreaSqFt, @superBuiltUp),
                OpenTerraceAreaSqFt  = ISNULL(OpenTerraceAreaSqFt, @openTerrace),
                RatePerSqFt          = ISNULL(RatePerSqFt, @rate),
                UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
            totalCreated++;
          }
          // Already active — leave it alone, it's already real inventory.
        } else {
          await pool.request()
            .input("pid",          sql.Int,          projectId)
            .input("bid",          sql.Int,          floor.BlockId)
            .input("name",         sql.NVarChar(100),unitName)
            .input("fno",          sql.Int,          floor.FloorNo)
            .input("utype",        sql.NVarChar(50), typeSlot?.UnitType || null)
            .input("area",         sql.Decimal(18,2),typeSlot?.AreaSqFt ?? null)
            .input("carpetArea",   sql.Decimal(18,2),typeSlot?.CarpetAreaSqFt ?? null)
            .input("builtUp",      sql.Decimal(18,2),typeSlot?.BuiltUpAreaSqFt ?? null)
            .input("superBuiltUp", sql.Decimal(18,2),typeSlot?.SuperBuiltUpAreaSqFt ?? null)
            .input("openTerrace",  sql.Decimal(18,2),typeSlot?.OpenTerraceAreaSqFt ?? null)
            .input("rate",         sql.Decimal(18,2),typeSlot?.RatePerSqFt ?? null)
            .input("cb",           sql.Int,          createdBy)
            .query(`
              INSERT INTO dbo.UnitMaster
                (ProjectId, BlockId, UnitName, FloorNo, UnitType,
                 AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt, RatePerSqFt,
                 IsActive, CreatedBy, CreatedAt)
              VALUES
                (@pid, @bid, @name, @fno, @utype,
                 @area, @carpetArea, @builtUp, @superBuiltUp, @openTerrace, @rate,
                 1, @cb, SYSDATETIME())
            `);
          totalCreated++;
        }
        if (sample.length < 5) sample.push(unitName);
      }

      await pool.request().input("id", sql.Int, floor.Id)
        .query("UPDATE dbo.CrmProjectAutoSetupFloor SET IsGenerated = 1, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }

    if (totalCreated > 0) await bumpCacheVersion("unit-master");
    res.status(201).json({ message: "Units generated", createdCount: totalCreated, sample, floorsGenerated: floors.recordset.length });
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

        const dupe = await pool.request()
          .input("pid", sql.Int, projectId).input("bid", sql.Int, block.BlockId).input("slot", sql.NVarChar(50), slotNo)
          .query("SELECT Id, IsActive FROM dbo.ParkingSlot WHERE ProjectId = @pid AND BlockId = @bid AND SlotNo = @slot");

        if (dupe.recordset.length) {
          if (!dupe.recordset[0].IsActive) {
            await pool.request().input("id", sql.Int, dupe.recordset[0].Id).input("type", sql.NVarChar(50), parkingType)
              .query("UPDATE dbo.ParkingSlot SET IsActive = 1, ParkingType = ISNULL(ParkingType, @type), UpdatedAt = SYSDATETIME() WHERE Id = @id");
            totalCreated++;
          }
          // Already active — leave it alone, it's already real inventory.
        } else {
          await pool.request()
            .input("pid", sql.Int, projectId).input("bid", sql.Int, block.BlockId)
            .input("slot", sql.NVarChar(50), slotNo).input("type", sql.NVarChar(50), parkingType)
            .input("cb", sql.Int, createdBy)
            .query(`
              INSERT INTO dbo.ParkingSlot (ProjectId, BlockId, SlotNo, ParkingType, IsActive, CreatedBy, CreatedAt)
              VALUES (@pid, @bid, @slot, @type, 1, @cb, SYSDATETIME())
            `);
          totalCreated++;
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

module.exports = router;
