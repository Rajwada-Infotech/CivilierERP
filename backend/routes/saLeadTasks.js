const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin, applyLeadScope } = require("../services/saAccess");

router.use(apiRateLimit);
router.use(authMiddleware);

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
    const lid = parseId(req.params.leadId);
    if (lid === null) return res.status(400).json({ error: "Invalid leadId" });

    const req0 = pool.request().input("lid", sql.Int, lid);
    const scope = applyLeadScope(req0, req, "l");
    const check = await req0.query(
      `SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`
    );
    if (!check.recordset.length)
      return res.status(403).json({ error: "Access denied or lead not found" });

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
    const lid   = parseId(req.params.leadId);
    if (lid === null) return res.status(400).json({ error: "Invalid leadId" });

    const req0 = pool.request().input("lid", sql.Int, lid);
    const scope = applyLeadScope(req0, req, "l");
    const check = await req0.query(
      `SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`
    );
    if (!check.recordset.length)
      return res.status(403).json({ error: "Access denied or lead not found" });

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
    const isAdmin = isSaAdmin(req);
    const tid   = parseInt(req.params.id);

    // GET / scopes non-admins to their own tasks (t.AssignedTo = actor) —
    // this never checked that, letting anyone with the edit page right
    // act on any other user's task by id alone.
    if (!isAdmin) {
      const owned = await pool.request().input("id", sql.Int, tid).input("actorId", sql.Int, actor)
        .query("SELECT 1 AS ok FROM dbo.SaLeadTask WHERE Id = @id AND AssignedTo = @actorId");
      if (!owned.recordset.length) return res.status(403).json({ error: "Access denied" });
    }

    await pool.request()
      .input("id",    sql.Int,           tid)
      .input("title", sql.NVarChar(200), b.Title?.trim() || null)
      .input("desc",  sql.NVarChar(sql.MAX), b.Description || null)
      .input("asgn",  sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : null)
      .input("due",   sql.DateTime2(3),  b.DueDate || null)
      // A status-only update (Mark done / Reopen) sends no DueDate — keep it.
      // Only a body that carries DueDate (even empty, to clear it) changes it.
      .input("dueSet", sql.Bit,          Object.prototype.hasOwnProperty.call(b, "DueDate") ? 1 : 0)
      .input("pri",   sql.NVarChar(10),  b.Priority || null)
      .input("st",    sql.NVarChar(20),  b.Status || null)
      .input("ub",    sql.Int,           actor)
      .query(`
        UPDATE dbo.SaLeadTask SET
          Title       = ISNULL(@title, Title),
          Description = ISNULL(@desc, Description),
          AssignedTo  = ISNULL(@asgn, AssignedTo),
          DueDate     = CASE WHEN @dueSet = 1 THEN @due ELSE DueDate END,
          Priority    = ISNULL(@pri, Priority),
          Status      = ISNULL(@st, Status),
          CompletedAt = CASE WHEN @st = 'Done' THEN SYSDATETIME() WHEN @st IS NOT NULL THEN NULL ELSE CompletedAt END,
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
    const tid = parseInt(req.params.id);
    const actor = actorId(req);
    const isAdmin = isSaAdmin(req);

    if (!isAdmin) {
      const owned = await pool.request().input("id", sql.Int, tid).input("actorId", sql.Int, actor)
        .query("SELECT 1 AS ok FROM dbo.SaLeadTask WHERE Id = @id AND AssignedTo = @actorId");
      if (!owned.recordset.length) return res.status(403).json({ error: "Access denied" });
    }

    await pool.request()
      .input("id", sql.Int, tid)
      .query("DELETE FROM dbo.SaLeadTask WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-lead-tasks] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
