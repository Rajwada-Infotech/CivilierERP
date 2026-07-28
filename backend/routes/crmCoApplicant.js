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

// ── Application-scoped routes ─────────────────────────────────────────────────
// Co-applicants are captured at the Application stage (before a Booking
// exists). Each Application has its own independent set of co-applicants —
// a customer with two Applications can have completely different co-applicants
// on each. BookingId is filled in later by crmEntityCreation.js when the
// Application converts to a Booking.

// GET /application/:applicationId — list co-applicants for an application
router.get("/application/:applicationId", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    if (isNaN(applicationId)) return res.status(400).json({ error: "Invalid applicationId" });
    const result = await pool.request().input("aid", sql.Int, applicationId)
      .query(`
        SELECT Id, Name, Relation, Mobile, Email, PanNo, AadhaarNo,
               DateOfBirth, Gender, Occupation, AnnualIncome,
               Address, City, [State], Pincode, Notes,
               SourceType, BookingId, ApplicationId, CreatedAt, UpdatedAt
        FROM dbo.CrmCoApplicant
        WHERE ApplicationId = @aid AND IsActive = 1
        ORDER BY CreatedAt
      `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-co-applicant] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /application/:applicationId — add a co-applicant to an application
router.post("/application/:applicationId", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const applicationId = parseInt(req.params.applicationId);
    if (isNaN(applicationId)) return res.status(400).json({ error: "Invalid applicationId" });

    // Verify the application exists and is active
    const app = await pool.request().input("aid", sql.Int, applicationId)
      .query("SELECT Id FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!app.recordset.length) return res.status(404).json({ error: "Application not found" });

    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Co-applicant Name is required" });

    const result = await pool.request()
      .input("aid",    sql.Int,          applicationId)
      .input("name",   sql.NVarChar(200), b.Name.trim())
      .input("rel",    sql.NVarChar(50),  b.Relation || null)
      .input("mob",    sql.NVarChar(20),  b.Mobile || null)
      .input("em",     sql.NVarChar(200), b.Email || null)
      .input("pan",    sql.NVarChar(20),  b.PanNo || null)
      .input("aadh",   sql.NVarChar(20),  b.AadhaarNo || null)
      .input("dob",    sql.Date,          b.DateOfBirth || null)
      .input("gender", sql.NVarChar(10),  b.Gender || null)
      .input("occ",    sql.NVarChar(100), b.Occupation || null)
      .input("inc",    sql.Decimal(18,2), b.AnnualIncome ? parseFloat(b.AnnualIncome) : null)
      .input("addr",   sql.NVarChar(300), b.Address || null)
      .input("city",   sql.NVarChar(100), b.City || null)
      .input("state",  sql.NVarChar(100), b.State || null)
      .input("pin",    sql.NVarChar(10),  b.Pincode || null)
      .input("note",   sql.NVarChar(sql.MAX), b.Notes || null)
      .input("src",    sql.NVarChar(20),  "Application")
      .input("cb",     sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCoApplicant
          (ApplicationId, Name, Relation, Mobile, Email, PanNo, AadhaarNo,
           DateOfBirth, Gender, Occupation, AnnualIncome,
           Address, City, [State], Pincode, Notes, SourceType, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@aid, @name, @rel, @mob, @em, @pan, @aadh,
           @dob, @gender, @occ, @inc,
           @addr, @city, @state, @pin, @note, @src, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-co-applicant] POST /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

