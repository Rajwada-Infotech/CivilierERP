const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// AFS Registry tracks the act of registering the Agreement for Sale at the
// Sub-Registrar Office (Visit 1). It mirrors CrmRegistry (Visit 2 / Sale
// Deed), but is gated on AFS Query Payment being Confirmed instead.
// The registration details (AfsRegistrationNo/Date/StampDuty/RegFee) are
// still entered on the Agreement via crmAgreements mark-registered — this
// table only tracks the workflow checkpoint.
const AREG_SELECT = `
  SELECT ar.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         ag.AgreementNo, ag.AfsRegistrationNo
  FROM dbo.CrmAfsRegistry ar
  JOIN dbo.CrmBooking b ON b.Id = ar.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmAgreement ag ON ag.Id = ar.AgreementId
`;

router.get("/", requirePageRight("crm-afs-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("ar.Status = @st"); }
    const result = await req0.query(`${AREG_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ar.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-afs-registry] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-afs-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${AREG_SELECT} WHERE ar.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-afs-registry] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start AFS Registry for a booking.
// Gated on AFS Query Payment being Confirmed — customer must have paid the
// AFS stamp duty to the government before they attend the Sub-Registrar.
router.post("/", requirePageRight("crm-afs-registry", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const aqp = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, Status FROM dbo.CrmAfsQueryPayment WHERE BookingId = @bid");
    if (!aqp.recordset.length || aqp.recordset[0].Status !== "Confirmed") {
      return res.status(400).json({ error: "AFS Registry requires AFS Query Payment to be Confirmed first — the customer must have paid the AFS stamp duty before attending the Sub-Registrar Office" });
    }

    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");

    // Pre-check: guard against duplicate creation before consuming a doc-number
    // sequence slot. UNIQUE(BookingId) exists (migration 371) but only fires at
    // INSERT time — a concurrent double-submit would waste an AREG number and
    // return an opaque error before our 409 catch could fire.
    const existingReg = await pool.request().input("bid2", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, AfsRegNo FROM dbo.CrmAfsRegistry WHERE BookingId = @bid2");
    if (existingReg.recordset.length) {
      return res.status(409).json({
        error: `AFS Registry tracking (${existingReg.recordset[0].AfsRegNo}) has already been started for this booking`,
      });
    }

    const afsRegNo = await getNextDocNumber(pool, "AREG", "AREG");
    const result = await pool.request()
      .input("no",    sql.NVarChar(30), afsRegNo)
      .input("bid",   sql.Int, bookingId)
      .input("agrid", sql.Int, agr.recordset[0]?.Id || null)
      .input("cb",    sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAfsRegistry (AfsRegNo, BookingId, AgreementId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @agrid, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, AfsRegNo: afsRegNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "AFS Registry tracking already started for this booking" });
    console.error("[crm-afs-registry] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/schedule — record the appointment date at the Sub-Registrar Office
router.put("/:id/schedule", requirePageRight("crm-afs-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.ScheduledDate) return res.status(400).json({ error: "ScheduledDate is required" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmAfsRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "AFS Registry not found" });
    if (cur.recordset[0].Status === "Completed") return res.status(400).json({ error: "Already completed" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",  sql.Int, id)
      .input("dt",  sql.Date, b.ScheduledDate)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmAfsRegistry SET Status = 'Scheduled', ScheduledDate = @dt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-afs-registry] PUT /:id/schedule error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/complete — the AFS has been physically registered at the office.
// After this, staff records the AfsRegistrationNo/Date on the Agreement via
// crmAgreements.js PUT /:id/mark-registered.
router.put("/:id/complete", requirePageRight("crm-afs-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmAfsRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "AFS Registry not found" });
    if (cur.recordset[0].Status === "Completed") return res.status(400).json({ error: "Already completed" });
    if (cur.recordset[0].Status !== "Scheduled") {
      return res.status(400).json({ error: "AFS Registry must be Scheduled (appointment date recorded) before it can be marked Completed" });
    }
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",  sql.Int, id)
      .input("dt",  sql.Date, b.CompletedDate || new Date().toISOString().slice(0, 10))
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmAfsRegistry SET Status = 'Completed', CompletedDate = @dt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCommunication(pool, {
      bookingId: cur.recordset[0].BookingId, direction: "Outbound",
      subject: "AFS registered at Sub-Registrar Office",
      summary: "AFS Registry completed — the Agreement for Sale has been officially registered. Enter the AfsRegistrationNo on the Agreement record.",
      createdBy: actorId(req),
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-afs-registry] PUT /:id/complete error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
