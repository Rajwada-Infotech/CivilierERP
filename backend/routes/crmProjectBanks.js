const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — every active Project↔Bank link (management page).
router.get("/", requirePageRight("crm-project-banks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT pb.Id, pb.ProjectId, proj.name AS ProjectName,
             pb.BankLHeadId, ah.LHeadName AS BankName
      FROM dbo.CrmProjectBank pb
      JOIN dbo.enterprise proj ON proj.id = pb.ProjectId AND proj.business_type = 'P'
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = pb.BankLHeadId
      WHERE pb.IsActive = 1
      ORDER BY proj.name, ah.LHeadName
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-project-banks] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /for-project/:projectId — the lean lookup every payment surface calls
// to scope its deposit-bank dropdown. Empty array means "no banks linked to
// this project" — callers fall back to the full bank list themselves.
router.get("/for-project/:projectId", requirePageRight("crm-project-banks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = parseInt(req.params.projectId);
    const result = await pool.request().input("pid", sql.Int, projectId).query(`
      SELECT ah.LHeadId AS BId, ah.LHeadName AS BName
      FROM dbo.CrmProjectBank pb
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = pb.BankLHeadId
      WHERE pb.ProjectId = @pid AND pb.IsActive = 1
      ORDER BY ah.LHeadName
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-project-banks] GET /for-project error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — link a bank to a project. Idempotent: re-linking an already-
// active pair is a no-op success (matches the unique index instead of
// erroring on it).
router.post("/", requirePageRight("crm-project-banks", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const { ProjectId, BankLHeadId } = req.body;
    if (!ProjectId || !BankLHeadId) return res.status(400).json({ error: "ProjectId and BankLHeadId are required" });

    const existing = await pool.request()
      .input("pid", sql.Int, parseInt(ProjectId))
      .input("bid", sql.Int, parseInt(BankLHeadId))
      .query("SELECT Id FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND BankLHeadId = @bid AND IsActive = 1");
    if (existing.recordset.length) return res.json({ success: true, id: existing.recordset[0].Id, alreadyLinked: true });

    const result = await pool.request()
      .input("pid", sql.Int, parseInt(ProjectId))
      .input("bid", sql.Int, parseInt(BankLHeadId))
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmProjectBank (ProjectId, BankLHeadId, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@pid, @bid, 1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-project-banks] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — unlink (soft-deactivate, same convention as every other
// master in this codebase).
router.delete("/:id", requirePageRight("crm-project-banks", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmProjectBank SET IsActive = 0 WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-project-banks] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
