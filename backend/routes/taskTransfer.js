const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { bumpCacheVersion } = require("../redis");
const allowRoles = require("../middleware/role");

// Bulk reassignment is an admin action, same role gate TaskMaster itself
// uses for every task-mutating route — applied to the whole file since
// there's no non-admin use case for this page.
router.use(allowRoles("admin", "super_admin", "dba"));

const OPEN_STATUSES = ["Active", "Hold"]; // this app's "Pending + Ongoing" equivalent — excludes Cancel/Closed

function bumpTaskCaches() {
  return Promise.all([
    bumpCacheVersion("task-master"),
    bumpCacheVersion("task-master-followup-board"),
    bumpCacheVersion("task-master-closed-board"),
  ]).catch(() => {});
}

// GET /api/task-transfer/users — {id, name} list for the From/To pickers.
router.get("/users", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-transfer] GET users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task-transfer/tasks?userId=123 — open (Active/Hold) tasks
// currently assigned to that user, for one side panel.
router.get("/tasks", async (req, res) => {
  const userId = parseInt(req.query.userId, 10);
  if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: "Invalid userId" });
  try {
    const pool = getPool();
    const result = await pool.request().input("UserId", sql.Int, userId).query(`
      SELECT
        t.Id, t.TaskNo, t.Subject, t.Department, t.DueDate, t.CaseNumber,
        t.Priority, t.Status, t.AssignedTo,
        co.name AS CaseCompanyName, pr.name AS CaseProjectName
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      WHERE t.IsDeleted = 0 AND t.AssignedTo = @UserId AND t.Status IN ('Active', 'Hold')
      ORDER BY t.DueDate ASC, t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-transfer] GET tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task-transfer/history — most recent transfers first.
router.get("/history", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  try {
    const pool = getPool();
    const result = await pool.request().input("Limit", sql.Int, limit).query(`
      SELECT TOP (@Limit)
        h.Id, h.TaskId, h.TaskNo, h.TaskSubject,
        h.FromUserId, fu.name AS FromUserName,
        h.ToUserId, tu.name AS ToUserName,
        h.TransferredBy, bu.name AS TransferredByName,
        h.TransferredAt, h.Notes
      FROM dbo.TaskTransferHistory h
      LEFT JOIN dbo.users fu ON fu.id = h.FromUserId
      LEFT JOIN dbo.users tu ON tu.id = h.ToUserId
      LEFT JOIN dbo.users bu ON bu.id = h.TransferredBy
      ORDER BY h.TransferredAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-transfer] GET history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-transfer — bulk-move a set of tasks from one user to
// another. Every task is re-verified server-side (not deleted, still
// Active/Hold, still assigned to FromUserId) so a stale client selection
// can't silently transfer the wrong task or one someone else already closed.
router.post("/", async (req, res) => {
  const { TaskIds, FromUserId, ToUserId, Notes } = req.body;

  const fromUserId = parseInt(FromUserId, 10);
  const toUserId = parseInt(ToUserId, 10);
  const taskIds = Array.isArray(TaskIds) ? [...new Set(TaskIds.map((id) => parseInt(id, 10)))].filter(Number.isFinite) : [];

  if (!Number.isFinite(fromUserId) || !Number.isFinite(toUserId)) {
    return res.status(400).json({ error: "Select both a source and a destination user" });
  }
  if (fromUserId === toUserId) {
    return res.status(400).json({ error: "Source and destination users must be different" });
  }
  if (taskIds.length === 0) {
    return res.status(400).json({ error: "Select at least one task to transfer" });
  }

  const transferredBy = req.user?.userId || null;

  try {
    const pool = getPool();

    const users = await pool.request()
      .input("FromUserId", sql.Int, fromUserId)
      .input("ToUserId", sql.Int, toUserId)
      .query(`
        SELECT id, name FROM dbo.users
        WHERE id IN (@FromUserId, @ToUserId) AND ISNULL(discontinue, 0) = 0
      `);
    if (users.recordset.length !== 2) {
      return res.status(400).json({ error: "Both users must be active accounts" });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const transferred = [];
      for (const taskId of taskIds) {
        const taskResult = await tx.request()
          .input("Id", sql.Int, taskId)
          .input("FromUserId", sql.Int, fromUserId)
          .query(`
            SELECT Id, TaskNo, Subject, Status, AssignedTo
            FROM dbo.TaskMaster
            WHERE Id = @Id AND IsDeleted = 0 AND AssignedTo = @FromUserId
          `);
        const task = taskResult.recordset[0];
        if (!task) {
          throw new Error(`Task #${taskId} is no longer assigned to the source user — refresh and try again`);
        }
        if (!OPEN_STATUSES.includes(task.Status)) {
          throw new Error(`Task "${task.TaskNo || taskId}" is ${task.Status} and can't be transferred`);
        }

        await tx.request()
          .input("Id", sql.Int, taskId)
          .input("AssignedTo", sql.Int, toUserId)
          .input("UpdatedBy", sql.Int, transferredBy)
          .query(`
            UPDATE dbo.TaskMaster
            SET AssignedTo = @AssignedTo, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id
          `);

        await tx.request()
          .input("TaskId", sql.Int, taskId)
          .input("TaskNo", sql.NVarChar(20), task.TaskNo)
          .input("TaskSubject", sql.NVarChar(255), task.Subject)
          .input("FromUserId", sql.Int, fromUserId)
          .input("ToUserId", sql.Int, toUserId)
          .input("TransferredBy", sql.Int, transferredBy)
          .input("Notes", sql.NVarChar(500), Notes?.trim() || null)
          .query(`
            INSERT INTO dbo.TaskTransferHistory
              (TaskId, TaskNo, TaskSubject, FromUserId, ToUserId, TransferredBy, TransferredAt, Notes)
            VALUES
              (@TaskId, @TaskNo, @TaskSubject, @FromUserId, @ToUserId, @TransferredBy, SYSUTCDATETIME(), @Notes)
          `);

        transferred.push(task.TaskNo || `#${taskId}`);
      }

      await tx.commit();
      await bumpTaskCaches();
      res.json({ message: `${transferred.length} task${transferred.length === 1 ? "" : "s"} transferred successfully`, TaskNos: transferred });
    } catch (innerErr) {
      await tx.rollback();
      throw innerErr;
    }
  } catch (err) {
    console.error("[task-transfer] POST error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
