const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

// UnitMaster.UnitType is free-typed at unit-creation time and stored with a
// space ("3 BHK"), while every layout-type key in this feature is stored
// space-free ("3BHK") — normalize whenever crossing that boundary instead
// of requiring UnitType itself to change format. Custom types (Duplex,
// Penthouse, ...) go through the same normalization: "Duplex" -> "DUPLEX".
function normalizeTypeKey(raw) {
  return String(raw || "").toUpperCase().replace(/\s+/g, "");
}

// A real layout can reasonably have a handful of any one room category —
// even a big custom Duplex/Triplex template — but not a typo like "40
// bedrooms" in a 1BHK. Mirrored client-side in RoomCompositionBuilder.tsx
// so the UI itself never lets a user type past this, but enforced here too
// since that client-side cap can be bypassed by calling this API directly.
const MAX_ROOM_QTY = 10;

// GET /types — every registered layout type (the 4 seeded BHK defaults
// plus any custom ones added via POST /types), for the composition
// builder's picker.
router.get("/types", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT TypeKey AS typeKey, Label AS label, IsSystem AS isSystem
      FROM dbo.RoomLayoutType
      WHERE IsActive = 1
      ORDER BY SortOrder ASC, Label ASC
    `);
    res.json(r.recordset.map((row) => ({ ...row, isSystem: !!row.isSystem })));
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
    const existing = await pool.request().input("typeKey", sql.NVarChar(20), typeKey)
      .query(`SELECT TypeKey, Label FROM dbo.RoomLayoutType WHERE TypeKey = @typeKey`);
    if (existing.recordset.length) {
      // Already registered — hand back the existing one instead of erroring,
      // so re-adding "Duplex" a second time just selects it.
      return res.json({ typeKey: existing.recordset[0].TypeKey, label: existing.recordset[0].Label, isSystem: false });
    }

    const maxSort = await pool.request().query(`SELECT ISNULL(MAX(SortOrder), 40) AS m FROM dbo.RoomLayoutType`);
    const nextSort = (maxSort.recordset[0].m || 40) + 10;

    await pool.request()
      .input("typeKey", sql.NVarChar(20), typeKey)
      .input("label", sql.NVarChar(50), label)
      .input("sortOrder", sql.Int, nextSort)
      .input("createdBy", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder, CreatedBy)
        VALUES (@typeKey, @label, 0, @sortOrder, @createdBy)
      `);

    res.status(201).json({ typeKey, label, isSystem: false });
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
    const configRes = await pool.request().input("typeKey", sql.NVarChar(20), typeKey).query(`
      SELECT Id, BhkType, IsActive FROM dbo.UnitRoomConfig WHERE BhkType = @typeKey
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
      const typeCheck = await pool.request().input("typeKey", sql.NVarChar(20), typeKey)
        .query(`SELECT TypeKey FROM dbo.RoomLayoutType WHERE TypeKey = @typeKey AND IsActive = 1`);
      if (!typeCheck.recordset.length) {
        return res.status(404).json({ error: "This layout type isn't registered — add it first." });
      }

      // One UnitRoomConfig row per layout type — reactivate/update the
      // existing one if it's already there instead of ever creating a
      // duplicate.
      const existing = await pool.request().input("typeKey", sql.NVarChar(20), typeKey)
        .query(`SELECT Id FROM dbo.UnitRoomConfig WHERE BhkType = @typeKey`);

      let configId;
      if (existing.recordset.length) {
        configId = existing.recordset[0].Id;
        await pool.request()
          .input("id", sql.Int, configId)
          .input("updatedBy", sql.NVarChar(200), actor)
          .query(`
            UPDATE dbo.UnitRoomConfig SET IsActive = 1,
              UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
            WHERE Id = @id
          `);
      } else {
        const inserted = await pool.request()
          .input("typeKey", sql.NVarChar(20), typeKey)
          .input("createdBy", sql.NVarChar(200), actor)
          .query(`
            INSERT INTO dbo.UnitRoomConfig (BhkType, IsActive, CreatedBy)
            OUTPUT INSERTED.Id AS id
            VALUES (@typeKey, 1, @createdBy)
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

        await pool.request()
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

      res.json({ success: true, configId });
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
      SELECT UnitType FROM dbo.UnitMaster WHERE Id = @unitId
    `);
    if (!unitRes.recordset.length) return res.status(404).json({ error: "Unit not found" });
    const typeKey = normalizeTypeKey(unitRes.recordset[0].UnitType);
    if (!typeKey) return res.json([]); // no UnitType set on this Unit yet

    const result = await pool.request().input("typeKey", sql.NVarChar(20), typeKey).query(`
      SELECT rc.RoomCategoryId AS categoryId, rc.Quantity AS quantity, cat.Alias AS alias
      FROM dbo.UnitRoomConfig cfg
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE cfg.BhkType = @typeKey AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
      ORDER BY cat.SortOrder ASC, cat.Alias ASC
    `);
    const instances = [];
    for (const row of result.recordset) {
      for (let i = 1; i <= row.quantity; i++) {
        instances.push({ key: `${row.categoryId}-${i}`, label: `${row.alias} ${i}` });
      }
    }
    res.json(instances);
  } catch (err) {
    console.error("[unit-bhk-config] GET /room-instances error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
