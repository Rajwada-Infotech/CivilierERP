const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);

function cleanStr(v, len = 50) {
  if (!v || String(v).trim() === "") return null;
  return String(v).trim().slice(0, len);
}

// GET / — full list for the management UI
router.get("/", requirePageRight("id-template-master", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT t.Id AS id, t.ProjectId AS projectId, pr.name AS projectName,
             t.ProjectAlias AS projectAlias, t.IsActive AS isActive,
             t.CreatedBy AS createdBy, t.CreatedAt AS createdAt,
             t.UpdatedBy AS updatedBy, t.UpdatedAt AS updatedAt
      FROM dbo.IDTemplateMaster t
      LEFT JOIN dbo.enterprise pr ON pr.id = t.ProjectId
      ORDER BY pr.name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[id-template-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /by-project/:projectId — active alias for one project (used by the FA
// Inventory "Generate ID" flow to check whether a project is configured yet).
router.get("/by-project/:projectId", requirePageRight("id-template-master", "view"), async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: "Invalid projectId" });
  try {
    const pool = getPool();
    const result = await pool.request().input("ProjectId", sql.Int, projectId).query(`
      SELECT Id AS id, ProjectId AS projectId, ProjectAlias AS projectAlias, IsActive AS isActive
      FROM dbo.IDTemplateMaster WHERE ProjectId = @ProjectId AND IsActive = 1
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "No active ID template configured for this project" });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[id-template-master] GET /by-project error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST / — create. One alias per project.
router.post("/", requirePageRight("id-template-master", "create"), async (req, res) => {
  const { projectId, projectAlias, isActive = true } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const pId = parseInt(projectId, 10);
  const alias = cleanStr(projectAlias, 50);
  if (!Number.isFinite(pId)) return res.status(400).json({ error: "Project is required" });
  if (!alias) return res.status(400).json({ error: "Project Alias is required" });

  try {
    const pool = getPool();
    const dup = await pool.request().input("ProjectId", sql.Int, pId)
      .query(`SELECT Id FROM dbo.IDTemplateMaster WHERE ProjectId = @ProjectId`);
    if (dup.recordset.length > 0) return res.status(409).json({ error: "This project already has an ID template configured" });

    const result = await pool.request()
      .input("ProjectId",    sql.Int,           pId)
      .input("ProjectAlias", sql.NVarChar(50),  alias)
      .input("IsActive",     sql.Bit,           isActive ? 1 : 0)
      .input("CreatedBy",    sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.IDTemplateMaster (ProjectId, ProjectAlias, IsActive, CreatedBy)
        OUTPUT INSERTED.Id AS id
        VALUES (@ProjectId, @ProjectAlias, @IsActive, @CreatedBy)
      `);
    res.status(201).json({ success: true, id: result.recordset[0].id });
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: "This project already has an ID template configured" });
    }
    console.error("[id-template-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update (Alias / IsActive; ProjectId can be corrected too).
router.put("/:id", requirePageRight("id-template-master", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const { projectId, projectAlias, isActive } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  const pId = parseInt(projectId, 10);
  const alias = cleanStr(projectAlias, 50);
  if (!Number.isFinite(pId)) return res.status(400).json({ error: "Project is required" });
  if (!alias) return res.status(400).json({ error: "Project Alias is required" });

  try {
    const pool = getPool();
    const dup = await pool.request()
      .input("ProjectId", sql.Int, pId)
      .input("Id",        sql.Int, id)
      .query(`SELECT Id FROM dbo.IDTemplateMaster WHERE ProjectId = @ProjectId AND Id <> @Id`);
    if (dup.recordset.length > 0) return res.status(409).json({ error: "Another ID template already exists for this project" });

    await pool.request()
      .input("Id",           sql.Int,           id)
      .input("ProjectId",    sql.Int,           pId)
      .input("ProjectAlias", sql.NVarChar(50),  alias)
      .input("IsActive",     sql.Bit,           isActive !== undefined ? (isActive ? 1 : 0) : 1)
      .input("UpdatedBy",    sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.IDTemplateMaster SET
          ProjectId = @ProjectId, ProjectAlias = @ProjectAlias, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("duplicate key")) {
      return res.status(409).json({ error: "Another ID template already exists for this project" });
    }
    console.error("[id-template-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — soft delete (IsActive = 0), never hard-remove — existing
// generated FA Item Codes must keep referring to a stable project alias.
router.delete("/:id", requirePageRight("id-template-master", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  const actor = req.user?.email || req.user?.name || "system";
  try {
    const pool = getPool();
    await pool.request()
      .input("Id",        sql.Int,           id)
      .input("UpdatedBy", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.IDTemplateMaster SET IsActive = 0, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE Id = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[id-template-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
