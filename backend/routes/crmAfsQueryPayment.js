const express = require("express");
const { sumMoney } = require("../services/bookingUnits");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
// Project access: a restricted user gets 403 on records outside their projects.
{ const { crmProjectGuards, crmViaBookingSql } = require("../services/projectScope"); crmProjectGuards(router, crmViaBookingSql("CrmAfsQueryPayment")); }
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");
const { requireApprovedBooking } = require("../services/crmWorkflowGuards");
const { verifyFileMatchesDeclaredType } = require("../services/fileSignature");

router.use(authMiddleware);

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

function parseOptionalMoney(value, field) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${field} must be a non-negative amount with up to 2 decimal places`);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount > 9999999999999999.99) throw new Error(`${field} is outside the supported range`);
  return amount;
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
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("aqp.Status = @st"); }
    // Not paginated — status counts are computed client-side from the full
    // set (see CrmAfsQueryPayment.tsx), same reasoning as CrmDemands.
    // Company/Project/Block narrows the set server-side instead.
    if (companyId) { req0.input("companyId", sql.Int, companyId); where.push("b.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); where.push("b.ProjectId = @projectId"); }
    if (req.projectScope) where.push(require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (blockId) { req0.input("blockId", sql.Int, blockId); where.push("b.BlockId = @blockId"); }
    const result = await req0.query(`${AQP_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY aqp.CreatedAt DESC`);
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
    if (!Number.isFinite(bookingId)) return res.status(400).json({ error: "Invalid bookingId" });
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${AQP_SELECT} WHERE aqp.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-afs-query-payment] GET /booking/:id error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const result = await pool.request().input("id", sql.Int, id).query(`${AQP_SELECT} WHERE aqp.Id = @id`);
    if (!result.recordset.length) return res.status(404).json({ error: "Agreement registration fees not found" });

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
    const bookingId = parseId(b.BookingId);
    if (bookingId === null) return res.status(400).json({ error: "Invalid BookingId" });
    let stampDuty, registrationFee;
    try {
      stampDuty = parseOptionalMoney(b.StampDuty, "Stamp Duty");
      registrationFee = parseOptionalMoney(b.RegistrationFee, "Registration Fee");
    } catch (e) { return res.status(400).json({ error: e.message }); }

    const tx = pool.transaction();
    await tx.begin();
    try {
      // The booking locked for this start, then the shared rule (approved, active, not frozen) read under that lock.
      await tx.request().input("bid", sql.Int, bookingId).query("SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid");
      const activeErr = await requireApprovedBooking(tx, bookingId);
      if (activeErr) {
        await tx.rollback();
        return res.status(400).json({ error: activeErr });
      }
      const agreement = await tx.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WITH (UPDLOCK, HOLDLOCK)
        WHERE BookingId = @bid ORDER BY CreatedAt DESC
      `);
      if (!agreement.recordset.length) {
        await tx.rollback();
        return res.status(400).json({ error: "Registration fees need an Agreement for Sale for this booking first" });
      }
      const agr = agreement.recordset[0];
      if (![CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(agr.Status)) {
        await tx.rollback();
        return res.status(400).json({ error: `Registration fees can start once the Agreement for Sale is executed (it is ${agr.Status})` });
      }
      const existing = await tx.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 Id FROM dbo.CrmAfsQueryPayment WITH (UPDLOCK, HOLDLOCK) WHERE BookingId = @bid
      `);
      if (existing.recordset.length) {
        await tx.rollback();
        return res.status(409).json({ error: "Registration fees are already started for this booking" });
      }
      const aqpNo = await getNextDocNumber(tx, "AQP", "AQP");
      const result = await tx.request()
        .input("no", sql.NVarChar(30), aqpNo)
        .input("bid", sql.Int, bookingId)
        .input("agid", sql.Int, agr.Id)
        .input("stamp", sql.Decimal(18,2), stampDuty)
        .input("regfee", sql.Decimal(18,2), registrationFee)
        .input("cb", sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmAfsQueryPayment (AfsQPNo, BookingId, AgreementId, StampDuty, RegistrationFee, Status, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@no, @bid, @agid, @stamp, @regfee, 'Pending', @cb, SYSDATETIME())
        `);
      await tx.commit();
      res.status(201).json({ success: true, id: result.recordset[0].Id, AfsQPNo: aqpNo });
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Registration fees are already started for this booking" });
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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement registration fees not found" });
    const row = cur.recordset[0];
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    if (row.Status !== CrmStatus.PENDING) {
      return res.status(400).json({ error: "Stamp Duty and Registration Fee can no longer be edited once the paperwork has been sent to the customer" });
    }
    let stampDuty, registrationFee;
    try {
      stampDuty = parseOptionalMoney(b.StampDuty, "Stamp Duty");
      registrationFee = parseOptionalMoney(b.RegistrationFee, "Registration Fee");
    } catch (e) { return res.status(400).json({ error: e.message }); }
    const updated = await pool.request()
      .input("id",     sql.Int,           id)
      .input("stamp",  sql.Decimal(18,2), stampDuty)
      .input("regfee", sql.Decimal(18,2), registrationFee)
      .input("rem",    sql.NVarChar(sql.MAX), b.Remarks !== undefined ? (b.Remarks || null) : null)
      .input("ub",     sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmAfsQueryPayment SET
          StampDuty       = ISNULL(@stamp, StampDuty),
          RegistrationFee = ISNULL(@regfee, RegistrationFee),
          Remarks         = ISNULL(@rem, Remarks),
          UpdatedBy       = @ub,
          UpdatedAt       = SYSDATETIME()
        WHERE Id = @id AND Status = '${CrmStatus.PENDING}'
      `);
    if (updated.rowsAffected?.[0] !== 1) {
      return res.status(409).json({ error: "Payment status changed; refresh and try again" });
    }
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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status, StampDuty, RegistrationFee FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement registration fees not found" });
    const row = cur.recordset[0];
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // The fee amount stays optional here too (business decision 2026-10-22 —
    // staff genuinely may not know it yet, e.g. still waiting on the Sub-
    // Registrar's own valuation). Forcing a number before this could proceed
    // only pushed staff to type a placeholder to get past the block, which is
    // worse than sending with none. The real, binding figure is what gets
    // recorded at /:id/confirm (ConfirmedAmount) once the customer actually
    // pays — that step still requires a real amount; nothing downstream reads
    // StampDuty/RegistrationFee as anything but an optional estimate (see
    // AfsQpStampDuty/AfsQpRegistrationFee in crmAgreements.js).
    const hasAmount = (row.StampDuty != null && Number(row.StampDuty) > 0) || (row.RegistrationFee != null && Number(row.RegistrationFee) > 0);

    const rawFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!rawFiles.length) return res.status(400).json({ error: "At least one file is required" });
    let files;
    try {
      files = rawFiles.map((f, i) => decodeBase64File(f, `File ${i + 1}`));
    } catch (decodeErr) {
      return res.status(400).json({ error: decodeErr.message });
    }

    const actor = actorId(req);
    // Multiple attachment INSERTs + the Status flip + comm log — wrapped so
    // a failure partway through a multi-file upload can't leave some files
    // attached and others missing while the status already reads InfoSent.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const locked = await tx.request().input("id", sql.Int, id).query(`
        SELECT Status FROM dbo.CrmAfsQueryPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
      `);
      if (!locked.recordset.length || ![CrmStatus.PENDING, "InfoSent"].includes(locked.recordset[0].Status)) {
        await tx.rollback();
        return res.status(409).json({ error: "Payment status changed; refresh before sending information" });
      }
      const currentStatus = locked.recordset[0].Status;
      for (const file of files) {
        await tx.request()
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

      if (currentStatus === CrmStatus.PENDING) {
        const sent = await tx.request().input("id", sql.Int, id).input("ub", sql.Int, actor).query(`
          UPDATE dbo.CrmAfsQueryPayment SET Status = 'InfoSent', InfoSentAt = SYSDATETIME(), InfoSentBy = @ub, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE Id = @id AND Status = '${CrmStatus.PENDING}'
        `);
        if (sent.rowsAffected?.[0] !== 1) {
          await tx.rollback();
          return res.status(409).json({ error: "Payment status changed; refresh before sending information" });
        }
      }

      await logCommunication(tx, {
        bookingId: row.BookingId, direction: "Outbound",
        subject: "Agreement stamp duty and registration fee details sent to the customer",
        summary: hasAmount
          ? "Required government payment amount and paperwork for AFS registration shared with the customer."
          : "Paperwork for AFS registration shared with the customer; the exact stamp duty / registration fee amount was not yet known and will follow.",
        createdBy: actor,
      });

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status, StampDuty, RegistrationFee FROM dbo.CrmAfsQueryPayment WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement registration fees not found" });
    const row = cur.recordset[0];
    if (row.Status === "Confirmed") return res.status(400).json({ error: "Already confirmed" });
    if (row.Status !== "InfoSent") {
      return res.status(400).json({ error: "Payment details must be sent to the customer (InfoSent) before confirming — the customer must know what they paid and why" });
    }
    const activeErr = await requireApprovedBooking(pool, row.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Confirming is staff attesting the customer paid the government, so it
    // needs the receipt and the amount; an amount different from stamp duty +
    // registration fee (e.g. a revised valuation) must be explained.
    if (!b.proof) return res.status(400).json({ error: "Attach the payment proof (challan / receipt) the customer paid to the Sub-Registrar" });
    const confirmed = b.ConfirmedAmount != null && b.ConfirmedAmount !== "" ? parseFloat(b.ConfirmedAmount) : NaN;
    if (!(confirmed > 0)) return res.status(400).json({ error: "Enter the amount the customer paid" });
    const expected = sumMoney([row.StampDuty, row.RegistrationFee]);
    if (expected > 0 && Math.abs(confirmed - expected) > 0.5 && !String(b.Remarks || "").trim()) {
      return res.status(400).json({ error: `The amount paid (₹${confirmed.toLocaleString("en-IN")}) differs from stamp duty + registration fee (₹${expected.toLocaleString("en-IN")}) — add a remark explaining why` });
    }
    let proof = null;
    if (b.proof) {
      try {
        proof = decodeBase64File(b.proof, "Proof");
      } catch (decodeErr) {
        return res.status(400).json({ error: decodeErr.message });
      }
    }

    const actor = actorId(req);
    // Proof attachment INSERT + Status flip to Confirmed + comm log — wrapped
    // so a failure between them can't leave the confirmation recorded with no
    // proof attached, or vice versa.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const locked = await tx.request().input("id", sql.Int, id).query(`
        SELECT Status FROM dbo.CrmAfsQueryPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
      `);
      if (!locked.recordset.length || locked.recordset[0].Status !== "InfoSent") {
        await tx.rollback();
        return res.status(409).json({ error: "Payment status changed; refresh before confirming" });
      }
      if (proof) {
        await tx.request()
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

      const confirmedResult = await tx.request()
        .input("id",  sql.Int,           id)
        .input("amt", sql.Decimal(18,2), b.ConfirmedAmount != null && b.ConfirmedAmount !== "" ? parseFloat(b.ConfirmedAmount) : null)
        .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
        .input("ub",  sql.Int,           actor)
        .query(`
          UPDATE dbo.CrmAfsQueryPayment SET
            Status = 'Confirmed', ConfirmedAt = SYSDATETIME(), ConfirmedBy = @ub,
            ConfirmedAmount = @amt, Remarks = ISNULL(@rem, Remarks),
            UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE Id = @id AND Status = 'InfoSent'
        `);
      if (confirmedResult.rowsAffected?.[0] !== 1) {
        await tx.rollback();
        return res.status(409).json({ error: "Payment status changed; refresh before confirming" });
      }

      await logCommunication(tx, {
        bookingId: row.BookingId, direction: "Inbound",
        subject: "Agreement registration fees paid",
        summary: "Staff confirmed the customer paid the agreement's stamp duty and registration fee to the Sub-Registrar's office.",
        createdBy: actor,
      });

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-afs-query-payment] POST /:id/confirm error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/attachment/:attachId", requirePageRight("crm-afs-query-payment", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const attachId = parseId(req.params.attachId);
    if (attachId === null) return res.status(400).json({ error: "Invalid attachId" });
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
