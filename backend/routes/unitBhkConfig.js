const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

const BHK_TYPES = ["1BHK", "2BHK", "3BHK", "4BHK"];

// GET /for-unit/:unitId — the BHK profile + saved composition for one Unit,
// used to pre-fill the composition builder when re-opening a Unit that
// already has one. Returns config: null when nothing has been set up yet.
router.get("/for-unit/:unitId", authMiddleware, async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unitId" });

  try {
    const pool = await getPool();
    const configRes = await pool.request().input("unitId", sql.Int, unitId).query(`
      SELECT Id, BhkType, IsActive FROM dbo.UnitRoomConfig WHERE UnitId = @unitId
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
    console.error("[unit-bhk-config] GET /for-unit error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /for-unit/:unitId — upsert the BHK profile + composition rows in
// one save. Quantity=0 rows are kept (not deleted) so a category that was
// dialled down to 0 and back up doesn't need to be re-added to the table —
// same "row exists but counts to nothing" convention as everywhere else in
// this app that soft-tracks quantities.
router.post(
  "/for-unit/:unitId",
  authMiddleware,
  requirePageRight("room-composition-builder", "create"),
  async (req, res) => {
    const unitId = parseInt(req.params.unitId, 10);
    if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unitId" });
    const { bhkType, composition } = req.body;
    const actor = req.user?.email || req.user?.name || "system";

    if (!BHK_TYPES.includes(bhkType)) {
      return res.status(400).json({ error: `bhkType must be one of ${BHK_TYPES.join(", ")}` });
    }
    if (!Array.isArray(composition)) {
      return res.status(400).json({ error: "composition must be an array" });
    }

    try {
      const pool = await getPool();

      const unitCheck = await pool.request().input("unitId", sql.Int, unitId)
        .query(`SELECT Id FROM dbo.UnitMaster WHERE Id = @unitId`);
      if (!unitCheck.recordset.length) return res.status(404).json({ error: "Unit not found" });

      // One UnitRoomConfig row per Unit — reactivate/update the existing
      // one if it's already there (same dedupe-then-update pattern as
      // blockMaster.js/unitMaster.js) instead of ever creating a duplicate.
      const existing = await pool.request().input("unitId", sql.Int, unitId)
        .query(`SELECT Id FROM dbo.UnitRoomConfig WHERE UnitId = @unitId`);

      let configId;
      if (existing.recordset.length) {
        configId = existing.recordset[0].Id;
        await pool.request()
          .input("id", sql.Int, configId)
          .input("bhkType", sql.NVarChar(10), bhkType)
          .input("updatedBy", sql.NVarChar(200), actor)
          .query(`
            UPDATE dbo.UnitRoomConfig SET BhkType = @bhkType, IsActive = 1,
              UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
            WHERE Id = @id
          `);
      } else {
        const inserted = await pool.request()
          .input("unitId", sql.Int, unitId)
          .input("bhkType", sql.NVarChar(10), bhkType)
          .input("createdBy", sql.NVarChar(200), actor)
          .query(`
            INSERT INTO dbo.UnitRoomConfig (UnitId, BhkType, IsActive, CreatedBy)
            OUTPUT INSERTED.Id AS id
            VALUES (@unitId, @bhkType, 1, @createdBy)
          `);
        configId = inserted.recordset[0].id;
      }

      // Every active category must be represented, even at quantity 0 — the
      // acceptance criteria explicitly wants a graceful reduction, not a
      // deleted/re-added row (see the RoomCategoryMaster deactivate note
      // above for the mirror case). Categories not present in the payload
      // (e.g. one that was deactivated between page-load and save) are
      // simply skipped rather than erroring the whole save.
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
      console.error("[unit-bhk-config] POST /for-unit error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /room-instances/:unitId — the Work Done page's Room dropdown source.
// Generates {alias} {index} instances (Bathroom 1, Bathroom 2, ...) for
// every active category with Quantity > 0, using the CURRENT Alias at
// render time — so a renamed category shows the new name immediately
// without touching any stored composition data. No stable per-instance ID
// exists yet (there's no per-room table, just a quantity count), so the
// key returned is a synthetic "<categoryId>-<index>" for use as a form
// value / React key only.
router.get("/room-instances/:unitId", authMiddleware, async (req, res) => {
  const unitId = parseInt(req.params.unitId, 10);
  if (!Number.isFinite(unitId)) return res.status(400).json({ error: "Invalid unitId" });

  try {
    const pool = await getPool();
    const result = await pool.request().input("unitId", sql.Int, unitId).query(`
      SELECT rc.RoomCategoryId AS categoryId, rc.Quantity AS quantity, cat.Alias AS alias
      FROM dbo.UnitRoomConfig cfg
      JOIN dbo.RoomComposition rc ON rc.UnitRoomConfigId = cfg.Id
      JOIN dbo.RoomCategoryMaster cat ON cat.Id = rc.RoomCategoryId
      WHERE cfg.UnitId = @unitId AND cfg.IsActive = 1 AND cat.IsActive = 1 AND rc.Quantity > 0
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
