// Naming Pattern master — CRUD over dbo.CrmNamingPattern (migration 527).
// Patterns are created and assigned per project / block / floor from the
// Naming panel in Auto Project Setup. Deletes are soft and refused while anything is assigned to
// the pattern, so a project's naming never silently changes underneath it.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");
const { SCOPE, validateTemplate, renderName } = require("../services/namingPattern");

router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Managed inside Auto Project Setup — same page rights, no separate screen.
const PAGE = "crm-auto-project-setup";

const USAGE = `
  (SELECT COUNT(*) FROM dbo.enterprise e WHERE e.UnitNamingPatternId = p.Id OR e.ParkingNamingPatternId = p.Id) AS ProjectCount,
  (SELECT COUNT(*) FROM dbo.BlockMaster b WHERE b.UnitNamingPatternId = p.Id OR b.ParkingNamingPatternId = p.Id) AS BlockCount,
  (SELECT COUNT(*) FROM dbo.CrmProjectAutoSetupFloor f WHERE f.UnitNamingPatternId = p.Id AND f.IsActive = 1) AS FloorCount`;

// A worked example so the screen shows what a template produces.
function example(row) {
  const ctx = { shortCode: "PRJ", blockName: "A", towerNo: 1 };
  try {
    if (row.Scope === SCOPE.PARKING) return [1, 2, 3].map((seq) => renderName(row, { ...ctx, seq })).join(", ");
    return [renderName(row, { ...ctx, floorNo: 0, seq: 1 }), renderName(row, { ...ctx, floorNo: 1, seq: 1 }),
      renderName(row, { ...ctx, floorNo: 1, seq: 2 }), renderName(row, { ...ctx, floorNo: 2, seq: 1 })].join(", ");
  } catch (e) {
    return e.message;
  }
}

function parse(b) {
  const name = String(b.Name || "").trim();
  const scope = b.Scope === SCOPE.PARKING ? SCOPE.PARKING : SCOPE.UNIT;
  const template = String(b.Template || "").trim();
  const groundLabel = String(b.GroundLabel ?? "G").trim() || "G";
  const skip = String(b.SkipLetters || "").toUpperCase().replace(/[^A-Z]/g, "");
  const start = b.NumberStart === undefined || b.NumberStart === "" ? 1 : parseInt(b.NumberStart, 10);
  const sort = b.SortOrder === undefined || b.SortOrder === "" ? 100 : parseInt(b.SortOrder, 10);
  if (!name) return { error: "Name is required" };
  const bad = validateTemplate(template, scope);
  if (bad) return { error: bad };
  if (groundLabel.length > 10) return { error: "Ground label must be 10 characters or fewer" };
  if (skip.length >= 26) return { error: "Can't skip every letter" };
  if (!Number.isInteger(start) || start < 0 || start > 9999) return { error: "Number start must be 0–9999" };
  return {
    name, scope, template, groundLabel, skip: skip || null, start,
    sort: Number.isInteger(sort) ? sort : 100,
    isActive: b.IsActive === false || b.IsActive === 0 || b.IsActive === "false" ? 0 : 1,
    notes: b.Notes ? String(b.Notes).slice(0, 300) : null,
  };
}

const bind = (r, v, req) => r
  .input("name", sql.NVarChar(100), v.name).input("scope", sql.NVarChar(10), v.scope)
  .input("tpl", sql.NVarChar(200), v.template).input("ground", sql.NVarChar(10), v.groundLabel)
  .input("skip", sql.NVarChar(26), v.skip).input("start", sql.Int, v.start).input("sort", sql.Int, v.sort)
  .input("active", sql.Bit, v.isActive).input("notes", sql.NVarChar(300), v.notes)
  .input("by", sql.Int, req.user?.userId ?? null);

router.get("/", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT p.Id, p.Name, p.Scope, p.Template, p.GroundLabel, p.SkipLetters, p.NumberStart, p.SortOrder, p.IsActive, p.Notes, ${USAGE}
      FROM dbo.CrmNamingPattern p ORDER BY p.IsActive DESC, p.Scope, p.SortOrder, p.Name`);
    res.json(r.recordset.map((row) => ({ ...row, Example: example(row) })));
  } catch (e) {
    console.error("[naming-pattern] GET:", e.message);
    res.status(500).json({ error: `Failed to load naming patterns: ${e.message}` });
  }
});

// POST /preview — example names for an unsaved template (live preview in the form).
router.post("/preview", requirePageRight(PAGE, "view"), (req, res) => {
  const v = parse({ ...req.body, Name: req.body?.Name || "preview" });
  if (v.error) return res.json({ error: v.error });
  res.json({ example: example({ Scope: v.scope, Template: v.template, GroundLabel: v.groundLabel, SkipLetters: v.skip, NumberStart: v.start }) });
});

router.post("/", requirePageRight(PAGE, "create"), async (req, res) => {
  const v = parse(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const r = await bind(getPool().request(), v, req).query(`
      INSERT INTO dbo.CrmNamingPattern (Name, Scope, Template, GroundLabel, SkipLetters, NumberStart, SortOrder, IsActive, Notes, CreatedBy)
      OUTPUT INSERTED.Id VALUES (@name, @scope, @tpl, @ground, @skip, @start, @sort, @active, @notes, @by)`);
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error("[naming-pattern] POST:", e.message);
    res.status(500).json({ error: "Failed to create naming pattern" });
  }
});

router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const v = parse(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const pool = getPool();
    // A pattern already assigned somewhere can't switch scope (unit <-> parking).
    const cur = (await pool.request().input("id", sql.Int, id).query(`SELECT p.Scope, ${USAGE} FROM dbo.CrmNamingPattern p WHERE p.Id = @id`)).recordset[0];
    if (!cur) return res.status(404).json({ error: "Naming pattern not found" });
    if (cur.Scope !== v.scope && cur.ProjectCount + cur.BlockCount + cur.FloorCount > 0) {
      return res.status(400).json({ error: "This pattern is in use — it can't change between Unit and Parking" });
    }
    await bind(pool.request().input("id", sql.Int, id), v, req).query(`
      UPDATE dbo.CrmNamingPattern SET Name = @name, Scope = @scope, Template = @tpl, GroundLabel = @ground,
        SkipLetters = @skip, NumberStart = @start, SortOrder = @sort, IsActive = @active, Notes = @notes,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
    res.json({ success: true });
  } catch (e) {
    console.error("[naming-pattern] PUT:", e.message);
    res.status(500).json({ error: "Failed to update naming pattern" });
  }
});

router.delete("/:id", requirePageRight(PAGE, "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const cur = (await pool.request().input("id", sql.Int, id).query(`SELECT ${USAGE} FROM dbo.CrmNamingPattern p WHERE p.Id = @id`)).recordset[0];
    if (!cur) return res.status(404).json({ error: "Naming pattern not found" });
    if (cur.ProjectCount + cur.BlockCount + cur.FloorCount > 0) {
      return res.status(400).json({ error: `In use by ${cur.ProjectCount} project(s), ${cur.BlockCount} block(s), ${cur.FloorCount} floor(s) — reassign them first.` });
    }
    await pool.request().input("id", sql.Int, id).query("UPDATE dbo.CrmNamingPattern SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[naming-pattern] DELETE:", e.message);
    res.status(500).json({ error: "Failed to remove naming pattern" });
  }
});

module.exports = router;
