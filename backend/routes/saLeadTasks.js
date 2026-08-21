const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

const LEAD_TASK_SELECT = `
  SELECT
    t.Id, t.LeadId, t.Title, t.Description,
    t.AssignedTo, t.DueDate, t.Priority, t.Status, t.CompletedAt,
    t.CreatedBy, t.CreatedAt, t.UpdatedAt,
    u.name  AS AssigneeName,
    cu.name AS CreatedByName,
    l.LeadUid, l.CustomerName, l.Mobile, l.Status AS LeadStatus, l.Classification
  FROM dbo.SaLeadTask t
  LEFT JOIN dbo.Users u  ON u.id  = t.AssignedTo
  LEFT JOIN dbo.Users cu ON cu.id = t.CreatedBy
  JOIN  dbo.SaLead l     ON l.Id  = t.LeadId
`;

// GET / — tasks for current user (or all tasks for admins)
router.get("/", requirePageRight("sa-lead-tasks", "view"), async (req, res) => {
  try {
    const pool   = getPool();
    const actor  = actorId(req);
    const isAdmin = isSaAdmin(req);
    const { status, priority, overdue } = req.query;

    const req0 = pool.request();
    const conditions = [];

    // Non-admins see only their own tasks
    if (!isAdmin && actor) {
      req0.input("actorId", sql.Int, actor);
      conditions.push("t.AssignedTo = @actorId");
    }
    if (status)   { req0.input("status",   sql.NVarChar(20), status);   conditions.push("t.Status = @status"); }
    if (priority) { req0.input("priority", sql.NVarChar(10), priority); conditions.push("t.Priority = @priority"); }
    if (overdue === "1") conditions.push("t.DueDate < SYSDATETIME() AND t.Status NOT IN ('Done','Cancelled')");

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const result = await req0.query(`${LEAD_TASK_SELECT} ${where} ORDER BY t.DueDate ASC, t.Priority DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-lead-tasks] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /lead/:leadId — tasks for a specific lead
router.get("/lead/:leadId", requirePageRight("sa-lead-tasks", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const lid = parseInt(req.params.leadId);
    const result = await pool.request()
      .input("lid", sql.Int, lid)
      .query(`${LEAD_TASK_SELECT} WHERE t.LeadId = @lid ORDER BY t.DueDate ASC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-lead-tasks] GET /lead/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /lead/:leadId — create task
router.post("/lead/:leadId", requirePageRight("sa-lead-tasks", "create"), async (req, res) => {
  try {
    const pool  = getPool();
    const lid   = parseInt(req.params.leadId);
    const b     = req.body;
    const actor = actorId(req);

    if (!b.Title?.trim()) return res.status(400).json({ error: "Title is required" });

    await pool.request()
      .input("lid",   sql.Int,            lid)
      .input("title", sql.NVarChar(200),  b.Title.trim())
      .input("desc",  sql.NVarChar(sql.MAX), b.Description || null)
      .input("asgn",  sql.Int,            b.AssignedTo ? parseInt(b.AssignedTo) : actor)
      .input("due",   sql.DateTime2(3),   b.DueDate || null)
      .input("pri",   sql.NVarChar(10),   b.Priority || "Normal")
      .input("cb",    sql.Int,            actor)
      .query(`
        INSERT INTO dbo.SaLeadTask (LeadId, Title, Description, AssignedTo, DueDate, Priority, CreatedBy)
        VALUES (@lid, @title, @desc, @asgn, @due, @pri, @cb)
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[sa-lead-tasks] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update task
router.put("/:id", requirePageRight("sa-lead-tasks", "edit"), async (req, res) => {
  try {
    const pool  = getPool();
    const b     = req.body;
    const actor = actorId(req);
    const tid   = parseInt(req.params.id);

    await pool.request()
      .input("id",    sql.Int,           tid)
      .input("title", sql.NVarChar(200), b.Title?.trim() || null)
      .input("desc",  sql.NVarChar(sql.MAX), b.Description || null)
      .input("asgn",  sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : null)
      .input("due",   sql.DateTime2(3),  b.DueDate || null)
      .input("pri",   sql.NVarChar(10),  b.Priority || null)
      .input("st",    sql.NVarChar(20),  b.Status || null)
      .input("ub",    sql.Int,           actor)
      .query(`
        UPDATE dbo.SaLeadTask SET
          Title       = ISNULL(@title, Title),
          Description = ISNULL(@desc, Description),
          AssignedTo  = ISNULL(@asgn, AssignedTo),
          DueDate     = @due,
          Priority    = ISNULL(@pri, Priority),
          Status      = ISNULL(@st, Status),
          CompletedAt = CASE WHEN @st = 'Done' THEN SYSDATETIME() ELSE CompletedAt END,
          UpdatedBy   = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-lead-tasks] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — hard delete (tasks are ephemeral)
router.delete("/:id", requirePageRight("sa-lead-tasks", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .query("DELETE FROM dbo.SaLeadTask WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-lead-tasks] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
