const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireApprovedBooking } = require("../services/crmWorkflowGuards");
const { verifyFileMatchesDeclaredType } = require("../services/fileSignature");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function decodeBase64File(f, label) {
  if (!f || !f.base64 || !f.fileName) throw new Error(`${label}: fileName and base64 are required`);
  const buffer = Buffer.from(f.base64, "base64");
  if (!buffer.length) throw new Error(`${label}: file is empty`);
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`${label}: ${f.fileName} is too large (max ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)}MB)`);
  const mimeType = f.mimeType || "application/octet-stream";
  const sigErr = verifyFileMatchesDeclaredType({ buffer, mimetype: mimeType });
  if (sigErr) throw new Error(`${label}: ${sigErr}`);
  return { fileName: f.fileName, mimeType, buffer };
}

// Amount (StampDuty + RegistrationFee) is stored on this record — unlike the
// Sale Deed Query Payment which reads live from CrmSalesDeed, the AFS stamp
// duty amounts are entered here at creation time (before or after AFS
// registration). The same amounts are independently recorded on CrmAgreement
// at mark-registered time as AfsStampDuty + AfsRegistrationFee for use as a
// credit against the Sale Deed Query Payment's RequiredAmount.
const AQP_SELECT = `
  SELECT aqp.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
         ag.AgreementNo, ag.AfsRegistrationNo, ag.AfsRegistrationDate,
         ISNULL(aqp.StampDuty, 0) + ISNULL(aqp.RegistrationFee, 0) AS RequiredAmount
  FROM dbo.CrmAfsQueryPayment aqp
  JOIN dbo.CrmBooking b ON b.Id = aqp.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmAgreement ag ON ag.Id = aqp.AgreementId
`;

router.get("/", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("aqp.Status = @st"); }
    const result = await req0.query(`${AQP_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY aqp.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-afs-query-payment] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${AQP_SELECT} WHERE aqp.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-afs-query-payment] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings the "Start" dialog should offer. Mirrors
// the real POST / gate exactly (Agreement Executed/Registered, no tracker
// yet) instead of the frontend fetching the generic /api/crm/bookings list
// and filtering client-side against an AgreementStatus field — the same
// drift risk fixed for Legal Milestones/Query Payment/Mutation this session:
// a client-side filter can silently fall out of sync with the real gate.
// MUST be registered before GET /:id below — Express matches routes in
// registration order, and ":id" would otherwise swallow this literal path
// (treating "eligible-bookings" as the :id value), the exact bug already
// found and fixed once this session in crmQueryPayment.js.
router.get("/eligible-bookings", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             ag.AgreementNo, ag.Id AS AgreementId
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id AND ag.Status IN ('Executed', 'Registered')
      WHERE b.Status = 'Approved' AND b.IsActive = 1
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmAfsQueryPayment WHERE BookingId = b.Id)
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-afs-query-payment] eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id).query(`${AQP_SELECT} WHERE aqp.Id = @id`);
    if (!result.recordset.length) return res.status(404).json({ error: "AFS Query Payment not found" });

    const attachments = await pool.request().input("id", sql.Int, id).query(`
      SELECT AttachmentId, DocType, FileName, MimeType, FileSize, UploadedBy, UploadedAt
      FROM dbo.CrmAfsQueryPaymentAttachments WHERE AfsQueryPaymentId = @id ORDER BY UploadedAt DESC
    `);
    res.json({ ...result.recordset[0], attachments: attachments.recordset });
  } catch (e) {
    console.error("[crm-afs-query-payment] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start tracking AFS Query Payment for a booking.
// Gate: a registered Agreement for Sale must be executed (both parties signed).
// The AFS stamp duty is paid at Sub-Registrar Visit 1 — this tracker
// communicates the amount to the customer and records their payment.
router.post("/", requirePageRight("crm-afs-query-payment", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    // Same upgrade as crmQueryPayment.js — requireActiveBooking allowed
    // Expired/Pending bookings through; this whole module only ever starts
    // once an Agreement is Executed, so the booking should still be Approved.
    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Agreement must exist and be at least Executed — that's when both sides
    // have signed and it's ready to go for Sub-Registrar registration.
    const agreement = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC");
    if (!agreement.recordset.length) {
      return res.status(400).json({ error: "AFS Query Payment requires an Agreement for Sale to exist for this booking first" });
    }
    const agr = agreement.recordset[0];
    if (![CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(agr.Status)) {
      return res.status(400).json({ error: `AFS Query Payment requires the Agreement for Sale to be Executed or Registered first (current status: ${agr.Status})` });
    }

    // Unlike crmQueryPayment.js (which reads the amount live from an
    // upstream table), this amount is typed in right here — but nothing
    // stopped it being typed in as blank. A tracker with no real Stamp
    // Duty/Registration Fee is indistinguishable from one correctly showing
    // "nothing owed", which is never actually true for AFS registration.
    const stampIn = b.StampDuty != null && b.StampDuty !== "" ? parseFloat(b.StampDuty) : 0;
    const regFeeIn = b.RegistrationFee != null && b.RegistrationFee !== "" ? parseFloat(b.RegistrationFee) : 0;
    if (stampIn + regFeeIn <= 0) {
      return res.status(400).json({ error: "Enter a Stamp Duty or Registration Fee amount before starting AFS Query Payment tracking." });
    }

    const aqpNo = await getNextDocNumber(pool, "AQP", "AQP");
    const result = await pool.request()
      .input("no",     sql.NVarChar(30),  aqpNo)
      .input("bid",    sql.Int,           bookingId)
      .input("agid",   sql.Int,           agr.Id)
      .input("stamp",  sql.Decimal(18,2), b.StampDuty != null && b.StampDuty !== "" ? parseFloat(b.StampDuty) : null)
      .input("regfee", sql.Decimal(18,2), b.RegistrationFee != null && b.RegistrationFee !== "" ? parseFloat(b.RegistrationFee) : null)
      .input("cb",     sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmAfsQueryPayment (AfsQPNo, BookingId, AgreementId, StampDuty, RegistrationFee, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @agid, @stamp, @regfee, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, AfsQPNo: aqpNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "AFS Query Payment tracking already started for this booking" });
    console.error("[crm-afs-query-payment] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update StampDuty / RegistrationFee / Remarks before InfoSent.
// Once paperwork has been sent to the customer the amounts are locked —
// the customer relied on the number we sent.
router.put("/:id", requirePageRight("crm-afs-query-payment", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "AFS Query Payment not found" });
    const row = cur.recordset[0];
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (row.Status !== CrmStatus.PENDING) {
      return res.status(400).json({ error: "Stamp Duty and Registration Fee can no longer be edited once the paperwork has been sent to the customer" });
    }
    await pool.request()
      .input("id",     sql.Int,           id)
      .input("stamp",  sql.Decimal(18,2), b.StampDuty != null && b.StampDuty !== "" ? parseFloat(b.StampDuty) : null)
      .input("regfee", sql.Decimal(18,2), b.RegistrationFee != null && b.RegistrationFee !== "" ? parseFloat(b.RegistrationFee) : null)
      .input("rem",    sql.NVarChar(sql.MAX), b.Remarks !== undefined ? (b.Remarks || null) : null)
      .input("ub",     sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmAfsQueryPayment SET
          StampDuty       = ISNULL(@stamp, StampDuty),
          RegistrationFee = ISNULL(@regfee, RegistrationFee),
          Remarks         = ISNULL(@rem, Remarks),
          UpdatedBy       = @ub,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-afs-query-payment] PUT /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/info — upload paperwork for the customer and flip Status -> InfoSent.
router.post("/:id/info", requirePageRight("crm-afs-query-payment", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "AFS Query Payment not found" });
    const row = cur.recordset[0];
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
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
        .input("aqpid", sql.Int,            id)
        .input("dtype", sql.NVarChar(20),   "Info")
        .input("fname", sql.NVarChar(255),  file.fileName)
        .input("mtype", sql.NVarChar(100),  file.mimeType)
        .input("fsize", sql.Int,            file.buffer.length)
        .input("fdata", sql.VarBinary(sql.MAX), file.buffer)
        .input("ub",    sql.Int,            actor)
        .query(`
          INSERT INTO dbo.CrmAfsQueryPaymentAttachments (AfsQueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
          VALUES (@aqpid, @dtype, @fname, @mtype, @fsize, @fdata, @ub)
        `);
    }

    if (row.Status === CrmStatus.PENDING) {
      await pool.request().input("id", sql.Int, id).input("ub", sql.Int, actor).query(`
        UPDATE dbo.CrmAfsQueryPayment SET Status = 'InfoSent', InfoSentAt = SYSDATETIME(), InfoSentBy = @ub, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    }

    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Outbound",
      subject: "AFS stamp duty / registration fee details sent to customer",
      summary: "Required government payment amount and paperwork for AFS registration shared with the customer.",
      createdBy: actor,
    });

    res.json({ success: true, count: files.length });
  } catch (e) {
    console.error("[crm-afs-query-payment] POST /:id/info error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/confirm — staff confirms the customer has paid the government.
// This is not company revenue — it is a staff attestation that the customer
// brought the required amount to the Sub-Registrar Office.
router.post("/:id/confirm", requirePageRight("crm-afs-query-payment", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "AFS Query Payment not found" });
    const row = cur.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed" });
    if (row.Status !== "InfoSent") {
      return res.status(400).json({ error: "Payment details must be sent to the customer (InfoSent) before confirming — the customer must know what they paid and why" });
    }
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
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
        .input("aqpid", sql.Int,            id)
        .input("dtype", sql.NVarChar(20),   "Proof")
        .input("fname", sql.NVarChar(255),  proof.fileName)
        .input("mtype", sql.NVarChar(100),  proof.mimeType)
        .input("fsize", sql.Int,            proof.buffer.length)
        .input("fdata", sql.VarBinary(sql.MAX), proof.buffer)
        .input("ub",    sql.Int,            actor)
        .query(`
          INSERT INTO dbo.CrmAfsQueryPaymentAttachments (AfsQueryPaymentId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
          VALUES (@aqpid, @dtype, @fname, @mtype, @fsize, @fdata, @ub)
        `);
    }

    await pool.request()
      .input("id",  sql.Int,           id)
      .input("amt", sql.Decimal(18,2), b.ConfirmedAmount != null ? parseFloat(b.ConfirmedAmount) : null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",  sql.Int,           actor)
      .query(`
        UPDATE dbo.CrmAfsQueryPayment SET
          Status = 'Confirmed', ConfirmedAt = SYSDATETIME(), ConfirmedBy = @ub,
          ConfirmedAmount = @amt, Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCommunication(pool, {
      bookingId: row.BookingId, direction: "Inbound",
      subject: "AFS government payment confirmed",
      summary: "Staff confirmed the customer has remitted AFS stamp duty and registration fee to the Sub-Registrar Office.",
      createdBy: actor,
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-afs-query-payment] POST /:id/confirm error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/attachment/:attachId", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const attachId = parseInt(req.params.attachId, 10);
    const result = await pool.request().input("id", sql.Int, attachId)
      .query("SELECT FileName, MimeType, FileData FROM dbo.CrmAfsQueryPaymentAttachments WHERE AttachmentId = @id");
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", attachment.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.FileName)}"`);
    res.send(attachment.FileData);
  } catch (e) {
    console.error("[crm-afs-query-payment] GET attachment error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
