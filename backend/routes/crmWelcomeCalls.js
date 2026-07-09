const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { maybeAutoCreateAgreement } = require("../services/crmWorkflowGuards");
const { emitNotification } = require("../services/notify");

router.use(authMiddleware);

const WC_SELECT = `
  SELECT
    wc.Id, wc.BookingId, wc.CalledBy, wc.CallDate, wc.DurationSeconds,
    wc.Outcome, wc.NextCallDate, wc.Notes, wc.CustomFields, wc.PreferredAgreementDate, wc.CreatedAt,
    u.name  AS CalledByName,
    b.BookingNo, b.UnitNo, b.ProjectName,
    a.ApplicantName, a.Mobile
  FROM dbo.CrmWelcomeCall wc
  JOIN  dbo.CrmBooking b     ON b.Id = wc.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users u      ON u.id = wc.CalledBy
`;

const OUTCOMES = ["Welcomed","NotReachable","RequestedCallback","VoiceMail","Busy","SwitchedOff"];

// GET /queue — the work queue: Approved bookings that still need a welcome
// call, or have a callback due today/overdue. Never Cancelled/Rejected/
// Pending bookings — those have no business being called yet.
router.get("/queue", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id AS BookingId, b.BookingNo, b.UnitNo, b.ProjectName, b.BookingDate,
        a.ApplicantName, a.Mobile,
        last.Id AS LastCallId, last.Outcome AS LastOutcome, last.CallDate AS LastCallDate,
        last.NextCallDate
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      OUTER APPLY (
        SELECT TOP 1 Id, Outcome, CallDate, NextCallDate
        FROM dbo.CrmWelcomeCall
        WHERE BookingId = b.Id
        ORDER BY CallDate DESC, CreatedAt DESC
      ) last
      WHERE b.Status = 'Approved' AND b.IsActive = 1
        AND (
          last.Id IS NULL
          OR (last.Outcome <> 'Welcomed' AND (last.NextCallDate IS NULL OR last.NextCallDate <= CAST(SYSDATETIME() AS DATE)))
        )
      ORDER BY ISNULL(last.NextCallDate, b.BookingDate)
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-calls] GET /queue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId/checklist — aggregate status of every intake step for one
// booking, so the detail panel can show a single progress checklist instead
// of staff hopping between pages to check each one manually.
router.get("/:bookingId/checklist", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const [welcome, docs, coApplicants, bankDetail, noc, agreement] = await Promise.all([
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CallDate DESC, CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Total, SUM(CASE WHEN IsVerified = 1 THEN 1 ELSE 0 END) AS Verified FROM dbo.CrmBookingDocument WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1"),
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 CASE WHEN
          NULLIF(LTRIM(RTRIM(ISNULL(BankName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(IfscCode, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountHolderName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(NomineeName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(NomineeRelation, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(PanNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AadhaarNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(Occupation, ''))), '') IS NOT NULL
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsComplete
        FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id, NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
    ]);

    res.json({
      welcomeCall: { done: welcome.recordset[0]?.Outcome === "Welcomed" },
      documents: { total: docs.recordset[0]?.Total || 0, verified: docs.recordset[0]?.Verified || 0 },
      coApplicants: { count: coApplicants.recordset[0]?.Cnt || 0 },
      bankDetails: { complete: !!bankDetail.recordset[0]?.IsComplete },
      noc: noc.recordset,
      agreement: agreement.recordset[0] || null,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/checklist error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

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

    // Ad-hoc custom fields: array of {key, value} the caller can freely add
    // to at call time, no admin setup needed — stored as JSON, never parsed
    // into columns.
    let customFieldsJson = null;
    if (Array.isArray(b.CustomFields) && b.CustomFields.length) {
      const cleaned = b.CustomFields
        .filter((f) => f && String(f.key || "").trim())
        .map((f) => ({ key: String(f.key).trim(), value: String(f.value ?? "").trim() }));
      if (cleaned.length) customFieldsJson = JSON.stringify(cleaned);
    }

    const bookingId = parseInt(b.BookingId);
    await pool.request()
      .input("bid",  sql.Int,           bookingId)
      .input("cb",   sql.Int,           b.CalledBy ? parseInt(b.CalledBy) : actorId(req))
      .input("dt",   sql.DateTime2(3),  b.CallDate || null)
      .input("dur",  sql.Int,           b.DurationSeconds ? parseInt(b.DurationSeconds) : null)
      .input("out",  sql.NVarChar(50),  b.Outcome || null)
      .input("ncd",  sql.Date,          b.NextCallDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cf",   sql.NVarChar(sql.MAX), customFieldsJson)
      .input("pad",  sql.Date,          b.PreferredAgreementDate || null)
      .input("acb",  sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmWelcomeCall (BookingId, CalledBy, CallDate, DurationSeconds, Outcome, NextCallDate, Notes, CustomFields, PreferredAgreementDate, CreatedBy, CreatedAt)
        VALUES (@bid, @cb, ISNULL(@dt, SYSDATETIME()), @dur, @out, @ncd, @note, @cf, @pad, @acb, SYSDATETIME())
      `);

    const bookingRow = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
    const booking = bookingRow.recordset[0];

    // Auto-flow: every logged call is itself a customer touchpoint — seed it
    // into the Communication Log automatically so that page becomes the
    // unified, continuing record of "further works and other tasks" instead
    // of staff having to separately re-log the same call there by hand.
    if (booking) {
      await pool.request()
        .input("aid",  sql.Int, booking.ApplicationId)
        .input("bid",  sql.Int, bookingId)
        .input("subj", sql.NVarChar(300), `Welcome Call${b.Outcome ? ` — ${b.Outcome}` : ""}`)
        .input("sum",  sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cat",  sql.DateTime2(3), b.CallDate || null)
        .input("cb",   sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmCommunicationLog
            (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
          VALUES (@aid, @bid, 'Call', 'Outbound', @subj, @sum, ISNULL(@cat, SYSDATETIME()), @cb, SYSDATETIME())
        `);
    }

    // Auto-flow: a completed welcome call is one of two prerequisites for
    // agreement prep — fire the auto-create check (no-op if bank/nominee
    // details aren't in yet) rather than waiting on staff to notice.
    if (b.Outcome === "Welcomed") {
      const created = await maybeAutoCreateAgreement(pool, bookingId, actorId(req));
      if (!created && booking?.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_bank_details_due",
          "Customer Details Needed",
          `Welcome call done for booking ${booking.BookingNo} — collect bank, nominee, PAN, and Aadhaar details to proceed to agreement.`,
          bookingId, "crm_booking");
      }
    }

    res.status(201).json({ success: true, bookingId });
  } catch (e) {
    console.error("[crm-welcome-calls] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
