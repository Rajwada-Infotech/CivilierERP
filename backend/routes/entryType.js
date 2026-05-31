const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
const { getPool, sql } = require("../db");

// ── GET /projects — projects from enterprise where business_type = 'P' ────────
router.get("/projects", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name
      FROM dbo.enterprise
      WHERE business_type = 'P'
        AND (discontinue IS NULL OR discontinue = 0)
      ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — all entry types with resolved project name via JOIN ───────────────
router.get("/", cache("entry-type", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        et.E_Id,
        et.project_id,
        e.name  AS Epname,
        et.EntryType,
        et.Eprefix,
        et.EDoc_N,
        et.E_CreatedBy,
        et.E_CreatedAt
      FROM dbo.Entry_Type et
      LEFT JOIN dbo.enterprise e ON et.project_id = e.id
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — store project_id FK + keep Epname in sync ───────────────────────
router.post("/", async (req, res) => {
  const { project_id, EntryType, Eprefix, EDoc_N } = req.body;
  try {
    const userEmail = req.user?.name;
    if (!userEmail)
      return res.status(401).json({ error: "User context missing" });
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });

    const pool = getPool();

    // Resolve the project name from enterprise to keep Epname in sync
    const projectResult = await pool
      .request()
      .input("pid", sql.Int, project_id)
      .query(`SELECT name FROM dbo.enterprise WHERE id = @pid`);
    const projectName = projectResult.recordset[0]?.name || null;

    await pool
      .request()
      .input("project_id", sql.Int, project_id)
      .input("Epname", sql.NVarChar(255), projectName)
      .input("EntryType", sql.NVarChar, EntryType || null)
      .input("Eprefix", sql.NVarChar, Eprefix || null)
      .input("EDoc_N", sql.Int, EDoc_N || 1)
      .input("E_CreatedBy", sql.NVarChar(100), userEmail)
      .input("E_CreatedAt", sql.DateTime2, new Date()).query(`
        INSERT INTO dbo.Entry_Type
          (project_id, Epname, EntryType, Eprefix, EDoc_N, E_CreatedBy, E_CreatedAt)
        VALUES
          (@project_id, @Epname, @EntryType, @Eprefix, @EDoc_N, @E_CreatedBy, @E_CreatedAt)
      `);
    await bumpCacheVersion("entry-type");
    res.json({ message: "Entry type added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — update project_id FK + keep Epname in sync ────────────────────
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { project_id, EntryType, Eprefix, EDoc_N } = req.body;
  try {
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });

    const pool = getPool();

    // Resolve the project name from enterprise to keep Epname in sync
    const projectResult = await pool
      .request()
      .input("pid", sql.Int, project_id)
      .query(`SELECT name FROM dbo.enterprise WHERE id = @pid`);
    const projectName = projectResult.recordset[0]?.name || null;

    await pool
      .request()
      .input("E_Id", sql.UniqueIdentifier, id)
      .input("project_id", sql.Int, project_id)
      .input("Epname", sql.NVarChar(255), projectName)
      .input("EntryType", sql.NVarChar, EntryType || null)
      .input("Eprefix", sql.NVarChar, Eprefix || null)
      .input("EDoc_N", sql.Int, EDoc_N || 1).query(`
        UPDATE dbo.Entry_Type SET
          project_id = @project_id,
          Epname     = @Epname,
          EntryType  = @EntryType,
          Eprefix    = @Eprefix,
          EDoc_N     = @EDoc_N
        WHERE E_Id = @E_Id
      `);
    await bumpCacheVersion("entry-type");
    res.json({ message: "Entry type updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("E_Id", sql.UniqueIdentifier, id)
      .query("DELETE FROM dbo.Entry_Type WHERE E_Id=@E_Id");
    await bumpCacheVersion("entry-type");
    res.json({ message: "Entry type deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

