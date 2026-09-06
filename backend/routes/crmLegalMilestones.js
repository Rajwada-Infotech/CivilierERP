const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { requireActiveBooking, requireApprovedBooking, recomputeLegalMilestoneCurrentStep } = require("../services/crmWorkflowGuards");

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

// The legal workflow spans the full property transaction lifecycle from
// Agreement Signing → AFS Registration (Visit 1) → Sale Deed → Sale Deed
// Registration (Visit 2) → Mutation → NOC. Each module owns its own
// create/update logic on its dedicated page; this page only summarises +
// links out so the team can see the entire journey in one place.
const LM_SELECT = `
  SELECT m.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName, a.Mobile,
    -- Agreement status (Executed / Registered / etc.)
    ag.Status AS AgreementStatus, ag.AgreementNo,
    -- Allotment Letter (issued right after booking, before agreement signing)
    al.Id AS AllotmentLetterId, al.AlNo, al.Status AS AllotmentLetterStatus,
    -- Sub-Registrar Visit 1: Agreement for Sale registration
    aqp.Id AS AfsQPId, aqp.AfsQPNo, aqp.Status AS AfsQPStatus,
    areg.Id AS AfsRegistryId, areg.AfsRegNo, areg.Status AS AfsRegistryStatus,
    -- Sale Deed
    sd.Id AS SalesDeedId, sd.DeedNo, sd.ExecutedBy AS DeedExecutedBy, sd.RegistrationNo AS DeedRegistrationNo,
    sd.DirectorApprovalStatus AS DeedDirectorApprovalStatus,
    -- Sub-Registrar Visit 2: Sale Deed registration
    qp.Id AS QueryPaymentId, qp.QPNo, qp.Status AS QueryPaymentStatus,
    reg.Id AS RegistryId, reg.RegNo, reg.Status AS RegistryStatus,
    -- Post-registration formalities
    mut.Id AS MutationId, mut.MutationNo, mut.Status AS MutationStatus,
    bankNoc.Id AS BankNocId, bankNoc.NocNo AS BankNocNo, bankNoc.Status AS BankNocStatus,
    orgNoc.Id AS OrgNocId, orgNoc.NocNo AS OrgNocNo, orgNoc.Status AS OrgNocStatus,
    -- Possession sequence (OC/CC is project-level; fetched via booking's ProjectId)
    occc.HasReceived AS OcCcReceived,
    pp.Status AS PrePossessionStatus,
    pn.Id AS PossessionNoticeId, pn.Status AS PossessionNoticeStatus,
    hov.Status AS HandoverStatus,
    -- Real-estate category + lifecycle status from Project Master (General
    -- tab Type + Timeline tab Status). Governs only the Handover-timing note
    -- shown in the Sale Deed/Handover stage text — see buildWorkflowModel in
    -- CrmLegalMilestones.tsx and getProjectSaleGate in crmWorkflowGuards.js.
    -- Never waives Agreement/AFS — that stays mandatory for every booking.
    proj.entity_type AS ProjectType, proj.status AS ProjectStatus,
    -- Mirrors crmHandover.js POST /'s exact dues gate (same columns, same
    -- condition) so the Handover stage here can't show "unlocked" for a
    -- booking the real Handover page would reject for an outstanding balance.
    CASE WHEN EXISTS (
      SELECT 1 FROM dbo.CrmPaymentMilestone pm
      WHERE pm.BookingId = m.BookingId
        AND pm.Status NOT IN ('Paid', 'Waived')
        AND pm.AmountDue > ISNULL(pm.AmountPaid, 0)
    ) THEN 1 ELSE 0 END AS HasOutstandingDues,
    -- No Objection Certificate is a SINGLE step per booking, not two — the
    -- bank's NOC and the developer's NOC serve the same purpose (clearing
    -- the booking for Possession/Handover); a booking only ever needs one,
    -- decided by how it's financed (see resolveNocType in
    -- crmWorkflowGuards.js for the full precedence rules, mirrored here as
    -- a single-query CASE for the list endpoint):
    --   1. A real, non-Rejected CrmNoc row already on file settles it —
    --      never contradict data that already exists.
    --   2. Otherwise: loan-financed (FinancingType = 'LoanFinanced', or an
    --      active CrmLoanDetail row — SanctionStatus NOT IN ('NotApplied',
    --      'Rejected'), same convention as crmBookings.js's ActiveLoans
    --      column) → Bank; otherwise → Organisation.
    b.FinancingType,
    CASE
      WHEN bankNoc.Id IS NOT NULL AND bankNoc.Status <> 'Rejected' THEN 'Bank'
      WHEN orgNoc.Id  IS NOT NULL AND orgNoc.Status  <> 'Rejected' THEN 'Organisation'
      WHEN b.FinancingType = 'LoanFinanced' OR EXISTS (
        SELECT 1 FROM dbo.CrmLoanDetail ld WHERE ld.BookingId = b.Id
          AND ld.SanctionStatus NOT IN ('NotApplied', 'Rejected')
      ) THEN 'Bank'
      ELSE 'Organisation'
    END AS NocResolvedType
  FROM dbo.CrmLegalMilestone m
  JOIN dbo.CrmBooking b ON b.Id = m.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
  OUTER APPLY (
    SELECT TOP 1 Id, AgreementNo, Status FROM dbo.CrmAgreement
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) ag
  OUTER APPLY (
    SELECT TOP 1 Id, AlNo, Status FROM dbo.CrmAllotmentLetter
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) al
  OUTER APPLY (
    SELECT TOP 1 Id, AfsQPNo, Status FROM dbo.CrmAfsQueryPayment
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) aqp
  OUTER APPLY (
    SELECT TOP 1 Id, AfsRegNo, Status FROM dbo.CrmAfsRegistry
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) areg
  OUTER APPLY (
    SELECT TOP 1 Id, DeedNo, ExecutedBy, RegistrationNo, DirectorApprovalStatus FROM dbo.CrmSalesDeed
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) sd
  OUTER APPLY (
    SELECT TOP 1 Id, QPNo, Status FROM dbo.CrmQueryPayment
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) qp
  OUTER APPLY (
    SELECT TOP 1 Id, RegNo, Status FROM dbo.CrmRegistry
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) reg
  OUTER APPLY (
    SELECT TOP 1 Id, MutationNo, Status FROM dbo.CrmMutation
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) mut
  OUTER APPLY (
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM dbo.CrmOccupancyCertificate
      WHERE ProjectId = b.ProjectId AND Status = 'Received'
    ) THEN 1 ELSE 0 END AS HasReceived
  ) occc
  OUTER APPLY (
    SELECT TOP 1 Status FROM dbo.CrmPrePossession
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) pp
  OUTER APPLY (
    SELECT TOP 1 Id, Status FROM dbo.CrmPossessionNotice
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) pn
  OUTER APPLY (
    SELECT TOP 1 Status FROM dbo.CrmHandover
    WHERE BookingId = m.BookingId ORDER BY CreatedAt DESC
  ) hov
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

// GET /eligible-bookings — bookings the "Start Workflow" dialog should offer.
// Mirrors the real POST / gate exactly (requireApprovedBooking + an Agreement
// on file + no tracker yet) so the dialog never lists a booking that then
// fails on submit. A plain "all bookings minus already-tracked" client-side
// filter drifted out of sync with the real gate — Expired/Cancelled/
// not-yet-approved bookings, or ones with no Agreement yet, kept showing up
// and 400ing on click.
router.get("/eligible-bookings", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT b.Id, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      JOIN dbo.CrmAgreement agr ON agr.BookingId = b.Id
      WHERE b.Status = 'Approved'
        AND b.IsActive = 1
        AND (b.IsFrozen = 0 OR (b.FreezeExpiresAt IS NOT NULL AND b.FreezeExpiresAt < SYSDATETIME()))
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmLegalMilestone WHERE BookingId = b.Id)
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-legal-milestones] GET /eligible-bookings error:", e.message);
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

    const activeErr = await requireApprovedBooking(pool, bookingId);
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
