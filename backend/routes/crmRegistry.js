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

// Registry is deliberately a separate, lightweight tracker for the ACT of
// registering the deed at the Sub-Registrar Office — not a duplicate of
// the registration DATA, which stays on CrmSalesDeed exactly as before
// (RegistrationNo/RegistrationDate/BookNo/PartNo/SubRegistrarOffice).
// Once this reaches Completed, that's what unlocks CrmSalesDeed.RegistrationNo
// being settable (see crmSalesDeed.js PUT /:id).
const REG_SELECT = `
  SELECT r.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile, sd.DeedNo
  FROM dbo.CrmRegistry r
  JOIN dbo.CrmBooking b ON b.Id = r.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = r.SalesDeedId
`;

router.get("/", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("r.Status = @st"); }
    const result = await req0.query(`${REG_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-registry] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-registry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${REG_SELECT} WHERE r.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-registry] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start Registry tracking for a booking. Gated on Query Payment
// being Confirmed — the customer must have actually paid the government
// before the deed can go to the Sub-Registrar Office for registration.
router.post("/", requirePageRight("crm-registry", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const qp = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id, Status FROM dbo.CrmQueryPayment WHERE BookingId = @bid");
    if (!qp.recordset.length || qp.recordset[0].Status !== "Confirmed") {
      return res.status(400).json({ error: "Registry requires Query Payment to be Confirmed first — the customer must have paid the government before the deed can be registered" });
    }

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmSalesDeed WHERE BookingId = @bid");

    const regNo = await getNextDocNumber(pool, "REG", "REG");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30), regNo)
      .input("bid",  sql.Int, bookingId)
      .input("sdid", sql.Int, deed.recordset[0]?.Id || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmRegistry (RegNo, BookingId, SalesDeedId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @sdid, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, RegNo: regNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Registry tracking already started for this booking" });
    console.error("[crm-registry] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/schedule — record the appointment date at the Sub-Registrar Office
router.put("/:id/schedule", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    if (!b.ScheduledDate) return res.status(400).json({ error: "ScheduledDate is required" });

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (cur.recordset[0].Status === "Completed") return res.status(400).json({ error: "Already completed" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id", sql.Int, id)
      .input("dt", sql.Date, b.ScheduledDate)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET Status = 'Scheduled', ScheduledDate = @dt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/schedule error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/complete — the deed has actually been registered at the office.
// This is the gate crmSalesDeed.js checks before letting RegistrationNo be
// filled in — mark this first, then go record the details on the deed.
router.put("/:id/complete", requirePageRight("crm-registry", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmRegistry WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Registry not found" });
    if (cur.recordset[0].Status === "Completed") return res.status(400).json({ error: "Already completed" });
    if (cur.recordset[0].Status !== "Scheduled") {
      return res.status(400).json({ error: "Registry must be Scheduled (appointment date recorded) before it can be marked Completed" });
    }
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id", sql.Int, id)
      .input("dt", sql.Date, b.CompletedDate || new Date().toISOString().slice(0, 10))
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmRegistry SET Status = 'Completed', CompletedDate = @dt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCommunication(pool, {
      bookingId: cur.recordset[0].BookingId, direction: "Outbound",
      subject: "Deed registered at Sub-Registrar Office",
      summary: "Registry completed — the sale deed has been officially registered.",
      createdBy: actorId(req),
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-registry] PUT /:id/complete error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
