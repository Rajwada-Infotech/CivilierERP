const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
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

// Amount is never stored on this table — it's read live from the Sales
// Deed's own StampDuty + RegistrationFee fields, which stay the single
// source of truth for what the deed actually costs to register. Query
// Payment only tracks whether that amount has been communicated to the
// customer and, later, whether they've actually paid it to the government.
const QP_SELECT = `
  SELECT qp.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile,
         sd.DeedNo, sd.StampDuty, sd.RegistrationFee,
         ISNULL(sd.StampDuty, 0) + ISNULL(sd.RegistrationFee, 0) AS RequiredAmount
  FROM dbo.CrmQueryPayment qp
  JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.Id = qp.SalesDeedId
`;

router.get("/", requirePageRight("crm-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("qp.Status = @st"); }
    const result = await req0.query(`${QP_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY qp.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-query-payment] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${QP_SELECT} WHERE qp.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-query-payment] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", requirePageRight("crm-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id).query(`${QP_SELECT} WHERE qp.Id = @id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Query Payment not found" });

    const attachments = await pool.request().input("id", sql.Int, id).query(`
      SELECT AttachmentId, DocType, FileName, MimeType, FileSize, UploadedBy, UploadedAt
      FROM dbo.CrmQueryPaymentAttachments WHERE QueryPaymentId = @id ORDER BY UploadedAt DESC
    `);
    res.json({ ...result.recordset[0], attachments: attachments.recordset });
  } catch (e) {
    console.error("[crm-query-payment] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start tracking Query Payment for a booking. Gated on a Sales
// Deed existing (that's where the amount comes from). Loan Processing is
// enforced further upstream, at Deed creation (see crmSalesDeed.js) — since
// a Deed can't exist without loan clearance, this is transitively enforced
// too without duplicating the check (and its error message) here.
router.post("/", requirePageRight("crm-query-payment", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmSalesDeed WHERE BookingId = @bid");
    if (!deed.recordset.length) {
      return res.status(400).json({ error: "Query Payment requires a Sales Deed to exist for this booking first (that's where the stamp duty / registration fee amount comes from)" });
    }

    const qpNo = await getNextDocNumber(pool, "QP", "QP");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30), qpNo)
      .input("bid",  sql.Int, bookingId)
      .input("sdid", sql.Int, deed.recordset[0].Id)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmQueryPayment (QPNo, BookingId, SalesDeedId, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @sdid, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, QPNo: qpNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Query Payment tracking already started for this booking" });
    console.error("[crm-query-payment] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/info — upload the paperwork/instructions for the customer and
// flip Status -> InfoSent. This is the outbound half: staff sending the
// customer what they need, not a document request FROM the customer (the
// customer never uploads here — see crmPortal.js for their read-only view).
router.post("/:id/info", requirePageRight("crm-query-payment", "edit"), upload.array("files", 10), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Query Payment not found" });
    const row = cur.recordset[0];
    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const actor = actorId(req);
    for (const file of req.files || []) {
      await pool.request()
        .input("qpid", sql.Int, id)
        .input("dtype", sql.NVarChar(20), "Info")
        .input("fname", sql.NVarChar(255), file.originalname)
        .input("mtype", sql.NVarChar(100), file.mimetype)
        .input("fsize", sql.Int, file.size)
        .input("fdata", sql.VarBinary(sql.MAX), file.buffer)
        .input("ub", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmQueryPaymentAttachments (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
          VALUES (@qpid, @dtype, @fname, @mtype, @fsize, @fdata, @ub)
        `);
    }

    if (row.Status === "Pending") {
      await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actor).query(`
        UPDATE dbo.CrmQueryPayment SET Status = 'InfoSent', InfoSentAt = SYSDATETIME(), InfoSentBy = @ub, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    }

    const booking = await pool.request().input("bid", sql.Int, row.BookingId)
      .query("SELECT AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Outbound",
      subject: "Stamp duty / registration payment details sent to customer",
      summary: "Required government payment amount and paperwork shared with the customer via portal.",
      createdBy: actor,
    });

    res.json({ success: true, count: (req.files || []).length });
  } catch (e) {
    console.error("[crm-query-payment] POST /:id/info error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/confirm — staff confirms the customer has actually paid the
// government. This is never company revenue (the company never receives
// this money) — it's a staff attestation, optionally with the customer's
// payment proof attached (DocType='Proof').
router.post("/:id/confirm", requirePageRight("crm-query-payment", "edit"), upload.single("proof"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Query Payment not found" });
    const row = cur.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed" });
    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const actor = actorId(req);
    if (req.file) {
      await pool.request()
        .input("qpid", sql.Int, id)
        .input("dtype", sql.NVarChar(20), "Proof")
        .input("fname", sql.NVarChar(255), req.file.originalname)
        .input("mtype", sql.NVarChar(100), req.file.mimetype)
        .input("fsize", sql.Int, req.file.size)
        .input("fdata", sql.VarBinary(sql.MAX), req.file.buffer)
        .input("ub", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmQueryPaymentAttachments (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
          VALUES (@qpid, @dtype, @fname, @mtype, @fsize, @fdata, @ub)
        `);
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("amt", sql.Decimal(18,2), b.ConfirmedAmount != null ? parseFloat(b.ConfirmedAmount) : null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmQueryPayment SET
          Status = 'Confirmed', ConfirmedAt = SYSDATETIME(), ConfirmedBy = @ub,
          ConfirmedAmount = @amt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: "Government payment confirmed",
      summary: "Staff confirmed the customer has remitted stamp duty / registration fee to the Sub-Registrar Office.",
      createdBy: actor,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-query-payment] POST /:id/confirm error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/attachment/:attachId", requirePageRight("crm-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const attachId = parseInt(req.params.attachId, 10);
    const result = await pool.request().input("id", sql.Int, attachId)
      .query("SELECT FileName, MimeType, FileData FROM dbo.CrmQueryPaymentAttachments WHERE AttachmentId = @id");
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", attachment.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.FileName)}"`);
    res.send(attachment.FileData);
  } catch (e) {
    console.error("[crm-query-payment] GET attachment error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
