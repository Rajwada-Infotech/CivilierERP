const express = require("express");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireApprovedBooking } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

// Standard checklist shown even before any row exists, so staff see what's
// expected to be collected — not just what's already been uploaded.
const STANDARD_DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }, // 25 MB per file, 10 files per request
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      "application/pdf", "image/jpeg", "image/png", "image/webp",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("File type not allowed"));
  },
});

// GET /booking/:bookingId — documents for a booking
router.get("/booking/:bookingId", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    // Include docs uploaded at the Application stage (ApplicationId set, BookingId NULL)
    // by joining through CrmBooking → CrmApplication — so files collected during
    // the application wizard appear here without any data migration.
    const result = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT d.Id, d.BookingId, d.ApplicationId, d.DocumentType, d.DocumentUrl, d.FileName,
             d.IsVerified, d.VerifiedBy, d.VerifiedAt, d.Notes, d.CreatedBy, d.CreatedAt,
             d.FileSize, d.MimeType,
             CASE WHEN d.FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS FilePath,
             u.name AS VerifiedByName
      FROM dbo.CrmBookingDocument d
      LEFT JOIN dbo.Users u ON u.id = d.VerifiedBy
      WHERE d.BookingId = @bid
         OR (d.ApplicationId IS NOT NULL AND d.BookingId IS NULL AND d.ApplicationId = (
               SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1
             ))
      ORDER BY d.CreatedAt
    `);
    res.json({ documents: result.recordset, standardTypes: STANDARD_DOC_TYPES });
  } catch (e) {
    console.error("[crm-booking-documents] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId — attach a document by pasting an external URL
// (no file involved) — kept alongside the upload path below for links to
// documents that live outside our own storage.
//
// Same gate as the rest of the Welcome-Call-onward workflow this document
// collection is part of (crmWelcomeCalls.js POST / uses
// requireApprovedBooking) — this route previously had NO booking-status
// check at all, so a document could be attached to a Cancelled, Rejected,
// or not-yet-Approved booking with zero restriction.
router.post("/booking/:bookingId", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const booking = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    const applicationId = booking.recordset[0]?.ApplicationId || null;
    const b = req.body;
    if (!b.DocumentType?.trim()) return res.status(400).json({ error: "DocumentType is required" });

    const result = await pool.request()
      .input("bid",  sql.Int, bookingId)
      .input("aid",  sql.Int, applicationId)
      .input("type", sql.NVarChar(100), b.DocumentType.trim())
      .input("url",  sql.NVarChar(2000), b.DocumentUrl || null)
      .input("fn",   sql.NVarChar(300), b.FileName || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmBookingDocument (BookingId, ApplicationId, DocumentType, DocumentUrl, FileName, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @aid, @type, @url, @fn, @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-booking-documents] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId/upload — actual multi-file upload (up to 10 files
// in one request). One row per file, all sharing the same DocumentType.
router.post("/booking/:bookingId/upload", requirePageRight("crm-welcome-calls", "edit"), (req, res) => {
  upload.array("files", 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const pool = getPool();
      const bookingId = parseInt(req.params.bookingId);
      const docType = req.body?.DocumentType?.trim();
      if (!docType) return res.status(400).json({ error: "DocumentType is required" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      // Same gate as POST /booking/:bookingId above — see its comment.
      const activeErr = await requireApprovedBooking(pool, bookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });

      const booking = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
      const applicationId = booking.recordset[0]?.ApplicationId || null;

      const inserted = [];
      for (const file of req.files) {
        const result = await pool.request()
          .input("bid",  sql.Int, bookingId)
          .input("aid",  sql.Int, applicationId)
          .input("type", sql.NVarChar(100), docType)
          .input("fn",   sql.NVarChar(300), file.originalname)
          .input("fb64", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
          .input("fs",   sql.BigInt, file.size)
          .input("mt",   sql.NVarChar(150), file.mimetype)
          .input("cb",   sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmBookingDocument (BookingId, ApplicationId, DocumentType, FileName, FileBase64, FileSize, MimeType, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES (@bid, @aid, @type, @fn, @fb64, @fs, @mt, @cb, SYSDATETIME())
          `);
        inserted.push(result.recordset[0].Id);
      }
      res.status(201).json({ success: true, ids: inserted, count: inserted.length });
    } catch (e) {
      console.error("[crm-booking-documents] upload error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /application/:applicationId — documents captured at Application stage
// (Phase 1 of the Application/Booking redesign) — same table, same file
// pipeline, just keyed by ApplicationId instead of BookingId since no
// booking exists yet at this point.
router.get("/application/:applicationId", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, applicationId).query(`
      SELECT d.Id, d.BookingId, d.ApplicationId, d.DocumentType, d.DocumentUrl, d.FileName,
             d.IsVerified, d.VerifiedBy, d.VerifiedAt, d.Notes, d.CreatedBy, d.CreatedAt,
             d.FileSize, d.MimeType,
             CASE WHEN d.FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS FilePath,
             u.name AS VerifiedByName
      FROM dbo.CrmBookingDocument d
      LEFT JOIN dbo.Users u ON u.id = d.VerifiedBy
      WHERE d.ApplicationId = @aid
      ORDER BY d.CreatedAt
    `);
    res.json({ documents: result.recordset, standardTypes: STANDARD_DOC_TYPES });
  } catch (e) {
    console.error("[crm-booking-documents] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/application/:applicationId/upload", requirePageRight("crm-applications", "edit"), (req, res) => {
  upload.array("files", 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const pool = getPool();
      const applicationId = parseInt(req.params.applicationId);
      const docType = req.body?.DocumentType?.trim();
      if (!docType) return res.status(400).json({ error: "DocumentType is required" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });
      const booking = await pool.request().input("aid", sql.Int, applicationId)
        .query("SELECT TOP 1 Id FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1 ORDER BY Id DESC");
      const bookingId = booking.recordset[0]?.Id || null;

      const inserted = [];
      for (const file of req.files) {
        const result = await pool.request()
          .input("aid",  sql.Int, applicationId)
          .input("bid",  sql.Int, bookingId)
          .input("type", sql.NVarChar(100), docType)
          .input("fn",   sql.NVarChar(300), file.originalname)
          .input("fb64", sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
          .input("fs",   sql.BigInt, file.size)
          .input("mt",   sql.NVarChar(150), file.mimetype)
          .input("cb",   sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmBookingDocument (BookingId, ApplicationId, DocumentType, FileName, FileBase64, FileSize, MimeType, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES (@bid, @aid, @type, @fn, @fb64, @fs, @mt, @cb, SYSDATETIME())
          `);
        inserted.push(result.recordset[0].Id);
      }
      res.status(201).json({ success: true, ids: inserted, count: inserted.length });
    } catch (e) {
      console.error("[crm-booking-documents] application upload error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /file/:id — stream a document's file for inline preview/download
router.get("/file/:id", requireAnyPageRight(["crm-applications", "crm-welcome-calls", "crm-bookings"], "view"), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getPool().request().input("id", sql.Int, id)
      .query("SELECT FileName, FileBase64, MimeType FROM dbo.CrmBookingDocument WHERE Id = @id");
    if (!result.recordset.length || !result.recordset[0].FileBase64) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    res.send(Buffer.from(doc.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-booking-documents] file GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/verify — mark a document verified (or un-verify). Gated the same
// way as the routes above, but only when this row actually belongs to a
// Booking yet (BookingId set) — an Application-stage document (BookingId
// still NULL, no booking exists) has no booking-status concept to gate on.
router.put("/:id/verify", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const docRow = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmBookingDocument WHERE Id = @id");
    if (!docRow.recordset.length) return res.status(404).json({ error: "Document not found" });
    if (docRow.recordset[0].BookingId) {
      const activeErr = await requireApprovedBooking(pool, docRow.recordset[0].BookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
    }

    const verified = req.body?.IsVerified !== false;
    await pool.request()
      .input("id", sql.Int, id)
      .input("v",  sql.Bit, verified ? 1 : 0)
      .input("vb", sql.Int, verified ? actorId(req) : null)
      .query(`
        UPDATE dbo.CrmBookingDocument SET
          IsVerified = @v, VerifiedBy = @vb, VerifiedAt = CASE WHEN @v = 1 THEN SYSDATETIME() ELSE NULL END
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-booking-documents] verify error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — same booking-status gate as PUT /:id/verify above.
router.delete("/:id", requireAnyPageRight(["crm-applications", "crm-welcome-calls"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const docRow = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmBookingDocument WHERE Id = @id");
    if (!docRow.recordset.length) return res.status(404).json({ error: "Document not found" });
    if (docRow.recordset[0].BookingId) {
      const activeErr = await requireApprovedBooking(pool, docRow.recordset[0].BookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
    }

    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmBookingDocument WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-booking-documents] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
