const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const CHANNELS = ["Call", "Email", "SMS", "WhatsApp", "InPerson", "Letter", "System"];

router.get("/", requirePageRight("crm-communication", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { applicationId, bookingId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (applicationId) { req0.input("aid", sql.Int, parseInt(applicationId)); conds.push("c.ApplicationId = @aid"); }
    if (bookingId)      { req0.input("bid", sql.Int, parseInt(bookingId));     conds.push("c.BookingId = @bid"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT c.*, cu.name AS CreatedByName,
             a.ApplicantName, a.Mobile, a.Email, b.BookingNo
      FROM dbo.CrmCommunicationLog c
      LEFT JOIN dbo.CrmBooking b ON b.Id = c.BookingId
      -- Resolve the applicant via either linkage — a log entry created with
      -- only a BookingId still needs its ApplicantName/Mobile/Email so the
      -- Communication Log's call/SMS/WhatsApp/email quick-actions work.
      LEFT JOIN dbo.CrmApplication a ON a.Id = ISNULL(c.ApplicationId, b.ApplicationId)
      LEFT JOIN dbo.Users cu ON cu.id = c.CreatedBy
      ${where}
      ORDER BY c.ContactedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-communication] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-communication", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!CHANNELS.includes(b.Channel)) return res.status(400).json({ error: `Invalid Channel. Must be: ${CHANNELS.join(", ")}` });
    if (!b.ApplicationId && !b.BookingId) return res.status(400).json({ error: "ApplicationId or BookingId is required" });

    await pool.request()
      .input("aid",  sql.Int,           b.ApplicationId ? parseInt(b.ApplicationId) : null)
      .input("bid",  sql.Int,           b.BookingId ? parseInt(b.BookingId) : null)
      .input("ch",   sql.NVarChar(30),  b.Channel)
      .input("dir",  sql.NVarChar(20),  b.Direction || null)
      .input("subj", sql.NVarChar(300), b.Subject || null)
      .input("sum",  sql.NVarChar(sql.MAX), b.Summary || null)
      .input("cat",  sql.DateTime2(3),  b.ContactedAt || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCommunicationLog
          (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
        VALUES (@aid, @bid, @ch, @dir, @subj, @sum, ISNULL(@cat, SYSDATETIME()), @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-communication] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit an existing log entry. System-generated entries (auto-logged
// workflow events — see crmCommunicationLog.js's logCommunication()) are excluded:
// they're the audit trail for what actually happened on the record (agreement sent,
// deed sent, ticket raised, etc.), not a note staff typed, so they're not editable
// here — same reasoning as why Status is excluded from generic PUTs elsewhere in
// this module (e.g. crmMutation.js).
router.put("/:id", requirePageRight("crm-communication", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    if (b.Channel && !CHANNELS.includes(b.Channel)) return res.status(400).json({ error: `Invalid Channel. Must be: ${CHANNELS.join(", ")}` });

    const existing = await pool.request().input("id", sql.Int, id).query("SELECT Id, Channel FROM dbo.CrmCommunicationLog WHERE Id = @id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Log entry not found" });
    if (existing.recordset[0].Channel === "System") {
      return res.status(403).json({ error: "System-generated log entries are part of the audit trail and cannot be edited." });
    }

    await pool.request()
      .input("id",   sql.Int, id)
      .input("ch",   sql.NVarChar(30), b.Channel || null)
      .input("dir",  sql.NVarChar(20), b.Direction || null)
      .input("subj", sql.NVarChar(300), b.Subject ?? null)
      .input("sum",  sql.NVarChar(sql.MAX), b.Summary ?? null)
      .input("cat",  sql.DateTime2(3), b.ContactedAt || null)
      .query(`
        UPDATE dbo.CrmCommunicationLog SET
          Channel = ISNULL(@ch, Channel), Direction = ISNULL(@dir, Direction),
          Subject = @subj, Summary = @sum,
          ContactedAt = ISNULL(@cat, ContactedAt)
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-communication] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — same System-entry exclusion as PUT above. Table has no IsActive
// column (this is a hard delete), so a bypass here is unrecoverable — worth the
// extra SELECT to keep the audit trail intact.
router.delete("/:id", requirePageRight("crm-communication", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const existing = await pool.request().input("id", sql.Int, id).query("SELECT Id, Channel FROM dbo.CrmCommunicationLog WHERE Id = @id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Log entry not found" });
    if (existing.recordset[0].Channel === "System") {
      return res.status(403).json({ error: "System-generated log entries are part of the audit trail and cannot be deleted." });
    }
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmCommunicationLog WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-communication] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;