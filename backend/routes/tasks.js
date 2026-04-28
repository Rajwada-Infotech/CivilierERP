/**
 * backend/routes/tasks.js
 *
 * Full CRUD for Tasks + Comments.
 * Mounted in server.js as:
 *   app.use("/api/tasks", authMiddleware, require("./routes/tasks"));
 */

const express = require("express");
const logger = require("../logger");
const { redisGet, redisSet, redisDel } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");
// Note: authMiddleware is NOT imported here — it is already applied globally
// at app.use("/api", authMiddleware) in server.js. Applying it again per-route
// would double-decode the JWT and overwrite req.user, breaking role checks.
const allowRoles = require("../middleware/role");

const adminOnly = allowRoles("admin", "super_admin");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseQC(raw) {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function mapTask(row, comments = []) {
  return {
    id: String(row.Id),
    title: row.Title,
    description: row.Description || "",
    module: row.Module || null,
    priority: row.Priority,
    status: row.Status,
    assignedTo: String(row.AssignedTo),
    assignedToName: row.AssignedToName || "",
    createdBy: String(row.CreatedBy),
    createdByName: row.CreatedByName || "",
    reviewedBy: row.ReviewedBy ? String(row.ReviewedBy) : undefined,
    reviewedByName: row.ReviewedByName || undefined,
    dueDate: row.DueDate
      ? new Date(row.DueDate).toISOString().split("T")[0]
      : "",
    qualityCriteria: parseQC(row.QualityCriteria),
    reminderSent: !!row.ReminderSent,
    closedAt: row.ClosedAt ? new Date(row.ClosedAt).toISOString() : undefined,
    reviewedAt: row.ReviewedAt
      ? new Date(row.ReviewedAt).toISOString()
      : undefined,
    createdAt: new Date(row.CreatedAt).toISOString(),
    comments,
  };
}

function mapComment(row) {
  return {
    id: String(row.Id),
    taskId: String(row.TaskId),
    userId: String(row.UserId),
    userName: row.UserName || "",
    userInitials: (row.UserName || "?")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2),
    text: row.Text,
    createdAt: new Date(row.CreatedAt).toISOString(),
  };
}

// ─── GET /api/tasks ───────────────────────────────────────────────────────────
// Admins see all tasks; regular users see only tasks assigned/created by them.
router.get("/", async (req, res) => {
  let userId = null;
  try {
    userId = req.user.userId ?? req.user.id;
    const { role } = req.user;
    const isAdmin =
      role === "admin" || role === "super_admin" || role === "dba";
    const moduleFilter =
      typeof req.query.module === "string" && req.query.module.trim()
        ? req.query.module.trim().toLowerCase()
        : "";

    const cacheKey = `tasks:${userId}:${isAdmin}:${moduleFilter || "all"}`;

    // ✅ 1. Check cache
    const cached = await redisGet(cacheKey);
    if (cached) {
      logger.info({ event: "TASKS_CACHE_HIT", userId }, "Tasks served from cache");
      return res.json(JSON.parse(cached));
    }

    const pool = getPool();

    let query = `
      SELECT
        t.Id, t.Title, t.Description, t.Module, t.Priority, t.Status,
        t.AssignedTo, au.name AS AssignedToName,
        t.CreatedBy,  cu.name AS CreatedByName,
        t.ReviewedBy, ru.name AS ReviewedByName,
        t.DueDate, t.QualityCriteria, t.ReminderSent,
        t.ClosedAt, t.ReviewedAt, t.CreatedAt
      FROM dbo.Tasks t
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
      LEFT JOIN dbo.users ru ON ru.id = t.ReviewedBy
    `;

    const request = pool.request();
    const conditions = [];

    if (!isAdmin) {
      conditions.push(`(t.AssignedTo = @userId OR t.CreatedBy = @userId)`);
      request.input("userId", sql.Int, userId);
    }

    if (moduleFilter) {
      conditions.push(`LOWER(ISNULL(t.Module, '')) = @module`);
      request.input("module", sql.NVarChar(50), moduleFilter);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY t.CreatedAt DESC`;
    const result = await request.query(query);

    const taskIds = result.recordset.map((r) => r.Id);

    let comments = [];
    if (taskIds.length > 0) {
      const idList = taskIds.join(",");
      const commentsResult = await pool.request().query(`
        SELECT tc.Id, tc.TaskId, tc.UserId, u.name AS UserName, tc.Text, tc.CreatedAt
        FROM dbo.TaskComments tc
        LEFT JOIN dbo.users u ON u.id = tc.UserId
        WHERE tc.TaskId IN (${idList})
        ORDER BY tc.CreatedAt ASC
      `);
      comments = commentsResult.recordset;
    }

    const commentsByTask = {};
    for (const c of comments) {
      if (!commentsByTask[c.TaskId]) commentsByTask[c.TaskId] = [];
      commentsByTask[c.TaskId].push(mapComment(c));
    }

    const tasks = result.recordset.map((row) =>
      mapTask(row, commentsByTask[row.Id] || []),
    );

    // ✅ 2. Save to Redis (TTL = 60 sec)
    await redisSet(cacheKey, JSON.stringify(tasks), 60);

    logger.info({ event: "TASKS_FETCHED", count: tasks.length, userId }, "Tasks fetched from DB");

    res.json(tasks);
  } catch (err) {
    logger.error({ event: "TASKS_FETCH_FAILED", err, userId }, "Failed to fetch tasks");
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// ─── GET /api/tasks/reminders ─────────────────────────────────────────────────
// Returns open/in_progress tasks that are overdue or due within 7 days.
// Used by the bell notification in TopNavbar.
router.get("/reminders", async (req, res) => {
  try {
    const pool = getPool();
    const userId = req.user.userId ?? req.user.id;
    const { role } = req.user;
    const isAdmin =
      role === "admin" || role === "super_admin" || role === "dba";

    const request = pool.request();
    request.input("today", sql.Date, new Date());
    request.input("soon", sql.Date, new Date(Date.now() + 7 * 86400000));

    let where = `t.Status IN ('open', 'in_progress') AND t.DueDate <= @soon`;
    if (!isAdmin) {
      where += ` AND (t.AssignedTo = @userId OR t.CreatedBy = @userId)`;
      request.input("userId", sql.Int, userId);
    }

    const result = await request.query(`
      SELECT
        t.Id, t.Title, t.Priority, t.Status,
        t.AssignedTo, au.name AS AssignedToName,
        t.DueDate
      FROM dbo.Tasks t
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      WHERE ${where}
      ORDER BY t.DueDate ASC
    `);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items = result.recordset.map((row) => {
      const due = new Date(row.DueDate);
      due.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((due - today) / 86400000);
      let urgency;
      if (diffDays < 0) urgency = "overdue";
      else if (diffDays === 0) urgency = "today";
      else urgency = "soon";

      return {
        id: `task-${row.Id}`,
        taskId: String(row.Id), // explicit numeric id for frontend navigation
        type: "task",
        title: row.Title,
        subtitle: `Assigned to ${row.AssignedToName || "Unknown"}`,
        dueDate: new Date(row.DueDate).toISOString().split("T")[0],
        urgency,
        priority: row.Priority,
      };
    });

    res.json(items);
  } catch (err) {
    logger.error({ event: "TASK_REMINDERS_FETCH_FAILED", err, userId }, "Failed to fetch task reminders");
    res.status(500).json({ error: "Failed to fetch task reminders" });
  }
});

// ─── GET /api/tasks/:id ───────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  let userId = null;
  try {
    const pool = getPool();
    userId = req.user.userId ?? req.user.id;
    const { role } = req.user;
    const isAdmin =
      role === "admin" || role === "super_admin" || role === "dba";
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid task id" });

    const result = await pool.request().input("id", sql.Int, id).query(`
        SELECT
          t.Id, t.Title, t.Description, t.Module, t.Priority, t.Status,
          t.AssignedTo, au.name AS AssignedToName,
          t.CreatedBy,  cu.name AS CreatedByName,
          t.ReviewedBy, ru.name AS ReviewedByName,
          t.DueDate, t.QualityCriteria, t.ReminderSent,
          t.ClosedAt, t.ReviewedAt, t.CreatedAt
        FROM dbo.Tasks t
        LEFT JOIN dbo.users au ON au.id = t.AssignedTo
        LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
        LEFT JOIN dbo.users ru ON ru.id = t.ReviewedBy
        WHERE t.Id = @id
      `);

    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: "Task not found" });

    // Access control: non-admins can only see their own tasks
    if (
      !isAdmin &&
      String(row.AssignedTo) !== String(userId) &&
      String(row.CreatedBy) !== String(userId)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const commentsResult = await pool.request().input("taskId", sql.Int, id)
      .query(`
        SELECT tc.Id, tc.TaskId, tc.UserId, u.name AS UserName, tc.Text, tc.CreatedAt
        FROM dbo.TaskComments tc
        LEFT JOIN dbo.users u ON u.id = tc.UserId
        WHERE tc.TaskId = @taskId
        ORDER BY tc.CreatedAt ASC
      `);

    res.json(mapTask(row, commentsResult.recordset.map(mapComment)));
  } catch (err) {
    logger.error({ event: "TASK_FETCH_FAILED", err, taskId: req.params.id, userId }, "Failed to fetch task");
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
router.post("/", adminOnly, async (req, res) => {
  let createdBy = null;
  let assignedTo = null;
  try {
    const pool = getPool();
    const {
      title,
      description,
      module = null,
      priority = "medium",
      assignedTo: assignedToRaw,
      dueDate,
      qualityCriteria = [],
    } = req.body;
    assignedTo = assignedToRaw;

    if (!title || !assignedTo || !dueDate) {
      return res
        .status(400)
        .json({ error: "title, assignedTo and dueDate are required" });
    }

    createdBy = req.user.userId ?? req.user.id;

    const result = await pool
      .request()
      .input("title", sql.NVarChar(255), title)
      .input("description", sql.NVarChar(sql.MAX), description || "")
      .input("module", sql.NVarChar(50), module ? String(module).trim().toLowerCase() : null)
      .input("priority", sql.NVarChar(20), priority)
      .input("assignedTo", sql.Int, assignedTo)
      .input("createdBy", sql.Int, createdBy)
      .input("dueDate", sql.Date, new Date(dueDate))
      .input(
        "qualityCriteria",
        sql.NVarChar(sql.MAX),
        JSON.stringify(qualityCriteria),
      ).query(`
        INSERT INTO dbo.Tasks
          (Title, Description, Module, Priority, Status, AssignedTo, CreatedBy, DueDate, QualityCriteria)
        OUTPUT INSERTED.Id
        VALUES
          (@title, @description, @module, @priority, 'open', @assignedTo, @createdBy, @dueDate, @qualityCriteria)
      `);

    const newId = result.recordset[0].Id;

    // Return full task row
    const newTask = await pool.request().input("id", sql.Int, newId).query(`
        SELECT t.*, au.name AS AssignedToName, cu.name AS CreatedByName
        FROM dbo.Tasks t
        LEFT JOIN dbo.users au ON au.id = t.AssignedTo
        LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
        WHERE t.Id = @id
      `);

    // 🔥 CLEAR CACHE
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:true`);
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:false`);

    logger.info({ event: "TASK_CREATED", taskId: newId, createdBy, assignedTo, title }, "Task created");
    res.status(201).json(mapTask(newTask.recordset[0], []));
  } catch (err) {
    logger.error({ event: "TASK_CREATE_FAILED", err, createdBy, assignedTo }, "Failed to create task");
    res.status(500).json({ error: "Failed to create task" });
  }
});

// ─── PUT /api/tasks/:id ───────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  let userId = null;
  let id = null;
  try {
    const pool = getPool();
    userId = req.user.userId ?? req.user.id;
    const { role } = req.user;
    const isAdmin =
      role === "admin" || role === "super_admin" || role === "dba";
    id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid task id" });

    const existing = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT * FROM dbo.Tasks WHERE Id = @id");

    const row = existing.recordset[0];
    if (!row) return res.status(404).json({ error: "Task not found" });

    if (
      !isAdmin &&
      String(row.AssignedTo) !== String(userId) &&
      String(row.CreatedBy) !== String(userId)
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const {
      title,
      description,
      priority,
      status,
      module,
      assignedTo,
      dueDate,
      qualityCriteria,
      reviewedBy,
    } = req.body;

    // Build dynamic SET clause
    const updates = [];
    const request = pool.request().input("id", sql.Int, id);

    if (title !== undefined) {
      updates.push("Title = @title");
      request.input("title", sql.NVarChar(255), title);
    }
    if (description !== undefined) {
      updates.push("Description = @description");
      request.input("description", sql.NVarChar(sql.MAX), description);
    }
    if (priority !== undefined) {
      updates.push("Priority = @priority");
      request.input("priority", sql.NVarChar(20), priority);
    }
    if (module !== undefined) {
      updates.push("Module = @module");
      request.input(
        "module",
        sql.NVarChar(50),
        module ? String(module).trim().toLowerCase() : null,
      );
    }
    if (status !== undefined) {
      updates.push("Status = @status");
      request.input("status", sql.NVarChar(20), status);

      if (status === "closed" && row.Status !== "closed") {
        updates.push("ClosedAt = GETUTCDATE()");
      }
      if (status === "reviewed" && row.Status !== "reviewed") {
        updates.push("ReviewedAt = GETUTCDATE()");
        if (reviewedBy) {
          updates.push("ReviewedBy = @reviewedBy");
          request.input("reviewedBy", sql.Int, reviewedBy);
        }
      }
      // Sent back for rework
      if (status === "in_progress" && row.Status === "closed") {
        updates.push("ReviewedBy = NULL");
        updates.push("ReviewedAt = NULL");
      }
    }
    if (assignedTo !== undefined) {
      updates.push("AssignedTo = @assignedTo");
      request.input("assignedTo", sql.Int, assignedTo);
    }
    if (dueDate !== undefined) {
      updates.push("DueDate = @dueDate");
      request.input("dueDate", sql.Date, new Date(dueDate));
    }
    if (qualityCriteria !== undefined) {
      updates.push("QualityCriteria = @qc");
      request.input(
        "qc",
        sql.NVarChar(sql.MAX),
        JSON.stringify(qualityCriteria),
      );
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("UpdatedAt = GETUTCDATE()");
    await request.query(
      `UPDATE dbo.Tasks SET ${updates.join(", ")} WHERE Id = @id`,
    );

    // Return updated task
    const updated = await pool.request().input("id", sql.Int, id).query(`
        SELECT t.*, au.name AS AssignedToName, cu.name AS CreatedByName, ru.name AS ReviewedByName
        FROM dbo.Tasks t
        LEFT JOIN dbo.users au ON au.id = t.AssignedTo
        LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
        LEFT JOIN dbo.users ru ON ru.id = t.ReviewedBy
        WHERE t.Id = @id
      `);

    const commentsResult = await pool.request().input("taskId", sql.Int, id)
      .query(`
        SELECT tc.*, u.name AS UserName
        FROM dbo.TaskComments tc
        LEFT JOIN dbo.users u ON u.id = tc.UserId
        WHERE tc.TaskId = @taskId
        ORDER BY tc.CreatedAt ASC
      `);

    // 🔥 CLEAR CACHE
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:true`);
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:false`);

    logger.info({ event: "TASK_UPDATED", taskId: id, updatedBy: userId }, "Task updated");
    res.json(
      mapTask(updated.recordset[0], commentsResult.recordset.map(mapComment)),
    );
  } catch (err) {
    logger.error({ event: "TASK_UPDATE_FAILED", err, taskId: id, userId }, "Failed to update task");
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ─── DELETE /api/tasks/:id ────────────────────────────────────────────────────
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid task id" });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM dbo.Tasks WHERE Id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Task not found" });
    }
    // 🔥 CLEAR CACHE
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:true`);
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:false`);

    logger.info({ event: "TASK_DELETED", taskId: id, deletedBy: req.user.userId ?? req.user.id }, "Task deleted");
    res.json({ success: true });
  } catch (err) {
    logger.error({ event: "TASK_DELETE_FAILED", err, taskId: id, userId: req.user.userId ?? req.user.id }, "Failed to delete task");
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ─── POST /api/tasks/:id/comments ─────────────────────────────────────────────
router.post("/:id/comments", async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid task id" });

    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: "Comment text is required" });
    }

    const userId = req.user.userId ?? req.user.id;

    const result = await pool
      .request()
      .input("taskId", sql.Int, id)
      .input("userId", sql.Int, userId)
      .input("text", sql.NVarChar(sql.MAX), text.trim()).query(`
        INSERT INTO dbo.TaskComments (TaskId, UserId, Text)
        OUTPUT INSERTED.Id, INSERTED.TaskId, INSERTED.UserId, INSERTED.Text, INSERTED.CreatedAt
        VALUES (@taskId, @userId, @text)
      `);

    const inserted = result.recordset[0];

    // Get user name
    const userResult = await pool
      .request()
      .input("uid", sql.Int, userId)
      .query("SELECT name FROM dbo.users WHERE id = @uid");

    const userName = userResult.recordset[0]?.name || "";

    // 🔥 CLEAR CACHE
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:true`);
    await redisDel(`tasks:${req.user.userId ?? req.user.id}:false`);

    logger.info({ event: "TASK_COMMENT_ADDED", taskId: id, commentId: inserted.Id, userId }, "Comment added to task");
    res.status(201).json(mapComment({ ...inserted, UserName: userName }));
  } catch (err) {
    logger.error({ event: "TASK_COMMENT_FAILED", err, taskId: id, userId }, "Failed to add comment");
    res.status(500).json({ error: "Failed to add comment" });
  }
});

module.exports = router;
