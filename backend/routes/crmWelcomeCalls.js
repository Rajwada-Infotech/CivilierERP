const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);

const WC_SELECT = `
  SELECT
    wc.Id, wc.BookingId, wc.CalledBy, wc.CallDate, wc.DurationSeconds,
    wc.Outcome, wc.NextCallDate, wc.Notes, wc.CreatedAt,
    u.name  AS CalledByName,
    b.BookingNo, b.UnitNo, b.ProjectName,
    a.ApplicantName, a.Mobile
  FROM dbo.CrmWelcomeCall wc
  JOIN  dbo.CrmBooking b     ON b.Id = wc.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users u      ON u.id = wc.CalledBy
`;

const OUTCOMES = ["Welcomed","NotReachable","RequestedCallback","VoiceMail","Busy","SwitchedOff"];

// GET / — all welcome calls
router.get("/", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId, pending } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (bookingId) { req0.input("bid", sql.Int, parseInt(bookingId)); conds.push("wc.BookingId = @bid"); }
    if (pending === "1") conds.push("wc.NextCallDate <= CAST(SYSDATETIME() AS DATE)");
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${WC_SELECT} ${where} ORDER BY wc.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-calls] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — log a welcome call
router.post("/", requirePageRight("crm-welcome-calls", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    if (b.Outcome && !OUTCOMES.includes(b.Outcome))
      return res.status(400).json({ error: `Invalid Outcome. Must be: ${OUTCOMES.join(", ")}` });

    await pool.request()
      .input("bid",  sql.Int,           parseInt(b.BookingId))
      .input("cb",   sql.Int,           b.CalledBy ? parseInt(b.CalledBy) : actorId(req))
      .input("dt",   sql.DateTime2(3),  b.CallDate || null)
      .input("dur",  sql.Int,           b.DurationSeconds ? parseInt(b.DurationSeconds) : null)
      .input("out",  sql.NVarChar(50),  b.Outcome || null)
      .input("ncd",  sql.Date,          b.NextCallDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("acb",  sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmWelcomeCall (BookingId, CalledBy, CallDate, DurationSeconds, Outcome, NextCallDate, Notes, CreatedBy, CreatedAt)
        VALUES (@bid, @cb, ISNULL(@dt, SYSDATETIME()), @dur, @out, @ncd, @note, @acb, SYSDATETIME())
      `);
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
