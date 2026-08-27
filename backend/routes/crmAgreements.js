const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCrmAudit } = require("../services/crmAudit");
const { emitNotification } = require("../services/notify");
const { validateAgreementPreparationPrerequisites, maybeAutoCreateSalesDeed, maybeAutoCreateLegalMilestone, proposeAgreementDate, acceptAgreementDate, finalizeAgreementDate, resetAgreementDateNegotiation, syncLegalMilestoneStep, syncLegalMilestoneFromDocument, maybeUnlockBrokerageOnAgreementExecuted } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
// Senior approval is gated to admin/super_admin/dba via this shared engine —
// same mechanism BOQ/Purchase Orders/etc. use — instead of any editor being
// able to self-approve on this page.
const { transition: approvalTransition } = require("../services/approvalService");

// Explicit agreement workflow state machine — matches the Status values the
// handover workflow guard (crmHandover.js) already checks for.
const AGREEMENT_TRANSITIONS = {
  Draft:      [CrmStatus.DRAFT, CrmStatus.EXECUTED, CrmStatus.CANCELLED],
  Executed:   [CrmStatus.EXECUTED, CrmStatus.REGISTERED, CrmStatus.CANCELLED],
  Registered: [CrmStatus.REGISTERED],
  Cancelled:  [CrmStatus.CANCELLED],
};

router.use(authMiddleware);
router.use(apiRateLimit);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
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

const AGR_SELECT = `
  SELECT
    ag.Id, ag.AgreementNo, ag.BookingId, ag.AgreementDate,
    ag.LegalName, ag.LegalAddress, ag.PanNo, ag.AadhaarNo, ag.VersionNo,
    ag.Status, ag.Notes, ag.CreatedAt, ag.UpdatedAt,
    ag.SeniorApprovalStatus, ag.SeniorApprovedAt, ag.SeniorApprovalRemarks,
    ag.CustomerApprovalStatus, ag.CustomerApprovedAt,
    ag.RecheckCount, ag.LastRecheckRemarks,
    ag.ProposedDate, ag.ProposedDateStatus, ag.SentToCustomerAt, ag.DateApprovalStatus,
    ag.AfsRegistrationNo, ag.AfsRegistrationDate,
    ag.LegalExecutiveId, le.name AS LegalExecutiveName,
    b.BookingNo,
    COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    b.TotalValue, b.GrandTotal, b.TotalGstAmount,
    b.UnitGstAmount, b.ParkingTotal, b.ParkingGstAmount, b.ExtraChargesTotal, b.ExtraWorkGstAmount,
    b.Status AS BookingStatus, b.IsActive AS BookingIsActive,
    a.ApplicantName, a.Mobile, a.Email,
    cu.name AS CreatedByName,
    pu.Email AS PortalEmail, pu.IsActive AS PortalActive, pu.MustChangePassword AS PortalMustChangePassword
  FROM dbo.CrmAgreement ag
  JOIN  dbo.CrmBooking b     ON b.Id = ag.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.Users cu     ON cu.id = ag.CreatedBy
  LEFT JOIN dbo.Users le     ON le.id = ag.LegalExecutiveId
  LEFT JOIN dbo.CrmCustomerPortalUser pu ON pu.CustomerId = a.CustomerId
`;

// Shared lock check — nothing here previously checked whether the Booking
// behind an Agreement was still live. A Booking can be cancelled after its
// Agreement already exists (independently, from the Bookings module), and
// until now the Agreement page had zero visibility into that: it would keep
// showing Edit/Send/Mark Executed/etc. as normal, active actions on a
// contract for a sale that no longer exists. Mirrors the same
// IsActive/Status NOT IN ('Cancelled','Rejected') definition used
// everywhere else in the codebase (see unitMaster.js). Only /:id/cancel is
// deliberately exempt — closing out the agreement itself must stay possible.
async function getAgreementBookingLockReason(pool, agreementId) {
  const result = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT b.Status AS BookingStatus, b.IsActive AS BookingIsActive
    FROM dbo.CrmAgreement ag
    JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
    WHERE ag.Id = @id
  `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (row.BookingIsActive === false || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(row.BookingStatus)) {
    return `the underlying booking is ${row.BookingStatus || "inactive"}`;
  }
  return null;
}

// A separate check from the booking lock above — this one guards the
// agreement's own lifecycle rather than its booking. Once Executed or
// Registered, the document set is part of what was actually signed off;
// attaching/requesting/uploading new documents against it afterward would
// let the "as executed" record keep changing after the fact with nobody
// told. Used by the three document routes below and by crmPortal.js's own
// customer-facing upload route.
async function agreementExecutedLockReason(pool, agreementId) {
  const result = await pool.request().input("id", sql.Int, agreementId)
    .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
  if (!result.recordset.length) return null;
  const status = result.recordset[0].Status;
  if ([CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(status)) {
    return `this agreement is already ${status}`;
  }
  return null;
}

// "Agreement Followup" step — % of this agreement's mandatory document
// TYPES that actually have a file attached. Deliberately computed live on
// every call (never stored) so it can never go stale through a reject/
// resend/recheck cycle — the moment a document's file changes, the next
// read reflects it automatically. Zero mandatory documents requested yet
// means 0%, not a vacuous 100% — staff must actually request/attach the
// real paperwork before this can complete; there being nothing to check
// yet doesn't count as "checked."
async function agreementFollowupProgress(pool, agreementId) {
  const result = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT COUNT(*) AS Required, SUM(CASE WHEN FileBase64 IS NOT NULL THEN 1 ELSE 0 END) AS Uploaded
    FROM dbo.CrmAgreementDocument WHERE AgreementId = @id AND IsMandatory = 1
  `);
  const row = result.recordset[0] || { Required: 0, Uploaded: 0 };
  const required = Number(row.Required) || 0;
  const uploaded = Number(row.Uploaded) || 0;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

// GET / — all agreements
router.get("/", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("ag.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${AGR_SELECT} ${where} ORDER BY ag.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /eligible-bookings — bookings that may legitimately have a NEW
// agreement created for them right now. Registered ahead of GET /:id so
// "eligible-bookings" is never swallowed by the :id param route.
//
// Mirrors validateAgreementPreparationPrerequisites() exactly (same function,
// not a re-implementation) so this list can never drift out of sync with
// the real gate POST / already enforces. In the normal flow an agreement
// auto-creates the moment every prerequisite lands (see
// maybeAutoCreateAgreement in crmWorkflowGuards.js, wired from
// crmWelcomeCalls.js and crmCustomerBankDetails.js) — so this list is
// usually short: bookings that are Approved with no Agreement yet, most of
// which are still missing a prerequisite. That's intentional; the "New
// Agreement" dialog is a manual/admin path, not the primary one.
router.get("/eligible-bookings", requirePageRight("crm-agreements", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const candidates = await pool.request().query(`
      SELECT b.Id, b.BookingNo, a.ApplicantName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.Status = '${CrmStatus.APPROVED}' AND b.IsActive = 1
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id)
      ORDER BY b.BookingNo
    `);

    const eligible = [];
    for (const c of candidates.recordset) {
      const prereq = await validateAgreementPreparationPrerequisites(pool, c.Id);
      if (prereq.ok) eligible.push({ Id: c.Id, BookingNo: c.BookingNo, ApplicantName: c.ApplicantName });
    }
    res.json(eligible);
  } catch (e) {
    console.error("[crm-agreements] GET /eligible-bookings error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — agreement with documents
router.get("/:id", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [agRes, docRes, milRes, oaRes, mrRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${AGR_SELECT} WHERE ag.Id = @id`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT d.Id, d.AgreementId, d.DocumentType, d.DocumentUrl, d.FileName, d.IssuedBy, d.Status, d.Remarks,
                d.UploadedAt, d.CreatedBy, d.CreatedAt, d.VersionNo, d.FileSize, d.MimeType, d.UploadedByType,
                d.RequestedBy, d.RequestedAt, d.Label, d.IsMandatory,
                CASE WHEN d.FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS FilePath,
                cu.name AS CreatedByName
         FROM dbo.CrmAgreementDocument d LEFT JOIN dbo.Users cu ON cu.id = d.CreatedBy WHERE d.AgreementId = @id ORDER BY d.CreatedAt`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ISNULL(SUM(AmountDue),0) AS TotalDue, ISNULL(SUM(AmountPaid),0) AS TotalPaid
         FROM dbo.CrmPaymentMilestone WHERE BookingId = (SELECT BookingId FROM dbo.CrmAgreement WHERE Id = @id)`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount,0)),0) AS AvailableBalance
         FROM dbo.CrmOnAccountPayment WHERE BookingId = (SELECT BookingId FROM dbo.CrmAgreement WHERE Id = @id)`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ISNULL(SUM(Amount),0) AS MRTotal FROM dbo.CrmMoneyReceipt
         WHERE BookingId = (SELECT BookingId FROM dbo.CrmAgreement WHERE Id = @id) AND Status IN ('${CrmStatus.PENDING}','${CrmStatus.APPROVED}')`),
    ]);
    if (!agRes.recordset[0]) return res.status(404).json({ error: "Agreement not found" });
    const mil = milRes.recordset[0] || {};
    const cleared = Number(mil.TotalPaid || 0);
    const mrReceived = Number(mrRes.recordset[0]?.MRTotal || 0);
    res.json({
      agreement: agRes.recordset[0],
      documents: docRes.recordset,
      financialSummary: {
        cleared,
        totalDue: Number(mil.TotalDue || 0),
        approvedOnAccount: Number(oaRes.recordset[0]?.AvailableBalance || 0),
        mrOnAccount: Math.max(0, mrReceived - cleared),
      },
    });
  } catch (e) {
    console.error("[crm-agreements] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/revisions — prior versions of the agreement's legal content,
// newest first. Each row is what was superseded, with the reason.
router.get("/:id/revisions", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT r.*, cu.name AS CreatedByName
      FROM dbo.CrmAgreementRevision r
      LEFT JOIN dbo.Users cu ON cu.id = r.CreatedBy
      WHERE r.AgreementId = @id
      ORDER BY r.VersionNo DESC, r.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET /:id/revisions error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create agreement for a booking (one per booking, enforced by UNIQUE on BookingId)
router.post("/", requirePageRight("crm-agreements", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const bookingRow = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT Status, IsActive FROM dbo.CrmBooking WHERE Id = @bid");
    if (!bookingRow.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const bkg = bookingRow.recordset[0];
    if (bkg.IsActive === false || [CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(bkg.Status)) {
      return res.status(400).json({ error: `Cannot create an agreement — this booking is ${bkg.Status || "inactive"}.` });
    }

    const prereq = await validateAgreementPreparationPrerequisites(pool, bookingId);
    if (!prereq.ok) {
      return res.status(400).json({
        error: "Agreement preparation prerequisites are incomplete",
        details: prereq.errors,
      });
    }

    // System-assigned unique agreement number
    const agNo = await getNextDocNumber(pool, "AGR", "AGR");

    // Status always starts Draft — it is never accepted from the request body,
    // here or in PUT below. It only ever advances via /:id/mark-executed,
    // /:id/mark-registered, /:id/cancel — each gated on the real workflow
    // step (approvals, dates) actually having happened, not a free choice.
    //
    // AgreementDate is likewise never accepted here — per the workflow's
    // "SET IT WITH BOTH END'S AVAILABILITY" requirement, it can only ever be
    // set by finalizeAgreementDate() once a super_admin approves it (via
    // PUT /:id/date/approve), which itself only becomes possible once one
    // side accepts the other's proposed date (PUT /:id/propose-date +
    // /:id/date/accept, or POST /agreement/propose-date + /agreement/respond
    // on the portal side). A field that let staff type a date directly here
    // would silently bypass that mandate.
    const result = await pool.request()
      .input("agno",  sql.NVarChar(50),  agNo)
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("lname", sql.NVarChar(300), b.LegalName     || null)
      .input("laddr", sql.NVarChar(sql.MAX), b.LegalAddress  || null)
      .input("pan",   sql.NVarChar(20),  b.PanNo         || null)
      .input("aadh",  sql.NVarChar(20),  b.AadhaarNo     || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("leg",   sql.Int,           b.LegalExecutiveId ? parseInt(b.LegalExecutiveId) : null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreement
          (AgreementNo, BookingId, LegalName, LegalAddress, PanNo, AadhaarNo, Status, Notes, LegalExecutiveId, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@agno, @bid, @lname, @laddr, @pan, @aadh, 'Draft', @note, @leg, @cb, SYSDATETIME())
      `);
    const agreementId = result.recordset[0].Id;

    // Same standing SaleAgreement request maybeAutoCreateAgreement() seeds
    // for the normal (auto-created) path — this manual "New Agreement"
    // dialog is the fallback path (e.g. no unit preselected on the
    // Application), and must guarantee the same baseline: every agreement,
    // however it was created, always has the real legal paperwork tracked
    // as a mandatory document from day one.
    await pool.request()
      .input("agid", sql.Int, agreementId)
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementDocument
          (AgreementId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
        VALUES (@agid, 'SaleAgreement', 'Sale Agreement (Legal Paperwork)', 1, 'Requested', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
      `);

    // Same auto-start maybeAutoCreateAgreement() does for the normal path —
    // this manual dialog must not leave the booking without a Legal
    // Milestone tracker just because the agreement didn't come from the
    // auto-create trigger.
    try {
      await maybeAutoCreateLegalMilestone(pool, bookingId, actorId(req));
    } catch (e) {
      console.error("[crm-agreements] legal milestone auto-start failed:", e.message);
    }

    // Portal is provisioned at booking confirmation (crmBookingStageService.js)
    // — no duplicate call needed here. The idempotent ensurePortalUser() would
    // no-op anyway, but removing it keeps this path clean and avoids an extra
    // DB round-trip on every manual agreement creation.

    // "A legal person will arrange/prepare the papers works" — if assigned
    // at creation time, they're notified immediately rather than having to
    // discover the assignment by browsing the list.
    if (b.LegalExecutiveId) {
      await emitNotification(pool, parseInt(b.LegalExecutiveId), "crm_agreement_legal_assigned",
        "Agreement Assigned For Preparation",
        `${agNo} assigned to you for legal preparation.`,
        agreementId, "crm_agreement");
    }

    res.status(201).json({ success: true, id: agreementId, AgreementNo: agNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "An agreement already exists for this booking" });
    console.error("[crm-agreements] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Rejected -> Pending. Lets staff resubmit a senior-rejected
// agreement for another approval pass (no role restriction — this is not
// an approval action).
router.put("/:id/submit", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot resubmit — ${lockReason}. Cancel the agreement instead.` });
    const result = await approvalTransition("crm-agreements", id, CrmStatus.PENDING, userEmail, req.user?.role);
    await pool.request()
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.CrmAgreement SET
          SeniorApprovedBy = NULL,
          SeniorApprovedAt = NULL,
          SeniorApprovalRemarks = NULL,
          SentToCustomerAt = NULL,
          CustomerApprovalStatus = '${CrmStatus.PENDING}',
          CustomerApprovedAt = NULL,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — senior approval. Admin/super_admin/dba only, enforced
// inside approvalTransition(). Only reachable from the Admin Approval Inbox
// now — there is no self-approve button on the agreement page anymore.
router.put("/:id/approve", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool0 = getPool();
    const lockReason0 = await getAgreementBookingLockReason(pool0, id);
    if (lockReason0) return res.status(409).json({ error: `Cannot approve — ${lockReason0}. Cancel the agreement instead.` });
    // Same mandate mark-executed already enforces, moved earlier: a Legal
    // Executive must be on record before senior approval, not just before
    // execution. The stepper (CrmAgreement.tsx: agreementStepStates) already
    // displays "Legal Exec. Assigned" as the step before "Senior Approval" —
    // this makes that order real instead of just a label, closing the gap
    // where senior-approve -> send -> customer-approve -> date-agree could
    // all complete with nobody assigned, and the stepper would show a "done"
    // step sitting after a still-"current" one.
    const legalCheck0 = await pool0.request().input("id", sql.Int, id)
      .query("SELECT LegalExecutiveId FROM dbo.CrmAgreement WHERE Id = @id");
    if (!legalCheck0.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    if (!legalCheck0.recordset[0].LegalExecutiveId) {
      return res.status(400).json({ error: "A Legal Executive must be assigned before this agreement can receive senior approval — use PUT /:id/assign-legal" });
    }
    // Agreement Followup gate — mandatory paperwork must actually be
    // attached (100% of required document types have a real file) before
    // this can be senior-approved. Computed live, never cached, so a
    // reject/resend cycle can never leave a stale "done" behind.
    const followup0 = await agreementFollowupProgress(pool0, id);
    if (followup0.required === 0) {
      return res.status(400).json({ error: "No mandatory agreement documents have been requested/attached yet — add the required paperwork before this can receive senior approval" });
    }
    if (followup0.percent < 100) {
      return res.status(400).json({ error: `Agreement Followup is only ${followup0.percent}% complete (${followup0.uploaded}/${followup0.required} mandatory documents attached) — all required paperwork must be attached before senior approval` });
    }
    // The Admin Approval Inbox's Approve/Reject buttons render through the
    // shared ApprovalActions component (src/components/ApprovalActions.tsx),
    // which posts { note: ... } — not { Remarks: ... }, which is what every
    // other approval-gated module (BOQ, Journal Voucher, Inter-Company
    // Transfer) already reads. This route was the one outlier still reading
    // the wrong field name, so any remarks staff typed on approve/reject
    // were silently discarded — worse once reject's remarks became
    // mandatory below, since that field-name mismatch would then hard-block
    // every real reject even when staff DID type a reason.
    const remarks = req.body?.note || null;
    const result = await approvalTransition("crm-agreements", id, CrmStatus.APPROVED, userEmail, req.user?.role, remarks, actorId(req));
    if (result.newStatus === CrmStatus.APPROVED) {
      const pool = getPool();
      await pool.request()
        .input("id", sql.Int, id)
        .input("aid", sql.Int, actorId(req))
        .input("rem", sql.NVarChar(sql.MAX), remarks)
        .query(`
          UPDATE dbo.CrmAgreement SET
            SeniorApprovedBy = @aid,
            SeniorApprovedAt = SYSDATETIME(),
            SeniorApprovalRemarks = @rem,
            UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);

      const agBooking = await pool.request().input("id", sql.Int, id)
        .query("SELECT BookingId FROM dbo.CrmAgreement WHERE Id = @id");
      const bookingIdForSync = agBooking.recordset[0]?.BookingId;
      if (bookingIdForSync) {
        await syncLegalMilestoneStep(pool, bookingIdForSync, "InternalApproval", actorId(req));
      }

      // Auto-flow: "SENIOR APPROVAL -> SHOW AGREEMENT TO THE CUSTOMER" is
      // meant to happen the instant senior approval lands, not wait on
      // staff remembering a separate "Send to Customer Portal" click. Only
      // gated on at least one document already being attached — there's
      // nothing to show the customer otherwise, and staff can still use the
      // manual send button once they've uploaded one.
      const docCount = await pool.request().input("id", sql.Int, id)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmAgreementDocument WHERE AgreementId = @id");
      if (docCount.recordset[0].Cnt > 0) {
        const already = await pool.request().input("id", sql.Int, id)
          .query("SELECT SentToCustomerAt FROM dbo.CrmAgreement WHERE Id = @id");
        if (!already.recordset[0].SentToCustomerAt) {
          await pool.request().input("id", sql.Int, id).query(`
            UPDATE dbo.CrmAgreement SET
              SentToCustomerAt = SYSDATETIME(), CustomerApprovalStatus = '${CrmStatus.PENDING}', CustomerApprovedAt = NULL
            WHERE Id = @id
          `);
          await pool.request().input("agid", sql.Int, id).query(`
            INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, CreatedAt)
            VALUES (@agid, 'SendToCustomer', 'System', SYSDATETIME())
          `);
          await syncLegalMilestoneStep(pool, bookingIdForSync, "DocShared", actorId(req));

          const info = await pool.request().input("id", sql.Int, id).query(`
            SELECT ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
            FROM dbo.CrmAgreement ag
            JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
            JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
            WHERE ag.Id = @id
          `);
          const row = info.recordset[0];
          if (row?.AssignedTo) {
            await emitNotification(pool, row.AssignedTo, "crm_agreement_sent_to_customer",
              "Agreement Sent to Customer",
              `${row.AgreementNo} (${row.BookingNo}) is now visible to ${row.ApplicantName} in their portal, awaiting their approval.`,
              id, "crm_agreement");
          }
          await logCommunication(pool, {
            bookingId: row?.BookingId, direction: "Outbound",
            subject: `Agreement ${row?.AgreementNo} sent to customer`,
            summary: "Agreement shared with the customer via portal, awaiting their approval.",
            createdBy: actorId(req),
          });
        }
      }
    }

    // Only log the audit entry once ALL approval levels are satisfied —
    // partial multi-level approvals should not appear as "SeniorApprove" in the trail.
    if (result.newStatus === CrmStatus.APPROVED) {
      await logApprovalHistory(id, "SeniorApprove", remarks, actorId(req));
    }
    // Forward the full transition() result (not just `status`) — when this
    // is one level of several (see migration 169's 2-level workflow),
    // newStatus/level/totalLevels are what ApprovalActions.tsx reads to show
    // "Level 1 of 2 approved" instead of misleadingly saying fully approved.
    res.json({ success: true, status: result.newStatus, ...result });
  } catch (e) {
    console.error("[crm-agreements] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — senior rejection. Admin/super_admin/dba only.
router.put("/:id/reject", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    // Same field-name fix as /approve above — the shared ApprovalActions
    // component posts { note: ... }.
    const remarks = req.body?.note?.trim() || null;
    if (!remarks) return res.status(400).json({ error: "Remarks are required when rejecting an agreement" });
    const pool = getPool();

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot reject — ${lockReason}. Cancel the agreement instead.` });

    // Snapshot before the transition touches anything — same content, no
    // VersionNo bump, but tagged with why it bounced back. Mirrors the
    // Recheck-branch fix in crmPortal.js's POST /agreement/respond.
    const oldRow = (await pool.request().input("id", sql.Int, id)
      .query("SELECT VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes FROM dbo.CrmAgreement WHERE Id = @id")).recordset[0];

    const result = await approvalTransition("crm-agreements", id, CrmStatus.REJECTED, userEmail, req.user?.role, remarks);
    // Check if customer had already approved before resetting — log it so the
    // reset is traceable and not a silent discard.
    const priorCustomer = (await pool.request().input("id", sql.Int, id)
      .query("SELECT CustomerApprovalStatus, CustomerApprovedAt FROM dbo.CrmAgreement WHERE Id = @id")).recordset[0];
    const customerHadApproved = priorCustomer?.CustomerApprovalStatus === CrmStatus.APPROVED;

    await pool.request()
      .input("id", sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), remarks)
      .query(`
        UPDATE dbo.CrmAgreement SET
          SeniorApprovedBy = NULL,
          SeniorApprovedAt = NULL,
          SeniorApprovalRemarks = @rem,
          SentToCustomerAt = NULL,
          CustomerApprovalStatus = '${CrmStatus.PENDING}',
          CustomerApprovedAt = NULL,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    if (customerHadApproved) {
      await pool.request().input("agid", sql.Int, id).input("rem", sql.NVarChar(sql.MAX), remarks).query(`
        INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, Remarks, ActorType, CreatedAt)
        VALUES (@agid, 'CustomerApprovalVoided', @rem, 'System', SYSDATETIME())
      `);
    }

    if (oldRow) {
      await pool.request()
        .input("agid", sql.Int, id)
        .input("ver",  sql.Int, oldRow.VersionNo)
        .input("adt",  sql.Date, oldRow.AgreementDate)
        .input("lname",sql.NVarChar(300), oldRow.LegalName)
        .input("laddr",sql.NVarChar(sql.MAX), oldRow.LegalAddress)
        .input("pan",  sql.NVarChar(20), oldRow.PanNo)
        .input("aadh", sql.NVarChar(20), oldRow.AadhaarNo)
        .input("note", sql.NVarChar(sql.MAX), oldRow.Notes)
        .input("reason", sql.NVarChar(500), `Senior rejection${remarks ? `: ${remarks}` : ""}`)
        .input("cb",   sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmAgreementRevision
            (AgreementId, VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes, Reason, CreatedBy, CreatedAt)
          VALUES (@agid, @ver, @adt, @lname, @laddr, @pan, @aadh, @note, @reason, @cb, SYSDATETIME())
        `);
    }

    await logApprovalHistory(id, "SeniorReject", remarks, actorId(req));
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/date/approve — the second, independent approval gate: confirms
// the agreement date once both sides have proposed a matching one
// (DateApprovalStatus='Pending', set by acceptAgreementDate()).
// Restricted to super_admin only via approvalService's
// MODULE_APPROVER_ROLE_OVERRIDES + the seeded LevelsData — same
// "hardcoded for now, reassignable later with zero code change" pattern
// used for Senior Approval.
router.put("/:id/date/approve", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool0 = getPool();
    const lockReason0 = await getAgreementBookingLockReason(pool0, id);
    if (lockReason0) return res.status(409).json({ error: `Cannot approve a date — ${lockReason0}. Cancel the agreement instead.` });
    // Same field-name fix as Senior Approval above — this route is also
    // reached through the shared ApprovalActions component (module
    // "crm-agreement-date" in ApprovalInbox.tsx), which posts { note: ... }.
    const remarks = req.body?.note || null;
    const result = await approvalTransition("crm-agreement-date", id, CrmStatus.APPROVED, userEmail, req.user?.role, remarks, actorId(req));
    if (result.newStatus === CrmStatus.APPROVED) {
      const pool = getPool();
      const confirmedDate = await finalizeAgreementDate(pool, id);

      const info = await pool.request().input("id", sql.Int, id).query(`
        SELECT ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmAgreement ag
        JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE ag.Id = @id
      `);
      const row = info.recordset[0];
      if (row?.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_agreement_date_approved",
          "Agreement Date Approved",
          `${row.AgreementNo} (${row.BookingNo}) is now dated ${String(confirmedDate).slice(0, 10)} — ready to mark executed once documents are verified.`,
          id, "crm_agreement");
      }
      await logCommunication(pool, {
        bookingId: row?.BookingId, direction: "Outbound",
        subject: `Agreement date confirmed — ${String(confirmedDate).slice(0, 10)}`,
        summary: `${row?.AgreementNo}: both sides agreed and a super admin approved ${String(confirmedDate).slice(0, 10)} as the agreement date.`,
        createdBy: actorId(req),
      });
    }
    res.json({ success: true, status: result.newStatus, ...result });
  } catch (e) {
    console.error("[crm-agreements] date/approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/date/reject — the proposed date is not acceptable. Both
// proposals are cleared so staff and customer start the date negotiation
// over, rather than leaving a rejected date sitting on the record.
router.put("/:id/date/reject", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    // Same field-name fix as above.
    const remarks = req.body?.note || null;
    const pool = getPool();
    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot reject a date — ${lockReason}. Cancel the agreement instead.` });
    const result = await approvalTransition("crm-agreement-date", id, CrmStatus.REJECTED, userEmail, req.user?.role, remarks);
    await resetAgreementDateNegotiation(pool, id);
    await pool.request()
      .input("agid", sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), remarks)
      .input("aid", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, Remarks, ActorType, ActorId, CreatedAt)
        VALUES (@agid, 'AgreementDateRejected', @rem, 'Staff', @aid, SYSDATETIME())
      `);

    const info = await pool.request().input("id", sql.Int, id).query(`
      SELECT ag.AgreementNo, ag.BookingId, b.AssignedTo, b.BookingNo FROM dbo.CrmAgreement ag JOIN dbo.CrmBooking b ON b.Id = ag.BookingId WHERE ag.Id = @id
    `);
    const row = info.recordset[0];
    if (row?.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "crm_agreement_date_rejected",
        "Agreement Date Rejected",
        `The proposed date for ${row.AgreementNo} (${row.BookingNo}) was rejected${remarks ? `: ${remarks}` : ""}. Propose a new date to restart.`,
        id, "crm_agreement");
    }
    await logCommunication(pool, {
      bookingId: row?.BookingId, direction: "Outbound",
      subject: `Agreement date proposal rejected`,
      summary: `${row?.AgreementNo}: proposed date was not approved${remarks ? ` — ${remarks}` : ""}.`,
      createdBy: actorId(req),
    });

    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-agreements] date/reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// CRM-specific friendly approval history (SendToCustomer/CustomerApprove/
// CustomerRecheck live here too) — separate from, and in addition to, the
// generic ApprovalAuditLog the engine above writes for security purposes.
async function logApprovalHistory(agreementId, action, remarks, actorIdVal) {
  const pool = getPool();
  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("act",  sql.NVarChar(30), action)
    .input("rem",  sql.NVarChar(sql.MAX), remarks || null)
    .input("aid",  sql.Int, actorIdVal)
    .query(`
      INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, Remarks, ActorType, ActorId, CreatedAt)
      VALUES (@agid, @act, @rem, 'Staff', @aid, SYSDATETIME())
    `);
}

// PUT /:id/send-to-customer — publish the agreement to the customer portal
// for their approval; requires senior approval first.
router.put("/:id/send-to-customer", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const { proposedDate } = req.body;

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot send to customer — ${lockReason}. Cancel the agreement instead.` });

    const ag = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        ag.SeniorApprovalStatus,
        ag.BookingId,
        (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = ag.Id) AS DocumentCount
      FROM dbo.CrmAgreement ag
      WHERE ag.Id = @id
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    if (ag.recordset[0].SeniorApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Agreement must receive senior approval before it can be sent to the customer" });
    }
    if (!ag.recordset[0].DocumentCount) {
      return res.status(400).json({ error: "Upload at least one agreement document before sending it to the customer portal" });
    }

    // Preserve the prior proposed date (if any) in history before it's
    // overwritten — nothing about the negotiation is ever lost. If
    // proposedDate is omitted, leave whatever's currently on ProposedDate/
    // ProposedDateStatus alone (e.g. resending after recheck without
    // changing the date already on the table).
    if (proposedDate) {
      await pool.request()
        .input("agid", sql.Int, id)
        .input("pd",   sql.Date, proposedDate)
        .input("cb",   sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmAgreementDateHistory (AgreementId, ProposedBy, ProposedDate, CreatedBy, CreatedAt)
          VALUES (@agid, 'Company', @pd, @cb, SYSDATETIME())
        `);
      await pool.request()
        .input("id", sql.Int, id)
        .input("pd", sql.Date, proposedDate)
        .query(`
          UPDATE dbo.CrmAgreement SET
            ProposedDate = @pd, ProposedDateStatus = '${CrmStatus.PENDING_CUSTOMER_REVIEW}'
          WHERE Id = @id
        `);
    }

    await pool.request()
      .input("id",  sql.Int, id)
      .query(`
        UPDATE dbo.CrmAgreement SET
          SentToCustomerAt = SYSDATETIME(),
          CustomerApprovalStatus = '${CrmStatus.PENDING}',
          CustomerApprovedAt = NULL
        WHERE Id = @id
      `);

    await pool.request()
      .input("agid", sql.Int, id)
      .input("aid",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, ActorId, CreatedAt)
        VALUES (@agid, 'SendToCustomer', 'Staff', @aid, SYSDATETIME())
      `);
    await syncLegalMilestoneStep(pool, ag.recordset[0].BookingId, "DocShared", actorId(req));

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT /:id/send-to-customer error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/propose-date — set/update the company's proposed agreement date
// on an already-sent agreement, without re-triggering the send itself (now
// that sending happens automatically on senior approval, this is the only
// remaining way for staff to propose or renegotiate a date).
router.put("/:id/propose-date", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const { proposedDate } = req.body;
    if (!proposedDate) return res.status(400).json({ error: "proposedDate is required" });

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot propose a date — ${lockReason}. Cancel the agreement instead.` });

    const ag = await pool.request().input("id", sql.Int, id).query(`
      SELECT ag.SentToCustomerAt, ag.AgreementNo, ag.BookingId
      FROM dbo.CrmAgreement ag WHERE ag.Id = @id
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const agRow = ag.recordset[0];
    if (!agRow.SentToCustomerAt) return res.status(400).json({ error: "Agreement hasn't been sent to the customer yet" });

    await proposeAgreementDate(pool, id, "Company", proposedDate, actorId(req));

    await logCommunication(pool, {
      bookingId: agRow.BookingId, direction: "Outbound",
      subject: `Proposed agreement date — ${proposedDate}`,
      summary: `${agRow.AgreementNo}: we proposed ${proposedDate}.`,
      createdBy: actorId(req),
    });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT /:id/propose-date error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/date/accept — company accepts the customer's currently-proposed
// date as-is (no need to re-propose the identical date). Moves the
// negotiation to 'Matched' and opens the super_admin sign-off gate, exactly
// like a same-date match did under the old two-column design.
router.put("/:id/date/accept", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot accept a date — ${lockReason}. Cancel the agreement instead.` });

    const ag = await pool.request().input("id", sql.Int, id).query(`
      SELECT ag.AgreementNo, ag.BookingId, ag.ProposedDate FROM dbo.CrmAgreement ag WHERE ag.Id = @id
    `);
    if (!ag.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const agRow = ag.recordset[0];

    await acceptAgreementDate(pool, id, "Company");

    await logCommunication(pool, {
      bookingId: agRow.BookingId, direction: "Outbound",
      subject: "Agreement date accepted — sent for approval",
      summary: `${agRow.AgreementNo}: we accepted the customer's proposed date ${String(agRow.ProposedDate).slice(0, 10)}, sent for super admin sign-off.`,
      createdBy: actorId(req),
    });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT /:id/date/accept error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /:id/date-history — every proposed execution date, company and
// customer side, in order — nothing here is ever overwritten in place.
router.get("/:id/date-history", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("agid", sql.Int, id).query(`
      SELECT h.*, u.name AS CreatedByName
      FROM dbo.CrmAgreementDateHistory h
      LEFT JOIN dbo.Users u ON u.id = h.CreatedBy
      WHERE h.AgreementId = @agid
      ORDER BY h.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET /:id/date-history error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update agreement
// Generic PUT never accepts Status — it is auto-derived, never freely chosen.
// Status only ever advances via /:id/mark-executed, /:id/mark-registered,
// /:id/cancel below, each gated on the real workflow step having happened.
router.put("/:id", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes, LegalExecutiveId, AgreementNo, BookingId FROM dbo.CrmAgreement WHERE Id = @id");
    if (!old.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const oldRow = old.recordset[0];

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot edit — ${lockReason}. Cancel the agreement instead.` });
    // Once an agreement is Executed or Registered, its legal content is the
    // record of what the customer actually approved and signed — it must
    // never silently drift after the fact. Previously this had no gate
    // beyond the booking-lock check above, so LegalName/PAN/Aadhaar could
    // still be edited (with a real VersionNo bump + revision row) on an
    // already-executed contract with nobody notified.
    if ([CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(oldRow.Status)) {
      return res.status(409).json({ error: `Cannot edit — this agreement is already ${oldRow.Status}. Its legal content is locked.` });
    }

    // AgreementDate is deliberately NOT accepted here — see the note on
    // POST / above. Edit Details can correct legal identity fields, but the
    // agreement date can only ever come from both sides' proposals matching.
    const touchesLegalContent = b.LegalName != null
      || b.LegalAddress != null || b.PanNo != null || b.AadhaarNo != null;
    if (touchesLegalContent) {
      await pool.request()
        .input("agid", sql.Int, id)
        .input("ver",  sql.Int, oldRow.VersionNo)
        .input("adt",  sql.Date, oldRow.AgreementDate)
        .input("lname",sql.NVarChar(300), oldRow.LegalName)
        .input("laddr",sql.NVarChar(sql.MAX), oldRow.LegalAddress)
        .input("pan",  sql.NVarChar(20), oldRow.PanNo)
        .input("aadh", sql.NVarChar(20), oldRow.AadhaarNo)
        .input("note", sql.NVarChar(sql.MAX), oldRow.Notes)
        .input("reason", sql.NVarChar(200), b.RevisionReason || "Staff correction")
        .input("cb",   sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmAgreementRevision
            (AgreementId, VersionNo, AgreementDate, LegalName, LegalAddress, PanNo, AadhaarNo, Notes, Reason, CreatedBy, CreatedAt)
          VALUES (@agid, @ver, @adt, @lname, @laddr, @pan, @aadh, @note, @reason, @cb, SYSDATETIME())
        `);
    }

    const newLegalExecutiveId = b.LegalExecutiveId !== undefined
      ? (b.LegalExecutiveId ? parseInt(b.LegalExecutiveId) : null)
      : oldRow.LegalExecutiveId;

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("lname", sql.NVarChar(300), b.LegalName     || null)
      .input("laddr", sql.NVarChar(sql.MAX), b.LegalAddress  || null)
      .input("pan",   sql.NVarChar(20),  b.PanNo         || null)
      .input("aadh",  sql.NVarChar(20),  b.AadhaarNo     || null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("bump",  sql.Int,           touchesLegalContent ? 1 : 0)
      .input("leg",   sql.Int,           newLegalExecutiveId)
      .input("ub",    sql.Int,           actor)
      .query(`
        UPDATE dbo.CrmAgreement SET
          LegalName = ISNULL(@lname, LegalName),
          LegalAddress = ISNULL(@laddr, LegalAddress),
          PanNo = ISNULL(@pan, PanNo),
          AadhaarNo = ISNULL(@aadh, AadhaarNo),
          Notes = @note, VersionNo = VersionNo + @bump,
          LegalExecutiveId = @leg,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Notify the legal executive the moment they're assigned/reassigned —
    // same as at creation time — so the handoff to "the legal person" is
    // never just a silent database field nobody checks.
    if (newLegalExecutiveId && newLegalExecutiveId !== oldRow.LegalExecutiveId) {
      await syncLegalMilestoneStep(pool, oldRow.BookingId, "LegalReview", actor);
      await emitNotification(pool, newLegalExecutiveId, "crm_agreement_legal_assigned",
        "Agreement Assigned For Preparation",
        `${oldRow.AgreementNo} assigned to you for legal preparation.`,
        id, "crm_agreement");
    }

    res.json({ success: true, versionBumped: touchesLegalContent });
  } catch (e) {
    console.error("[crm-agreements] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/assign-legal — assign or reassign the Legal Executive responsible
// for preparing this agreement's paperwork. Split out from the generic
// PUT /:id on purpose: that route bundles the change into "Edit Details"
// (locked-by-default, meant for correcting legal identity fields, bumps
// VersionNo and asks for a revision reason) — none of which applies to
// "who is handling this," so assignment was previously reachable only by
// going through an edit flow meant for something else entirely. This never
// touches VersionNo or CrmAgreementRevision.
router.put("/:id/assign-legal", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);
    const newId = req.body?.LegalExecutiveId ? parseInt(req.body.LegalExecutiveId) : null;

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot reassign — ${lockReason}. Cancel the agreement instead.` });

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT LegalExecutiveId, AgreementNo, Status, BookingId FROM dbo.CrmAgreement WHERE Id = @id");
    if (!old.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const oldRow = old.recordset[0];
    if ([CrmStatus.REGISTERED, CrmStatus.CANCELLED].includes(oldRow.Status)) {
      return res.status(400).json({ error: `Cannot reassign a legal executive on an agreement that is already ${oldRow.Status}` });
    }

    await pool.request().input("id", sql.Int, id).input("leg", sql.Int, newId).input("ub", sql.Int, actor)
      .query("UPDATE dbo.CrmAgreement SET LegalExecutiveId = @leg, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "LegalExecutiveId", oldVal: oldRow.LegalExecutiveId ? String(oldRow.LegalExecutiveId) : null, newVal: newId ? String(newId) : null },
    ]);

    if (newId && newId !== oldRow.LegalExecutiveId) {
      await syncLegalMilestoneStep(pool, oldRow.BookingId, "LegalReview", actor);
      await emitNotification(pool, newId, "crm_agreement_legal_assigned",
        "Agreement Assigned For Preparation",
        `${oldRow.AgreementNo} assigned to you for legal preparation.`,
        id, "crm_agreement");
    }

    res.json({ success: true, LegalExecutiveId: newId });
  } catch (e) {
    console.error("[crm-agreements] PUT /:id/assign-legal error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-executed — Draft -> Executed. Gated on the real-world facts
// that make an agreement "executed": both senior and customer approvals
// already granted, and a genuine AgreementDate already on record. That date
// can only have gotten there via acceptAgreementDate() + finalizeAgreementDate()
// — one side accepting the other's proposed date, then a super_admin
// sign-off — never typed in here, so execution itself is proof the "both
// ends agreed on a date" mandate was actually satisfied.
router.put("/:id/mark-executed", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT BookingId, Status, AgreementDate, SeniorApprovalStatus, CustomerApprovalStatus, LegalExecutiveId
      FROM dbo.CrmAgreement WHERE Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const row = cur.recordset[0];

    if (row.Status !== CrmStatus.DRAFT) {
      return res.status(400).json({ error: `Cannot mark-executed from status '${row.Status}'` });
    }
    if (row.SeniorApprovalStatus !== CrmStatus.APPROVED || row.CustomerApprovalStatus !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: "Both senior and customer approval must be Approved before execution" });
    }
    if (!row.AgreementDate) {
      return res.status(400).json({ error: "Both sides must agree on an agreement date first — propose a date and wait for the customer's matching response before marking executed" });
    }
    // A legally executed contract must have a named responsible party on
    // record — the Legal Executive field previously had no consequence at
    // all for staying Unassigned all the way through execution, which is a
    // real accountability gap for real paperwork, not a cosmetic one.
    if (!row.LegalExecutiveId) {
      return res.status(400).json({ error: "A Legal Executive must be assigned before this agreement can be marked executed — use PUT /:id/assign-legal" });
    }
    const unverified = await pool.request().input("id", sql.Int, id).query(`
      SELECT DocumentType, Label, Status FROM dbo.CrmAgreementDocument
      WHERE AgreementId = @id AND IsMandatory = 1 AND Status <> 'Verified'
    `);
    if (unverified.recordset.length) {
      const names = unverified.recordset.map(d => d.Label || d.DocumentType).join(", ");
      return res.status(400).json({ error: `Cannot mark executed — mandatory document(s) not yet verified: ${names}` });
    }
    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot mark executed — ${lockReason}. Cancel the agreement instead.` });

    await pool.request()
      .input("id",  sql.Int, id)
      .input("ub",  sql.Int, actor)
      .query(`
        UPDATE dbo.CrmAgreement SET
          Status = '${CrmStatus.EXECUTED}', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status", oldVal: CrmStatus.DRAFT, newVal: CrmStatus.EXECUTED },
    ]);

    // Auto-flow: execution is one of two sales-deed prerequisites — fire the
    // auto-create check (no-op if milestones aren't fully settled yet).
    await maybeAutoCreateSalesDeed(pool, row.BookingId, actor);
    await syncLegalMilestoneStep(pool, row.BookingId, "FinalExecution", actor);
    // Releases any brokerage tranche waiting on Agreement Executed — TwoPart's
    // second half, or AgreementOnly's single tranche. No-op for OneTime
    // bookings or ones with no broker.
    await maybeUnlockBrokerageOnAgreementExecuted(pool, row.BookingId);

    res.json({ success: true, status: CrmStatus.EXECUTED });
  } catch (e) {
    console.error("[crm-agreements] mark-executed error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/mark-registered — Executed -> Registered.
// The AFS is physically registered at the Sub-Registrar Office before the
// Sale Deed exists at all. The caller must supply the Doc No and date they
// receive from the Sub-Registrar as proof of the real-world event —
// AfsRegistrationNo is required, AfsRegistrationDate is required.
// There is no dependency on CrmSalesDeed here; that is a separate document
// registered much later at a separate Sub-Registrar visit.
router.put("/:id/mark-registered", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);
    const { AfsRegistrationNo, AfsRegistrationDate } = req.body || {};

    if (!AfsRegistrationNo || !String(AfsRegistrationNo).trim()) {
      return res.status(400).json({ error: "AFS Registration No. is required — enter the Doc No received from the Sub-Registrar" });
    }
    if (!AfsRegistrationDate) {
      return res.status(400).json({ error: "AFS Registration Date is required — enter the date of Sub-Registrar registration" });
    }

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    if (cur.recordset[0].Status !== CrmStatus.EXECUTED) {
      return res.status(400).json({ error: `Cannot mark-registered from status '${cur.recordset[0].Status}'` });
    }

    const lockReason = await getAgreementBookingLockReason(pool, id);
    if (lockReason) return res.status(409).json({ error: `Cannot mark registered — ${lockReason}. Cancel the agreement instead.` });

    const regNo = String(AfsRegistrationNo).trim();
    const regDate = AfsRegistrationDate;

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("ub",    sql.Int,           actor)
      .input("regNo", sql.NVarChar(100), regNo)
      .input("regDt", sql.Date,          regDate)
      .query(`
        UPDATE dbo.CrmAgreement SET
          Status              = '${CrmStatus.REGISTERED}',
          AfsRegistrationNo   = @regNo,
          AfsRegistrationDate = @regDt,
          UpdatedBy           = @ub,
          UpdatedAt           = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status",              oldVal: CrmStatus.EXECUTED, newVal: CrmStatus.REGISTERED },
      { field: "AfsRegistrationNo",   oldVal: null,               newVal: regNo },
      { field: "AfsRegistrationDate", oldVal: null,               newVal: regDate },
    ]);

    res.json({ success: true, status: CrmStatus.REGISTERED });
  } catch (e) {
    console.error("[crm-agreements] mark-registered error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/cancel — Draft/Executed -> Cancelled. Business action (matches
// crmCancellations.js / crmNoc.js pattern), not admin-approval-gated — a
// forward-only terminal transition, blocked once already Registered.
router.put("/:id/cancel", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmAgreement WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Agreement not found" });
    const allowed = AGREEMENT_TRANSITIONS[cur.recordset[0].Status] || [];
    if (!allowed.includes("Cancelled")) {
      return res.status(400).json({ error: `Cannot cancel an agreement in status '${cur.recordset[0].Status}'` });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmAgreement SET Status = '${CrmStatus.CANCELLED}', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logCrmAudit(pool, "Agreement", id, actor, [
      { field: "Status", oldVal: cur.recordset[0].Status, newVal: CrmStatus.CANCELLED },
    ]);

    res.json({ success: true, status: CrmStatus.CANCELLED });
  } catch (e) {
    console.error("[crm-agreements] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents — add a document to an agreement. Re-uploading the
// same DocumentType (e.g. a corrected SaleAgreement PDF) never overwrites
// the prior row — it inserts a new one with the next VersionNo for that
// type, so every prior document stays reachable via GET /:id.
router.post("/:id/documents", requirePageRight("crm-documents", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const agreementId = parseInt(req.params.id);
    const DOC_TYPES = ["SaleAgreement","AllotmentLetter","PossessionLetter","RegistrationDoc","NOC","IdentityProof","Other"];
    if (!DOC_TYPES.includes(b.DocumentType))
      return res.status(400).json({ error: `Invalid DocumentType. Must be: ${DOC_TYPES.join(", ")}` });

    const lockReason = await getAgreementBookingLockReason(pool, agreementId);
    if (lockReason) return res.status(409).json({ error: `Cannot attach a document — ${lockReason}.` });
    const execLockReason = await agreementExecutedLockReason(pool, agreementId);
    if (execLockReason) return res.status(409).json({ error: `Cannot attach a document — ${execLockReason}.` });

    const ver = await pool.request().input("agid", sql.Int, agreementId).input("dtype", sql.NVarChar(100), b.DocumentType)
      .query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS N FROM dbo.CrmAgreementDocument WHERE AgreementId = @agid AND DocumentType = @dtype");
    const nextVersion = ver.recordset[0].N;

    const inserted = await pool.request()
      .input("agid",  sql.Int,            agreementId)
      .input("dtype", sql.NVarChar(100),  b.DocumentType)
      .input("url",   sql.NVarChar(2000), b.DocumentUrl  || null)
      .input("fname", sql.NVarChar(300),  b.FileName     || null)
      .input("iby",   sql.NVarChar(200),  b.IssuedBy     || null)
      .input("st",    sql.NVarChar(30),   b.Status || "Uploaded")
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks   || null)
      .input("uat",   sql.DateTime2(3),   b.UploadedAt   || null)
      .input("ver",   sql.Int,            nextVersion)
      .input("cb",    sql.Int,            actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementDocument
          (AgreementId, DocumentType, DocumentUrl, FileName, IssuedBy, Status, Remarks, UploadedAt, VersionNo, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@agid, @dtype, @url, @fname, @iby, @st, @rem, ISNULL(@uat, SYSDATETIME()), @ver, @cb, SYSDATETIME())
      `);
    await syncLegalMilestoneFromDocument(pool, inserted.recordset[0].Id, actorId(req));
    res.status(201).json({ success: true, version: nextVersion });
  } catch (e) {
    console.error("[crm-agreements] POST documents error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/request — ask the customer for a document via their
// portal, without a file yet. Shows up there as an open request; the
// customer's upload (crmPortal.js POST /agreement/documents/:docId/upload)
// fills in the file and flips Status to 'Submitted' for staff review.
router.post("/:id/documents/request", requirePageRight("crm-documents", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const agreementId = parseInt(req.params.id);
    const DOC_TYPES = ["SaleAgreement","AllotmentLetter","PossessionLetter","RegistrationDoc","NOC","IdentityProof","Other"];
    if (!DOC_TYPES.includes(b.DocumentType))
      return res.status(400).json({ error: `Invalid DocumentType. Must be: ${DOC_TYPES.join(", ")}` });

    const lockReason = await getAgreementBookingLockReason(pool, agreementId);
    if (lockReason) return res.status(409).json({ error: `Cannot request a document — ${lockReason}.` });
    const execLockReason = await agreementExecutedLockReason(pool, agreementId);
    if (execLockReason) return res.status(409).json({ error: `Cannot request a document — ${execLockReason}.` });

    // An already-open request for this exact document type (Status still
    // 'Requested' — asked for, nothing uploaded yet) must be reused, not
    // duplicated. Previously this always inserted a fresh, ever-incrementing
    // VersionNo row regardless of whether an unfulfilled request already
    // existed, so clicking "Request from Customer" twice for the same type
    // (e.g. re-confirming a request, or a staff double-click) silently
    // spawned a second "field" for the same document — inflating the
    // Agreement Followup denominator and showing the same document type
    // twice in the list. Re-requesting the SAME open slot just refreshes it
    // in place. A genuinely new version is still created when the prior
    // attempt was Rejected or Verified — those are real, resolved outcomes,
    // not an open request sitting untouched.
    const openReq = await pool.request().input("agid", sql.Int, agreementId).input("dtype", sql.NVarChar(100), b.DocumentType)
      .query("SELECT TOP 1 Id FROM dbo.CrmAgreementDocument WHERE AgreementId = @agid AND DocumentType = @dtype AND Status = 'Requested' ORDER BY VersionNo DESC");
    if (openReq.recordset.length) {
      const existingId = openReq.recordset[0].Id;
      await pool.request()
        .input("id", sql.Int, existingId)
        .input("label", sql.NVarChar(200), b.Label || null)
        .input("mand", sql.Bit, !!b.IsMandatory)
        .input("rb", sql.Int, actorId(req))
        .query(`
          UPDATE dbo.CrmAgreementDocument SET
            Label = ISNULL(@label, Label), IsMandatory = @mand, RequestedBy = @rb, RequestedAt = SYSDATETIME()
          WHERE Id = @id
        `);
      return res.status(200).json({ success: true, id: existingId, reused: true });
    }

    const ver = await pool.request().input("agid", sql.Int, agreementId).input("dtype", sql.NVarChar(100), b.DocumentType)
      .query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS N FROM dbo.CrmAgreementDocument WHERE AgreementId = @agid AND DocumentType = @dtype");
    const nextVersion = ver.recordset[0].N;

    const result = await pool.request()
      .input("agid",  sql.Int, agreementId)
      .input("dtype", sql.NVarChar(100), b.DocumentType)
      .input("label", sql.NVarChar(200), b.Label || null)
      .input("mand",  sql.Bit, !!b.IsMandatory)
      .input("ver",   sql.Int, nextVersion)
      .input("rb",    sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmAgreementDocument
          (AgreementId, DocumentType, Label, IsMandatory, Status, UploadedByType, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@agid, @dtype, @label, @mand, 'Requested', 'Customer', @rb, SYSDATETIME(), @ver, @rb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-agreements] POST documents/request error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/documents/upload — actual multi-file upload (up to 10 files in
// one request). One row per file, all sharing the same DocumentType, each
// versioned sequentially so a re-upload never overwrites a prior file.
router.post("/:id/documents/upload", requirePageRight("crm-documents", "create"), (req, res) => {
  upload.array("files", 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const pool = getPool();
      const agreementId = parseInt(req.params.id);
      const docType = req.body?.DocumentType;
      const DOC_TYPES = ["SaleAgreement","AllotmentLetter","PossessionLetter","RegistrationDoc","NOC","IdentityProof","Other"];
      if (!DOC_TYPES.includes(docType)) return res.status(400).json({ error: `Invalid DocumentType. Must be: ${DOC_TYPES.join(", ")}` });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      const lockReason = await getAgreementBookingLockReason(pool, agreementId);
      if (lockReason) {
        return res.status(409).json({ error: `Cannot upload a document — ${lockReason}.` });
      }
      const execLockReason = await agreementExecutedLockReason(pool, agreementId);
      if (execLockReason) {
        return res.status(409).json({ error: `Cannot upload a document — ${execLockReason}.` });
      }

      const ver = await pool.request().input("agid", sql.Int, agreementId).input("dtype", sql.NVarChar(100), docType)
        .query("SELECT ISNULL(MAX(VersionNo), 0) AS N FROM dbo.CrmAgreementDocument WHERE AgreementId = @agid AND DocumentType = @dtype");
      let nextVersion = ver.recordset[0].N;

      const inserted = [];
      for (const file of req.files) {
        nextVersion += 1;
        const result = await pool.request()
          .input("agid",  sql.Int, agreementId)
          .input("dtype", sql.NVarChar(100), docType)
          .input("fname", sql.NVarChar(300), file.originalname)
          .input("fb64",  sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
          .input("fs",    sql.BigInt, file.size)
          .input("mt",    sql.NVarChar(150), file.mimetype)
          .input("iby",   sql.NVarChar(200), req.body?.IssuedBy || null)
          .input("rem",   sql.NVarChar(sql.MAX), req.body?.Remarks || null)
          .input("ver",   sql.Int, nextVersion)
          .input("cb",    sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmAgreementDocument
              (AgreementId, DocumentType, FileName, FileBase64, FileSize, MimeType, IssuedBy, Status, Remarks, UploadedAt, VersionNo, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES (@agid, @dtype, @fname, @fb64, @fs, @mt, @iby, 'Uploaded', @rem, SYSDATETIME(), @ver, @cb, SYSDATETIME())
          `);
        inserted.push(result.recordset[0].Id);
      }
      if (inserted.length) await syncLegalMilestoneFromDocument(pool, inserted[inserted.length - 1], actorId(req));
      res.status(201).json({ success: true, ids: inserted, count: inserted.length });
    } catch (e) {
      console.error("[crm-agreements] upload documents error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// POST /:id/documents/:docId/attach — attach a file to an EXISTING
// Requested/Rejected row in place (the Legal Executive fulfilling a
// mandatory placeholder like SaleAgreement). Distinct from
// /:id/documents/upload above, which always inserts a brand-new row —
// using that for a mandatory placeholder left the original Requested row
// permanently empty, so Agreement Followup % could never reach 100%. This
// mirrors the customer-portal fulfillment route (crmPortal.js) on the
// staff side.
router.post("/:id/documents/:docId/attach", requirePageRight("crm-documents", "create"), (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    try {
      const pool = getPool();
      const agreementId = parseInt(req.params.id);
      const docId = parseInt(req.params.docId);

      const cur = await pool.request()
        .input("id", sql.Int, docId).input("agid", sql.Int, agreementId)
        .query("SELECT Id, Status FROM dbo.CrmAgreementDocument WHERE Id = @id AND AgreementId = @agid");
      if (!cur.recordset.length) return res.status(404).json({ error: "Document not found for this agreement" });
      if (!["Requested", CrmStatus.REJECTED].includes(cur.recordset[0].Status)) {
        return res.status(400).json({ error: "This document already has a file — use Add Document to upload a corrected version instead" });
      }

      const lockReason = await getAgreementBookingLockReason(pool, agreementId);
      if (lockReason) return res.status(409).json({ error: `Cannot upload a document — ${lockReason}.` });
      const execLockReason = await agreementExecutedLockReason(pool, agreementId);
      if (execLockReason) return res.status(409).json({ error: `Cannot upload a document — ${execLockReason}.` });

      await pool.request()
        .input("id", sql.Int, docId)
        .input("fname", sql.NVarChar(300), req.file.originalname)
        .input("fb64", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
        .input("fs", sql.BigInt, req.file.size)
        .input("mt", sql.NVarChar(150), req.file.mimetype)
        .input("cb", sql.Int, actorId(req))
        .query(`
          UPDATE dbo.CrmAgreementDocument SET
            FileName = @fname, FileBase64 = @fb64, FileSize = @fs, MimeType = @mt,
            Status = 'Uploaded', Remarks = NULL, UploadedAt = SYSDATETIME(), UploadedByType = 'Staff', CreatedBy = ISNULL(CreatedBy, @cb)
          WHERE Id = @id
        `);
      await syncLegalMilestoneFromDocument(pool, docId, actorId(req));

      res.json({ success: true });
    } catch (e) {
      console.error("[crm-agreements] attach document error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /documents/all — cross-agreement document register, for the dedicated
// "Agreement Papers" document-center view (crm-documents permission scope,
// distinct from crm-agreements: a documents clerk can be granted this
// without full agreement CRUD rights). Every other /documents endpoint in
// this file is scoped to a single agreement; this is the one place staff
// can see requested/submitted/verified/rejected documents across every
// agreement in one register, without opening each agreement individually.
router.get("/documents/all", requirePageRight("crm-documents", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, documentType } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("d.Status = @st"); }
    if (documentType) { req0.input("dt", sql.NVarChar(100), documentType); conds.push("d.DocumentType = @dt"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    // Includes the agreement-level lifecycle fields (senior/customer approval,
    // send/date state) and the Legal Executive assignment — not just the
    // document's own status — so the cross-agreement register can show real
    // step-by-step progress and flag an unassigned legal preparer per
    // agreement, instead of only ever showing document rows in isolation.
    const result = await req0.query(`
      SELECT
        d.Id, d.AgreementId, d.DocumentType, d.Label, d.IsMandatory, d.UploadedByType,
        d.FileName, CASE WHEN d.FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS FilePath,
        d.FileSize, d.MimeType, d.Status, d.Remarks, d.VersionNo,
        d.RequestedAt, d.UploadedAt, d.CreatedAt,
        ag.AgreementNo, ag.Status AS AgreementStatus,
        ag.SeniorApprovalStatus, ag.SentToCustomerAt, ag.CustomerApprovalStatus, ag.AgreementDate,
        ag.LegalExecutiveId, le.name AS LegalExecutiveName,
        b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName
      FROM dbo.CrmAgreementDocument d
      JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
      LEFT JOIN dbo.Users le ON le.id = ag.LegalExecutiveId
      ${where}
      ORDER BY d.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET documents/all error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /documents/file/:docId — stream a document's file for inline preview/download
router.get("/documents/file/:docId", requirePageRight("crm-documents", "view"), async (req, res) => {
  try {
    const id = parseInt(req.params.docId);
    const result = await getPool().request().input("id", sql.Int, id)
      .query("SELECT FileName, FileBase64, MimeType FROM dbo.CrmAgreementDocument WHERE Id = @id");
    if (!result.recordset.length || !result.recordset[0].FileBase64) return res.status(404).json({ error: "File not found" });
    const doc = result.recordset[0];

    res.setHeader("Content-Type", doc.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.FileName || "document"}"`);
    res.send(Buffer.from(doc.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-agreements] file GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/documents/:docId — review metadata only (Status/Remarks). The
// file itself can never be replaced in place — a corrected file always goes
// through POST /:id/documents as a new version instead ("nothing should be
// overwritten").
router.put("/:id/documents/:docId", requirePageRight("crm-documents", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const agreementId = parseInt(req.params.id);
    const docId = parseInt(req.params.docId);
    const actor = actorId(req);

    const lockReason = await getAgreementBookingLockReason(pool, agreementId);
    if (lockReason) return res.status(409).json({ error: `Cannot review a document — ${lockReason}.` });

    // The :id in the URL was previously dead — any docId updated regardless
    // of which agreement it actually belonged to. Scope the lookup by both,
    // so a stale/wrong docId 404s instead of silently touching the wrong
    // agreement's document.
    const cur = await pool.request()
      .input("id", sql.Int, docId).input("agid", sql.Int, agreementId)
      .query("SELECT Status, FileBase64 FROM dbo.CrmAgreementDocument WHERE Id = @id AND AgreementId = @agid");
    if (!cur.recordset.length) return res.status(404).json({ error: "Document not found for this agreement" });
    const oldRow = cur.recordset[0];

    if (b.Status === "Verified" && !oldRow.FileBase64) {
      return res.status(400).json({ error: "Cannot verify a document that hasn't been uploaded yet" });
    }
    // Same rule PUT /documents/bulk-review already enforces — a legal
    // document can't be silently rejected with no reason on record. This
    // single-document route was the one path that didn't have this check,
    // which meant a plain status-dropdown flip could reject a real
    // contractual document with zero explanation and nothing useful in the
    // audit trail beyond "Status: Uploaded -> Rejected".
    if (b.Status === CrmStatus.REJECTED && !String(b.Remarks || "").trim()) {
      return res.status(400).json({ error: "Remarks are required to reject a document" });
    }
    // Split, not a blanket freeze: Verified is still allowed post-execution
    // (doesn't change legal content, needs no customer action). Rejected is
    // blocked — it puts the document back in the customer's court to
    // re-upload, but the customer-facing upload route is itself frozen at
    // Executed/Registered (crmPortal.js), so a post-execution reject would
    // leave the document permanently stuck Rejected with no way back.
    if (b.Status === CrmStatus.REJECTED) {
      const execLockReason = await agreementExecutedLockReason(pool, agreementId);
      if (execLockReason) return res.status(409).json({ error: `Cannot reject — ${execLockReason}. The document can no longer be re-uploaded, so rejecting it now would leave it permanently stuck.` });
    }

    await pool.request()
      .input("id",  sql.Int,          docId)
      .input("st",  sql.NVarChar(30), b.Status || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .query(`
        UPDATE dbo.CrmAgreementDocument SET
          Status = ISNULL(@st, Status), Remarks = @rem
        WHERE Id = @id
      `);

    if (b.Status && b.Status !== oldRow.Status) {
      await logCrmAudit(pool, "AgreementDocument", docId, actor, [
        { field: "Status", oldVal: oldRow.Status, newVal: b.Status },
      ]);
      await syncLegalMilestoneFromDocument(pool, docId, actor);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] PUT document error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/portal/deactivate, PUT /:id/portal/reactivate — flip the
// customer's portal account IsActive flag. Was previously a display-only
// column (AGR_SELECT already surfaces PortalActive above) with no route
// anywhere that ever wrote to it — staff had visibility into portal status
// but no way to act on it. Reached from this file (not crmPortal.js, which
// is exclusively the customer-facing surface, gated by portal JWTs, not
// staff sessions) since this is where portal status is already shown to
// staff. Only meaningful together with the crmPortal.js gate that now
// re-checks IsActive on every request — before that fix, flipping this had
// no real effect until the customer's existing 7-day token happened to
// expire on its own.
async function setPortalActive(pool, agreementId, isActive) {
  const row = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT a.Id AS ApplicationId, pu.Id AS PortalUserId
    FROM dbo.CrmAgreement ag
    JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomerPortalUser pu ON pu.CustomerId = a.CustomerId
    WHERE ag.Id = @id
  `);
  if (!row.recordset.length) return { error: "Agreement not found", status: 404 };
  if (!row.recordset[0].PortalUserId) return { error: "No portal account exists for this customer yet", status: 404 };
  await pool.request().input("id", sql.Int, row.recordset[0].PortalUserId).input("act", sql.Bit, isActive ? 1 : 0)
    .query("UPDATE dbo.CrmCustomerPortalUser SET IsActive = @act WHERE Id = @id");
  return { ok: true };
}

// GET /documents/:docId/audit — review history for a single document, read
// from dbo.CrmAuditLog (EntityType='AgreementDocument'). Lets a reviewer see
// who touched a document and when (prior status flips, remarks changes)
// instead of only ever seeing its current state — matters most on documents
// that bounced through Rejected -> re-uploaded -> Submitted more than once.
router.get("/documents/:docId/audit", requirePageRight("crm-documents", "view"), async (req, res) => {
  try {
    const docId = parseInt(req.params.docId);
    const result = await getPool().request().input("id", sql.Int, docId).query(`
      SELECT al.Id, al.Field, al.OldValue, al.NewValue, al.ChangedAt, al.ChangedBy, u.name AS ChangedByName
      FROM dbo.CrmAuditLog al
      LEFT JOIN dbo.Users u ON u.id = al.ChangedBy
      WHERE al.EntityType = 'AgreementDocument' AND al.EntityId = @id
      ORDER BY al.ChangedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-agreements] GET documents/:docId/audit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /documents/bulk-review — review several documents from across
// different agreements in one call, for the cross-agreement Agreement
// Papers register. Each document is validated independently (its own
// booking-lock check, its own "can't verify without a file" check) so one
// bad row in a batch doesn't block the rest; the response reports exactly
// which ids succeeded and which were skipped and why, instead of an
// all-or-nothing failure that would leave staff guessing which of 20
// selected rows actually went through.
router.put("/documents/bulk-review", requirePageRight("crm-documents", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const actor = actorId(req);
    const { docIds, status, remarks } = req.body || {};
    if (!Array.isArray(docIds) || !docIds.length) return res.status(400).json({ error: "docIds is required" });
    if (!["Verified", CrmStatus.REJECTED].includes(status)) return res.status(400).json({ error: "status must be Verified or Rejected" });
    if (status === CrmStatus.REJECTED && !String(remarks || "").trim()) return res.status(400).json({ error: "Remarks are required to reject" });

    const results = { succeeded: [], skipped: [] };
    for (const rawId of docIds) {
      const docId = parseInt(rawId);
      try {
        const cur = await pool.request().input("id", sql.Int, docId).query(`
          SELECT d.Status, d.AgreementId, CASE WHEN d.FileBase64 IS NOT NULL THEN 1 ELSE 0 END AS HasFile
          FROM dbo.CrmAgreementDocument d WHERE d.Id = @id
        `);
        if (!cur.recordset.length) { results.skipped.push({ docId, reason: "Document not found" }); continue; }
        const row = cur.recordset[0];

        const lockReason = await getAgreementBookingLockReason(pool, row.AgreementId);
        if (lockReason) { results.skipped.push({ docId, reason: `Booking ${lockReason}` }); continue; }
        if (status === "Verified" && !row.HasFile) { results.skipped.push({ docId, reason: "Not uploaded yet" }); continue; }
        // Same split as the single-document route: Rejected is blocked
        // post-execution (the customer's upload route is frozen too, so a
        // reject here would leave the document permanently stuck), Verified
        // stays allowed since it doesn't touch legal content.
        if (status === CrmStatus.REJECTED) {
          const execLockReason = await agreementExecutedLockReason(pool, row.AgreementId);
          if (execLockReason) { results.skipped.push({ docId, reason: execLockReason }); continue; }
        }

        await pool.request().input("id", sql.Int, docId).input("st", sql.NVarChar(30), status).input("rem", sql.NVarChar(sql.MAX), remarks || null)
          .query("UPDATE dbo.CrmAgreementDocument SET Status = @st, Remarks = @rem WHERE Id = @id");

        if (status !== row.Status) {
          await logCrmAudit(pool, "AgreementDocument", docId, actor, [{ field: "Status", oldVal: row.Status, newVal: status }]);
          await syncLegalMilestoneFromDocument(pool, docId, actor);
        }
        results.succeeded.push(docId);
      } catch (innerErr) {
        results.skipped.push({ docId, reason: innerErr.message });
      }
    }
    res.json(results);
  } catch (e) {
    console.error("[crm-agreements] PUT documents/bulk-review error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id/portal/deactivate", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await setPortalActive(pool, id, false);
    if (result.error) return res.status(result.status).json({ error: result.error });
    await logCrmAudit(pool, "Agreement", id, actorId(req), [
      { field: "PortalAccess", oldVal: CrmStatus.ACTIVE, newVal: "Deactivated" },
    ]);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] portal deactivate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id/portal/reactivate", requirePageRight("crm-agreements", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await setPortalActive(pool, id, true);
    if (result.error) return res.status(result.status).json({ error: result.error });
    await logCrmAudit(pool, "Agreement", id, actorId(req), [
      { field: "PortalAccess", oldVal: "Deactivated", newVal: CrmStatus.ACTIVE },
    ]);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-agreements] portal reactivate error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
// Reused by crmPortal.js's own document-upload route (POST
// /agreement/documents/:docId/upload) — the customer-facing upload path was
// missing this exact check, unlike every staff-side document route here.
module.exports.getAgreementBookingLockReason = getAgreementBookingLockReason;
module.exports.agreementExecutedLockReason = agreementExecutedLockReason;