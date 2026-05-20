/**
 * ticketRoutes.js
 * Full ticket workflow: create → assign → comment → resolve/close
 * Auth-protected — all endpoints require valid JWT (via global authMiddleware in server.js).
 * Role-gated endpoints explicitly checked with allowRoles().
 */

const express = require("express");
const router  = express.Router();
const { getPool, sql } = require("../db");
const allowRoles = require("../middleware/role");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userFromReq(req) {
  // req.user is set by authMiddleware: { userId, name, role, email }
  return {
    id:   req.user?.userId ?? null,
    name: req.user?.name   ?? req.user?.email ?? "Unknown",
    role: req.user?.role   ?? "user",
  };
}

function isTicketAdmin(role) {
  return ["admin", "super_admin", "dba"].includes(role);
}

async function getAccessibleTicket(pool, id, actor) {
  const result = await pool.request()
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
// Admins/super_admin/dba see ALL tickets.
// Regular users see tickets they created or tickets assigned to them.
router.get("/", async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool  = getPool();
    const isAdmin = isTicketAdmin(actor.role);

    const request = pool.request();
    let query;

    if (isAdmin) {
      query = `
        SELECT t.*,
               (SELECT COUNT(*) FROM dbo.ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
        FROM dbo.tickets t
        ORDER BY
          CASE t.status WHEN 'Pending' THEN 0 WHEN 'InProgress' THEN 1 ELSE 2 END,
          CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
          t.created_at DESC
      `;
    } else {
      // Regular users see tickets they created or tickets assigned to them.
      request.input("userId", sql.Int, actor.id);
      query = `
        SELECT t.*,
               (SELECT COUNT(*) FROM dbo.ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
        FROM dbo.tickets t
        WHERE t.created_by_id = @userId OR t.assigned_to_id = @userId
        ORDER BY
          CASE t.status WHEN 'Pending' THEN 0 WHEN 'InProgress' THEN 1 ELSE 2 END,
          t.created_at DESC
      `;
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("[Tickets GET /]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickets/stats ───────────────────────────────────────────────────
// Summary stats for Admin Dashboard widget — admin+ only
router.get("/stats", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        COUNT(*)                                                     AS total,
        SUM(CASE WHEN status = 'Pending'    THEN 1 ELSE 0 END)      AS pending,
        SUM(CASE WHEN status = 'InProgress' THEN 1 ELSE 0 END)      AS in_progress,
        SUM(CASE WHEN status = 'Resolved'   THEN 1 ELSE 0 END)      AS resolved,
        SUM(CASE WHEN status = 'Closed'     THEN 1 ELSE 0 END)      AS closed,
        SUM(CASE WHEN priority = 'Urgent' AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS urgent_open,
        SUM(CASE WHEN priority = 'High'   AND status NOT IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS high_open
      FROM dbo.tickets
    `);

    const recentPending = await pool.request().query(`
      SELECT TOP 5 id, subject, priority, customer_name, created_at, assigned_to
      FROM dbo.tickets
      WHERE status IN ('Pending','InProgress')
      ORDER BY
        CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
        created_at DESC
    `);

    res.json({
      counts:        result.recordset[0],
      recentPending: recentPending.recordset,
    });
  } catch (err) {
    console.error("[Tickets GET /stats]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickets/mine ───────────────────────────────────────────────────
// Personal ticket queue for the Ticket module. Even admins only see tickets
// they created or tickets assigned to them here; the Admin Dashboard uses GET /.
router.get("/mine", async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool = getPool();

    const result = await pool.request()
      .input("userId", sql.Int, actor.id)
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
    console.error("[Tickets GET /mine]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickets/:id ─────────────────────────────────────────────────────
// Get a single ticket + its comment trail
router.get("/:id", async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const access = await getAccessibleTicket(pool, id, actor);
    if (access.status === 404) return res.status(404).json({ error: "Ticket not found" });
    if (access.status === 403) return res.status(403).json({ error: "Access denied" });

    const comments = await pool.request()
      .input("tid", sql.Int, id)
      .query(`SELECT * FROM dbo.ticket_comments WHERE ticket_id = @tid ORDER BY created_at ASC`);

    res.json({ ticket: access.ticket, comments: comments.recordset });
  } catch (err) {
    console.error("[Tickets GET /:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tickets/create ─────────────────────────────────────────────────
router.post("/create", async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool  = getPool();
    const {
      subject, priority, issue_details,
      customer_name, customer_phone,
      company_id, project_id, attachment_path,
    } = req.body;

    if (!subject || !issue_details || !customer_name) {
      return res.status(400).json({ error: "subject, issue_details and customer_name are required" });
    }

    await pool.request()
      .input("subject",         sql.NVarChar(500),    subject)
      .input("priority",        sql.NVarChar(50),     priority ?? "Medium")
      .input("issue_details",   sql.NVarChar(sql.MAX), issue_details)
      .input("customer_name",   sql.NVarChar(255),    customer_name)
      .input("customer_phone",  sql.NVarChar(50),     customer_phone ?? null)
      .input("company_id",      sql.Int,              company_id ?? null)
      .input("project_id",      sql.Int,              project_id ?? null)
      .input("attachment_path", sql.NVarChar(sql.MAX), attachment_path ?? null)
      .input("created_by",      sql.NVarChar(255),    actor.name)
      .input("created_by_id",   sql.Int,              actor.id)
      .query(`
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
        )
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("[Tickets POST /create]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/assign/:id ─────────────────────────────────────────────
// Admin assigns ticket to a staff member
router.put("/assign/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const pool = getPool();
    const id   = parseInt(req.params.id);
    const { assigned_to_id, assigned_to } = req.body;

    if (!assigned_to_id || !assigned_to) {
      return res.status(400).json({ error: "assigned_to_id and assigned_to are required" });
    }

    await pool.request()
      .input("id",             sql.Int,         id)
      .input("assigned_to",    sql.NVarChar(255), assigned_to)
      .input("assigned_to_id", sql.Int,          assigned_to_id)
      .query(`
        UPDATE dbo.tickets
        SET assigned_to    = @assigned_to,
            assigned_to_id = @assigned_to_id,
            status         = CASE WHEN status = 'Pending' THEN 'InProgress' ELSE status END,
            updated_at     = SYSUTCDATETIME()
        WHERE id = @id
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("[Tickets PUT /assign]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/resolve/:id ────────────────────────────────────────────
// Any logged-in user can resolve; resolution_note mandatory for admins
router.put("/resolve/:id", async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool  = getPool();
    const id    = parseInt(req.params.id);
    const { resolution_note } = req.body;

    const access = await getAccessibleTicket(pool, id, actor);
    if (access.status === 404) return res.status(404).json({ error: "Ticket not found" });
    if (access.status === 403) return res.status(403).json({ error: "Access denied" });

    await pool.request()
      .input("id",              sql.Int,          id)
      .input("resolved_by",     sql.NVarChar(255), actor.name)
      .input("resolved_by_id",  sql.Int,          actor.id)
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

    // Auto-add resolution comment if note provided
    if (resolution_note?.trim()) {
      await pool.request()
        .input("ticket_id",   sql.Int,          id)
        .input("comment",     sql.NVarChar(sql.MAX), `[Resolved] ${resolution_note.trim()}`)
        .input("author_name", sql.NVarChar(255), actor.name)
        .input("author_id",   sql.Int,          actor.id)
        .input("author_role", sql.NVarChar(50), actor.role)
        .query(`
          INSERT INTO dbo.ticket_comments (ticket_id, comment, author_name, author_id, author_role)
          VALUES (@ticket_id, @comment, @author_name, @author_id, @author_role)
        `);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Tickets PUT /resolve]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/tickets/close/:id ──────────────────────────────────────────────
// Admin closes a resolved ticket (final state)
router.put("/close/:id", allowRoles("admin", "super_admin", "dba"), async (req, res) => {
  try {
    const actor = userFromReq(req);
    const pool  = getPool();
    const id    = parseInt(req.params.id);

    await pool.request()
      .input("id",         sql.Int, id)
      .input("updated_at", sql.DateTime2, new Date())
      .query(`
        UPDATE dbo.tickets
        SET status     = 'Closed',
            closed_at  = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    res.json({ success: true });
  } catch (err) {
    console.error("[Tickets PUT /close]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tickets/comment/:id ───────────────────────────────────────────
// Add a comment to a ticket (any authenticated user who has access)
router.post("/comment/:id", async (req, res) => {
  try {
    const actor  = userFromReq(req);
    const pool   = getPool();
    const id     = parseInt(req.params.id);
    const { comment } = req.body;

    if (!comment?.trim()) return res.status(400).json({ error: "Comment cannot be empty" });

    // Verify ticket exists and user has access
    const ticket = await pool.request()
      .input("id", sql.Int, id)
      .query(`SELECT id, created_by_id, assigned_to_id FROM dbo.tickets WHERE id = @id`);

    if (!ticket.recordset.length) return res.status(404).json({ error: "Ticket not found" });

    const t = ticket.recordset[0];
    if (!isTicketAdmin(actor.role) && t.created_by_id !== actor.id && t.assigned_to_id !== actor.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    await pool.request()
      .input("ticket_id",   sql.Int,          id)
      .input("comment",     sql.NVarChar(sql.MAX), comment.trim())
      .input("author_name", sql.NVarChar(255), actor.name)
      .input("author_id",   sql.Int,          actor.id)
      .input("author_role", sql.NVarChar(50), actor.role)
      .query(`
        INSERT INTO dbo.ticket_comments (ticket_id, comment, author_name, author_id, author_role)
        VALUES (@ticket_id, @comment, @author_name, @author_id, @author_role)
      `);

    // Touch updated_at on ticket
    await pool.request()
      .input("id", sql.Int, id)
      .query(`UPDATE dbo.tickets SET updated_at = SYSUTCDATETIME() WHERE id = @id`);

    res.json({ success: true });
  } catch (err) {
    console.error("[Tickets POST /comment]", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
