const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

const CHANNELS = ["Call", "Email", "SMS", "WhatsApp", "InPerson", "Letter"];

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
             a.ApplicantName, b.BookingNo
      FROM dbo.CrmCommunicationLog c
      LEFT JOIN dbo.Users cu ON cu.id = c.CreatedBy
      LEFT JOIN dbo.CrmApplication a ON a.Id = c.ApplicationId
      LEFT JOIN dbo.CrmBooking b ON b.Id = c.BookingId
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

module.exports = router;
