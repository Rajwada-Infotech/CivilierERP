// Project Type master — CRUD over dbo.ProjectTypeMaster (migration 502).
//
// Migration 502 SEEDED five types, which made them look hardcoded from the
// application's side: you could not add "Row Housing" or retire one without a
// deploy. This route makes them ordinary master data.
//
// WHAT A TYPE ACTUALLY CONTROLS — the flags, not the name. Code across CRM
// branches on HasFloors / SellsLand / SellsConstruction / AllowsMultiUnitSale
// and never on Code or Name, which is what lets a type added here work
// immediately without a code change:
//
//   HasFloors            units stack on floors (tower) vs sit on a site map
//   SellsLand            land is sold -> outside GST (Schedule III, CGST Act)
//   SellsConstruction    built area is sold -> taxable supply
//   AllowsMultiUnitSale  several units may share one booking (plot buyers)
//   SellsResidential     residential units (flats / villas) may be sold
//   SellsCommercial      commercial units (kinds flagged IsCommercial) may be sold
//
// Deletes are SOFT (IsActive = 0) and refused while projects or blocks still
// point at the row. Hard-deleting would strand those references and silently
// change how their GST and inventory behave — the same reasoning that keeps
// every other CRM record soft-deleted.

const express = require("express");
const router = express.Router();
const rateLimit = require("../middleware/rateLimiter");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const allowRoles = require("../middleware/role");
const { parseId } = require("../middleware/validateRequest");

const adminOnly = allowRoles("admin", "super_admin", "dba");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const SELECT = `
  SELECT t.Id, t.Code, t.Name, t.Description,
         t.HasFloors, t.SellsLand, t.SellsConstruction, t.AllowsMultiUnitSale,
         t.SellsResidential, t.SellsCommercial,
         t.SortOrder, t.IsActive,
         (SELECT COUNT(*) FROM dbo.enterprise e WHERE e.project_type_id = t.Id) AS ProjectCount,
         (SELECT COUNT(*) FROM dbo.BlockMaster b WHERE b.ProjectTypeId = t.Id)  AS BlockCount,
         (SELECT STRING_AGG(LTRIM(RTRIM(e.name)), ', ') FROM dbo.enterprise e WHERE e.project_type_id = t.Id) AS ProjectNames
  FROM dbo.ProjectTypeMaster t
`;

// Booleans arrive from the UI as true/false, but also as "true"/1 from CSV
// imports — normalised here so a bulk import cannot silently store 0 for a
// flag someone ticked.
const toBit = (v, fallback = 0) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" ? 1 : 0;
};

router.get("/", async (_req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`${SELECT} ORDER BY t.SortOrder, t.Name`);
    res.json(r.recordset);
  } catch (e) {
    console.error("[project-type-master] GET:", e.message);
    res.status(500).json({ error: "Failed to load project types" });
  }
});

// GET /impact?projectId=&typeId= — what giving a project this type would make
// unbookable: unsold units / plots whose kind the type doesn't sell (blocks
// with their own type keep it). Mirrors bookingTypeViolation's rules, read-only.
router.get("/impact", async (req, res) => {
  const projectId = parseId(req.query.projectId);
  const typeId = parseId(req.query.typeId);
  if (projectId === null || typeId === null) return res.json({ blocked: [], total: 0 });
  try {
    const pool = getPool();
    const r = await pool.request().input("p", sql.Int, projectId).input("t", sql.Int, typeId).query(`
      DECLARE @land BIT, @constr BIT, @resi BIT, @comm BIT;
      SELECT @land = SellsLand, @constr = SellsConstruction, @resi = SellsResidential, @comm = SellsCommercial
      FROM dbo.ProjectTypeMaster WHERE Id = @t;
      SELECT Reason, COUNT(*) AS Units FROM (
        SELECT CASE
          WHEN ISNULL(u.UnitKind, 'FLAT') IN (SELECT Code FROM dbo.CrmConstructedAssetKind WHERE IsLand = 1)
            THEN CASE WHEN @land = 0 THEN 'land units (type does not sell land)' END
          WHEN @constr = 0 THEN CONCAT(LOWER(ISNULL(u.UnitKind, 'FLAT')), ' units (type does not sell construction)')
          WHEN ISNULL(k.IsCommercial, 0) = 1 AND @comm = 0 THEN CONCAT(LOWER(ISNULL(u.UnitKind, 'FLAT')), ' units (type does not sell commercial)')
          WHEN ISNULL(k.IsCommercial, 0) = 0 AND @resi = 0 THEN CONCAT(LOWER(ISNULL(u.UnitKind, 'FLAT')), ' units (type does not sell residential)')
        END AS Reason
        FROM dbo.UnitMaster u LEFT JOIN dbo.BlockMaster b ON b.Id = u.BlockId
        LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = ISNULL(u.UnitKind, 'FLAT')
        WHERE u.ProjectId = @p AND u.IsActive = 1 AND b.ProjectTypeId IS NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.UnitId = u.Id AND bk.IsActive = 1)
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l WHERE l.UnitId = u.Id AND l.Status = N'Active')
        UNION ALL
        SELECT CASE WHEN @land = 0 THEN 'plots (type does not sell land)' END
        FROM dbo.PlotMaster pl LEFT JOIN dbo.BlockMaster b ON b.Id = pl.BlockId
        WHERE pl.ProjectId = @p AND pl.IsActive = 1 AND pl.ConvertedUnitId IS NULL AND b.ProjectTypeId IS NULL
          AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.PlotId = pl.Id AND bp.Status = N'Active')
      ) x WHERE Reason IS NOT NULL GROUP BY Reason
    `);
    const blocked = r.recordset.map((x) => ({ reason: x.Reason, units: x.Units }));
    res.json({ blocked, total: blocked.reduce((s, x) => s + x.units, 0) });
  } catch (e) {
    console.error("[project-type-master] GET impact:", e.message);
    res.status(500).json({ error: "Failed to check project type impact" });
  }
});

// What changing a type's switches would break in the projects / blocks that
// use it (block's own type, else its project's): unsold units whose kind the
// new switches no longer sell, or a layout change (floors <-> plots) under
// blocks that already have floors / plots. Empty string = safe.
async function switchConflicts(pool, typeId, next) {
  const commercialCol = (await pool.request().query("SELECT COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsCommercial') AS c")).recordset[0].c != null;
  const r = await pool.request()
    .input("t", sql.Int, typeId)
    .input("floors", sql.Bit, next.floors).input("land", sql.Bit, next.land).input("constr", sql.Bit, next.constr)
    .input("resi", sql.Bit, next.resi).input("comm", sql.Bit, next.comm)
    .query(`
      WITH blk AS (
        SELECT b.Id, b.ProjectId FROM dbo.BlockMaster b JOIN dbo.enterprise e ON e.id = b.ProjectId
        WHERE b.IsActive = 1 AND COALESCE(b.ProjectTypeId, e.project_type_id) = @t
      )
      SELECT Reason, COUNT(*) AS N FROM (
        SELECT CASE
          WHEN ISNULL(k.IsLand, 0) = 1 THEN CASE WHEN @land = 0 THEN 'land unit(s)' END
          WHEN @constr = 0 THEN 'constructed unit(s)'
          ${commercialCol ? "WHEN ISNULL(k.IsCommercial, 0) = 1 AND @comm = 0 THEN 'commercial unit(s)' WHEN ISNULL(k.IsCommercial, 0) = 0 AND @resi = 0 THEN 'residential unit(s)'" : ""}
        END AS Reason
        FROM dbo.UnitMaster u JOIN blk ON blk.Id = u.BlockId
        LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = ISNULL(u.UnitKind, 'FLAT')
        WHERE u.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.UnitId = u.Id AND bk.IsActive = 1)
        UNION ALL
        SELECT CASE WHEN @land = 0 THEN 'plot(s)' END
        FROM dbo.PlotMaster p JOIN blk ON blk.Id = p.BlockId WHERE p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        UNION ALL
        SELECT CASE WHEN @floors = 0 THEN 'block(s) that already have floors' END
        FROM blk WHERE EXISTS (SELECT 1 FROM dbo.CrmProjectAutoSetupFloor f WHERE f.BlockId = blk.Id AND f.IsActive = 1)
        UNION ALL
        SELECT CASE WHEN @floors = 1 THEN 'block(s) that already have plots' END
        FROM blk WHERE EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.BlockId = blk.Id AND p.IsActive = 1)
      ) x WHERE Reason IS NOT NULL GROUP BY Reason`);
  return r.recordset.map((x) => `${x.N} ${x.Reason}`).join(", ");
}

router.post("/", adminOnly, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || b.Name || "").trim();
  const code = String(b.code || b.Code || "").trim().toUpperCase();
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!code) return res.status(400).json({ error: "Code is required" });

  try {
    const pool = getPool();
    const dup = await pool.request().input("c", sql.NVarChar(30), code)
      .query("SELECT TOP 1 Id FROM dbo.ProjectTypeMaster WHERE Code = @c AND IsActive = 1");
    if (dup.recordset.length) return res.status(400).json({ error: `Code "${code}" is already in use` });

    const r = await pool.request()
      .input("code", sql.NVarChar(30), code)
      .input("name", sql.NVarChar(100), name)
      .input("desc", sql.NVarChar(300), b.description || b.Description || null)
      // Defaults mirror a conventional tower project, so a half-filled form
      // produces today's behaviour rather than something novel.
      .input("floors", sql.Bit, toBit(b.hasFloors ?? b.HasFloors, 1))
      .input("land", sql.Bit, toBit(b.sellsLand ?? b.SellsLand, 0))
      .input("constr", sql.Bit, toBit(b.sellsConstruction ?? b.SellsConstruction, 1))
      .input("multi", sql.Bit, toBit(b.allowsMultiUnitSale ?? b.AllowsMultiUnitSale, 0))
      .input("resi", sql.Bit, toBit(b.sellsResidential ?? b.SellsResidential, 1))
      .input("comm", sql.Bit, toBit(b.sellsCommercial ?? b.SellsCommercial, 0))
      .input("sort", sql.Int, b.sortOrder != null && b.sortOrder !== "" ? parseInt(b.sortOrder, 10) : 100)
      .input("active", sql.Bit, toBit(b.isActive ?? b.IsActive, 1))
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`
        INSERT INTO dbo.ProjectTypeMaster
          (Code, Name, Description, HasFloors, SellsLand, SellsConstruction, AllowsMultiUnitSale, SellsResidential, SellsCommercial, SortOrder, IsActive, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@code, @name, @desc, @floors, @land, @constr, @multi, @resi, @comm, @sort, @active, @by)
      `);
    res.status(201).json({ success: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error("[project-type-master] POST:", e.message);
    res.status(500).json({ error: "Failed to create project type" });
  }
});

router.put("/:id", adminOnly, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  const b = req.body || {};
  const name = String(b.name || b.Name || "").trim();
  const code = String(b.code || b.Code || "").trim().toUpperCase();
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!code) return res.status(400).json({ error: "Code is required" });

  try {
    const pool = getPool();
    const dup = await pool.request().input("c", sql.NVarChar(30), code).input("id", sql.Int, id)
      .query("SELECT TOP 1 Id FROM dbo.ProjectTypeMaster WHERE Code = @c AND IsActive = 1 AND Id <> @id");
    if (dup.recordset.length) return res.status(400).json({ error: `Code "${code}" is already in use` });

    // The type's switches can't be changed under units / layouts that already depend on them.
    const usageReady = (await pool.request().query("SELECT COL_LENGTH('dbo.ProjectTypeMaster', 'SellsCommercial') AS c")).recordset[0].c != null;
    const clash = await switchConflicts(pool, id, {
      floors: toBit(b.hasFloors ?? b.HasFloors, 1), land: toBit(b.sellsLand ?? b.SellsLand, 0),
      constr: toBit(b.sellsConstruction ?? b.SellsConstruction, 1),
      resi: usageReady ? toBit(b.sellsResidential ?? b.SellsResidential, 1) : 1,
      comm: usageReady ? toBit(b.sellsCommercial ?? b.SellsCommercial, 0) : 1,
    });
    if (clash) return res.status(400).json({ error: `Projects using this type have ${clash} that these switches would no longer allow — change those first, or create a new type.` });

    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("code", sql.NVarChar(30), code)
      .input("name", sql.NVarChar(100), name)
      .input("desc", sql.NVarChar(300), b.description || b.Description || null)
      .input("floors", sql.Bit, toBit(b.hasFloors ?? b.HasFloors, 1))
      .input("land", sql.Bit, toBit(b.sellsLand ?? b.SellsLand, 0))
      .input("constr", sql.Bit, toBit(b.sellsConstruction ?? b.SellsConstruction, 1))
      .input("multi", sql.Bit, toBit(b.allowsMultiUnitSale ?? b.AllowsMultiUnitSale, 0))
      .input("resi", sql.Bit, toBit(b.sellsResidential ?? b.SellsResidential, 1))
      .input("comm", sql.Bit, toBit(b.sellsCommercial ?? b.SellsCommercial, 0))
      .input("sort", sql.Int, b.sortOrder != null && b.sortOrder !== "" ? parseInt(b.sortOrder, 10) : 100)
      .input("active", sql.Bit, toBit(b.isActive ?? b.IsActive, 1))
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`
        UPDATE dbo.ProjectTypeMaster SET
          Code = @code, Name = @name, Description = @desc,
          HasFloors = @floors, SellsLand = @land,
          SellsConstruction = @constr, AllowsMultiUnitSale = @multi,
          SellsResidential = @resi, SellsCommercial = @comm,
          SortOrder = @sort, IsActive = @active,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Project type not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[project-type-master] PUT:", e.message);
    res.status(500).json({ error: "Failed to update project type" });
  }
});

// Soft delete, and only when nothing references it. A type still in use decides
// how those projects price and tax their units; removing it under them would
// silently move them back to the legacy high-rise behaviour.
router.delete("/:id", adminOnly, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const use = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.enterprise  WHERE project_type_id = @id) AS Projects,
        (SELECT COUNT(*) FROM dbo.BlockMaster WHERE ProjectTypeId  = @id) AS Blocks
    `);
    const { Projects, Blocks } = use.recordset[0];
    if (Projects > 0 || Blocks > 0) {
      return res.status(400).json({
        error: `In use by ${Projects} project(s) and ${Blocks} block(s) — reassign them before removing this type.`,
      });
    }
    const r = await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.ProjectTypeMaster SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Project type not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("[project-type-master] DELETE:", e.message);
    res.status(500).json({ error: "Failed to remove project type" });
  }
});

module.exports = router;
