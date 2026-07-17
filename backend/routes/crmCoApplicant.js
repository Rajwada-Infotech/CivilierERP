const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET /booking/:bookingId — co-applicants for a booking
router.get("/booking/:bookingId", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT * FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1 ORDER BY CreatedAt");
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-co-applicant] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId — add a co-applicant
router.post("/booking/:bookingId", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Name is required" });

    const result = await pool.request()
      .input("bid",  sql.Int, bookingId)
      .input("name", sql.NVarChar(200), b.Name.trim())
      .input("rel",  sql.NVarChar(50), b.Relation || null)
      .input("mob",  sql.NVarChar(20), b.Mobile || null)
      .input("em",   sql.NVarChar(200), b.Email || null)
      .input("pan",  sql.NVarChar(20), b.PanNo || null)
      .input("aadh", sql.NVarChar(20), b.AadhaarNo || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, Mobile, Email, PanNo, AadhaarNo, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @name, @rel, @mob, @em, @pan, @aadh, @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-co-applicant] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update a co-applicant
router.put("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Name is required" });

    await pool.request()
      .input("id",   sql.Int, id)
      .input("name", sql.NVarChar(200), b.Name.trim())
      .input("rel",  sql.NVarChar(50), b.Relation || null)
      .input("mob",  sql.NVarChar(20), b.Mobile || null)
      .input("em",   sql.NVarChar(200), b.Email || null)
      .input("pan",  sql.NVarChar(20), b.PanNo || null)
      .input("aadh", sql.NVarChar(20), b.AadhaarNo || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmCoApplicant SET
          Name = @name, Relation = @rel, Mobile = @mob, Email = @em,
          PanNo = @pan, AadhaarNo = @aadh, Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-co-applicant] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool.request().input("id", sql.Int, id)
      .query("UPDATE dbo.CrmCoApplicant SET IsActive = 0 WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-co-applicant] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
