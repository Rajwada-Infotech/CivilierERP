const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { isLegalWorkStarted } = require("../services/crmWorkflowGuards");
const { createAmendmentRequest } = require("../services/crmAmendments");

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

// A newly added (or removed) co-applicant changes whether the "Co-Applicant
// Details" welcome-call verification item even applies (see getActiveTemplate
// in crmWelcomeChecklist.js) — adding one to a booking whose checklist is
// already Submitted and locked would otherwise leave that locked checklist
// silently claiming "fully verified" for a fact nobody ever actually
// checked. Block the edit here instead, same as the checklist's own
// assertUnlocked gate — staff reopen the checklist first, which is an
// explicit, logged action, rather than this silently going stale.
async function assertWelcomeChecklistUnlocked(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT IsLocked FROM dbo.CrmWelcomeCallSubmission WHERE BookingId = @bid");
  if (r.recordset[0]?.IsLocked) {
    return "The welcome call verification checklist for this booking is already submitted and locked. Reopen it on the Welcome Calls page before adding or removing a co-applicant.";
  }
  return null;
}

// The actual insert, shared by the direct (pre-legal-work) path below and
// the amendment-approval replay path in crmBookingAmendments.js — never
// duplicated logic between the two.
async function applyAddCoApplicant(pool, bookingId, b, actorUserId) {
  const result = await pool.request()
    .input("bid",  sql.Int, bookingId)
    .input("name", sql.NVarChar(200), b.Name.trim())
    .input("rel",  sql.NVarChar(50), b.Relation || null)
    .input("mob",  sql.NVarChar(20), b.Mobile || null)
    .input("em",   sql.NVarChar(200), b.Email || null)
    .input("pan",  sql.NVarChar(20), b.PanNo || null)
    .input("aadh", sql.NVarChar(20), b.AadhaarNo || null)
    .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, Mobile, Email, PanNo, AadhaarNo, Notes, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@bid, @name, @rel, @mob, @em, @pan, @aadh, @note, @cb, SYSDATETIME())
    `);
  return { id: result.recordset[0].Id };
}

// POST /booking/:bookingId — add a co-applicant. A co-applicant is a named
// party on the Agreement for Sale itself — once that document actually has
// pages under verification (isLegalWorkStarted), adding one directly would
// silently leave the document out of sync with who it names. Same pattern
// crmExtraCharges.js / crmParking.js already use: queue a
// CrmBookingAmendmentRequest for approval instead of applying immediately.
router.post("/booking/:bookingId", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Name is required" });

    const lockErr = await assertWelcomeChecklistUnlocked(pool, bookingId);
    if (lockErr) return res.status(400).json({ error: lockErr });

    if (await isLegalWorkStarted(pool, bookingId)) {
      if (!b.Reason?.trim()) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
      const requestId = await createAmendmentRequest(pool, {
        bookingId, changeType: "CoApplicant", action: "Add", targetId: null,
        proposedChange: b, reason: b.Reason.trim(), requestedBy: actorId(req),
      });
      return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
    }

    const result = await applyAddCoApplicant(pool, bookingId, b, actorId(req));
    res.status(201).json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-co-applicant] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update a co-applicant. The only edit route for BOTH a
// Booking-stage row (Welcome Call) and an Application-stage row (the wizard's
// own Co-Applicant tab, added below) — there's no separate
// PUT /application/:id, since a co-applicant row's own Id is already the
// unique key regardless of which stage it belongs to. Gated on either right
// so an Application-stage salesperson (crm-applications, no Welcome Call
// access) can still edit/remove the co-applicant they themselves just added.
router.put("/:id", requireAnyPageRight(["crm-welcome-calls", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    if (!b.Name?.trim()) return res.status(400).json({ error: "Name is required" });

    await pool.request()
      .input("id",     sql.Int, id)
      .input("name",   sql.NVarChar(200), b.Name.trim())
      .input("rel",    sql.NVarChar(50), b.Relation || null)
      .input("mob",    sql.NVarChar(20), b.Mobile || null)
      .input("em",     sql.NVarChar(200), b.Email || null)
      .input("pan",    sql.NVarChar(20), b.PanNo || null)
      .input("aadh",   sql.NVarChar(20), b.AadhaarNo || null)
      .input("dob",    sql.Date,          b.DateOfBirth || null)
      .input("gender", sql.NVarChar(10),  b.Gender || null)
      .input("occ",    sql.NVarChar(100), b.Occupation || null)
      .input("inc",    sql.Decimal(18,2), b.AnnualIncome ? parseFloat(b.AnnualIncome) : null)
      .input("addr",   sql.NVarChar(300), b.Address || null)
      .input("city",   sql.NVarChar(100), b.City || null)
      .input("state",  sql.NVarChar(100), b.State || null)
      .input("pin",    sql.NVarChar(10),  b.Pincode || null)
      .input("note",   sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",     sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmCoApplicant SET
          Name = @name, Relation = @rel, Mobile = @mob, Email = @em,
          PanNo = @pan, AadhaarNo = @aadh,
          DateOfBirth = @dob, Gender = @gender, Occupation = @occ, AnnualIncome = @inc,
          Address = @addr, City = @city, [State] = @state, Pincode = @pin, Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-co-applicant] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Shared with the amendment-approval replay path — see applyAddCoApplicant.
async function applyRemoveCoApplicant(pool, id) {
  await pool.request().input("id", sql.Int, id)
    .query("UPDATE dbo.CrmCoApplicant SET IsActive = 0 WHERE Id = @id");
  return { success: true };
}

// DELETE /:id — soft delete. Same dual-gate reasoning as PUT /:id above,
// plus the same legal-work-started amendment gate as POST above (removing a
// named party from the Agreement is exactly as consequential as adding one).
router.delete("/:id", requireAnyPageRight(["crm-welcome-calls", "crm-applications"], "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const row = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId FROM dbo.CrmCoApplicant WHERE Id = @id");
    const bookingId = row.recordset[0]?.BookingId;
    if (bookingId) {
      const lockErr = await assertWelcomeChecklistUnlocked(pool, bookingId);
      if (lockErr) return res.status(400).json({ error: lockErr });

      if (await isLegalWorkStarted(pool, bookingId)) {
        const reason = req.body?.Reason?.trim();
        if (!reason) return res.status(400).json({ error: "A reason is required to request this change — legal documents are already under verification for this booking" });
        const requestId = await createAmendmentRequest(pool, {
          bookingId, changeType: "CoApplicant", action: "Remove", targetId: id,
          proposedChange: {}, reason, requestedBy: actorId(req),
        });
        return res.status(202).json({ pending: true, requestId, message: "Legal documents are already under verification — this change needs approval before it applies." });
      }
    }
    const result = await applyRemoveCoApplicant(pool, id);
    res.json(result);
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
module.exports.applyAddCoApplicant = applyAddCoApplicant;
module.exports.applyRemoveCoApplicant = applyRemoveCoApplicant;