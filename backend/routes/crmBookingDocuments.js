const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

// Standard checklist shown even before any row exists, so staff see what's
// expected to be collected — not just what's already been uploaded.
const STANDARD_DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];

const UPLOAD_DIR = path.join(__dirname, "../uploads/crm-booking-documents");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safe}`);
  },
});
const upload = multer({
  storage,
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
    const result = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT d.*, u.name AS VerifiedByName
      FROM dbo.CrmBookingDocument d
      LEFT JOIN dbo.Users u ON u.id = d.VerifiedBy
      WHERE d.BookingId = @bid
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
router.post("/booking/:bookingId", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.DocumentType?.trim()) return res.status(400).json({ error: "DocumentType is required" });

    const result = await pool.request()
      .input("bid",  sql.Int, bookingId)
      .input("type", sql.NVarChar(100), b.DocumentType.trim())
      .input("url",  sql.NVarChar(2000), b.DocumentUrl || null)
      .input("fn",   sql.NVarChar(300), b.FileName || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmBookingDocument (BookingId, DocumentType, DocumentUrl, FileName, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @type, @url, @fn, @note, @cb, SYSDATETIME())
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

      const inserted = [];
      for (const file of req.files) {
        const result = await pool.request()
          .input("bid",  sql.Int, bookingId)
          .input("type", sql.NVarChar(100), docType)
          .input("fn",   sql.NVarChar(300), file.originalname)
          .input("fp",   sql.NVarChar(500), file.path)
          .input("fs",   sql.BigInt, file.size)
          .input("mt",   sql.NVarChar(150), file.mimetype)
          .input("cb",   sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmBookingDocument (BookingId, DocumentType, FileName, FilePath, FileSize, MimeType, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES (@bid, @type, @fn, @fp, @fs, @mt, @cb, SYSDATETIME())
          `);
        inserted.push(result.recordset[0].Id);
      }
      res.status(201).json({ success: true, ids: inserted, count: inserted.length });
    } catch (e) {
      // Clean up any files already written to disk on DB failure
      for (const file of req.files || []) {
        const resolved = path.resolve(file.path);
        if (resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) fs.unlink(resolved, () => {});
      }
      console.error("[crm-booking-documents] upload error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /file/:id — stream a document's file for inline preview/download
router.get("/file/:id", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getPool().request().input("id", sql.Int, id)
      .query("SELECT FileName, FilePath, MimeType FROM dbo.CrmBookingDocument WHERE Id = @id");
    if (!result.recordset.length || !result.recordset[0].FilePath) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    // Path-traversal guard — only ever serve files that resolve inside UPLOAD_DIR.
    const resolvedPath = path.resolve(doc.FilePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return res.status(403).json({ error: "Access denied" });
    if (!fs.existsSync(resolvedPath)) return res.status(404).json({ error: "File not found on disk" });

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (e) {
    console.error("[crm-booking-documents] file GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/verify — mark a document verified (or un-verify)
router.put("/:id/verify", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
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

// DELETE /:id
router.delete("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT FilePath FROM dbo.CrmBookingDocument WHERE Id = @id");
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmBookingDocument WHERE Id = @id");

    const filePath = row.recordset[0]?.FilePath;
    if (filePath) {
      const resolvedPath = path.resolve(filePath);
      if (resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) && fs.existsSync(resolvedPath)) {
        fs.unlink(resolvedPath, () => {});
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-booking-documents] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
