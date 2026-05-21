/**
 * ticketRoutes.js
 * Full ticket workflow: create → assign → comment → resolve/close/reopen
 * Auth-protected — all endpoints require valid JWT (via global authMiddleware in server.js).
 * Role-gated endpoints explicitly checked with allowRoles().
 */

const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const canAcceptTickets = require("../middleware/canAcceptTickets");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ─── Socket.IO — lazy-loaded (same pattern as userActivity.js) ───────────────
let _getIo = null;
function getIo() {
  if (!_getIo) _getIo = require("../socket").getIo;
  return _getIo();
}
function emitTicketUpdate(action, ticketId, extra = {}) {
  try {
    getIo().emit("ticket:updated", { action, ticketId, ...extra });
  } catch (err) {
    // Best-effort socket emit: never break HTTP flow if Socket.IO is unavailable.
    console.warn(
      `[ticketRoutes] Socket emit failed for action="${action}", ticketId="${ticketId}": ${err?.message || err}`,
    );
  }
}

function emitTicketMessage(ticketId, message) {
  try {
    getIo().to(`ticket:${ticketId}`).emit("ticket:message", {
      ticketId,
      message,
    });
    getIo().emit("ticket:updated", {
      action: "commented",
      ticketId,
      commentId: message?.id,
    });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Tickets socket message emit]", err.message);
    }
  }
}

// ─── Multer setup ─────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../uploads/tickets");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/i;
    if (
      allowed.test(path.extname(file.originalname)) &&
      allowed.test(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only images (jpg, png, gif, webp) and PDFs are allowed"));
    }
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userFromReq(req) {
  return {
    id: req.user?.userId ?? req.user?.id ?? null,
    name: req.user?.name ?? req.user?.username ?? "Unknown",
    role: allowRoles.normalizeRole(req.user?.role),
  };
}

function isTicketAdmin(role) {
  return ["admin", "super_admin", "dba"].includes(allowRoles.normalizeRole(role));
}

function requireActor(req, res) {
  const actor = userFromReq(req);
  if (!actor.id) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return actor;
}

function parseTicketId(param) {
  const id = Number(param);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number(value);
  const normalized = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(normalized, max);
}

function sendTicketAccessError(res, access) {
  if (access.status === 404) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (access.status === 403) {
    return res.status(403).json({ error: "Access denied" });
  }
  return null;
}

async function addCommentToTicket(pool, ticketId, comment, actor) {
  const result = await pool
    .request()
    .input("ticket_id", sql.Int, ticketId)
    .input("comment", sql.NVarChar(sql.MAX), comment)
    .input("author_name", sql.NVarChar(255), actor.name)
    .input("author_id", sql.Int, actor.id)
    .input("author_role", sql.NVarChar(50), actor.role).query(`
      INSERT INTO dbo.ticket_comments (ticket_id, comment, author_name, author_id, author_role)
      OUTPUT INSERTED.*
      VALUES (@ticket_id, @comment, @author_name, @author_id, @author_role)
    `);
  return result.recordset[0] || null;
}

async function addAndEmitCommentToTicket(pool, ticketId, comment, actor) {
  const inserted = await addCommentToTicket(pool, ticketId, comment, actor);
  if (inserted) emitTicketMessage(ticketId, inserted);
  return inserted;
}

async function getAccessibleTicket(pool, id, actor) {
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT * FROM dbo.tickets WHERE id = @id`);

  if (!result.recordset.length) return { status: 404 };
  const ticket = result.recordset[0];
  if (
    !isTicketAdmin(actor.role) &&
    ticket.created_by_id !== actor.id &&
    ticket.assigned_to_id !== actor.id
  ) {
    return { status: 403 };
  }
  return { status: 200, ticket };
}

// ─── GET /api/tickets ─────────────────────────────────────────────────────────
// Returns ALL tickets — for admins
router.get("/", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;

    const page = parsePositiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInt(req.query.limit, 25, 100);
    const offset = (page - 1) * limit;

    const pool = getPool();
    const result = await pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit).query(`
        SELECT
          t.id, t.subject, t.priority, t.customer_name, t.customer_phone,
          t.company_id, t.project_id, t.status, t.created_at,
          t.assigned_to, t.assigned_to_id,
          t.resolved_by, t.resolved_by_id,
          t.created_by, t.created_by_id,
          t.issue_details, t.attachment_path,
          t.escalated_at, t.escalation_level, t.escalation_reason,
          t.updated_at, t.resolved_at, t.closed_at,
          ISNULL(c.comment_count, 0) AS comment_count
        FROM dbo.tickets t
        LEFT JOIN (
          SELECT ticket_id, COUNT(*) AS comment_count
          FROM dbo.ticket_comments
          GROUP BY ticket_id
        ) c ON c.ticket_id = t.id
        ORDER BY
          CASE WHEN t.escalated_at IS NOT NULL AND t.status IN ('Pending', 'InProgress') THEN 0 ELSE 1 END,
          CASE
            WHEN t.status = 'Pending' AND t.assigned_to_id IS NULL THEN 0
            WHEN t.status = 'InProgress' THEN 1
            WHEN t.status = 'Resolved' THEN 2
            ELSE 3
          END,
          CASE t.priority
            WHEN 'Urgent' THEN 0
            WHEN 'High' THEN 1
            WHEN 'Medium' THEN 2
            WHEN 'Low' THEN 3
            ELSE 4
          END,
          t.created_at ASC,
          t.id ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const countResult = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.tickets");
    const total = countResult.recordset[0]?.total ?? 0;

    res.json({
      data: result.recordset ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[Tickets GET /]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickets/stats ───────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    if (!isTicketAdmin(actor.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Pending'    THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'InProgress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'Resolved'   THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'Closed'     THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN escalated_at IS NOT NULL AND status IN ('Pending','InProgress') THEN 1 ELSE 0 END) AS escalated_open,
        SUM(CASE WHEN priority = 'Urgent' AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS urgent_open,
        SUM(CASE WHEN priority = 'High'   AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS high_open
      FROM dbo.tickets
    `);
    res.json({ counts: result.recordset[0] });
  } catch (err) {
    console.error("[Tickets GET /stats]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickets/my  (alias for /mine — frontend uses this) ──────────────
// ─── GET /api/tickets/mine ───────────────────────────────────────────────────
// Personal ticket queue for the Ticket module.
async function myTicketsHandler(req, res) {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();

    const result = await pool.request().input("userId", sql.Int, actor.id)
      .query(`
        SELECT t.*,
               (SELECT COUNT(*) FROM dbo.ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
        FROM dbo.tickets t
        WHERE t.created_by_id = @userId OR t.assigned_to_id = @userId
        ORDER BY
          CASE t.status WHEN 'Pending' THEN 0 WHEN 'InProgress' THEN 1 ELSE 2 END,
          t.created_at DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("[Tickets GET /my]", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.get("/my", myTicketsHandler);
router.get("/mine", myTicketsHandler);

// ─── GET /api/tickets/admin-users ─────────────────────────────────────────────
// List users that can be assigned tickets
router.get(
  "/admin-users",
  allowRoles("admin", "super_admin", "dba"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT UserID AS id, UserName AS name, Role AS role
      FROM dbo.Users
      WHERE IsActive = 1
      ORDER BY UserName
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[Tickets GET /admin-users]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── GET /api/tickets/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });
    const access = await getAccessibleTicket(pool, id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    const comments = await pool
      .request()
      .input("tid", sql.Int, id)
      .query(
        `SELECT * FROM dbo.ticket_comments WHERE ticket_id = @tid ORDER BY created_at ASC`,
      );

    res.json({ ticket: access.ticket, comments: comments.recordset });
  } catch (err) {
    console.error("[Tickets GET /:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tickets/upload ─────────────────────────────────────────────────
// Accepts one or more files; returns array of stored URLs via /api/tickets/file/
router.post("/upload", upload.array("file", 20), (req, res) => {
  const files = req.files;
  if (!files || files.length === 0)
    return res.status(400).json({ error: "No file uploaded" });
  const urls = files.map((f) => `/api/tickets/file/${f.filename}`);
  res.json({ success: true, url: urls[0], urls });
});

// ─── GET /api/tickets/file/:filename ─────────────────────────────────────────
// Serve uploaded attachment files after checking ticket access.
async function serveTicketFile(req, res) {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;

    const filename = path.basename(req.params.filename);
    if (!/^[\w.-]+$/.test(filename)) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    const uploadRoot = path.resolve(UPLOAD_DIR);
    const filePath = path.resolve(uploadRoot, filename);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
      return res.status(400).json({ error: "Invalid filename" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const pool = getPool();
    const ticketResult = await pool
      .request()
      .input("fileUrl", sql.NVarChar(512), `%/api/tickets/file/${filename}%`)
      .input("fileName", sql.NVarChar(255), `%${filename}%`)
      .query(`
        SELECT TOP 1 *
        FROM dbo.tickets
        WHERE attachment_path LIKE @fileUrl OR attachment_path LIKE @fileName
        ORDER BY id DESC
      `);

    if (!ticketResult.recordset.length) {
      return res.status(404).json({ error: "File not found" });
    }

    const ticket = ticketResult.recordset[0];
    const access = await getAccessibleTicket(pool, ticket.id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    res.sendFile(filePath);
  } catch (err) {
    console.error("[Tickets GET /file/:filename]", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.get("/file/:filename", serveTicketFile);

// ─── POST /api/tickets  (also accepts /create for backward compat) ─────────────
async function createTicketHandler(req, res) {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const {
      subject,
      priority,
      issue_details,
      customer_name,
      customer_phone,
      company_id,
      project_id,
      attachment_path,
    } = req.body;

    if (!subject || !issue_details || !customer_name) {
      return res.status(400).json({
        error: "subject, issue_details and customer_name are required",
      });
    }

    const createResult = await pool
      .request()
      .input("subject", sql.NVarChar(500), subject)
      .input("priority", sql.NVarChar(50), priority ?? "Medium")
      .input("issue_details", sql.NVarChar(sql.MAX), issue_details)
      .input("customer_name", sql.NVarChar(255), customer_name)
      .input("customer_phone", sql.NVarChar(50), customer_phone ?? null)
      .input("company_id", sql.Int, company_id ?? null)
      .input("project_id", sql.Int, project_id ?? null)
      .input("attachment_path", sql.NVarChar(sql.MAX), attachment_path ?? null)
      .input("created_by", sql.NVarChar(255), actor.name)
      .input("created_by_id", sql.Int, actor.id).query(`
        INSERT INTO dbo.tickets (
          subject, priority, issue_details,
          customer_name, customer_phone,
          company_id, project_id,
          attachment_path, status,
          created_by, created_by_id
        ) VALUES (
          @subject, @priority, @issue_details,
          @customer_name, @customer_phone,
          @company_id, @project_id,
          @attachment_path, 'Pending',
          @created_by, @created_by_id
        );
        SELECT SCOPE_IDENTITY() AS id;
      `);

    const ticketId = Number(createResult.recordset[0]?.id || 0) || null;
    res.json({ success: true, id: ticketId });
    emitTicketUpdate("created", ticketId);
  } catch (err) {
    console.error("[Tickets POST /create]", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.post("/", createTicketHandler);
router.post("/create", createTicketHandler);

// Accept an unassigned pending ticket into the current user's resolving queue.
router.put("/accept/:id", canAcceptTickets, async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;

    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("assigned_to", sql.NVarChar(255), actor.name)
      .input("assigned_to_id", sql.Int, actor.id).query(`
        UPDATE dbo.tickets
        SET assigned_to    = @assigned_to,
            assigned_to_id = @assigned_to_id,
            status         = 'InProgress',
            updated_at     = SYSUTCDATETIME()
        WHERE id = @id
          AND status = 'Pending'
          AND assigned_to_id IS NULL
      `);

    if (result.rowsAffected?.[0] === 0) {
      const current = await pool
        .request()
        .input("id", sql.Int, id)
        .query("SELECT status, assigned_to FROM dbo.tickets WHERE id = @id");
      if (!current.recordset.length) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      return res.status(409).json({
        error: "Ticket is already accepted, assigned, or no longer pending",
      });
    }

    await addAndEmitCommentToTicket(
      pool,
      id,
      `[Accepted] ${actor.name} started resolving this ticket.`,
      actor,
    );

    res.json({ success: true });
    emitTicketUpdate("accepted", id);
  } catch (err) {
    console.error("[Tickets PUT /accept]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/assign/:id ─────────────────────────────────────────────
router.put(
  "/assign/:id",
  allowRoles("admin", "super_admin", "dba"),
  async (req, res) => {
    try {
      const pool = getPool();
      const id = parseTicketId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });
      const { assigned_to_id, assigned_to } = req.body;

      if (!assigned_to_id || !assigned_to) {
        return res
          .status(400)
          .json({ error: "assigned_to_id and assigned_to are required" });
      }

      const result = await pool
        .request()
        .input("id", sql.Int, id)
        .input("assigned_to", sql.NVarChar(255), assigned_to)
        .input("assigned_to_id", sql.Int, assigned_to_id).query(`
        UPDATE dbo.tickets
        SET assigned_to    = @assigned_to,
            assigned_to_id = @assigned_to_id,
            status         = CASE WHEN status = 'Pending' THEN 'InProgress' ELSE status END,
            updated_at     = SYSUTCDATETIME()
        WHERE id = @id
      `);

      if (result.rowsAffected?.[0] === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json({ success: true });
      emitTicketUpdate("assigned", id);
    } catch (err) {
      console.error("[Tickets PUT /assign]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── PUT /api/tickets/resolve/:id ────────────────────────────────────────────
// Accepts rating (1–5) and review_remarks in addition to resolution_note
router.put("/resolve/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });
    const { resolution_note, rating, review_remarks } = req.body;

    const access = await getAccessibleTicket(pool, id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("resolved_by", sql.NVarChar(255), actor.name)
      .input("resolved_by_id", sql.Int, actor.id)
      .input("resolution_note", sql.NVarChar(sql.MAX), resolution_note ?? null)
      .query(`
        UPDATE dbo.tickets
        SET status          = 'Resolved',
            resolved_by     = @resolved_by,
            resolved_by_id  = @resolved_by_id,
            resolution_note = @resolution_note,
            resolved_at     = SYSUTCDATETIME(),
            updated_at      = SYSUTCDATETIME()
        WHERE id = @id
      `);

    if (result.rowsAffected?.[0] === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    // Build comment from resolution note + review
    const commentParts = [];
    if (resolution_note?.trim())
      commentParts.push(`[Resolved] ${resolution_note.trim()}`);
    if (rating)
      commentParts.push(
        `[Review ${rating}★]${review_remarks?.trim() ? " " + review_remarks.trim() : ""}`,
      );

    if (commentParts.length > 0) {
      await addAndEmitCommentToTicket(pool, id, commentParts.join("\n"), actor);
    }

    res.json({ success: true });
    emitTicketUpdate("resolved", id);
  } catch (err) {
    console.error("[Tickets PUT /resolve]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/reopen/:id ─────────────────────────────────────────────
// Moves a Resolved or Closed ticket back to Pending status
router.put("/reopen/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });

    const access = await getAccessibleTicket(pool, id, actor);
    if (access.status === 404)
      return res.status(404).json({ error: "Ticket not found" });
    if (access.status === 403)
      return res.status(403).json({ error: "Access denied" });

    await pool
      .request()
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.tickets
        SET status          = 'Pending',
            resolved_by     = NULL,
            resolved_by_id  = NULL,
            resolution_note = NULL,
            resolved_at     = NULL,
            closed_at       = NULL,
            updated_at      = SYSUTCDATETIME()
        WHERE id = @id
      `);

    res.json({ success: true });
    emitTicketUpdate("reopened", id);
  } catch (err) {
    console.error("[Tickets PUT /reopen]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/close/:id ──────────────────────────────────────────────
router.put(
  "/close/:id",
  allowRoles("admin", "super_admin", "dba"),
  async (req, res) => {
    try {
      const pool = getPool();
      const id = parseTicketId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid ticket id" });

      const result = await pool.request().input("id", sql.Int, id).query(`
        UPDATE dbo.tickets
        SET status     = 'Closed',
            closed_at  = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

      if (result.rowsAffected?.[0] === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json({ success: true });
      emitTicketUpdate("closed", id);
    } catch (err) {
      console.error("[Tickets PUT /close]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── POST /api/tickets/comment/:id ───────────────────────────────────────────
router.post("/comment/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });
    const { comment } = req.body;

    if (!comment?.trim())
      return res.status(400).json({ error: "Comment cannot be empty" });

    const access = await getAccessibleTicket(pool, id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    const insertedComment = await addAndEmitCommentToTicket(
      pool,
      id,
      comment.trim(),
      actor,
    );

    await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        `UPDATE dbo.tickets SET updated_at = SYSUTCDATETIME() WHERE id = @id`,
      );

    res.json({ success: true, comment: insertedComment });
  } catch (err) {
    console.error("[Tickets POST /comment]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.serveTicketFile = serveTicketFile;
