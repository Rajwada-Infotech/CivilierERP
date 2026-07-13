const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

router.get("/", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { project, projectId } = req.query;
    const req0 = pool.request();
    const conds = [];
    // projectId is the real link (FK to the Unit Master project); project
    // (a ProjectName string) is kept only for old callers/back-compat.
    if (projectId) { req0.input("pid", sql.Int, parseInt(projectId)); conds.push("u.ProjectId = @pid"); }
    else if (project) { req0.input("p", sql.NVarChar(200), project); conds.push("u.ProjectName = @p"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT u.*, cu.name AS CreatedByName
      FROM dbo.CrmConstructionUpdate u
      LEFT JOIN dbo.Users cu ON cu.id = u.CreatedBy
      ${where}
      ORDER BY u.UpdateDate DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-construction-updates] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-construction-updates", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ProjectId) return res.status(400).json({ error: "ProjectId is required — select a project from Unit Master" });

    const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
      .query("SELECT name FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
    if (!proj.recordset.length) return res.status(400).json({ error: "Selected project does not exist" });

    await pool.request()
      .input("pid",  sql.Int,           parseInt(b.ProjectId))
      .input("proj", sql.NVarChar(200), proj.recordset[0].name)
      .input("dt",   sql.Date,          b.UpdateDate || null)
      .input("pct",  sql.Decimal(5,2),  b.PercentComplete != null ? parseFloat(b.PercentComplete) : null)
      .input("stage",sql.NVarChar(100), b.Stage || null)
      .input("sum",  sql.NVarChar(sql.MAX), b.Summary || null)
      .input("photos",sql.NVarChar(sql.MAX), b.PhotoUrls ? JSON.stringify(b.PhotoUrls) : null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmConstructionUpdate
          (ProjectId, ProjectName, UpdateDate, PercentComplete, Stage, Summary, PhotoUrls, CreatedBy, CreatedAt)
        VALUES (@pid, @proj, ISNULL(@dt, CAST(SYSDATETIME() AS DATE)), @pct, @stage, @sum, @photos, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-construction-updates] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
