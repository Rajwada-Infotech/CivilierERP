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
//
// Deletes are SOFT (IsActive = 0) and refused while projects or blocks still
// point at the row. Hard-deleting would strand those references and silently
// change how their GST and inventory behave — the same reasoning that keeps
// every other CRM record soft-deleted.

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
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
      .input("sort", sql.Int, b.sortOrder != null && b.sortOrder !== "" ? parseInt(b.sortOrder, 10) : 100)
      .input("active", sql.Bit, toBit(b.isActive ?? b.IsActive, 1))
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`
        INSERT INTO dbo.ProjectTypeMaster
          (Code, Name, Description, HasFloors, SellsLand, SellsConstruction, AllowsMultiUnitSale, SortOrder, IsActive, CreatedBy)
        OUTPUT INSERTED.Id
        VALUES (@code, @name, @desc, @floors, @land, @constr, @multi, @sort, @active, @by)
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

    const r = await pool.request()
      .input("id", sql.Int, id)
      .input("code", sql.NVarChar(30), code)
      .input("name", sql.NVarChar(100), name)
      .input("desc", sql.NVarChar(300), b.description || b.Description || null)
      .input("floors", sql.Bit, toBit(b.hasFloors ?? b.HasFloors, 1))
      .input("land", sql.Bit, toBit(b.sellsLand ?? b.SellsLand, 0))
      .input("constr", sql.Bit, toBit(b.sellsConstruction ?? b.SellsConstruction, 1))
      .input("multi", sql.Bit, toBit(b.allowsMultiUnitSale ?? b.AllowsMultiUnitSale, 0))
      .input("sort", sql.Int, b.sortOrder != null && b.sortOrder !== "" ? parseInt(b.sortOrder, 10) : 100)
      .input("active", sql.Bit, toBit(b.isActive ?? b.IsActive, 1))
      .input("by", sql.Int, req.user?.id ?? req.user?.userId ?? null)
      .query(`
        UPDATE dbo.ProjectTypeMaster SET
          Code = @code, Name = @name, Description = @desc,
          HasFloors = @floors, SellsLand = @land,
          SellsConstruction = @constr, AllowsMultiUnitSale = @multi,
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
