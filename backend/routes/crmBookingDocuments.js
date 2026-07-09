const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);

// Standard checklist shown even before any row exists, so staff see what's
// expected to be collected — not just what's already been uploaded.
const STANDARD_DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];

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

// POST /booking/:bookingId — attach a document
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
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmBookingDocument WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-booking-documents] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
