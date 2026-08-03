const allowRoles = require("../middleware/role");
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { lockNextDocNumber, currentFinYear } = require("../utils/docNumberLock");
const multer = require("multer");
const path = require("path");

const PRIORITIES = ["Very Important", "Important", "Normal"];
const STATUSES = ["Active", "Hold", "Cancel", "Closed"];

// Socket.io — lazy-loaded, same pattern as ticketRoutes.js, so requiring
// this route file never fails before initSocket() has run in server.js.
let _getIo = null;
function getIo() {
  if (!_getIo) _getIo = require("../socket").getIo;
  return _getIo();
}

// Follow-up/chat attachments go straight to DB as binary, same pattern as
// dbo.ticket_attachments in ticketRoutes.js — no disk dependency.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|docx?|xlsx?/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error("Unsupported file type"));
  },
});

// GET /followup-board is cached under its own namespace (separate cache
// entry/TTL from GET /), so any mutation that could change what the board
// shows — status changes above all — has to bump both or the board keeps
// serving a stale response for up to its own TTL regardless of what the
// frontend invalidates.
function bumpTaskCaches() {
  return Promise.all([
    bumpCacheVersion("task-master"),
    bumpCacheVersion("task-master-followup-board"),
  ]);
}

bumpTaskCaches().catch(() => {});

// GET all tasks — case-linkage columns are joined in as labels so the grid
// never needs a second round trip to show Company/Project/Financial Year.
router.get("/", cache("task-master", 60), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        t.Id, t.TaskNo, t.Subject, t.Details, t.Department, t.DueDate,
        t.CaseNumber, t.Priority, t.Status,
        t.CaseCompanyId, co.name AS CaseCompanyName,
        t.CaseProjectId, pr.name AS CaseProjectName,
        t.CaseFinYearId, fy.FName AS CaseFinYearName,
        t.CaseDocumentNumber,
        t.TypeOfDocId, td.Description AS TypeOfDocLabel,
        t.AssignedTo, au.name AS AssigneeName,
        t.CreatedBy, u.name AS CreatedByName,
        t.CreatedAt, t.UpdatedAt
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      LEFT JOIN dbo.FinYear fy ON fy.FId = t.CaseFinYearId
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = t.TypeOfDocId
      LEFT JOIN dbo.users u ON u.id = t.CreatedBy
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      WHERE t.IsDeleted = 0
      ORDER BY t.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /assignable-users — lightweight {id, name} list for the Assignee
// dropdown. Open to any authenticated user (unlike /api/users, which is
// privileged-only) since anyone creating a task needs to be able to assign
// it. Registered before /:id so "assignable-users" never gets swallowed as
// an :id param.
router.get("/assignable-users", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-master] GET assignable-users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /followup-board — standalone feed for the Follow-Up dashboard. Kept
// separate from GET / (Task Master admin grid) so the two pages never share
// a cache entry or a response shape — Follow-Up only ever needs the handful
// of fields its cards render, not the full admin record.
// Every task has an Assignee, so the Follow-Up board only ever shows a user
// their own assigned tasks — never another user's — determined purely from
// the logged-in session (req.user), never a client-supplied filter. Admin
// roles keep full visibility since they're the ones who assign tasks in the
// first place and need to see the whole board to manage it.
const FOLLOWUP_BOARD_PRIVILEGED_ROLES = new Set(["admin", "super_admin", "dba"]);

router.get("/followup-board", cache("task-master-followup-board", 30), async (req, res) => {
  try {
    const pool = getPool();
    const scopeToSelf = !FOLLOWUP_BOARD_PRIVILEGED_ROLES.has(req.user?.role);
    const request = pool.request();
    if (scopeToSelf) request.input("UserId", sql.Int, req.user?.userId || null);
    const result = await request.query(`
      SELECT
        t.Id, t.TaskNo, t.Subject, t.Details, t.Department, t.DueDate,
        t.CaseNumber, t.Priority, t.Status,
        co.name AS CaseCompanyName, pr.name AS CaseProjectName, fy.FName AS CaseFinYearName,
        (
          SELECT TOP 1 f.NextReminderAt
          FROM dbo.TaskFollowUps f
          WHERE f.TaskId = t.Id AND f.IsDone = 0 AND f.NextReminderAt IS NOT NULL
          ORDER BY f.CreatedAt DESC
        ) AS NextFollowUpAt
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      LEFT JOIN dbo.FinYear fy ON fy.FId = t.CaseFinYearId
      WHERE t.IsDeleted = 0 AND t.Status IN ('Active', 'Hold') AND t.DueDate IS NOT NULL
        ${scopeToSelf ? "AND t.AssignedTo = @UserId" : ""}
      ORDER BY t.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-master] GET followup-board error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — single task, for the Follow-Up drawer to fetch standalone
// (independent of whatever list/cache the caller came from).
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, id).query(`
      SELECT
        t.Id, t.TaskNo, t.Subject, t.Details, t.Department, t.DueDate,
        t.CaseNumber, t.Priority, t.Status,
        t.CaseCompanyId, co.name AS CaseCompanyName,
        t.CaseProjectId, pr.name AS CaseProjectName,
        t.CaseFinYearId, fy.FName AS CaseFinYearName,
        t.CaseDocumentNumber,
        t.TypeOfDocId, td.Description AS TypeOfDocLabel,
        t.AssignedTo, au.name AS AssigneeName, au.avatar_url AS AssigneeAvatarUrl,
        t.CreatedBy, u.name AS CreatedByName,
        t.CreatedAt, t.UpdatedAt
      FROM dbo.TaskMaster t
      LEFT JOIN dbo.enterprise co ON co.id = t.CaseCompanyId AND co.business_type = 'C'
      LEFT JOIN dbo.enterprise pr ON pr.id = t.CaseProjectId AND pr.business_type = 'P'
      LEFT JOIN dbo.FinYear fy ON fy.FId = t.CaseFinYearId
      LEFT JOIN dbo.TypeOfDoc td ON td.TypeOfDocId = t.TypeOfDocId
      LEFT JOIN dbo.users u ON u.id = t.CreatedBy
      LEFT JOIN dbo.users au ON au.id = t.AssignedTo
      WHERE t.Id = @Id AND t.IsDeleted = 0
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Task not found" });
    const task = result.recordset[0];
    // Same rule as /followup-board: a non-privileged user can't fetch a task
    // (and by extension its follow-ups/chat/files via the drawer) assigned
    // to someone else, even by guessing/typing the id directly.
    if (
      !FOLLOWUP_BOARD_PRIVILEGED_ROLES.has(req.user?.role) &&
      task.AssignedTo !== (req.user?.userId ?? null)
    ) {
      return res.status(403).json({ error: "Not authorized to view this task" });
    }
    res.json(task);
  } catch (err) {
    console.error("[task-master] GET /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — create a task. TaskNo is filled in by trg_TaskMaster_TaskNo right
// after the insert, so it's read back in the same round trip.
router.post("/", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const {
    Subject, Details, Department, DueDate, CaseNumber, Priority, Status,
    CaseCompanyId, CaseProjectId, CaseFinYearId, CaseDocumentNumber,
    TypeOfDocId, AssignedTo,
  } = req.body;

  if (!Subject?.trim()) return res.status(400).json({ error: "Subject is required" });
  const priority = Priority || "Normal";
  const status = Status || "Active";
  if (!PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid Priority. Must be: ${PRIORITIES.join(", ")}` });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid Status. Must be: ${STATUSES.join(", ")}` });
  }

  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();

    // TypeOfDocId is optional — when set, lock the next number through the
    // shared doc-numbering scheme (same one WO/PO/GRN use). Locking commits
    // its own row in DocNumberSequence immediately, independent of this
    // insert, so a collision here can't leave a gap. When not set, TaskNo is
    // left NULL and trg_TaskMaster_TaskNo fills in the simple TSK000001
    // fallback right after insert.
    let lockedTaskNo = null;
    if (TypeOfDocId) {
      lockedTaskNo = await lockNextDocNumber(pool, sql, {
        docTypeId: parseInt(TypeOfDocId, 10),
        finYear: currentFinYear(),
        tableName: "TaskMaster",
        docNoColumn: "TaskNo",
        issuedBy: req.user?.email || req.user?.name || null,
      });
    }

    const result = await pool
      .request()
      .input("TaskNo", sql.NVarChar(20), lockedTaskNo)
      .input("Subject", sql.NVarChar(255), Subject.trim())
      .input("Details", sql.NVarChar(sql.MAX), Details?.trim() || null)
      .input("Department", sql.NVarChar(100), Department?.trim() || null)
      .input("DueDate", sql.Date, DueDate || null)
      .input("CaseNumber", sql.NVarChar(100), CaseNumber?.trim() || null)
      .input("Priority", sql.NVarChar(20), priority)
      .input("Status", sql.NVarChar(20), status)
      .input("CaseCompanyId", sql.Int, CaseCompanyId ? parseInt(CaseCompanyId) : null)
      .input("CaseProjectId", sql.Int, CaseProjectId ? parseInt(CaseProjectId) : null)
      .input("CaseFinYearId", sql.Int, CaseFinYearId ? parseInt(CaseFinYearId) : null)
      .input("CaseDocumentNumber", sql.NVarChar(100), CaseDocumentNumber?.trim() || null)
      .input("TypeOfDocId", sql.Int, TypeOfDocId ? parseInt(TypeOfDocId, 10) : null)
      .input("AssignedTo", sql.Int, AssignedTo ? parseInt(AssignedTo, 10) : null)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.TaskMaster (
          TaskNo, Subject, Details, Department, DueDate, CaseNumber, Priority, Status,
          CaseCompanyId, CaseProjectId, CaseFinYearId, CaseDocumentNumber, TypeOfDocId, AssignedTo,
          CreatedBy, CreatedAt
        )
        VALUES (
          @TaskNo, @Subject, @Details, @Department, @DueDate, @CaseNumber, @Priority, @Status,
          @CaseCompanyId, @CaseProjectId, @CaseFinYearId, @CaseDocumentNumber, @TypeOfDocId, @AssignedTo,
          @CreatedBy, SYSUTCDATETIME()
        );
        SELECT SCOPE_IDENTITY() AS Id;
      `);
    const newId = result.recordset[0].Id;
    const taskNo = await pool.request().input("Id", sql.Int, newId)
      .query("SELECT TaskNo FROM dbo.TaskMaster WHERE Id = @Id");
    await bumpTaskCaches();
    res.json({ message: "Task added successfully", TaskNo: taskNo.recordset[0]?.TaskNo });
  } catch (err) {
    console.error("[task-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update a task
router.put("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const { id } = req.params;
  const {
    Subject, Details, Department, DueDate, CaseNumber, Priority, Status,
    CaseCompanyId, CaseProjectId, CaseFinYearId, CaseDocumentNumber, AssignedTo,
  } = req.body;

  if (!Subject?.trim()) return res.status(400).json({ error: "Subject is required" });
  const priority = Priority || "Normal";
  const status = Status || "Active";
  if (!PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid Priority. Must be: ${PRIORITIES.join(", ")}` });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid Status. Must be: ${STATUSES.join(", ")}` });
  }

  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool
      .request()
      .input("Id", sql.Int, parseInt(id))
      .input("Subject", sql.NVarChar(255), Subject.trim())
      .input("Details", sql.NVarChar(sql.MAX), Details?.trim() || null)
      .input("Department", sql.NVarChar(100), Department?.trim() || null)
      .input("DueDate", sql.Date, DueDate || null)
      .input("CaseNumber", sql.NVarChar(100), CaseNumber?.trim() || null)
      .input("Priority", sql.NVarChar(20), priority)
      .input("Status", sql.NVarChar(20), status)
      .input("CaseCompanyId", sql.Int, CaseCompanyId ? parseInt(CaseCompanyId) : null)
      .input("CaseProjectId", sql.Int, CaseProjectId ? parseInt(CaseProjectId) : null)
      .input("CaseFinYearId", sql.Int, CaseFinYearId ? parseInt(CaseFinYearId) : null)
      .input("CaseDocumentNumber", sql.NVarChar(100), CaseDocumentNumber?.trim() || null)
      .input("AssignedTo", sql.Int, AssignedTo ? parseInt(AssignedTo) : null)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query(`
        UPDATE dbo.TaskMaster SET
          Subject = @Subject, Details = @Details, Department = @Department,
          DueDate = @DueDate, CaseNumber = @CaseNumber, Priority = @Priority, Status = @Status,
          CaseCompanyId = @CaseCompanyId, CaseProjectId = @CaseProjectId,
          CaseFinYearId = @CaseFinYearId, CaseDocumentNumber = @CaseDocumentNumber,
          AssignedTo = @AssignedTo,
          UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME()
        WHERE Id = @Id AND IsDeleted = 0
      `);
    await bumpTaskCaches();
    res.json({ message: "Task updated successfully" });
  } catch (err) {
    console.error("[task-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id/status — quick lifecycle transition (Active/Hold/Cancel) from
// the grid's row actions, independent of the Add/Edit form's Active toggle.
router.patch("/:id/status", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { Status } = req.body;
  if (!STATUSES.includes(Status)) {
    return res.status(400).json({ error: `Invalid Status. Must be: ${STATUSES.join(", ")}` });
  }
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT TaskNo FROM dbo.TaskMaster WHERE Id = @Id AND IsDeleted = 0");
    if (!existing.recordset.length) return res.status(404).json({ error: "Task not found" });
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Status", sql.NVarChar(20), Status)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query("UPDATE dbo.TaskMaster SET Status = @Status, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id");
    await bumpTaskCaches();
    res.json({ message: `Task "${existing.recordset[0].TaskNo}" marked ${Status}` });
  } catch (err) {
    console.error("[task-master] PATCH status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Follow-up timeline ──────────────────────────────────────────────────────

router.get("/:id/followups", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const followups = await pool.request().input("TaskId", sql.Int, taskId).query(`
      SELECT f.Id, f.TaskId, f.Note, f.NextReminderAt, f.CreatedAt,
             f.CreatedBy, u.name AS CreatedByName,
             f.IsDone, f.DoneAt, f.DoneBy, du.name AS DoneByName
      FROM dbo.TaskFollowUps f
      LEFT JOIN dbo.users u ON u.id = f.CreatedBy
      LEFT JOIN dbo.users du ON du.id = f.DoneBy
      WHERE f.TaskId = @TaskId
      ORDER BY f.CreatedAt ASC
    `);
    const attachments = await pool.request().input("TaskId", sql.Int, taskId).query(`
      SELECT Id, FollowUpId, FileName, MimeType, FileSize, UploadedAt
      FROM dbo.TaskAttachments
      WHERE TaskId = @TaskId
      ORDER BY UploadedAt ASC
    `);
    const byFollowUp = {};
    for (const a of attachments.recordset) {
      const key = a.FollowUpId ?? 0;
      (byFollowUp[key] ||= []).push(a);
    }
    res.json(
      followups.recordset.map((f) => ({ ...f, Attachments: byFollowUp[f.Id] || [] })),
    );
  } catch (err) {
    console.error("[task-master] GET followups error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/followups", upload.array("files", 10), async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid id" });
  const { Note, NextReminderAt } = req.body;
  if (!Note?.trim()) return res.status(400).json({ error: "Note is required" });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const task = await pool.request().input("Id", sql.Int, taskId)
      .query("SELECT Id FROM dbo.TaskMaster WHERE Id = @Id AND IsDeleted = 0");
    if (!task.recordset.length) return res.status(404).json({ error: "Task not found" });

    const ins = await pool
      .request()
      .input("TaskId", sql.Int, taskId)
      .input("Note", sql.NVarChar(sql.MAX), Note.trim())
      .input("NextReminderAt", sql.DateTime2, NextReminderAt || null)
      .input("CreatedBy", sql.Int, createdBy)
      .query(`
        INSERT INTO dbo.TaskFollowUps (TaskId, Note, NextReminderAt, CreatedBy, CreatedAt)
        VALUES (@TaskId, @Note, @NextReminderAt, @CreatedBy, SYSUTCDATETIME());
        SELECT SCOPE_IDENTITY() AS Id;
      `);
    const followUpId = ins.recordset[0].Id;

    for (const file of req.files || []) {
      await pool
        .request()
        .input("TaskId", sql.Int, taskId)
        .input("FollowUpId", sql.Int, followUpId)
        .input("FileName", sql.NVarChar(255), file.originalname)
        .input("MimeType", sql.NVarChar(100), file.mimetype)
        .input("FileSize", sql.Int, file.size)
        .input("FileData", sql.VarBinary(sql.MAX), file.buffer)
        .input("UploadedBy", sql.Int, createdBy)
        .query(`
          INSERT INTO dbo.TaskAttachments (TaskId, FollowUpId, FileName, MimeType, FileSize, FileData, UploadedBy, UploadedAt)
          VALUES (@TaskId, @FollowUpId, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy, SYSUTCDATETIME())
        `);
    }

    await bumpTaskCaches();
    res.json({ message: "Follow-up added", Id: followUpId });
  } catch (err) {
    console.error("[task-master] POST followups error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id/followups/:followUpId — removes the follow-up entry and any
// attachments filed against it (no ON DELETE CASCADE on TaskAttachments, so
// those are removed explicitly first).
router.delete("/:id/followups/:followUpId", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const followUpId = parseInt(req.params.followUpId, 10);
  if (!Number.isFinite(taskId) || !Number.isFinite(followUpId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("Id", sql.Int, followUpId)
      .input("TaskId", sql.Int, taskId)
      .query("SELECT Id FROM dbo.TaskFollowUps WHERE Id = @Id AND TaskId = @TaskId");
    if (!existing.recordset.length) return res.status(404).json({ error: "Follow-up not found" });

    await pool.request().input("FollowUpId", sql.Int, followUpId)
      .query("DELETE FROM dbo.TaskAttachments WHERE FollowUpId = @FollowUpId");
    await pool.request().input("Id", sql.Int, followUpId)
      .query("DELETE FROM dbo.TaskFollowUps WHERE Id = @Id");

    await bumpTaskCaches();
    res.json({ message: "Follow-up deleted" });
  } catch (err) {
    console.error("[task-master] DELETE followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id/followups/:followUpId/done — marks the current follow-up
// reminder as completed, so it drops off the "most recent due date" shown on
// the board/bell before the next one is logged.
router.patch("/:id/followups/:followUpId/done", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  const followUpId = parseInt(req.params.followUpId, 10);
  if (!Number.isFinite(taskId) || !Number.isFinite(followUpId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("Id", sql.Int, followUpId)
      .input("TaskId", sql.Int, taskId)
      .query("SELECT Id FROM dbo.TaskFollowUps WHERE Id = @Id AND TaskId = @TaskId");
    if (!existing.recordset.length) return res.status(404).json({ error: "Follow-up not found" });

    await pool.request()
      .input("Id", sql.Int, followUpId)
      .input("DoneBy", sql.Int, req.user?.userId || null)
      .query(`
        UPDATE dbo.TaskFollowUps
        SET IsDone = 1, DoneAt = SYSUTCDATETIME(), DoneBy = @DoneBy
        WHERE Id = @Id
      `);

    await bumpTaskCaches();
    res.json({ message: "Follow-up marked done" });
  } catch (err) {
    console.error("[task-master] PATCH followup done error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chat thread ──────────────────────────────────────────────────────────────

router.get("/:id/chat", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("TaskId", sql.Int, taskId).query(`
      SELECT c.Id, c.TaskId, c.Message, c.CreatedAt,
             c.SenderId, u.name AS SenderName, u.avatar_url AS SenderAvatarUrl
      FROM dbo.TaskChatMessages c
      LEFT JOIN dbo.users u ON u.id = c.SenderId
      WHERE c.TaskId = @TaskId
      ORDER BY c.CreatedAt ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-master] GET chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/chat", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid id" });
  const { Message } = req.body;
  if (!Message?.trim()) return res.status(400).json({ error: "Message is required" });
  const senderId = req.user?.userId || null;
  try {
    const pool = getPool();
    const task = await pool.request().input("Id", sql.Int, taskId)
      .query("SELECT Id FROM dbo.TaskMaster WHERE Id = @Id AND IsDeleted = 0");
    if (!task.recordset.length) return res.status(404).json({ error: "Task not found" });

    const ins = await pool
      .request()
      .input("TaskId", sql.Int, taskId)
      .input("SenderId", sql.Int, senderId)
      .input("Message", sql.NVarChar(sql.MAX), Message.trim())
      .query(`
        INSERT INTO dbo.TaskChatMessages (TaskId, SenderId, Message, CreatedAt)
        VALUES (@TaskId, @SenderId, @Message, SYSUTCDATETIME());
        SELECT SCOPE_IDENTITY() AS Id;
      `);
    const newId = ins.recordset[0].Id;

    const row = await pool.request().input("Id", sql.Int, newId).query(`
      SELECT c.Id, c.TaskId, c.Message, c.CreatedAt, c.SenderId, u.name AS SenderName, u.avatar_url AS SenderAvatarUrl
      FROM dbo.TaskChatMessages c
      LEFT JOIN dbo.users u ON u.id = c.SenderId
      WHERE c.Id = @Id
    `);
    const savedMessage = row.recordset[0];

    try {
      getIo().emit("task:chat:new", { taskId, message: savedMessage });
    } catch (err) {
      console.warn("[task-master] socket emit failed:", err?.message || err);
    }

    res.json({ message: "Message sent", data: savedMessage });
  } catch (err) {
    console.error("[task-master] POST chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Files tab (all attachments across every follow-up on the task) ─────────

router.get("/:id/attachments", async (req, res) => {
  const taskId = parseInt(req.params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("TaskId", sql.Int, taskId).query(`
      SELECT a.Id, a.FollowUpId, a.FileName, a.MimeType, a.FileSize,
             a.UploadedBy, u.name AS UploadedByName, a.UploadedAt
      FROM dbo.TaskAttachments a
      LEFT JOIN dbo.users u ON u.id = a.UploadedBy
      WHERE a.TaskId = @TaskId
      ORDER BY a.UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[task-master] GET attachments error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/attachment/:attachmentId", async (req, res) => {
  const attachmentId = parseInt(req.params.attachmentId, 10);
  if (!Number.isFinite(attachmentId) || attachmentId <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("Id", sql.Int, attachmentId).query(`
      SELECT FileName, MimeType, FileData FROM dbo.TaskAttachments WHERE Id = @Id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    const { FileName, MimeType, FileData } = result.recordset[0];
    res.setHeader("Content-Type", MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(FileName)}"`);
    res.send(FileData);
  } catch (err) {
    console.error("[task-master] GET attachment error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — soft delete, consistent with the rest of the platform.
router.delete("/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const existing = await pool.request().input("Id", sql.Int, id)
      .query("SELECT TaskNo FROM dbo.TaskMaster WHERE Id = @Id AND IsDeleted = 0");
    if (!existing.recordset.length) return res.status(404).json({ error: "Task not found" });
    await pool
      .request()
      .input("Id", sql.Int, id)
      .input("UpdatedBy", sql.Int, updatedBy)
      .query("UPDATE dbo.TaskMaster SET IsDeleted = 1, UpdatedBy = @UpdatedBy, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id");
    await bumpTaskCaches();
    res.json({ message: `Task "${existing.recordset[0].TaskNo}" deleted successfully` });
  } catch (err) {
    console.error("[task-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
