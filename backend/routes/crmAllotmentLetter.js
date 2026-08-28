const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { getAllotmentLetterPdfBuffer } = require("../services/allotmentLetterPdf");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const AL_SELECT = `
  SELECT al.Id, al.AlNo, al.BookingId, al.Status, al.DraftedOn, al.IssuedOn, al.Remarks,
         al.FileName, al.MimeType, al.FileSize,
         al.CreatedBy, al.CreatedAt, al.UpdatedBy, al.UpdatedAt,
         b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmAllotmentLetter al
  JOIN dbo.CrmBooking b ON b.Id = al.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
`;

router.get("/", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const where = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); where.push("al.Status = @st"); }
    const result = await req0.query(`${AL_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY al.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-allotment-letter] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query(`${AL_SELECT} WHERE al.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create a Draft allotment letter. Gate: booking must be active and
// not already have a letter (UNIQUE constraint on BookingId).
router.post("/", requirePageRight("crm-allotment-letter", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const alNo = await getNextDocNumber(pool, "AL", "AL");
    const result = await pool.request()
      .input("no",  sql.NVarChar(30), alNo)
      .input("bid", sql.Int, bookingId)
      .input("dt",  sql.Date, b.DraftedOn || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAllotmentLetter (AlNo, BookingId, Status, DraftedOn, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, 'Draft', @dt, @rem, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, AlNo: alNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "An Allotment Letter has already been started for this booking" });
    console.error("[crm-allotment-letter] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update DraftedOn and Remarks (allowed in Draft state only)
router.put("/:id", requirePageRight("crm-allotment-letter", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmAllotmentLetter WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Allotment Letter not found" });
    if (cur.recordset[0].Status === "Issued") return res.status(400).json({ error: "Allotment Letter is already issued and cannot be edited" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    await pool.request()
      .input("id",  sql.Int, id)
      .input("dt",  sql.Date, b.DraftedOn || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmAllotmentLetter SET
          DraftedOn = ISNULL(@dt,  DraftedOn),
          Remarks   = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-allotment-letter] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/issue — mark the letter as Issued and optionally attach the PDF.
// File arrives as base64 in the JSON body: { fileName, mimeType, base64 }.
router.put("/:id/issue", requirePageRight("crm-allotment-letter", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId, Status FROM dbo.CrmAllotmentLetter WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Allotment Letter not found" });
    if (cur.recordset[0].Status === "Issued") return res.status(400).json({ error: "Already issued" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    let fileData = null;
    let fileName = null;
    let mimeType = null;
    let fileSize = null;
    if (b.file?.base64) {
      const buf = Buffer.from(b.file.base64, "base64");
      const MAX = 5 * 1024 * 1024;
      if (buf.length > MAX) return res.status(400).json({ error: "File exceeds 5MB limit" });
      fileData = buf;
      fileName = b.file.fileName || "allotment-letter.pdf";
      mimeType = b.file.mimeType || "application/pdf";
      fileSize = buf.length;
    }

    const req0 = pool.request()
      .input("id",   sql.Int, id)
      .input("ion",  sql.Date, b.IssuedOn || new Date().toISOString().slice(0, 10))
      .input("rem",  sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",   sql.Int, actorId(req));

    if (fileData) {
      req0.input("fn",  sql.NVarChar(255), fileName)
          .input("mt",  sql.NVarChar(100), mimeType)
          .input("fs",  sql.Int, fileSize)
          .input("fd",  sql.VarBinary(sql.MAX), fileData);
      await req0.query(`
        UPDATE dbo.CrmAllotmentLetter SET
          Status = 'Issued', IssuedOn = @ion,
          Remarks  = ISNULL(@rem, Remarks),
          FileName = @fn, MimeType = @mt, FileSize = @fs, FileData = @fd,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    } else {
      await req0.query(`
        UPDATE dbo.CrmAllotmentLetter SET
          Status = 'Issued', IssuedOn = @ion,
          Remarks = ISNULL(@rem, Remarks),
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-allotment-letter] PUT /:id/issue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/pdf — generate allotment letter PDF on-the-fly from booking data.
// ?download=1 forces Content-Disposition: attachment (download prompt).
router.get("/:id/pdf", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = getPool();
    const buf = await getAllotmentLetterPdfBuffer(pool, id);
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="allotment-letter-${id}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /:id/pdf error:", e.message);
    res.status(e.message.includes("not found") ? 404 : 500).json({ error: e.message });
  }
});

// GET /:id/download — serve the attached letter file
router.get("/:id/download", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id)
      .query("SELECT FileData, FileName, MimeType FROM dbo.CrmAllotmentLetter WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    const row = result.recordset[0];
    if (!row.FileData) return res.status(404).json({ error: "No file attached" });
    res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.FileName || "allotment-letter")}"`);
    res.send(row.FileData);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /:id/download error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
