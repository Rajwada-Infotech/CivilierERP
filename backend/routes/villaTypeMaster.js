// Villa Type master — the villa designs a plotted layout offers (migration 525).
//
// Each design carries its own built-up area (and optionally base land area and
// super built-up area), so converting plots to a villa takes the areas from the
// design instead of having them typed, or guessed from the land area.
// Types belong to one project. Plots plan a type (PlotMaster.PlannedVillaTypeId)
// and a converted villa records the type it was built to (UnitMaster.VillaTypeId).

const express = require("express");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

const router = express.Router();
const PAGE = "crm-auto-project-setup";

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function area(value, label, { required = false } = {}) {
  if (value === null || value === undefined || value === "") return required ? { error: `${label} is required` } : { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { error: `${label} must be a positive number of sq ft` };
  return { value: Math.round(n * 100) / 100 };
}

function parseBody(b) {
  const code = String(b?.Code || "").trim();
  const name = String(b?.Name || "").trim();
  if (!code || code.length > 20) return { error: "Code is required and must be 20 characters or fewer" };
  if (!name || name.length > 100) return { error: "Name is required and must be 100 characters or fewer" };
  const land = area(b?.BaseLandAreaSqFt, "Base land area");
  const bua = area(b?.BuiltUpAreaSqFt, "Built-up area", { required: true });
  const sbu = area(b?.SuperBuiltUpAreaSqFt, "Super built-up area");
  for (const r of [land, bua, sbu]) if (r.error) return r;
  if (sbu.value != null && sbu.value < bua.value) return { error: "Super built-up area cannot be less than the built-up area" };
  const layoutTypeId = b?.LayoutTypeId == null || b.LayoutTypeId === "" ? null : parseId(b.LayoutTypeId);
  if (b?.LayoutTypeId != null && b.LayoutTypeId !== "" && layoutTypeId == null) return { error: "Invalid layout" };
  let sort = 100;
  if (b?.SortOrder != null && b.SortOrder !== "") {
    sort = parseInt(b.SortOrder, 10);
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) return { error: "Sort order must be a whole number from 0 to 9999" };
  }
  return { code, name, land: land.value, bua: bua.value, sbu: sbu.value, layoutTypeId, sort };
}

const SELECT = `
  SELECT v.Id, v.ProjectId, v.Code, v.Name, v.LayoutTypeId, l.Label AS LayoutLabel,
         v.BaseLandAreaSqFt, v.BuiltUpAreaSqFt, v.SuperBuiltUpAreaSqFt, v.SortOrder, v.IsActive,
         (SELECT COUNT(*) FROM dbo.PlotMaster p WHERE p.PlannedVillaTypeId = v.Id AND p.IsActive = 1) AS PlotCount,
         (SELECT COUNT(*) FROM dbo.UnitMaster u WHERE u.VillaTypeId = v.Id AND u.IsActive = 1) AS VillaCount,
         -- the floor plan (migration 539): when set, the type's layout is its own, built from it
         CAST(CASE WHEN l.OwnerVillaTypeId = v.Id THEN 1 ELSE 0 END AS BIT) AS HasFloorPlan,
         (SELECT ISNULL(SUM(rp.Quantity), 0) FROM dbo.VillaTypeRoomPlan rp WHERE rp.VillaTypeId = v.Id) AS PlanRoomCount,
         (SELECT COUNT(DISTINCT rp.Storey) FROM dbo.VillaTypeRoomPlan rp WHERE rp.VillaTypeId = v.Id) AS PlanFloorCount
  FROM dbo.VillaTypeMaster v
  LEFT JOIN dbo.RoomLayoutType l ON l.Id = v.LayoutTypeId
`;

router.get("/", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = parseId(req.query.projectId);
  if (projectId == null) return res.status(400).json({ error: "projectId is required" });
  try {
    const where = `WHERE v.ProjectId = @p${req.query.all === "1" ? "" : " AND v.IsActive = 1"}`;
    const r = await getPool().request().input("p", sql.Int, projectId).query(`${SELECT} ${where} ORDER BY v.SortOrder, v.Code`);
    res.json(r.recordset);
  } catch (e) {
    console.error("[villa-type-master] GET:", e.message);
    res.status(500).json({ error: "Failed to load villa types" });
  }
});

async function checkLayout(pool, layoutTypeId) {
  if (layoutTypeId == null) return null;
  const r = await pool.request().input("id", sql.Int, layoutTypeId).query("SELECT Id FROM dbo.RoomLayoutType WHERE Id = @id AND IsActive = 1");
  return r.recordset.length ? null : "Select an active room layout";
}

async function codeTaken(pool, projectId, code, exceptId = null) {
  const r = await pool.request().input("p", sql.Int, projectId).input("c", sql.NVarChar(20), code).input("id", sql.Int, exceptId ?? 0)
    .query("SELECT TOP 1 Id FROM dbo.VillaTypeMaster WHERE ProjectId = @p AND Code = @c AND IsActive = 1 AND Id <> @id");
  return r.recordset.length > 0;
}

router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  const projectId = parseId(req.body?.ProjectId);
  if (projectId == null) return res.status(400).json({ error: "Project is required" });
  const v = parseBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const pool = getPool();
    const project = await pool.request().input("p", sql.Int, projectId).query("SELECT id FROM dbo.enterprise WHERE id = @p");
    if (!project.recordset.length) return res.status(400).json({ error: "Project not found" });
    const layoutError = await checkLayout(pool, v.layoutTypeId);
    if (layoutError) return res.status(400).json({ error: layoutError });
    if (await codeTaken(pool, projectId, v.code)) return res.status(409).json({ error: `Villa type "${v.code}" already exists in this project` });
    const r = await pool.request()
      .input("p", sql.Int, projectId).input("code", sql.NVarChar(20), v.code).input("name", sql.NVarChar(100), v.name)
      .input("layout", sql.Int, v.layoutTypeId).input("land", sql.Decimal(18, 2), v.land)
      .input("bua", sql.Decimal(18, 2), v.bua).input("sbu", sql.Decimal(18, 2), v.sbu)
      .input("sort", sql.Int, v.sort).input("by", sql.Int, req.user?.userId || null)
      .query(`INSERT INTO dbo.VillaTypeMaster (ProjectId, Code, Name, LayoutTypeId, BaseLandAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, SortOrder, CreatedBy)
              OUTPUT INSERTED.Id VALUES (@p, @code, @name, @layout, @land, @bua, @sbu, @sort, @by)`);
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) return res.status(409).json({ error: "That villa type code is already taken in this project" });
    console.error("[villa-type-master] POST:", e.message);
    res.status(500).json({ error: "Failed to create the villa type" });
  }
});

// Editing a type changes what future conversions default to. Villas already
// built keep the areas they were created with (they are on UnitMaster).
router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const v = parseBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const wantsActive = !(req.body?.IsActive === false || req.body?.IsActive === 0 || req.body?.IsActive === "false");
  try {
    const pool = getPool();
    const cur = await pool.request().input("id", sql.Int, id).query("SELECT ProjectId FROM dbo.VillaTypeMaster WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Villa type not found" });
    const projectId = cur.recordset[0].ProjectId;
    const layoutError = await checkLayout(pool, v.layoutTypeId);
    if (layoutError) return res.status(400).json({ error: layoutError });
    // A type with a floor plan owns its layout (built from the plan); a
    // different layout here would leave its rooms out of step with the plan.
    const owned = (await pool.request().input("id", sql.Int, id).query(
      "SELECT TOP 1 l.Id FROM dbo.VillaTypeMaster v JOIN dbo.RoomLayoutType l ON l.Id = v.LayoutTypeId AND l.OwnerVillaTypeId = v.Id WHERE v.Id = @id")).recordset[0];
    if (owned && v.layoutTypeId !== owned.Id) {
      return res.status(400).json({ error: "This villa type's rooms come from its floor plan — change them with Rooms, not the layout." });
    }
    if (wantsActive && await codeTaken(pool, projectId, v.code, id)) return res.status(409).json({ error: `Villa type "${v.code}" already exists in this project` });
    if (!wantsActive) {
      const used = await pool.request().input("id", sql.Int, id)
        .query("SELECT COUNT(*) AS n FROM dbo.PlotMaster WHERE PlannedVillaTypeId = @id AND IsActive = 1 AND ConvertedUnitId IS NULL");
      if (used.recordset[0].n > 0) return res.status(400).json({ error: `Planned on ${used.recordset[0].n} unconverted plot(s) — change those plots first.` });
    }
    await pool.request()
      .input("id", sql.Int, id).input("code", sql.NVarChar(20), v.code).input("name", sql.NVarChar(100), v.name)
      .input("layout", sql.Int, v.layoutTypeId).input("land", sql.Decimal(18, 2), v.land)
      .input("bua", sql.Decimal(18, 2), v.bua).input("sbu", sql.Decimal(18, 2), v.sbu)
      .input("sort", sql.Int, v.sort).input("active", sql.Bit, wantsActive ? 1 : 0).input("by", sql.Int, req.user?.userId || null)
      .query(`UPDATE dbo.VillaTypeMaster
              SET Code = @code, Name = @name, LayoutTypeId = @layout, BaseLandAreaSqFt = @land, BuiltUpAreaSqFt = @bua,
                  SuperBuiltUpAreaSqFt = @sbu, SortOrder = @sort, IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
    res.json({ success: true });
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) return res.status(409).json({ error: "That villa type code is already taken in this project" });
    console.error("[villa-type-master] PUT:", e.message);
    res.status(500).json({ error: "Failed to update the villa type" });
  }
});

// Soft delete; refused while unconverted plots still plan this type.
router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const used = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS n FROM dbo.PlotMaster WHERE PlannedVillaTypeId = @id AND IsActive = 1 AND ConvertedUnitId IS NULL");
    if (used.recordset[0].n > 0) return res.status(400).json({ error: `Planned on ${used.recordset[0].n} unconverted plot(s) — change those plots first.` });
    const r = await pool.request().input("id", sql.Int, id).input("by", sql.Int, req.user?.userId || null)
      .query("UPDATE dbo.VillaTypeMaster SET IsActive = 0, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id AND IsActive = 1");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Villa type not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[villa-type-master] DELETE:", e.message);
    res.status(500).json({ error: "Failed to remove the villa type" });
  }
});

// GET /dpr-ready-categories?projectId= — room types that already have a DPR
// step list (an active chain with steps), this project's first. A room of any
// other type gets no DPR steps when a villa is built, so the plan editor
// flags it before the plan is saved.
router.get("/dpr-ready-categories", requirePageRight(PAGE, "view"), async (req, res) => {
  const projectId = parseId(req.query.projectId);
  try {
    const r = await getPool().request().input("p", sql.Int, projectId).query(`
      SELECT r.RoomCategoryId AS categoryId, MAX(CASE WHEN d.ProjectId = @p THEN 1 ELSE 0 END) AS inProject
      FROM dbo.DependencyMaster d JOIN dbo.RoomMaster r ON r.Id = d.RoomId
      WHERE d.IsActive = 1 AND r.RoomCategoryId IS NOT NULL
        AND EXISTS (SELECT 1 FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d.Id)
      GROUP BY r.RoomCategoryId`);
    res.json(r.recordset);
  } catch (e) {
    console.error("[villa-type-master] GET dpr-ready-categories:", e.message);
    res.status(500).json({ error: "Failed to load DPR readiness" });
  }
});

// ── Rooms by floor (migration 539) ───────────────────────────────────────────
// GET /:id/plan — the villa type's rooms on each of its floors.
router.get("/:id/plan", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid villa type" });
  try {
    res.json({ rooms: await require("../services/villaComposition").getPlan(getPool(), id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/plan { rooms: [{ storey, categoryId, quantity }] } — saves the
// plan, rebuilds the type's own room layout from it, and brings every villa
// already built to this type in line: missing rooms are added (with their
// DPR steps) and every room gets its floor. Rooms are never removed here —
// a room no longer in the plan is kept and reported by the DPR health check.
router.put("/:id/plan", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid villa type" });
  const { savePlan, applyStoreys, VillaPlanError } = require("../services/villaComposition");
  const { syncUnitRooms, bumpFlatMasterCaches } = require("../services/unitLayout");
  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const saved = await savePlan(tx, id, req.body?.rooms, req.user?.email || null);
    const villas = (await tx.request().input("v", sql.Int, id).input("lt", sql.Int, saved.layoutTypeId).input("l", sql.NVarChar(50), saved.label).query(`
      UPDATE dbo.UnitMaster SET LayoutTypeId = @lt, UnitType = @l, UpdatedAt = SYSDATETIME()
      OUTPUT INSERTED.Id
      WHERE VillaTypeId = @v AND IsActive = 1`)).recordset;
    let roomsAdded = 0;
    for (const v of villas) {
      const s = await syncUnitRooms(tx, v.Id, { removeUnused: false, createdBy: req.user?.userId || null });
      roomsAdded += s.created + (s.reactivated || 0);
      await applyStoreys(tx, v.Id);
    }
    await tx.commit();
    await bumpFlatMasterCaches().catch(() => {});
    res.json({ success: true, roomCount: saved.roomCount, villasUpdated: villas.length, roomsAdded });
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    if (e instanceof VillaPlanError) return res.status(e.status).json({ error: e.message });
    console.error("[villa-types] PUT plan:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
