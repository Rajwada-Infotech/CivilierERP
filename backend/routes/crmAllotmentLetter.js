const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking, requireApprovedBooking } = require("../services/crmWorkflowGuards");
const { getAllotmentLetterPdfBuffer } = require("../services/allotmentLetterPdf");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Columns common to all list/detail queries.
// AcknowledgedOn added by migration 376 — always present after that runs.
const AL_SELECT = `
  SELECT al.Id, al.AlNo, al.BookingId, al.Status,
         al.IssuedOn, al.AcknowledgedOn, al.Remarks,
         al.FileName, al.MimeType, al.FileSize,
         al.CreatedBy, al.CreatedAt, al.UpdatedBy, al.UpdatedAt,
         b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
         a.ApplicantName, a.Mobile
  FROM dbo.CrmAllotmentLetter al
  JOIN dbo.CrmBooking b ON b.Id = al.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
`;

// GET / — list all allotment letters, optional ?status= filter.
router.get("/", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const where = [];
    if (req.query.status) {
      req0.input("st", sql.NVarChar(20), req.query.status);
      where.push("al.Status = @st");
    }
    const result = await req0.query(
      `${AL_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY al.CreatedAt DESC`
    );
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-allotment-letter] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings that can have an Allotment Letter generated.
// Gate: Approved + Active + no letter yet + >= 10% of GrandTotal paid via milestones.
// MUST be registered before /:id routes so Express does not swallow "eligible-bookings"
// as a numeric id parameter.
router.get("/eligible-bookings", requirePageRight("crm-allotment-letter", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, a.ApplicantName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.Status = 'Approved'
        AND b.IsActive = 1
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmAllotmentLetter al WHERE al.BookingId = b.Id
        )
        AND EXISTS (
          SELECT 1 FROM dbo.CrmPaymentMilestone
          WHERE BookingId = b.Id AND MilestoneNo = 1 AND Status = 'Paid'
        )
      ORDER BY b.BookingNo
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — fetch the single letter for a given booking.
// Used by the booking lifecycle panel and other deep-link callers.
router.get("/booking/:bookingId", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId, 10);
    const result = await pool.request()
      .input("bid", sql.Int, bookingId)
      .query(`${AL_SELECT} WHERE al.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /booking/:bookingId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /generate — auto-generate an Allotment Letter for an eligible booking.
// Gate: booking must be Approved + Active + Booking Amount milestone (MilestoneNo=1) Paid + no letter yet.
// The letter is immediately created in Issued status — no Draft step.
router.post("/generate", requirePageRight("crm-allotment-letter", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const { BookingId } = req.body;
    if (!BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(BookingId, 10);

    const activeErr = await requireApprovedBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Gate: Booking Amount milestone (MilestoneNo=1) must be Paid
    const chk = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT COUNT(*) AS PaidCount
      FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo = 1 AND Status = 'Paid'
    `);
    if (!chk.recordset[0]?.PaidCount) {
      return res.status(400).json({
        error: "Allotment Letter can only be generated once the Booking Amount milestone is fully paid."
      });
    }

    // Pre-check: guard against duplicate generation before consuming a doc-number
    // sequence slot. A UNIQUE constraint exists on (BookingId), but it only fires
    // at INSERT time — a concurrent double-submit would otherwise waste a number
    // and return an opaque 500 before our 409 catch could fire.
    const existing = await pool.request().input("bid2", sql.Int, bookingId)
      .query("SELECT TOP 1 Id, AlNo FROM dbo.CrmAllotmentLetter WHERE BookingId = @bid2");
    if (existing.recordset.length) {
      return res.status(409).json({
        error: `An Allotment Letter (${existing.recordset[0].AlNo}) has already been generated for this booking`,
      });
    }

    const alNo = await getNextDocNumber(pool, "AL", "AL");
    const result = await pool.request()
      .input("no",  sql.NVarChar(30), alNo)
      .input("bid", sql.Int, bookingId)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAllotmentLetter (AlNo, BookingId, Status, IssuedOn, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, 'Issued', CONVERT(DATE, SYSDATETIME()), @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, AlNo: alNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "An Allotment Letter has already been generated for this booking" });
    }
    console.error("[crm-allotment-letter] POST /generate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/acknowledge — customer returns the signed copy.
// Marks the letter Acknowledged, records the date, and stores the signed PDF.
// This event starts the 30-day Agreement for Sale clock under RERA.
// File is optional — staff may record acknowledgement verbally and attach later.
router.put("/:id/acknowledge", requirePageRight("crm-allotment-letter", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Status FROM dbo.CrmAllotmentLetter WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Allotment Letter not found" });
    if (cur.recordset[0].Status === "Acknowledged") return res.status(400).json({ error: "Already acknowledged" });

    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Optional signed-copy file (base64 in body)
    let fileData = null, fileName = null, mimeType = null, fileSize = null;
    if (b.file?.base64) {
      const buf = Buffer.from(b.file.base64, "base64");
      if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: "File exceeds 5 MB limit" });
      fileData = buf;
      fileName = b.file.fileName || "signed-allotment-letter.pdf";
      mimeType = b.file.mimeType || "application/pdf";
      fileSize = buf.length;
    }

    let fileSet = "";
    const req0 = pool.request()
      .input("id",  sql.Int, id)
      .input("dt",  sql.Date, b.AcknowledgedOn || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",  sql.Int, actorId(req));

    if (fileData) {
      req0.input("fn", sql.NVarChar(255), fileName)
          .input("mt", sql.NVarChar(100), mimeType)
          .input("fs", sql.Int, fileSize)
          .input("fd", sql.VarBinary(sql.MAX), fileData);
      fileSet = ", FileName = @fn, MimeType = @mt, FileSize = @fs, FileData = @fd";
    }

    await req0.query(`
      UPDATE dbo.CrmAllotmentLetter SET
        Status         = 'Acknowledged',
        AcknowledgedOn = ISNULL(@dt, CONVERT(DATE, SYSDATETIME())),
        Remarks        = ISNULL(@rem, Remarks),
        UpdatedBy      = @ub,
        UpdatedAt      = SYSDATETIME()
        ${fileSet}
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-allotment-letter] PUT /:id/acknowledge error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/pdf — generate the Allotment Letter PDF on-the-fly from booking data.
// ?download=1 → Content-Disposition: attachment (browser download prompt).
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

// GET /:id/download — serve the stored signed copy uploaded during acknowledge.
router.get("/:id/download", requirePageRight("crm-allotment-letter", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const result = await pool.request().input("id", sql.Int, id)
      .query("SELECT FileData, FileName, MimeType FROM dbo.CrmAllotmentLetter WHERE Id = @id");
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });
    const row = result.recordset[0];
    if (!row.FileData) return res.status(404).json({ error: "No signed copy attached yet" });
    res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(row.FileName || "allotment-letter")}"`);
    res.send(row.FileData);
  } catch (e) {
    console.error("[crm-allotment-letter] GET /:id/download error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
