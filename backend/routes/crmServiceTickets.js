const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const CATEGORIES = ["Warranty", "Complaint", "ServiceRequest", "SocietyIssue", "Legal", "Modification", "Other"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
// SLA windows in hours, keyed by priority — used to auto-set SlaDueDate
const SLA_HOURS = { Urgent: 24, High: 48, Normal: 96, Low: 168 };

const TICKET_SELECT = `
  SELECT
    t.Id, t.TicketNo, t.BookingId, t.Category, t.Priority, t.Subject, t.Description,
    t.Status, t.AssignedTo, t.SlaDueDate, t.ResolvedAt, t.ResolutionNotes,
    t.CustomerRating, t.CustomerFeedback, t.RaisedByCustomer, t.CreatedAt, t.UpdatedAt,
    b.BookingNo, b.UnitNo, b.ProjectName,
    a.ApplicantName, a.Mobile,
    u.name  AS AssigneeName,
    cu.name AS CreatedByName
  FROM dbo.CrmServiceTicket t
  JOIN  dbo.CrmBooking b     ON b.Id = t.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users u  ON u.id  = t.AssignedTo
  LEFT JOIN dbo.Users cu ON cu.id = t.CreatedBy
`;

// GET / — all tickets (non-admins see only tickets assigned to them)
router.get("/", requirePageRight("crm-service-tickets", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, priority, category } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (!isSaAdmin(req)) {
      req0.input("actorId", sql.Int, actorId(req));
      conds.push("t.AssignedTo = @actorId");
    }
    if (status)   { req0.input("st", sql.NVarChar(30), status);   conds.push("t.Status = @st"); }
    if (priority) { req0.input("pr", sql.NVarChar(20), priority); conds.push("t.Priority = @pr"); }
    if (category) { req0.input("ct", sql.NVarChar(50), category); conds.push("t.Category = @ct"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${TICKET_SELECT} ${where} ORDER BY
      CASE t.Priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 ELSE 4 END,
      t.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-service-tickets] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — tickets for a specific booking
router.get("/booking/:bookingId", requirePageRight("crm-service-tickets", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bid)
      .query(`${TICKET_SELECT} WHERE t.BookingId = @bid ORDER BY t.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-service-tickets] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — raise a service ticket. Gated on the booking actually existing
// and still being active (not Cancelled/Rejected) — but not on Handover
// having occurred, since legitimate complaints (site/quality issues,
// construction snags) can and should be raiseable before possession too,
// not just after.
router.post("/", requirePageRight("crm-service-tickets", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);
    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (!CATEGORIES.includes(b.Category))
      return res.status(400).json({ error: `Invalid Category. Must be: ${CATEGORIES.join(", ")}` });
    if (!b.Subject?.trim()) return res.status(400).json({ error: "Subject is required" });

    const priority = PRIORITIES.includes(b.Priority) ? b.Priority : "Normal";
    const ticketNo = await getNextDocNumber(pool, "SVC", "SVC");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  ticketNo)
      .input("bid",  sql.Int,           parseInt(b.BookingId))
      .input("cat",  sql.NVarChar(50),  b.Category)
      .input("pri",  sql.NVarChar(20),  priority)
      .input("subj", sql.NVarChar(300), b.Subject.trim())
      .input("desc", sql.NVarChar(sql.MAX), b.Description || null)
      .input("asgn", sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : null)
      .input("sla",  sql.DateTime2(3),  new Date(Date.now() + SLA_HOURS[priority] * 3600 * 1000))
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmServiceTicket
          (TicketNo, BookingId, Category, Priority, Subject, Description, Status, AssignedTo, SlaDueDate, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cat, @pri, @subj, @desc, 'Open', @asgn, @sla, @cb, SYSDATETIME())
      `);

    if (b.AssignedTo) {
      await emitNotification(pool, parseInt(b.AssignedTo), "service_ticket_assigned",
        "Service Ticket Assigned", `${ticketNo}: ${b.Subject.trim()}`,
        result.recordset[0].Id, "service_ticket");
    }

    res.status(201).json({ success: true, id: result.recordset[0].Id, TicketNo: ticketNo });
  } catch (e) {
    console.error("[crm-service-tickets] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update/assign ticket. Status is never accepted from the request
// body — it only ever advances via the level-wise action endpoints below
// (mark-in-progress/resolve/close/reopen), or auto-derives to 'Assigned'
// here the moment an AssignedTo is set on an Open ticket.
router.put("/:id", requirePageRight("crm-service-tickets", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const prev = await pool.request().input("id", sql.Int, id)
      .query("SELECT AssignedTo, TicketNo, Subject, Status, BookingId FROM dbo.CrmServiceTicket WHERE Id = @id");
    if (!prev.recordset.length) return res.status(404).json({ error: "Ticket not found" });
    const activeErr = await requireActiveBooking(pool, prev.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",   sql.Int,           id)
      .input("pri",  sql.NVarChar(20),  b.Priority || null)
      .input("asgn", sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmServiceTicket SET
          Priority = ISNULL(@pri, Priority),
          AssignedTo = ISNULL(@asgn, AssignedTo),
          Status = CASE WHEN Status = 'Open' AND @asgn IS NOT NULL THEN 'Assigned' ELSE Status END,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Notify newly assigned technician
    const newAssignee = b.AssignedTo ? parseInt(b.AssignedTo) : null;
    if (newAssignee && String(newAssignee) !== String(prev.recordset[0].AssignedTo ?? "")) {
      await emitNotification(pool, newAssignee, "service_ticket_assigned",
        "Service Ticket Assigned", `${prev.recordset[0].TicketNo}: ${prev.recordset[0].Subject}`,
        id, "service_ticket");
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-service-tickets] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-in-progress — Assigned -> InProgress. Requires the ticket to
// already be assigned to someone (there must be an owner actively on it).
router.put("/:id/mark-in-progress", requirePageRight("crm-service-tickets", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, AssignedTo, BookingId FROM dbo.CrmServiceTicket WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Ticket not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (!["Assigned", "Reopened"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot mark-in-progress from status '${cur.recordset[0].Status}'` });
    }
    if (!cur.recordset[0].AssignedTo) {
      return res.status(400).json({ error: "Ticket must be assigned before work can start" });
    }
    await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actorId(req)).query(`
      UPDATE dbo.CrmServiceTicket SET Status = 'InProgress', UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id
    `);
    res.json({ success: true, status: "InProgress" });
  } catch (e) {
    console.error("[crm-service-tickets] mark-in-progress error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/resolve — Assigned/InProgress -> Resolved. Requires ResolutionNotes
// (the real evidence the issue was actually addressed).
router.put("/:id/resolve", requirePageRight("crm-service-tickets", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.ResolutionNotes?.trim()) return res.status(400).json({ error: "ResolutionNotes is required to resolve a ticket" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, BookingId FROM dbo.CrmServiceTicket WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Ticket not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (!["Assigned", "InProgress", "Reopened"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot resolve from status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("res", sql.NVarChar(sql.MAX), b.ResolutionNotes.trim())
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmServiceTicket SET
          Status = 'Resolved', ResolutionNotes = @res, ResolvedAt = SYSDATETIME(),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Resolved" });
  } catch (e) {
    console.error("[crm-service-tickets] resolve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/close — Resolved -> Closed. Optionally records CustomerRating/Feedback.
router.put("/:id/close", requirePageRight("crm-service-tickets", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, BookingId FROM dbo.CrmServiceTicket WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Ticket not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (cur.recordset[0].Status !== "Resolved") {
      return res.status(400).json({ error: `Cannot close from status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("rate", sql.Int, b.CustomerRating != null ? parseInt(b.CustomerRating) : null)
      .input("fb", sql.NVarChar(sql.MAX), b.CustomerFeedback || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmServiceTicket SET
          Status = 'Closed', CustomerRating = ISNULL(@rate, CustomerRating),
          CustomerFeedback = ISNULL(@fb, CustomerFeedback),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Closed" });
  } catch (e) {
    console.error("[crm-service-tickets] close error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/reopen — Resolved/Closed -> Reopened. Requires a reason.
router.put("/:id/reopen", requirePageRight("crm-service-tickets", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.Reason?.trim()) return res.status(400).json({ error: "Reason is required to reopen a ticket" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, BookingId FROM dbo.CrmServiceTicket WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Ticket not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (!["Resolved", "Closed"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: `Cannot reopen from status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("res", sql.NVarChar(sql.MAX), b.Reason.trim())
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmServiceTicket SET
          Status = 'Reopened', ResolutionNotes = @res, ResolvedAt = NULL,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: "Reopened" });
  } catch (e) {
    console.error("[crm-service-tickets] reopen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
