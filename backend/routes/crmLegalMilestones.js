const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking, recomputeLegalMilestoneCurrentStep } = require("../services/crmWorkflowGuards");

router.use(authMiddleware);
router.use(apiRateLimit);

const STEPS = [
  "DocCollection", "LegalReview", "Drafting", "InternalApproval",
  "DocShared", "MutualAgreement", "DirectorMeeting", "FinalExecution",
];

// Every step but DirectorMeeting now auto-ticks from its real-world
// equivalent on the Agreement page (see syncLegalMilestoneStep /
// syncLegalMilestoneFromDocument in crmWorkflowGuards.js) — Status is no
// longer accepted here for those, so this endpoint can't be used to fake a
// step that hasn't actually happened. Due/Notes remain editable for every
// step (scheduling/annotating is still manual for all of them).
const MANUAL_STEPS = new Set(["DirectorMeeting"]);

// The legal workflow doesn't actually end at step 8 (Final Execution) —
// Sales Deed, Query Payment, Registry, and Bank NOC all follow it, gated on
// each other (see crmSalesDeed.js / crmQueryPayment.js / crmRegistry.js /
// crmNoc.js). This page is the natural home for showing that whole journey
// in one place, not just the 8-step agreement-signing portion, so the
// summary list carries enough from each downstream module to render it —
// without duplicating any of their own create/update logic, which stays on
// their own dedicated pages (this page only links out to them).
const LM_SELECT = `
  SELECT m.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
    sd.Id AS SalesDeedId, sd.DeedNo, sd.ExecutedBy AS DeedExecutedBy, sd.RegistrationNo AS DeedRegistrationNo,
    qp.Id AS QueryPaymentId, qp.QPNo, qp.Status AS QueryPaymentStatus,
    reg.Id AS RegistryId, reg.RegNo, reg.Status AS RegistryStatus,
    bankNoc.Id AS BankNocId, bankNoc.NocNo AS BankNocNo, bankNoc.Status AS BankNocStatus,
    orgNoc.Id AS OrgNocId, orgNoc.NocNo AS OrgNocNo, orgNoc.Status AS OrgNocStatus
  FROM dbo.CrmLegalMilestone m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.CrmSalesDeed sd ON sd.BookingId = m.BookingId
  LEFT JOIN dbo.CrmQueryPayment qp ON qp.BookingId = m.BookingId
  LEFT JOIN dbo.CrmRegistry reg ON reg.BookingId = m.BookingId
  OUTER APPLY (
    SELECT TOP 1 Id, NocNo, Status FROM dbo.CrmNoc
    WHERE BookingId = m.BookingId AND NocType = 'Bank' ORDER BY CreatedAt DESC
  ) bankNoc
  OUTER APPLY (
    SELECT TOP 1 Id, NocNo, Status FROM dbo.CrmNoc
    WHERE BookingId = m.BookingId AND NocType = 'Organisation' ORDER BY CreatedAt DESC
  ) orgNoc
`;

// GET / — all legal milestone trackers
router.get("/", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${LM_SELECT} ORDER BY m.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-legal-milestones] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId
router.get("/booking/:bookingId", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().input("bid", sql.Int, parseInt(req.params.bookingId))
      .query(`${LM_SELECT} WHERE m.BookingId = @bid`);
    res.json(result.recordset[0] || null);
  } catch (e) {
    console.error("[crm-legal-milestones] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — start the legal workflow for a booking. Its own steps
// (Drafting, DocShared, MutualAgreement, FinalExecution...) are literally
// about the agreement itself, so it can't exist before agreement
// preparation has actually started — the one structural fact we can assert
// without guessing at which exact CrmAgreement.Status this internal legal
// team process is supposed to align with.
router.post("/", requirePageRight("crm-legal-milestones", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const agr = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (!agr.recordset.length) {
      return res.status(400).json({ error: "Legal milestone tracking requires an agreement to exist for this booking first" });
    }

    const milestoneNo = "LGL-" + Date.now().toString(36).toUpperCase().slice(-7);

    const result = await pool.request()
      .input("no",  sql.NVarChar(30), milestoneNo)
      .input("bid", sql.Int,          parseInt(b.BookingId))
      .input("cb",  sql.Int,          actorId(req))
      .query(`
        INSERT INTO dbo.CrmLegalMilestone (MilestoneNo, BookingId, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, MilestoneNo: milestoneNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Legal workflow already started for this booking" });
    console.error("[crm-legal-milestones] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/:step — update a single step (Due/Done/Status/Notes), advances CurrentStep
router.put("/:id/:step", requirePageRight("crm-legal-milestones", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const step = req.params.step;
    if (!STEPS.includes(step)) return res.status(400).json({ error: `Invalid step. Must be one of: ${STEPS.join(", ")}` });
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmLegalMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Legal milestone tracker not found" });
    const activeErr = await requireActiveBooking(pool, cur.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    if (b.Status && !MANUAL_STEPS.has(step)) {
      return res.status(400).json({ error: `${step} is auto-synced from the Agreement workflow and can't be marked manually.` });
    }

    const result = await pool.request()
      .input("id",   sql.Int,  id)
      .input("due",  sql.Date, b.Due  || null)
      .input("done", sql.Date, b.Done || null)
      .input("st",   sql.NVarChar(30), b.Status || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmLegalMilestone SET
          ${step}Due    = ISNULL(@due, ${step}Due),
          ${step}Done   = ISNULL(@done, ${step}Done),
          ${step}Status = ISNULL(@st, ${step}Status),
          ${step}Notes  = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Legal milestone tracker not found" });
    await recomputeLegalMilestoneCurrentStep(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-legal-milestones] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
