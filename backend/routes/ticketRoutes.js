/**
 * ticketRoutes.js
 * Full ticket workflow: create ΓåÆ assign ΓåÆ comment ΓåÆ resolve/close/reopen
 * Attachments are stored as binary in dbo.ticket_attachments (no disk dependency).
 * Auth-protected ΓÇö all endpoints require valid JWT (via global authMiddleware in server.js).
 */

const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");
const canAcceptTickets = require("../middleware/canAcceptTickets");
const multer = require("multer");
const path = require("path");

// ΓöÇΓöÇΓöÇ Socket.IO ΓÇö lazy-loaded ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
let _getIo = null;
function getIo() {
  if (!_getIo) _getIo = require("../socket").getIo;
  return _getIo();
}
function emitTicketUpdate(action, ticketId) {
  try {
    getIo().emit("ticket:updated", { action, ticketId });
  } catch (err) {
    console.warn(
      `[ticketRoutes] Socket emit failed for action="${action}", ticketId="${ticketId}": ${err?.message || err}`,
    );
  }
}

// ΓöÇΓöÇΓöÇ Multer ΓÇö memory storage (files go to DB, not disk) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const upload = multer({
  storage: multer.memoryStorage(),
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

// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function userFromReq(req) {
  return {
    id: req.user?.userId ?? req.user?.id ?? null,
    name: req.user?.name ?? req.user?.username ?? "Unknown",
    role: allowRoles.normalizeRole(req.user?.role),
  };
}

function isTicketAdmin(role) {
  return ["admin", "super_admin", "dba", "engineer"].includes(
    allowRoles.normalizeRole(role),
  );
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

const VALID_STATUSES = ["Pending", "InProgress", "Resolved", "Closed"];
const VALID_PRIORITIES = ["Urgent", "High", "Medium", "Low"];

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
  await pool
    .request()
    .input("ticket_id", sql.Int, ticketId)
    .input("comment", sql.NVarChar(sql.MAX), comment)
    .input("author_name", sql.NVarChar(255), actor.name)
    .input("author_id", sql.Int, actor.id)
    .input("author_role", sql.NVarChar(50), actor.role).query(`
      INSERT INTO dbo.ticket_comments (ticket_id, comment, author_name, author_id, author_role)
      VALUES (@ticket_id, @comment, @author_name, @author_id, @author_role)
    `);
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

// ΓöÇΓöÇΓöÇ GET /api/tickets ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

router.get("/", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    if (!isTicketAdmin(actor.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const page = parsePositiveInt(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = parsePositiveInt(req.query.limit, 25, 100);
    const offset = (page - 1) * limit;

    const rawStatus = req.query.status ?? "";
    const statusFilter = rawStatus
      .split(",")
      .map((s) => s.trim())
      .filter((s) => VALID_STATUSES.includes(s));
    const hasStatusFilter = statusFilter.length > 0;

    const pool = getPool();
    const req2 = pool
      .request()
      .input("offset", sql.Int, offset)
      .input("limit", sql.Int, limit);

    // Build parameterized IN clause — each status value bound as a named parameter
    // (e.g. @s0, @s1) so no user-controlled string is ever interpolated into SQL.
    let whereClause = "";
    if (hasStatusFilter) {
      statusFilter.forEach((s, i) => req2.input(`s${i}`, sql.NVarChar(50), s));
      const paramList = statusFilter.map((_, i) => `@s${i}`).join(",");
      whereClause = `WHERE x.status IN (${paramList})`;
    }

    const result = await req2.query(`
      WITH ticket_rows AS (
        ...
      )
      SELECT *
      FROM ticket_rows x
      ${whereClause}
        ORDER BY
          x.id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    // Separate request for count — req2 cannot be reused after .query() resolves.
    const countReq = pool.request();
    if (hasStatusFilter) {
      statusFilter.forEach((s, i) => countReq.input(`s${i}`, sql.NVarChar(50), s));
    }
    const countResult = await countReq.query(`
      WITH ticket_rows AS (
        ...
      )
      SELECT COUNT(*) AS total
      FROM ticket_rows x
      ${whereClause}
    `);
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

// ΓöÇΓöÇΓöÇ GET /api/tickets/stats ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get("/stats", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    if (!isTicketAdmin(actor.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const pool = getPool();
    const result = await pool.request().query(`
      WITH ticket_rows AS (
        SELECT
          t.priority,
          t.escalated_at,
          CASE
            WHEN t.status = 'Pending' AND ISNULL(c.comment_count, 0) > 0
            THEN 'InProgress'
            ELSE t.status
          END AS status
        FROM dbo.tickets t
        LEFT JOIN (
          SELECT ticket_id, COUNT(*) AS comment_count
          FROM dbo.ticket_comments
          GROUP BY ticket_id
        ) c ON c.ticket_id = t.id
      )
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Pending'    THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'InProgress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'Resolved'   THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'Closed'     THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN escalated_at IS NOT NULL AND status IN ('Pending','InProgress') THEN 1 ELSE 0 END) AS escalated_open,
        SUM(CASE WHEN priority = 'Urgent' AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS urgent_open,
        SUM(CASE WHEN priority = 'High'   AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS high_open
      FROM ticket_rows
    `);
    res.json({ counts: result.recordset[0] });
  } catch (err) {
    console.error("[Tickets GET /stats]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ GET /api/tickets/my  (alias /mine) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function myTicketsHandler(req, res) {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();

    const result = await pool.request().input("userId", sql.Int, actor.id)
      .query(`
        SELECT
          t.*,
          (SELECT COUNT(*) FROM dbo.ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count,
          CASE
            WHEN t.status = 'Pending'
              AND (SELECT COUNT(*) FROM dbo.ticket_comments tc WHERE tc.ticket_id = t.id) > 0
            THEN 'InProgress'
            ELSE t.status
          END AS status
        FROM dbo.tickets t
        WHERE t.created_by_id = @userId OR t.assigned_to_id = @userId
        ORDER BY
          t.id DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("[Tickets GET /my]", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.get("/my", myTicketsHandler);
router.get("/mine", myTicketsHandler);

// ΓöÇΓöÇΓöÇ GET /api/tickets/admin-users ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get(
  "/admin-users",
  allowRoles("admin", "super_admin", "dba"),
  async (req, res) => {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
      SELECT
        u.id,
        u.name,
        r.RName AS role
      FROM dbo.users u
      LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      WHERE ISNULL(u.discontinue, 0) = 0
        AND (
          ISNULL(u.can_accept_tickets, 0) = 1
          OR LOWER(ISNULL(r.RName, '')) IN ('admin', 'super_admin', 'dba', 'engineer')
        )
      ORDER BY u.name
    `);
      res.json(result.recordset);
    } catch (err) {
      console.error("[Tickets GET /admin-users]", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ΓöÇΓöÇΓöÇ GET /api/tickets/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    // Fetch DB attachments for this ticket
    const attachResult = await pool.request().input("tid", sql.Int, id).query(`
        SELECT id, ticket_id, comment_id, filename, mime_type, file_size, uploaded_at
        FROM dbo.ticket_attachments
        WHERE ticket_id = @tid
        ORDER BY uploaded_at ASC
      `);

    const visibleComments = isTicketAdmin(actor.role)
      ? comments.recordset
      : comments.recordset.filter((comment) => !Number(comment.is_internal));

    const ticket = { ...access.ticket };
    if (ticket.status === "Pending" && comments.recordset.length > 0) {
      ticket.status = "InProgress";
    }

    const dbAttachments = attachResult.recordset.map((a) => ({
      id: a.id,
      ticket_id: a.ticket_id,
      comment_id: a.comment_id,
      filename: a.filename,
      mime_type: a.mime_type,
      file_size: a.file_size,
      url: `/api/tickets/attachment/${a.id}`,
    }));

    res.json({
      ticket,
      comments: visibleComments,
      attachments: dbAttachments,
    });
  } catch (err) {
    console.error("[Tickets GET /:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ POST /api/tickets/upload ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Saves file binary to dbo.ticket_attachments. Returns attachment IDs + URLs.
// ticketId is required in body or query. commentId is optional.
router.post("/upload", upload.array("file", 20), async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;

    const files = req.files;
    if (!files || files.length === 0)
      return res.status(400).json({ error: "No file uploaded" });

    const ticketId = parseTicketId(req.body.ticketId ?? req.query.ticketId);
    const commentId =
      parseTicketId(req.body.commentId ?? req.query.commentId) ?? null;

    if (!ticketId) {
      return res.status(400).json({ error: "ticketId is required" });
    }

    const pool = getPool();
    const access = await getAccessibleTicket(pool, ticketId, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    const results = [];
    for (const file of files) {
      const insertResult = await pool
        .request()
        .input("ticket_id", sql.Int, ticketId)
        .input("comment_id", sql.Int, commentId)
        .input("filename", sql.NVarChar(255), file.originalname)
        .input("mime_type", sql.NVarChar(100), file.mimetype)
        .input("file_size", sql.Int, file.size)
        .input("file_data", sql.VarBinary(sql.MAX), file.buffer)
        .input("uploaded_by", sql.Int, actor.id).query(`
          INSERT INTO dbo.ticket_attachments
            (ticket_id, comment_id, filename, mime_type, file_size, file_data, uploaded_by)
          OUTPUT INSERTED.id
          VALUES
            (@ticket_id, @comment_id, @filename, @mime_type, @file_size, @file_data, @uploaded_by)
        `);

      const attachId = insertResult.recordset[0].id;
      results.push({
        id: attachId,
        filename: file.originalname,
        mime_type: file.mimetype,
        url: `/api/tickets/attachment/${attachId}`,
      });
    }

    res.json({
      success: true,
      url: results[0]?.url,
      urls: results.map((r) => r.url),
      attachments: results,
    });
    emitTicketUpdate("attachment_uploaded", ticketId);
  } catch (err) {
    console.error("[Tickets POST /upload]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ GET /api/tickets/attachment/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Stream attachment binary from DB. Checks ticket access before serving.
router.get("/attachment/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;

    const attachId = parseTicketId(req.params.id);
    if (!attachId)
      return res.status(400).json({ error: "Invalid attachment id" });

    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, attachId).query(`
        SELECT id, ticket_id, filename, mime_type, file_data
        FROM dbo.ticket_attachments
        WHERE id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const attachment = result.recordset[0];

    const access = await getAccessibleTicket(pool, attachment.ticket_id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    res.setHeader("Content-Type", attachment.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(attachment.filename)}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(attachment.file_data);
  } catch (err) {
    console.error("[Tickets GET /attachment/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ GET /api/tickets/file/:filename (LEGACY) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Keep for backward compat. Returns 410 Gone ΓÇö all old disk files are gone.
router.get("/file/:filename", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    return res
      .status(410)
      .json({ error: "Attachment no longer available. Please re-upload." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ POST /api/tickets  ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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
      attachmentIds,
    } = req.body;

    if (!subject || !issue_details || !customer_name) {
      return res.status(400).json({
        error: "subject, issue_details and customer_name are required",
      });
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    const insertResult = await pool
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
        )
        OUTPUT INSERTED.id
        VALUES (
          @subject, @priority, @issue_details,
          @customer_name, @customer_phone,
          @company_id, @project_id,
          @attachment_path, 'Pending',
          @created_by, @created_by_id
        )
      `);

    const newTicketId = insertResult.recordset[0]?.id;

    if (
      newTicketId &&
      Array.isArray(attachmentIds) &&
      attachmentIds.length > 0
    ) {
      for (const aid of attachmentIds) {
        const parsedAid = Number(aid);
        if (!Number.isInteger(parsedAid) || parsedAid <= 0) continue;
        await pool
          .request()
          .input("ticket_id", sql.Int, newTicketId)
          .input("id", sql.Int, parsedAid)
          .input("uploaded_by", sql.Int, actor.id).query(`
            UPDATE dbo.ticket_attachments
            SET ticket_id = @ticket_id
            WHERE id = @id AND uploaded_by = @uploaded_by
          `);
      }
    }

    res.json({ success: true, ticketId: newTicketId });
    emitTicketUpdate("created", newTicketId);
  } catch (err) {
    console.error("[Tickets POST /create]", err.message);
    res.status(500).json({ error: err.message });
  }
}
router.post("/", createTicketHandler);
router.post("/create", createTicketHandler);

// ΓöÇΓöÇΓöÇ PUT /api/tickets/accept/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    await addCommentToTicket(
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

// ΓöÇΓöÇΓöÇ PUT /api/tickets/assign/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

// ΓöÇΓöÇΓöÇ PUT /api/tickets/resolve/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    const commentParts = [];
    if (resolution_note?.trim())
      commentParts.push(`[Resolved] ${resolution_note.trim()}`);
    if (rating)
      commentParts.push(
        `[Review ${rating}Γÿà]${review_remarks?.trim() ? " " + review_remarks.trim() : ""}`,
      );

    if (commentParts.length > 0) {
      await addCommentToTicket(pool, id, commentParts.join("\n"), actor);
    }

    res.json({ success: true });
    emitTicketUpdate("resolved", id);
  } catch (err) {
    console.error("[Tickets PUT /resolve]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ PUT /api/tickets/reopen/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

    await pool.request().input("id", sql.Int, id).query(`
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

// ΓöÇΓöÇΓöÇ PUT /api/tickets/close/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

// ΓöÇΓöÇΓöÇ PUT /api/tickets/status/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.put("/status/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });

    const { status } = req.body;
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const access = await getAccessibleTicket(pool, id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    await pool
      .request()
      .input("id", sql.Int, id)
      .input("status", sql.NVarChar(50), status).query(`
        UPDATE dbo.tickets
        SET status     = @status,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    res.json({ success: true });
    emitTicketUpdate("status_updated", id);
  } catch (err) {
    console.error("[Tickets PUT /status]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ΓöÇΓöÇΓöÇ POST /api/tickets/comment/:id ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post("/comment/:id", async (req, res) => {
  try {
    const actor = requireActor(req, res);
    if (!actor) return;
    const pool = getPool();
    const id = parseTicketId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid ticket id" });
    const { comment, attachmentIds } = req.body;

    if (
      !comment?.trim() &&
      (!Array.isArray(attachmentIds) || attachmentIds.length === 0)
    )
      return res.status(400).json({ error: "Comment or attachment required" });

    const access = await getAccessibleTicket(pool, id, actor);
    const accessError = sendTicketAccessError(res, access);
    if (accessError) return accessError;

    const commentText = comment?.trim() || "";
    await addCommentToTicket(pool, id, commentText, actor);

    // Get the new comment's ID so we can link attachments to it
    const commentResult = await pool
      .request()
      .input("tid", sql.Int, id)
      .query(
        `SELECT TOP 1 id FROM dbo.ticket_comments WHERE ticket_id = @tid ORDER BY id DESC`,
      );
    const newCommentId = commentResult.recordset[0]?.id ?? null;

    // Link any pre-uploaded attachments to this comment
    if (
      newCommentId &&
      Array.isArray(attachmentIds) &&
      attachmentIds.length > 0
    ) {
      for (const aid of attachmentIds) {
        const parsedAid = Number(aid);
        if (!Number.isInteger(parsedAid) || parsedAid <= 0) continue;
        await pool
          .request()
          .input("comment_id", sql.Int, newCommentId)
          .input("id", sql.Int, parsedAid)
          .input("uploaded_by", sql.Int, actor.id).query(`
            UPDATE dbo.ticket_attachments
            SET comment_id = @comment_id
            WHERE id = @id AND uploaded_by = @uploaded_by
          `);
      }
    }

    const currentTicket = access.ticket;
    if (currentTicket.status === "Pending") {
      await pool.request().input("id", sql.Int, id).query(`
          UPDATE dbo.tickets
          SET status     = 'InProgress',
              updated_at = SYSUTCDATETIME()
          WHERE id = @id AND status = 'Pending'
        `);
    } else {
      await pool
        .request()
        .input("id", sql.Int, id)
        .query(
          `UPDATE dbo.tickets SET updated_at = SYSUTCDATETIME() WHERE id = @id`,
        );
    }

    res.json({ success: true });
    emitTicketUpdate("commented", id);
  } catch (err) {
    console.error("[Tickets POST /comment]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;