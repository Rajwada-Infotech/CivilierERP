const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
// UnitMaster.UnitType is stored with a space ("3 BHK"), every layout-type
// key space-free ("3BHK") — normalizeTypeKey crosses that boundary. Shared
// with every other route through services/unitLayout.js.
const {
  normalizeTypeKey,
  listLayoutTypes,
  resolveLayoutType,
  getLayoutComposition,
  syncRoomsForUnits,
  bumpFlatMasterCaches,
} = require("../services/unitLayout");

// A real layout can reasonably have a handful of any one room category —
// even a big custom Duplex/Triplex template — but not a typo like "40
// bedrooms" in a 1BHK. Mirrored client-side in RoomCompositionBuilder.tsx
// so the UI itself never lets a user type past this, but enforced here too
// since that client-side cap can be bypassed by calling this API directly.
const MAX_ROOM_QTY = 10;

// GET /types — every registered layout type (the seeded BHK defaults plus
// any custom ones added via POST /types), each with its id (the value
// UnitMaster.LayoutTypeId / the CRM auto-setup template store), how many
// rooms its composition has, and a one-line summary. roomCount = 0 means
// no layout defined yet — CRM Auto Setup and Unit Master only offer types
// with roomCount > 0 for new picks.
router.get("/types", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const types = await listLayoutTypes(pool);
    res.json(types.map((t) => ({
      id: t.id,
      typeKey: t.typeKey,
      label: t.label,
      roomCount: t.roomCount,
      summary: t.summary,
    })));
  } catch (err) {
    console.error("[unit-bhk-config] GET /types error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /types — register a new custom layout type (e.g. "Duplex"). The 4
// seeded defaults already exist and never need re-adding; this is only for
// anything beyond them.
router.post("/types", authMiddleware, requirePageRight("room-composition-builder", "create"), async (req, res) => {
  const label = String(req.body?.label || "").trim();
  if (!label) return res.status(400).json({ error: "label is required" });
  if (label.length > 50) return res.status(400).json({ error: "label must be 50 characters or fewer" });

  const typeKey = normalizeTypeKey(label);
  if (!typeKey) return res.status(400).json({ error: "label must contain at least one letter or number" });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const existing = await pool.request().input("typeKey", sql.NVarChar(50), typeKey)
      .query(`SELECT Id, TypeKey, Label FROM dbo.RoomLayoutType WHERE TypeKey = @typeKey`);
    if (existing.recordset.length) {
      // Already registered — hand back the existing one instead of erroring,
      // so re-adding "Duplex" a second time just selects it.
      const row = existing.recordset[0];
      return res.json({ id: row.Id, typeKey: row.TypeKey, label: row.Label });
    }

    const maxSort = await pool.request().query(`SELECT ISNULL(MAX(SortOrder), 40) AS m FROM dbo.RoomLayoutType`);
    const nextSort = (maxSort.recordset[0].m || 40) + 10;

    const inserted = await pool.request()
      .input("typeKey", sql.NVarChar(50), typeKey)
      .input("label", sql.NVarChar(50), label)
      .input("sortOrder", sql.Int, nextSort)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder, CreatedBy)
        OUTPUT INSERTED.Id AS id
        VALUES (@typeKey, @label, 0, @sortOrder, @createdBy)
      `);

    res.status(201).json({ id: inserted.recordset[0].id, typeKey, label });
  } catch (err) {
    console.error("[unit-bhk-config] POST /types error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /template/:bhkType — the composition template for one layout type,
// used to pre-fill the composition builder when re-opening a type that
// already has one. Returns config: null when nothing has been set up yet.
router.get("/template/:bhkType", authMiddleware, async (req, res) => {
  const typeKey = normalizeTypeKey(req.params.bhkType);
  if (!typeKey) return res.status(400).json({ error: "Invalid layout type" });

  try {
    const pool = await getPool();
    // Same lookup order as POST: the FK-linked config first, the BhkType
    // text match only for a legacy row without LayoutTypeId.
    const configRes = await pool.request().input("typeKey", sql.NVarChar(50), typeKey).query(`
      SELECT TOP 1 cfg.Id, cfg.BhkType, cfg.IsActive
      FROM dbo.UnitRoomConfig cfg
      LEFT JOIN dbo.RoomLayoutType lt ON lt.Id = cfg.LayoutTypeId
      WHERE lt.TypeKey = @typeKey OR (cfg.LayoutTypeId IS NULL AND cfg.BhkType = @typeKey)
      ORDER BY CASE WHEN cfg.LayoutTypeId IS NOT NULL THEN 0 ELSE 1 END, cfg.Id
    `);
    const config = configRes.recordset[0] || null;
    if (!config) return res.json({ config: null, composition: [] });

    const compRes = await pool.request().input("configId", sql.Int, config.Id).query(`
      SELECT rc.RoomCategoryId AS roomCategoryId, rc.Quantity AS quantity,
             cat.Alias AS alias, cat.SortOrder AS sortOrder, cat.IsActive AS categoryIsActive
      FROM dbo.RoomComposition rc
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE rc.UnitRoomConfigId = @configId
      ORDER BY cat.SortOrder ASC, cat.Alias ASC
    `);
    res.json({
      config: { id: config.Id, bhkType: config.BhkType, isActive: !!config.IsActive },
      composition: compRes.recordset,
    });
  } catch (err) {
    console.error("[unit-bhk-config] GET /template error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /template/:bhkType — upsert the composition template for one layout
// type in one save. Quantity=0 rows are kept (not deleted) so a category
// that was dialled down to 0 and back up doesn't need to be re-added to
// the table — same "row exists but counts to nothing" convention as
// everywhere else in this app that soft-tracks quantities.
router.post(
  "/template/:bhkType",
  authMiddleware,
  requirePageRight("room-composition-builder", "create"),
  async (req, res) => {
    const typeKey = normalizeTypeKey(req.params.bhkType);
    if (!typeKey) return res.status(400).json({ error: "Invalid layout type" });
    const { composition } = req.body;
    const actor = req.user?.email || req.user?.name || "system";

    if (!Array.isArray(composition)) {
      return res.status(400).json({ error: "composition must be an array" });
    }
    const overLimit = composition.find((row) => parseInt(row.quantity, 10) > MAX_ROOM_QTY);
    if (overLimit) {
      return res.status(400).json({ error: `A room category can have at most ${MAX_ROOM_QTY} rooms in one layout.` });
    }

    try {
      const pool = await getPool();

      // Layout type must already be registered (via GET /types' seeded
      // defaults or POST /types) — saving against an unregistered key would
      // create an orphan template no picker ever shows again.
      const typeCheck = await pool.request().input("typeKey", sql.NVarChar(50), typeKey)
        .query(`SELECT Id FROM dbo.RoomLayoutType WHERE TypeKey = @typeKey AND IsActive = 1`);
      if (!typeCheck.recordset.length) {
        return res.status(404).json({ error: "This layout type isn't registered — add it first." });
      }
      const layoutTypeId = typeCheck.recordset[0].Id;

      // Config row + its composition rows are one atomic save.
      const tx = pool.transaction();
      await tx.begin();
      let configId;
      try {
        // One UnitRoomConfig row per layout type (UX_UnitRoomConfig_LayoutType)
        // — reactivate/update the existing one instead of ever creating a
        // duplicate. BhkType match is the fallback for a legacy row that
        // didn't get LayoutTypeId backfilled.
        const existing = await tx.request()
          .input("layoutTypeId", sql.Int, layoutTypeId)
          .input("typeKey", sql.NVarChar(50), typeKey)
          .query(`
            SELECT TOP 1 Id FROM dbo.UnitRoomConfig
            WHERE LayoutTypeId = @layoutTypeId OR (LayoutTypeId IS NULL AND BhkType = @typeKey)
            ORDER BY CASE WHEN LayoutTypeId IS NOT NULL THEN 0 ELSE 1 END, Id
          `);

        if (existing.recordset.length) {
          configId = existing.recordset[0].Id;
          await tx.request()
            .input("id", sql.Int, configId)
            .input("layoutTypeId", sql.Int, layoutTypeId)
            .input("updatedBy", sql.NVarChar(200), actor)
            .query(`
              UPDATE dbo.UnitRoomConfig SET IsActive = 1, LayoutTypeId = @layoutTypeId,
                UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
              WHERE Id = @id
            `);
        } else {
          const inserted = await tx.request()
            .input("typeKey", sql.NVarChar(50), typeKey)
            .input("layoutTypeId", sql.Int, layoutTypeId)
            .input("createdBy", sql.NVarChar(200), actor)
            .query(`
              INSERT INTO dbo.UnitRoomConfig (BhkType, LayoutTypeId, IsActive, CreatedBy)
              OUTPUT INSERTED.Id AS id
              VALUES (@typeKey, @layoutTypeId, 1, @createdBy)
            `);
          configId = inserted.recordset[0].id;
        }

        // Every active category must be represented, even at quantity 0 —
        // categories not present in the payload (e.g. one deactivated between
        // page-load and save) are simply skipped rather than erroring the
        // whole save.
        for (const row of composition) {
          const categoryId = parseInt(row.roomCategoryId, 10);
          const quantity = Math.max(0, parseInt(row.quantity, 10) || 0);
          if (!Number.isFinite(categoryId)) continue;

          await tx.request()
            .input("configId", sql.Int, configId)
            .input("categoryId", sql.Int, categoryId)
            .input("quantity", sql.Int, quantity)
            .query(`
              MERGE dbo.RoomComposition AS tgt
              USING (SELECT @configId AS UnitRoomConfigId, @categoryId AS RoomCategoryId) AS src
              ON tgt.UnitRoomConfigId = src.UnitRoomConfigId AND tgt.RoomCategoryId = src.RoomCategoryId
              WHEN MATCHED THEN UPDATE SET Quantity = @quantity, UpdatedAt = SYSDATETIME()
              WHEN NOT MATCHED THEN INSERT (UnitRoomConfigId, RoomCategoryId, Quantity)
                VALUES (@configId, @categoryId, @quantity);
            `);
        }
        await tx.commit();
      } catch (e) {
        try { await tx.rollback(); } catch (_) { /* already rolled back */ }
        throw e;
      }

      // Propagate to units that already have their rooms built: ADD any room
      // the new composition calls for (e.g. a 2nd Bathroom), never remove
      // one — an existing room may already have DPR work/blueprints on it.
      // Units whose rooms haven't been generated yet are left to Room
      // Master's bulk "Generate rooms" action.
      const affected = await pool.request()
        .input("layoutTypeId", sql.Int, layoutTypeId)
        .input("typeKey", sql.NVarChar(50), typeKey)
        .query(`
          SELECT u.Id FROM dbo.UnitMaster u
          WHERE u.IsActive = 1
            AND (u.LayoutTypeId = @layoutTypeId
                 OR (u.LayoutTypeId IS NULL AND UPPER(REPLACE(LTRIM(RTRIM(u.UnitType)), ' ', '')) = @typeKey))
            AND EXISTS (SELECT 1 FROM dbo.RoomMaster r WHERE r.UnitId = u.Id AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL)
        `);
      const sync = await syncRoomsForUnits(pool, affected.recordset.map((r) => r.Id), { removeUnused: false, createdBy: req.user?.userId || null });
      if (sync.created || sync.reactivated || sync.renamed) await bumpFlatMasterCaches();
      if (sync.failed.length) console.error("[unit-bhk-config] POST /template room sync failures:", sync.failed);

      res.json({
        success: true,
        configId,
        roomSync: {
          unitsChecked: sync.units,
          unitsUpdated: sync.unitsChanged,
          roomsAdded: sync.created + sync.reactivated,
          failed: sync.failed.length,
        },
      });
    } catch (err) {
      console.error("[unit-bhk-config] POST /template error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /room-instances/:unitId — the Work Reporting page's Room dropdown
// source. Resolves the Unit's own UnitType (dbo.UnitMaster, e.g. "3 BHK"
// or a custom "Duplex") to the matching layout template, then generates
// {alias} {index} instances (Bathroom 1, Bathroom 2, ...) for every active
// category with Quantity > 0 in it, using the CURRENT Alias at render time
// — so a renamed category shows the new name immediately without touching
// any stored composition data. No stable per-instance ID exists (there's
// no per-room table, just a quantity count on the template), so the key
// returned is a synthetic "<categoryId>-<index>" for use as a form value /
// React key only.
router.get("/room-instances/:unitId", authMiddleware, async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unitId" });

  try {
    const pool = await getPool();

    const unitRes = await pool.request().input("unitId", sql.Int, unitId).query(`
      SELECT UnitType, LayoutTypeId FROM dbo.UnitMaster WHERE Id = @unitId
    `);
    if (!unitRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const unit = unitRes.recordset[0];
    // LayoutTypeId (FK) first; the UnitType text match only for a unit that
    // predates migration 477's backfill.
    const layout = unit.LayoutTypeId
      ? await resolveLayoutType(pool, { layoutTypeId: unit.LayoutTypeId })
      : await resolveLayoutType(pool, { unitType: unit.UnitType });
    if (!layout) return res.json([]); // no (registered) Unit Type set on this Unit yet

    const composition = await getLayoutComposition(pool, layout.id);
    const instances = [];
    for (const row of composition) {
      for (let i = 1; i <= row.quantity; i++) {
        // Mirror the label convention used by POST /generate/:unitId — omit
        // the numeric suffix when there is only one of this category (e.g.
        // "Kitchen" not "Kitchen 1"). Previously always appended the index,
        // so WorkDone's "Kitchen 1" never matched RoomMaster's "Kitchen".
        instances.push({
          key: `${row.categoryId}-${i}`,
          label: row.quantity > 1 ? `${row.alias} ${i}` : row.alias,
        });
      }
    }

    // SYNC-1 bridge: look up the real dbo.RoomMaster.Id for each synthetic
    // instance by matching on UnitId + RoomName. This lets callers (e.g.
    // WorkDone) record the stable integer FK alongside the ephemeral
    // "categoryId-index" key — enabling blueprints, Dependency Master, and
    // future features to cross-reference work entries with actual room rows.
    // roomMasterId will be null if Generate hasn't been run yet for this unit.
    if (instances.length > 0) {
      const namesParam = instances.map((_, idx) => `@n${idx}`).join(", ");
      const rmReq = pool.request().input("unitId", sql.Int, unitId);
      instances.forEach((inst, idx) => rmReq.input(`n${idx}`, sql.NVarChar(160), inst.label));
      const rmRes = await rmReq.query(`
        SELECT Id, RoomName FROM dbo.RoomMaster
        WHERE UnitId = @unitId AND IsActive = 1 AND RoomName IN (${namesParam})
      `);
      const nameToId = new Map(rmRes.recordset.map((r) => [r.RoomName.toLowerCase(), r.Id]));
      for (const inst of instances) {
        inst.roomMasterId = nameToId.get(inst.label.toLowerCase()) ?? null;
      }
    }

    res.json(instances);
  } catch (err) {
    console.error("[unit-bhk-config] GET /room-instances error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

