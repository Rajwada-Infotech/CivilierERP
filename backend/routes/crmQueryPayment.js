const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const uploadQP = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Base64 inflates payload ~33%, and the whole request shares one 10mb JSON
// body cap (server.js) across every staged file plus JSON structure — so
// this per-file cap has to leave real headroom, not just sit under 10mb
// itself. Kept in sync with the client-side cap in CrmQueryPayment.tsx.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Files arrive as base64 in the JSON body (not multipart) — decoded here
// back into the exact bytes the client staged and previewed, then stored in
// the existing VARBINARY(MAX) column exactly as a multipart upload would
// have stored them. Throws on anything over the size cap or with no data.
function decodeBase64File(f, label) {
  if (!f || !f.base64 || !f.fileName) throw new Error(`${label}: fileName and base64 are required`);
  const buffer = Buffer.from(f.base64, "base64");
  if (!buffer.length) throw new Error(`${label}: file is empty`);
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`${label}: ${f.fileName} is too large (max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB)`);
  return { fileName: f.fileName, mimeType: f.mimeType || "application/octet-stream", buffer };
}

// Amount is never stored on this table — it's read live from the Sales
// Deed's own StampDuty + RegistrationFee fields, which stay the single
// source of truth for what the deed actually costs to register. Query
// Payment only tracks whether that amount has been communicated to the
// customer and, later, whether they've actually paid it to the government.
const QP_SELECT = `
  SELECT qp.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         sd.DeedNo, sd.StampDuty, sd.RegistrationFee, sd.StampDutyCredit,
         ISNULL(sd.StampDuty, 0) + ISNULL(sd.RegistrationFee, 0) AS GrossAmount,
         ISNULL(sd.StampDuty, 0) + ISNULL(sd.RegistrationFee, 0) - ISNULL(sd.StampDutyCredit, 0) AS RequiredAmount
  FROM dbo.CrmQueryPayment qp
  JOIN dbo.CrmBooking b ON b.Id = qp.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
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

// GET /eligible-bookings — bookings whose Sale Deed is Director Approved and
// don't have Query Payment tracking started yet. Replaces the generic
// crm-bookings + client-side filter the dialog used to rely on.
// MUST be registered before GET /:id — Express matches routes in
// registration order, and ":id" would otherwise swallow this literal path
// (treating "eligible-bookings" as the :id value), making this handler
// completely unreachable. (That was a live, confirmed bug: this endpoint
// 404'd with "Query Payment not found" on every call before this fix.)
router.get("/eligible-bookings", requirePageRight("crm-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             sd.DeedNo, sd.Id AS SalesDeedId
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      JOIN dbo.CrmSalesDeed sd ON sd.BookingId = b.Id AND sd.DirectorApprovalStatus = 'Approved'
      WHERE b.Status <> 'Cancelled'
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmQueryPayment WHERE BookingId = b.Id)
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-query-payment] eligible-bookings error:", e.message);
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

    // Stamp duty amount is locked only after Director Approval (both internal
    // and customer review complete). Communicating the amount before that risks
    // the customer paying the wrong figure.
    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, DirectorApprovalStatus FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC");
    if (!deed.recordset.length) {
      return res.status(400).json({ error: "Query Payment requires a Sales Deed to exist for this booking first (that's where the stamp duty / registration fee comes from)" });
    }
    if (deed.recordset[0].DirectorApprovalStatus !== "Approved") {
      return res.status(400).json({ error: "Query Payment can only be started after the Sales Deed is Director Approved — the stamp duty amount must be finalised before communicating it to the customer" });
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
router.post("/:id/info", requirePageRight("crm-query-payment", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Query Payment not found" });
    const row = cur.recordset[0];
    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const rawFiles = Array.isArray(req.body.files) ? req.body.files : [];
    if (!rawFiles.length) return res.status(400).json({ error: "At least one file is required" });
    let files;
    try {
      files = rawFiles.map((f, i) => decodeBase64File(f, `File ${i + 1}`));
    } catch (decodeErr) {
      return res.status(400).json({ error: decodeErr.message });
    }

    const actor = actorId(req);
    for (const file of files) {
      await pool.request()
        .input("qpid", sql.Int, id)
        .input("dtype", sql.NVarChar(20), "Info")
        .input("fname", sql.NVarChar(255), file.fileName)
        .input("mtype", sql.NVarChar(100), file.mimeType)
        .input("fsize", sql.Int, file.buffer.length)
        .input("fdata", sql.VarBinary(sql.MAX), file.buffer)
        .input("ub", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmQueryPaymentAttachments (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
          VALUES (@qpid, @dtype, @fname, @mtype, @fsize, @fdata, @ub)
        `);
    }

    if (row.Status === CrmStatus.PENDING) {
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

    res.json({ success: true, count: files.length });
  } catch (e) {
    console.error("[crm-query-payment] POST /:id/info error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/confirm — staff confirms the customer has actually paid the
// government. This is never company revenue (the company never receives
// this money) — it's a staff attestation, optionally with the customer's
// payment proof attached (DocType='Proof').
router.post("/:id/confirm", requirePageRight("crm-query-payment", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Query Payment not found" });
    const row = cur.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed" });
    if (row.Status !== "InfoSent") {
      return res.status(400).json({ error: "Payment details must be sent to the customer (InfoSent) before confirming — the customer must know what they paid and why" });
    }
    const activeErr = await requireActiveBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    let proof = null;
    if (b.proof) {
      try {
        proof = decodeBase64File(b.proof, "Proof");
      } catch (decodeErr) {
        return res.status(400).json({ error: decodeErr.message });
      }
    }

    const actor = actorId(req);
    if (proof) {
      await pool.request()
        .input("qpid", sql.Int, id)
        .input("dtype", sql.NVarChar(20), "Proof")
        .input("fname", sql.NVarChar(255), proof.fileName)
        .input("mtype", sql.NVarChar(100), proof.mimeType)
        .input("fsize", sql.Int, proof.buffer.length)
        .input("fdata", sql.VarBinary(sql.MAX), proof.buffer)
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

// ─── Staff proxy: upload proof on behalf of a non-portal customer ────────────
const PROXY_METHODS_QP = ["Phone", "InPerson", "Email", "WhatsApp", "Other"];

// POST /:id/proxy-proof — staff uploads the customer's payment proof (stamp
// duty / registration fee receipt) on their behalf. Mirrors portal
// POST /query-payment/proof but accepts multipart instead of base64 JSON,
// and stamps the audit trail with ProxyMethod.
router.post("/:id/proxy-proof",
  requirePageRight("crm-query-payment", "edit"),
  uploadQP.single("file"),
  async (req, res) => {
    try {
      const pool  = getPool();
      const id    = parseInt(req.params.id);
      const actor = actorId(req);
      const { ProxyMethod, ProxyRemarks } = req.body;

      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      if (!ProxyMethod || !PROXY_METHODS_QP.includes(ProxyMethod)) {
        return res.status(400).json({ error: `ProxyMethod is required. Must be one of: ${PROXY_METHODS_QP.join(", ")}` });
      }
      if (!ProxyRemarks?.trim()) return res.status(400).json({ error: "ProxyRemarks are required" });

      const cur = await pool.request().input("id", sql.Int, id)
        .query("SELECT Status, QPNo, BookingId FROM dbo.CrmQueryPayment WHERE Id = @id");
      if (!cur.recordset.length) return res.status(404).json({ error: "Query payment not found" });
      const qp = cur.recordset[0];
      if (qp.Status === "Confirmed") return res.status(400).json({ error: "Payment already confirmed" });

      const proxyNote = `[Proof submitted on behalf of customer via ${ProxyMethod}] ${ProxyRemarks.trim()}`;

      await pool.request()
        .input("id",    sql.Int,           id)
        .input("dtype", sql.NVarChar(20),  "Proof")
        .input("fname", sql.NVarChar(255), req.file.originalname)
        .input("mime",  sql.NVarChar(100), req.file.mimetype)
        .input("fsize", sql.Int,           req.file.size)
        .input("fdata", sql.VarBinary(sql.MAX), req.file.buffer)
        .input("ub",    sql.Int,           actor)
        .query(`
          INSERT INTO dbo.CrmQueryPaymentAttachments
            (QueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy, UploadedAt)
          VALUES (@id, @dtype, @fname, @mime, @fsize, @fdata, @ub, SYSDATETIME())
        `);

      await logCommunication(pool, {
        bookingId: qp.BookingId, direction: "Inbound",
        subject: `Payment proof uploaded for ${qp.QPNo} (via ${ProxyMethod})`,
        summary: proxyNote,
      });

      res.json({ success: true });
    } catch (e) {
      console.error("[crm-query-payment] proxy-proof error:", e.message);
      res.status(500).json({ error: e.message });
    }
  }
);

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
