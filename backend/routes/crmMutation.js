const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { logCrmAudit } = require("../services/crmAudit");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Mutation tracks the municipal-record update (Khata Transfer) that follows
// Sale Deed registration. Gate: CrmRegistry.Status = 'Completed' — the deed
// must be officially registered before municipal records can be updated.
const MUT_SELECT = `
  SELECT m.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         sd.DeedNo, sd.RegistrationNo
  FROM dbo.CrmMutation m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.BookingId = b.Id
`;

router.get("/", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("m.Status = @st"); }
    const result = await req0.query(`${MUT_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-mutation] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-mutation", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${MUT_SELECT} WHERE m.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-mutation] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start mutation tracking. Gate: Sale Deed Registry must be Completed.
router.post("/", requirePageRight("crm-mutation", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const reg = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Status FROM dbo.CrmRegistry WHERE BookingId = @bid");
    if (!reg.recordset.length || reg.recordset[0].Status !== "Completed") {
      return res.status(400).json({ error: "Mutation requires the Sale Deed Registry to be Completed — the deed must be officially registered at the Sub-Registrar Office before mutation can be applied" });
    }

    const mutNo = await getNextDocNumber(pool, "MUT", "MUT");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  mutNo)
      .input("bid",  sql.Int,           bookingId)
      .input("ano",  sql.NVarChar(100), b.ApplicationNo   || null)
      .input("ad",   sql.Date,          b.ApplicationDate || null)
      .input("auth", sql.NVarChar(200), b.Authority       || null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks     || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmMutation (MutationNo, BookingId, Status, ApplicationNo, ApplicationDate, Authority, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, 'Applied', @ano, @ad, @auth, @rem, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, MutationNo: mutNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Mutation tracking already started for this booking" });
    console.error("[crm-mutation] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update editable metadata fields only. Status is never accepted here;
// use PUT /:id/approve for the Approved transition.
router.put("/:id", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });

    if (b.Status) return res.status(400).json({ error: "Use PUT /:id/approve to advance the status" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",   sql.Int, id)
      .input("ano",  sql.NVarChar(100), b.ApplicationNo   || null)
      .input("ad",   sql.Date,          b.ApplicationDate || null)
      .input("apno", sql.NVarChar(100), b.ApprovedNo      || null)
      .input("apd",  sql.Date,          b.ApprovedDate    || null)
      .input("auth", sql.NVarChar(200), b.Authority       || null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks     || null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmMutation SET
          ApplicationNo   = ISNULL(@ano,  ApplicationNo),
          ApplicationDate = ISNULL(@ad,   ApplicationDate),
          ApprovedNo      = ISNULL(@apno, ApprovedNo),
          ApprovedDate    = ISNULL(@apd,  ApprovedDate),
          Authority       = ISNULL(@auth, Authority),
          Remarks         = ISNULL(@rem,  Remarks),
          UpdatedBy       = @ub,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — advance from Applied → Approved. One-way; cannot be reversed.
router.put("/:id/approve", requirePageRight("crm-mutation", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status, MutationNo FROM dbo.CrmMutation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Mutation record not found" });
    if (cur.recordset[0].Status === "Approved") return res.status(400).json({ error: "Already approved" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",   sql.Int, id)
      .input("apno", sql.NVarChar(100), b.ApprovedNo   || null)
      .input("apd",  sql.Date,          b.ApprovedDate || null)
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks  || null)
      .input("ub",   sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmMutation SET
          Status       = 'Approved',
          ApprovedNo   = ISNULL(@apno, ApprovedNo),
          ApprovedDate = ISNULL(@apd,  CONVERT(DATE, SYSDATETIME())),
          Remarks      = ISNULL(@rem,  Remarks),
          UpdatedBy    = @ub,
          UpdatedAt    = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Mutation", id, actorId(req), [
      { field: "Status", oldVal: "Applied", newVal: "Approved" },
    ]);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-mutation] PUT /:id/approve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
