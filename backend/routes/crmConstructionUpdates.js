const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);

router.get("/", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { project } = req.query;
    const req0 = pool.request();
    let where = "";
    if (project) { req0.input("p", sql.NVarChar(200), project); where = "WHERE u.ProjectName = @p"; }
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
    if (!b.ProjectName?.trim()) return res.status(400).json({ error: "ProjectName is required" });
    await pool.request()
      .input("proj", sql.NVarChar(200), b.ProjectName.trim())
      .input("dt",   sql.Date,          b.UpdateDate || null)
      .input("pct",  sql.Decimal(5,2),  b.PercentComplete != null ? parseFloat(b.PercentComplete) : null)
      .input("stage",sql.NVarChar(100), b.Stage || null)
      .input("sum",  sql.NVarChar(sql.MAX), b.Summary || null)
      .input("photos",sql.NVarChar(sql.MAX), b.PhotoUrls ? JSON.stringify(b.PhotoUrls) : null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmConstructionUpdate
          (ProjectName, UpdateDate, PercentComplete, Stage, Summary, PhotoUrls, CreatedBy, CreatedAt)
        VALUES (@proj, ISNULL(@dt, CAST(SYSDATETIME() AS DATE)), @pct, @stage, @sum, @photos, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-construction-updates] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
