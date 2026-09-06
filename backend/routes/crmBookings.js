const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const multer = require("multer");
const router = express.Router();
const { getPool, sql } = require("../db");
const { triggerBookingConfirmed } = require("../services/communicationTriggers");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const allowRoles = require("../middleware/role");
const { actorId, requireUserEmail, isSaAdmin } = require("../services/saAccess");
const { logCrmAudit } = require("../services/crmAudit");
const { emitNotification } = require("../services/notify");
const { getIo } = require("../socket");
const { guardAndConvertHold, placeHoldIfNeeded } = require("../services/crmHoldService");
const { getNextDocNumber } = require("../services/docNumber");
const { requireActiveBooking, recalculateRemainingMilestones, resolveNocType } = require("../services/crmWorkflowGuards");
const { generateInvoicePdf, getInvoicePdfBuffer } = require("../services/invoicePdf");
const { normalizeRole } = require("../middleware/role");
const { recalculateBookingGst } = require("../services/crmGst");
const { verifyFileMatchesDeclaredType } = require("../services/fileSignature");
// Bookings land in Pending on creation and only ever reach Approved/Rejected
// through this shared engine — gated to admin/super_admin/marketing_head via
// the Admin Approval Inbox, same as every other CRM approval flow.
const { transition: approvalTransition } = require("../services/approvalService");
const { createCrmBookingRecord, CrmCreationError, generateMilestonesForBooking, resolveApplicationPaymentPlan } = require("../services/crmEntityCreation");
const { logStatusChange, syncApplicationOnBookingTerminal } = require("../services/crmApplicationWorkflow");
const {
  getStageState,
  submitForApproval,
  approveStageRequest,
  rejectStageRequest,
  stageLabel,
} = require("../services/crmBookingStageService");
// The merged Data Review checklist (formerly the Application's own Level-1
// gate) — see the "Data Review checklist" comment block below for why this
// now lives here instead.
const { ensureChecklistRows, checkItem, uncheckItem, flagItem, resubmitItem, CHECKLIST_ITEMS } = require("../services/crmApplicationChecklist");
const { createMoneyReceiptAfterDataReview } = require("../services/crmMoneyReceiptWorkflow");

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

const bookingDownstreamSql = `
  SELECT
    (SELECT COUNT(*) FROM dbo.CrmWelcomeCall WHERE BookingId = @bid) AS WelcomeCalls,
    (SELECT COUNT(*) FROM dbo.CrmAgreement WHERE BookingId = @bid) AS Agreements,
    (SELECT COUNT(*) FROM dbo.CrmLegalMilestone WHERE BookingId = @bid) AS LegalMilestones,
    (SELECT COUNT(*) FROM dbo.CrmSalesDeed WHERE BookingId = @bid) AS SalesDeeds,
    (SELECT COUNT(*) FROM dbo.CrmLoanDetail WHERE BookingId = @bid AND SanctionStatus NOT IN ('NotApplied', 'Rejected')) AS ActiveLoans,
    (SELECT COUNT(*) FROM dbo.CrmNoc WHERE BookingId = @bid AND Status NOT IN ('Rejected')) AS Nocs,
    (SELECT COUNT(*) FROM dbo.CrmPrePossession WHERE BookingId = @bid) AS PrePossession,
    (SELECT COUNT(*) FROM dbo.CrmPossessionNotice WHERE BookingId = @bid) AS PossessionNotices,
    (SELECT COUNT(*) FROM dbo.CrmHandover WHERE BookingId = @bid) AS Handovers,
    (SELECT COUNT(*) FROM dbo.CrmServiceTicket WHERE BookingId = @bid) AS ServiceTickets,
    (SELECT COUNT(*) FROM dbo.CrmQueryPayment WHERE BookingId = @bid) AS QueryPayments,
    (SELECT COUNT(*) FROM dbo.CrmRegistry WHERE BookingId = @bid) AS RegistryRecords,
    (SELECT COUNT(*) FROM dbo.CrmInvoice WHERE BookingId = @bid AND Status <> 'Void') AS Invoices,
    (SELECT COUNT(*) FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status <> 'Rejected') AS MoneyReceipts,
    (SELECT COUNT(*) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS OnAccountPayments,
    (SELECT COUNT(*) FROM dbo.CrmPaymentReceipt r JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId WHERE m.BookingId = @bid) AS PaymentReceipts,
    (SELECT COUNT(*) FROM dbo.ReceivedPayment rp
      WHERE (rp.CrmBookingId = @bid OR rp.CrmMilestoneId IN (SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid))
        AND ISNULL(rp.RPStatus, '') <> 'Rejected') AS ReceivedPayments,
    (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND (AmountPaid > 0 OR Status IN ('Paid', 'Waived'))) AS PaidMilestones,
    (SELECT COUNT(*) FROM dbo.CrmCancellation WHERE BookingId = @bid AND Status IN ('Pending', 'FinancePending')) AS ActiveCancellations,
    (SELECT COUNT(*) FROM dbo.CrmBookingAmendmentRequest WHERE BookingId = @bid AND Status = 'Pending') AS PendingAmendments
`;

// Returns true (and sends a 409) when the booking is frozen, so callers can
// do: if (await assertNotFrozen(pool, id, res)) return;
async function assertNotFrozen(pool, id, res) {
  const r = await pool.request().input("id", sql.Int, id)
    .query("SELECT IsFrozen, FreezeReason, FreezeExpiresAt FROM dbo.CrmBooking WHERE Id = @id");
  const b = r.recordset[0];
  if (!b?.IsFrozen) return false;
  // Auto-lift if the freeze expiry has passed — same logic as requireActiveBooking.
  if (b.FreezeExpiresAt && new Date(b.FreezeExpiresAt) < new Date()) {
    pool.request().input("id", sql.Int, id).query(
      "UPDATE dbo.CrmBooking SET IsFrozen=0, FrozenAt=NULL, FrozenBy=NULL, FreezeReason=NULL, FreezeExpiresAt=NULL, UpdatedAt=SYSDATETIME() WHERE Id=@id"
    ).catch(() => {});
    return false;
  }
  res.status(409).json({
    error: `Booking is currently frozen${b.FreezeReason ? ": " + b.FreezeReason : ""}. Contact an admin to unfreeze before making changes.`,
  });
  return true;
}

// Flow-progress flags (HasWelcomeCall / BankDetailsComplete / Agreement*)
// drive the list page's single "next step" action — the UI is never allowed
// to jump ahead to a later step than the record has actually reached.
const BOOKING_SELECT = `
  SELECT
    b.Id, b.BookingNo, b.ApplicationId, b.UnitId, b.ProjectId,
    -- Display names: always read from master tables so a rename in Block/Project
    -- Master is immediately reflected on every booking without a data migration.
    -- The stored snapshot column is the COALESCE fallback for legacy rows only.
    COALESCE(proj.name,     b.ProjectName) AS ProjectName,
    proj.entity_type AS ProjectType,
    b.CompanyId,
    COALESCE(um.UnitName,   b.UnitNo)    AS UnitNo,
    COALESCE(blk.BlockName, b.BlockName) AS BlockName,
    um.BlockId,
    b.FloorName,
    COALESCE(um.UnitType,   b.UnitType)  AS UnitType,
    b.AreaSqFt,
    b.CarpetAreaSqFt, b.BuiltUpAreaSqFt, b.SuperBuiltUpAreaSqFt, b.OpenTerraceAreaSqFt,
    b.RatePerSqFt, b.TotalValue, b.BookingAmount, b.TokenType, b.TokenValue,
    b.PaymentPlanId, b.BookingDate, b.HsnCode,
    b.PaymentMode, b.AssignedTo, b.Status, b.Notes, b.IsActive,
    b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
    b.UnitParkingGstRate, b.UnitGstAmount, b.ParkingGstAmount, b.UnitParkingGstAmount, b.ExtraWorkGstAmount, b.TotalGstAmount,
    b.ReadyForApprovalAt, b.WorkflowStage, b.StageRemarks, b.RejectedFromStage,
    b.RejectedBy, b.RejectedAt, b.MarketingHeadApprovedAt, b.MarketingHeadApprovedBy,
    b.DirectorApprovedAt, b.DirectorApprovedBy, b.ConfirmedAt, b.ConfirmedBy,
    b.CreatedAt, b.UpdatedAt,
    b.IsFrozen, b.FrozenAt, b.FrozenBy, b.FreezeReason, b.FreezeExpiresAt,
    a.ApplicationNo, a.ApplicantName, a.Mobile, a.Email, a.LeadId,
    u.name  AS AssigneeName,
    cu.name AS CreatedByName,
    pp.PlanName AS PaymentPlanName,
    comp.name AS CompanyName,
    -- Must match the outcome the real prerequisite gate requires
    -- (validateAgreementPreparationPrerequisites in crmWorkflowGuards.js,
    -- and crmWelcomeCalls.js's own status check) -- a logged call with any
    -- other outcome (NotReachable/Busy/VoiceMail/SwitchedOff/RequestedCallback)
    -- must NOT be treated as the step being done, or the Bookings page tells
    -- staff to move on to Bank Details while Agreement auto-create stays
    -- silently blocked behind an outcome they were never told to fix.
    CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmWelcomeCall wc WHERE wc.BookingId = b.Id AND wc.Outcome = 'Welcomed') THEN 1 ELSE 0 END AS BIT) AS HasWelcomeCall,
    CAST(CASE WHEN EXISTS (
      SELECT 1 FROM dbo.CrmCustomerBankDetail bd WHERE bd.BookingId = b.Id
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.BankName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AccountNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.IfscCode, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AccountHolderName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.NomineeName, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.NomineeRelation, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.PanNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.AadhaarNo, ''))), '') IS NOT NULL
        AND NULLIF(LTRIM(RTRIM(ISNULL(bd.Occupation, ''))), '') IS NOT NULL
    ) THEN 1 ELSE 0 END AS BIT) AS BankDetailsComplete,
    ag.Id AS AgreementId, ag.SeniorApprovalStatus, ag.CustomerApprovalStatus,
    ag.AgreementDate, ag.DateApprovalStatus, ag.Status AS AgreementStatus,
    ag.AfsStampDuty, ag.AfsRegistrationFee,
    (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND m.Status = '${CrmStatus.PENDING}') AS PendingMilestoneCount,
    (SELECT ISNULL(SUM(AmountPaid),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalCleared,
    (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount,0)),0) FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id) AS ApprovedOnAccount,
    (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmMoneyReceipt WHERE BookingId = b.Id AND Status IN ('${CrmStatus.PENDING}','${CrmStatus.APPROVED}')) AS MRReceivedTotal
  FROM dbo.CrmBooking b
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um   ON um.Id   = b.UnitId
  LEFT JOIN dbo.BlockMaster blk ON blk.Id  = um.BlockId
  LEFT JOIN dbo.enterprise  proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.Users u  ON u.id  = b.AssignedTo
  LEFT JOIN dbo.Users cu ON cu.id = b.CreatedBy
  LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = b.PaymentPlanId
  LEFT JOIN dbo.enterprise comp ON comp.id = b.CompanyId AND comp.business_type = 'C'
  OUTER APPLY (
    SELECT TOP 1 Id, SeniorApprovalStatus, CustomerApprovalStatus,
                 AgreementDate, DateApprovalStatus, Status,
                 AfsStampDuty, AfsRegistrationFee
    FROM dbo.CrmAgreement
    WHERE BookingId = b.Id ORDER BY CreatedAt DESC
  ) ag
`;

// GET / — all bookings. By default, Cancelled/Rejected bookings are
// excluded — every "select a booking" dropdown across the CRM (Legal
// Milestones, NOC, Sales Deed, Pre-Possession, Possession Notice, Payments,
// Service Tickets, Brokerage, Communication Log, Handover) calls this with
// no params and previously kept offering cancelled bookings as if they were
// still live. The main Bookings management page (which needs to show and
// filter to Cancelled/Rejected for record-keeping) passes
// ?includeCancelled=1 to opt back in; an explicit ?status=X always wins.
router.get("/", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, applicationId, includeCancelled, deleted } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const req0 = pool.request();
    const showDeleted = deleted === "1" || deleted === "true";
    const conds = [showDeleted ? "b.IsActive = 0" : "b.IsActive = 1"];
    if (status) {
      req0.input("st", sql.NVarChar(30), status);
      conds.push("b.Status = @st");
    } else if (!includeCancelled) {
      conds.push("b.Status NOT IN ('Cancelled', 'Rejected')");
    }
    if (applicationId) { req0.input("appId", sql.Int, parseInt(applicationId)); conds.push("b.ApplicationId = @appId"); }
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
    const result = await req0.query(`${BOOKING_SELECT} WHERE ${conds.join(" AND ")} ORDER BY b.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id — single booking with milestones, welcome calls, agreement,
// full customer record (Details tab needs "all means all" — every KYC/
// contact/co-applicant field, not just the denormalized name/mobile on the
// booking itself), and a payment summary.
router.get("/:id", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [bkRes, milRes, wcRes, agRes, custRes, coAppRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${BOOKING_SELECT} WHERE b.Id = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT m.*,
               (SELECT ISNULL(SUM(rp.RPAmount), 0) FROM dbo.ReceivedPayment rp
                WHERE rp.CrmMilestoneId = m.Id AND rp.RPStatus = '${CrmStatus.PENDING}') AS PendingVerificationAmount
        FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @id ORDER BY m.MilestoneNo
      `),
      pool.request().input("id", sql.Int, id).query(
        `SELECT wc.*, u.name AS CalledByName FROM dbo.CrmWelcomeCall wc LEFT JOIN dbo.Users u ON u.id = wc.CalledBy WHERE wc.BookingId = @id ORDER BY wc.CreatedAt DESC`),
      pool.request().input("id", sql.Int, id).query(
        `SELECT ag.*, (SELECT COUNT(*) FROM dbo.CrmAgreementDocument d WHERE d.AgreementId = ag.Id) AS DocumentCount FROM dbo.CrmAgreement ag WHERE ag.BookingId = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT c.*
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id
        WHERE b.Id = @id
      `),
      // The per-booking CrmCoApplicant table (not CrmCustomer's inline
      // CoApplicant* fields) is the authoritative source once a booking
      // exists — createCrmBookingRecord() seeds a row here from the
      // customer's intake-time co-applicant data, and Welcome Call's
      // checklist already counts against this table. Booking Details
      // should show the same list, not the intake-time snapshot.
      pool.request().input("id", sql.Int, id).query(
        `SELECT * FROM dbo.CrmCoApplicant WHERE BookingId = @id AND IsActive = 1 ORDER BY CreatedAt`),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });
    const milestones = milRes.recordset;
    const totalDue = milestones.reduce((s, m) => s + (m.AmountDue || 0), 0);
    const totalPaid = milestones.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    const stageState = await getStageState(pool, id);
    res.json({
      booking: bkRes.recordset[0],
      milestones,
      welcomeCalls: wcRes.recordset,
      agreement: agRes.recordset[0] || null,
      customer: custRes.recordset[0] || null,
      coApplicants: coAppRes.recordset,
      paymentSummary: { totalDue, totalPaid, balance: totalDue - totalPaid },
      stageState,
    });
  } catch (e) {
    console.error("[crm-bookings] GET /:id error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST / — create booking from an application. Unit selection is mandatory —
// the customer's chosen unit must exist in dbo.UnitMaster and must not
// already be attached to another active CRM booking. Delegates to the
// shared creation service (backend/services/crmEntityCreation.js) — the
// exact same function backend/services/saHandoff.js calls for the Sales
// Automation -> CRM handoff, so a booking created either way goes through
// identical Unit Master validation, milestone generation, and hold
// conversion — no second, drifting copy of this logic.
router.post("/", requirePageRight("crm-bookings", "create"), async (req, res) => {
  try {
    const pool = getPool();
    // If this booking is being created from an application, verify the
    // application has been submitted (Pending). Draft = wizard not complete.
    if (req.body.ApplicationId) {
      const appRow = await pool.request()
        .input("aid", sql.Int, parseInt(req.body.ApplicationId))
        .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
      if (!appRow.recordset.length) return res.status(404).json({ error: "Application not found" });
      const appStatus = appRow.recordset[0].Status;
      if (appStatus !== "Pending") {
        return res.status(400).json({
          error: `Cannot create a booking for a ${appStatus} application — the application must be submitted first`,
        });
      }
    }
    const { id: bookingId, BookingNo: bookingNo, tokenWarning } = await createCrmBookingRecord(pool, req.body, actorId(req));
    res.status(201).json({ success: true, id: bookingId, BookingNo: bookingNo, tokenWarning });
  } catch (e) {
    if (e instanceof CrmCreationError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-bookings] POST error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id — update booking. Status is never accepted here — it starts
// 'Pending' at creation and only moves via /submit, /approve, /reject above,
// or becomes 'Cancelled' via the CrmCancellation approval cascade in
// crmCancellations.js. UnitType and AreaSqFt are also never accepted here —
// both are inherited once from Unit Master at creation and the unit itself
// never changes on an existing booking.
router.put("/:id", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    if (await assertNotFrozen(pool, id, res)) return;
    const rate  = b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null;
    const actor = actorId(req);

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, WorkflowStage, ReadyForApprovalAt, AssignedTo, AreaSqFt, PaymentPlanId, CompanyId, ProjectId, UnitId, TotalValue, BookingAmount FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!old.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const oldRow = old.recordset[0];

    // Block financial field edits once the booking has entered the approval pipeline.
    // The approver must see exactly the figures they approved — silent mid-approval changes
    // would mean the approval is for different numbers than what was submitted.
    const APPROVAL_STAGES = ["MarketingHeadApproval", "DirectorApproval", "Confirmed"];
    const inApproval = APPROVAL_STAGES.includes(oldRow.WorkflowStage) || oldRow.ReadyForApprovalAt != null;
    const financialFields = ["RatePerSqFt", "TotalValue", "BookingAmount", "PaymentPlanId"];
    if (inApproval && financialFields.some(f => b[f] !== undefined)) {
      return res.status(400).json({ error: `Financial fields (rate, value, booking amount, payment plan) cannot be changed once the booking is in ${oldRow.WorkflowStage || "the approval pipeline"}. Reject it back to Review first.` });
    }

    const existingArea = oldRow.AreaSqFt;

    const total = b.TotalValue != null ? parseFloat(b.TotalValue)
                : (existingArea && rate ? Math.round(existingArea * rate) : null);

    // Changing the payment plan on a booking that already has milestone
    // history is NOT a cosmetic FK swap — the actual payment schedule
    // (amounts, due dates) was generated from the OLD plan and, unless
    // regenerated, silently keeps running on it while the record now claims
    // to be on the new one. Blocked once any real payment exists (nothing
    // to safely regenerate against); regenerated from scratch otherwise so
    // the schedule actually matches what's now selected — matching what
    // booking creation itself would have produced.
    const newPlanId = b.PaymentPlanId !== undefined ? (b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null) : undefined;
    const planIsChanging = newPlanId !== undefined && newPlanId !== oldRow.PaymentPlanId;
    if (planIsChanging) {
      if (newPlanId) {
        // Same tag-based resolver Application/Booking creation use — the new
        // plan must be one of the unit's CrmUnitPaymentPlan tags (or the
        // unit has no tags, in which case any active plan is acceptable).
        try {
          await resolveApplicationPaymentPlan(pool, { preferredUnitId: oldRow.UnitId, paymentPlanId: newPlanId });
        } catch (e) {
          return res.status(e.status || 400).json({ error: e.message });
        }
      }
      const paid = await pool.request().input("bid", sql.Int, id).query(`
        SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND (AmountPaid > 0 OR Status IN ('${CrmStatus.PAID}', 'Waived'))
      `);
      if (paid.recordset[0]?.Cnt > 0) {
        return res.status(400).json({ error: "Cannot change payment plan — payments have already been recorded against the existing schedule" });
      }
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("pid",   sql.Int,           b.ProjectId   ? parseInt(b.ProjectId) : null)
      .input("pname", sql.NVarChar(200), b.ProjectName || null)
      .input("unit",  sql.NVarChar(100), b.UnitNo || null)
      .input("blk",   sql.NVarChar(100), b.BlockName   || null)
      .input("flr",   sql.NVarChar(100), b.FloorName   || null)
      .input("rate",  sql.Decimal(18,2), rate)
      .input("tot",   sql.Decimal(18,2), total)
      .input("bamt",  sql.Decimal(18,2), b.BookingAmount  != null ? parseFloat(b.BookingAmount) : null)
      .input("bdate", sql.Date,          b.BookingDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode  || null)
      .input("asgn",  sql.Int,           b.AssignedTo   ? parseInt(b.AssignedTo) : null)
      .input("ppid",  sql.Int,           b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmBooking SET
          ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          UnitNo = ISNULL(@unit, UnitNo), BlockName = @blk, FloorName = @flr,
          RatePerSqFt = ISNULL(@rate, RatePerSqFt),
          TotalValue = ISNULL(@tot, TotalValue),
          BookingAmount = ISNULL(@bamt, BookingAmount),
          BookingDate = ISNULL(@bdate, BookingDate), PaymentMode = ISNULL(@pmode, PaymentMode),
          AssignedTo = ISNULL(@asgn, AssignedTo),
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId),
          -- HsnCode is no longer settable here — it's fully auto-resolved by
          -- recalculateBookingGst below (Unit+Parking value decides 1% vs
          -- 5%), never a manual per-booking input. See migration 283.
          -- GrandTotal tracks TotalValue changes without disturbing the
          -- already-rolled-up Parking/ExtraCharges totals.
          GrandTotal = ISNULL(@tot, TotalValue) + ParkingTotal + ExtraChargesTotal,
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    // TotalValue may have just moved — Unit+Parking could have crossed the
    // Rs. 45L GST bracket.
    await recalculateBookingGst(pool, id);

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "AssignedTo", oldVal: oldRow.AssignedTo, newVal: b.AssignedTo },
    ]);

    if (planIsChanging) {
      await pool.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
      const effectiveTotal = total || oldRow.TotalValue;
      const effectiveBookingAmount = b.BookingAmount != null ? parseFloat(b.BookingAmount) : oldRow.BookingAmount;
      await generateMilestonesForBooking(pool, id, effectiveTotal, newPlanId, b.BookingDate || null, actor, effectiveBookingAmount);
    } else if (total != null && total !== oldRow.TotalValue) {
      // TotalValue moved (rate correction) without a plan switch — the
      // existing schedule's ₹/% no longer add up to what's actually owed.
      // A plan switch already regenerates the whole schedule from scratch
      // above, so this only fires on the "same plan, new total" path.
      await recalculateRemainingMilestones(pool, id);
    }

    res.json({ success: true, milestonesRegenerated: planIsChanging });
  } catch (e) {
    console.error("[crm-bookings] PUT error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/change-unit — the only way UnitId can ever change on an existing
// booking. Restricted to admin/super_admin/dba/marketing_head (this
// re-points a real legal transaction to a different physical unit) and
// requires a mandatory reason. Every change is permanently logged to
// CrmUnitChangeLog — nothing here is ever silently overwritten.
router.put("/:id/change-unit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Only admin/super_admin/marketing_head can change a booking's unit" });
    const pool = getPool();
    const id = parseInt(req.params.id);
    if (await assertNotFrozen(pool, id, res)) return;
    const b = req.body || {};
    if (!b.NewUnitId) return res.status(400).json({ error: "NewUnitId is required" });
    if (!b.Reason?.trim()) return res.status(400).json({ error: "Reason is required to change a booking's unit" });

    // Same active-booking gate every other lifecycle-mutating route uses
    // (blocks both Cancelled and Rejected, not just Cancelled) — re-pointing
    // a real legal transaction to a different physical unit is exactly the
    // kind of action that gate exists for, and there's no reason a Rejected
    // booking should be exempt from it when nothing else is.
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const booking = await pool.request().input("id", sql.Int, id)
      .query("SELECT UnitId, Status, RatePerSqFt, TotalValue, BookingAmount FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!booking.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const oldUnitId = booking.recordset[0].UnitId;
    const oldRow = booking.recordset[0];
    const newUnitId = parseInt(b.NewUnitId);
    if (newUnitId === oldUnitId) return res.status(400).json({ error: "New unit is the same as the current unit" });

    // Same lookup + availability checks as booking creation — the new unit
    // must be real, active, and not already locked by another booking.
    const unit = await pool.request().input("uid", sql.Int, newUnitId).query(`
      SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt,
             u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
             proj.name AS ProjectName, proj.company_id AS CompanyId, blk.BlockName
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
      LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
      WHERE u.Id = @uid AND u.IsActive = 1
    `);
    if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
    const unitRow = unit.recordset[0];

    const taken = await pool.request().input("uid", sql.Int, newUnitId).input("id", sql.Int, id)
      .query("SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND Id <> @id AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected', 'Expired') AND (Status = 'Approved' OR ConfirmDeadline IS NULL OR ConfirmDeadline >= SYSDATETIME())");
    if (taken.recordset.length) return res.status(409).json({ error: "This unit is already booked" });

    const bookingAppId = await pool.request().input("id", sql.Int, id)
      .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @id");
    await guardAndConvertHold(pool, "Unit", newUnitId, bookingAppId.recordset[0].ApplicationId);

    const actor = actorId(req);
    const paid = await pool.request().input("bid", sql.Int, id).query(`
      SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND (AmountPaid > 0 OR Status IN ('${CrmStatus.PAID}', 'Waived'))
    `);
    const canRegenerateSchedule = paid.recordset[0]?.Cnt === 0;
    let newPlanId = null;
    if (canRegenerateSchedule) {
      try {
        // No explicit plan pick on this endpoint yet, so this only resolves
        // automatically when the new unit has exactly one tagged plan (see
        // resolveApplicationPaymentPlan). A unit with 0 or 2+ tags leaves
        // the plan unresolved here rather than guessing — staff can set it
        // explicitly via the booking's own PUT /:id payment-plan change.
        newPlanId = await resolveApplicationPaymentPlan(pool, { preferredUnitId: unitRow.Id, paymentPlanId: null });
      } catch (e) {
        newPlanId = null;
      }
    }
    // Keep existing rate if the booking already has one; fall back to new unit's master rate.
    const rate = oldRow.RatePerSqFt != null ? Number(oldRow.RatePerSqFt)
               : unitRow.RatePerSqFt != null ? Number(unitRow.RatePerSqFt) : null;
    const area = unitRow.AreaSqFt != null ? Number(unitRow.AreaSqFt) : null;
    const total = area && rate ? Math.round(area * rate) : oldRow.TotalValue;
    await pool.request()
      .input("id",    sql.Int, id)
      .input("uid",   sql.Int, newUnitId)
      .input("pid",   sql.Int, unitRow.ProjectId || null)
      .input("pname", sql.NVarChar(200), unitRow.ProjectName || null)
      .input("cid",   sql.Int, unitRow.CompanyId || null)
      .input("unit",  sql.NVarChar(100), unitRow.UnitName)
      .input("blk",   sql.NVarChar(100), unitRow.BlockName || null)
      .input("utype", sql.NVarChar(100), unitRow.UnitType || null)
      .input("area",  sql.Decimal(18,2), area)
      .input("carpetArea",       sql.Decimal(18,2), unitRow.CarpetAreaSqFt != null ? Number(unitRow.CarpetAreaSqFt) : null)
      .input("builtUpArea",      sql.Decimal(18,2), unitRow.BuiltUpAreaSqFt != null ? Number(unitRow.BuiltUpAreaSqFt) : null)
      .input("superBuiltUpArea", sql.Decimal(18,2), unitRow.SuperBuiltUpAreaSqFt != null ? Number(unitRow.SuperBuiltUpAreaSqFt) : null)
      .input("openTerraceArea",  sql.Decimal(18,2), unitRow.OpenTerraceAreaSqFt != null ? Number(unitRow.OpenTerraceAreaSqFt) : null)
      .input("rate",             sql.Decimal(18,2), rate)
      .input("tot",   sql.Decimal(18,2), total)
      .input("ppid",  sql.Int, newPlanId)
      .input("ub",    sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBooking SET
          UnitId = @uid, ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          CompanyId = @cid, UnitNo = @unit, BlockName = @blk, UnitType = @utype, AreaSqFt = @area,
          CarpetAreaSqFt = @carpetArea, BuiltUpAreaSqFt = @builtUpArea, SuperBuiltUpAreaSqFt = @superBuiltUpArea, OpenTerraceAreaSqFt = @openTerraceArea,
          RatePerSqFt = ISNULL(@rate, RatePerSqFt),
          TotalValue = @tot,
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId),
          GrandTotal = @tot + ParkingTotal + ExtraChargesTotal,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // New unit means a new TotalValue — Unit+Parking could have crossed the
    // Rs. 45L GST bracket.
    await recalculateBookingGst(pool, id);

    if (newPlanId) {
      // Only the %-based schedule steps get wiped and regenerated — a
      // Parking/Extra-Charge milestone is a fixed line item tied to a real
      // allotment/charge row elsewhere (see the same exclusion in
      // recalculateRemainingMilestones), not part of the plan schedule, and
      // deleting it here would silently orphan that charge's own payment
      // tracking.
      await pool.request().input("bid", sql.Int, id).query(`
        DELETE FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL
      `);
      await generateMilestonesForBooking(pool, id, total, newPlanId, null, actor, oldRow.BookingAmount);
    }

    await pool.request()
      .input("bid",    sql.Int, id)
      .input("oldUid", sql.Int, oldUnitId || null)
      .input("newUid", sql.Int, newUnitId)
      .input("reason", sql.NVarChar(sql.MAX), b.Reason.trim())
      .input("cb",     sql.Int, actor)
      .query(`
        INSERT INTO dbo.CrmUnitChangeLog (BookingId, OldUnitId, NewUnitId, Reason, ChangedBy, ChangedAt)
        VALUES (@bid, @oldUid, @newUid, @reason, @cb, SYSDATETIME())
      `);

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "UnitId", oldVal: oldUnitId, newVal: newUnitId },
    ]);

    res.json({ success: true, unitNo: unitRow.UnitName, paymentPlanUpdated: !!newPlanId });
  } catch (e) {
    console.error("[crm-bookings] change-unit error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /:id/unit-change-log — history of unit changes for a booking
router.get("/:id/unit-change-log", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("bid", sql.Int, id).query(`
      SELECT l.*, ou.UnitName AS OldUnitName, nu.UnitName AS NewUnitName, u.name AS ChangedByName
      FROM dbo.CrmUnitChangeLog l
      LEFT JOIN dbo.UnitMaster ou ON ou.Id = l.OldUnitId
      LEFT JOIN dbo.UnitMaster nu ON nu.Id = l.NewUnitId
      LEFT JOIN dbo.Users u ON u.id = l.ChangedBy
      WHERE l.BookingId = @bid
      ORDER BY l.ChangedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET unit-change-log error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/submit — re-submit a Rejected booking for approval. New bookings
// already land in Pending on creation, so this only matters for the
// Rejected -> Pending resubmit path (ApprovalActions renders Submit there).
router.put("/:id/submit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const result = await approvalTransition("crm-bookings", id, CrmStatus.PENDING, userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-bookings] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Shared readiness gate: both this route's own pre-check and
// submitForApproval() (crmBookingStageService.js, the actual authoritative
// gate that performs the transition) must agree on what "ready" means.
//
// Previously this checked booking.UnitReviewConfirmed/PlanReviewConfirmed —
// two standalone self-confirm fields with their own confirm-unit/confirm-plan
// routes — SEPARATELY from the Data Review checklist's own ProjectUnitRate/
// PaymentPlanAmounts items, even though both were asserting the same two
// facts. submitForApproval() already hard-requires the entire 7-item
// checklist checked before it will do anything, which already guarantees
// ProjectUnitRate and PaymentPlanAmounts are Checked — so the separate
// Unit/Plan booleans were pure redundant bookkeeping being kept in sync by
// firing two API calls per click on the frontend. Checking the checklist
// directly here removes the second, parallel system entirely: one source of
// truth (the checklist), one action per fact.
async function checkBookingApprovalReadiness(pool, id) {
  const row = await pool.request().input("id", sql.Int, id).query(`
    SELECT b.ApplicationId
    FROM dbo.CrmBooking b
    WHERE b.Id = @id
  `);
  if (!row.recordset.length) return { notFound: true, missing: [] };
  const chk = row.recordset[0];

  const checklistItems = await ensureChecklistRows(pool, chk.ApplicationId, 1);
  const uncheckedCount = checklistItems.filter((it) => it.CheckStatus !== "Checked").length;

  const missing = [];
  if (uncheckedCount > 0) missing.push(`Data Review Checklist (${uncheckedCount} item(s) unchecked)`);
  return { notFound: false, missing };
}

// The Unit/Rate/Total-Value and Payment-Plan self-confirm mechanism
// (confirm-unit/revert-unit/confirm-plan/revert-plan) has been removed.
// Those two facts are now asserted exactly once, by the Data Review
// checklist's own ProjectUnitRate/PaymentPlanAmounts items (see
// checkBookingApprovalReadiness above and renderChecklistItem in
// CrmBookingDetail.tsx) — not by a second, parallel set of booking columns
// kept in sync from the frontend. UnitReviewConfirmed/PlanReviewConfirmed
// columns are left in place on dbo.CrmBooking (no migration, no data loss)
// but nothing reads or writes them anymore.


// PUT /:id/ready-for-approval — staff-facing "Book" action. Re-runs the
// exact same readiness gate PUT /:id/approve enforces, so a booking can
// never be marked "ready" and then be surprised by a rejection for the same
// missing item. Stamps ReadyForApprovalAt (which the Admin Approval Inbox
// now requires before it will even list a Pending booking — see
// approvalInbox.js), and notifies every
// admin/super_admin/marketing_head that a booking is waiting on them.
router.put("/:id/ready-for-approval", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const readiness = await checkBookingApprovalReadiness(pool, id);
    if (readiness.notFound) return res.status(404).json({ error: "Booking not found" });
    if (readiness.missing.length) {
      return res.status(400).json({ error: `Cannot submit for approval — confirm ${readiness.missing.join(" and ")} first` });
    }

    const actor = actorId(req);
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const stageResult = await submitForApproval(pool, id, userEmail, req.user?.role, actor);

    // Money Receipt only ever becomes real once the booking has actually
    // been submitted for approval here — not the instant the Data Review
    // checklist happens to be fully ticked, which can sit there for a
    // while before staff actually hit Confirm & Book. submitForApproval
    // above already hard-requires the checklist complete, so this is
    // strictly the later of the two gates.
    let mrWarning = null;
    try {
      await createMoneyReceiptAfterDataReview(pool, id, actor);
    } catch (mrErr) {
      console.error("[crm-bookings] auto money receipt creation on submit-for-approval failed:", mrErr.message);
      mrWarning = mrErr.message;
    }

    const booking = await pool.request().input("id", sql.Int, id).query("SELECT BookingNo FROM dbo.CrmBooking WHERE Id = @id");
    const bookingNo = booking.recordset[0]?.BookingNo;
    // dbo.Users has no plain-text "role" column — role is a RoleId FK into
    // dbo.Role (RId / RName / RCode). RName is the machine-readable value
    // ('admin', 'super_admin', 'marketing_head', ...) that matches every
    // other role check in this codebase (e.g. CRM_APPROVER_ROLES in
    // approvalService.js, req.user.role); RCode is a short display code
    // (SA/ADM/MAR/...) and isn't what's compared elsewhere. The previous
    // `WHERE LOWER(role) IN (...)` referenced a column that doesn't exist
    // at all and 500'd this entire endpoint (surfaced in the CRM UI as
    // "Invalid column name 'role'." on Confirm & Book).
    const admins = await pool.request().query(`
      SELECT u.id FROM dbo.Users u
      JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE LOWER(r.RName) IN ('admin', 'super_admin', 'marketing_head') AND u.discontinue = 0
    `);
    for (const a of admins.recordset) {
      await emitNotification(pool, a.id, "crm_booking_ready_for_approval",
        "Booking Ready for Approval",
        `Booking ${bookingNo} has cleared its checklist and is ready for approval.`,
        id, "crm_booking");
    }

    res.json({ success: true, ...stageResult, mrWarning });
  } catch (e) {
    console.error("[crm-bookings] ready-for-approval error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /:id/trigger-money-receipt — recovery action for bookings where the
// auto-created Money Receipt was silently dropped (PDF error, missing amount,
// etc.) on Confirm & Book, and the booking has since moved past Review.
// Only usable when no non-Bounced MR exists (skipIfExists handles duplicates).
router.post("/:id/trigger-money-receipt", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const result = await createMoneyReceiptAfterDataReview(pool, id, actorId(req));
    res.status(result.existing ? 200 : 201).json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-bookings] trigger-money-receipt error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

async function getBookingApplicationId(pool, bookingId) {
  const r = await pool.request().input("id", sql.Int, bookingId)
    .query("SELECT ApplicationId, Status AS BookingStatus FROM dbo.CrmBooking WHERE Id = @id");
  return r.recordset[0] || null;
}

// ── Data Review checklist (the merged, former Level-1 Application check) ──
// The same 7 items that used to gate the Application's own separate
// Approve now live here instead, on the Booking, as the actual content of
// the "Review" workflow stage — a different-department reviewer confirms
// KYC/Project-Unit-Rate/Payment-Plan/Bank-Deposit/Broker/Source/Documents
// against the real data, item by item, before the booking can be Submitted
// for Approval (see submitForApproval in crmBookingStageService.js, which
// also requires this checklist fully checked). Stored at Level=1 in the
// shared table (dbo.CrmApplicationVerificationChecklist), keyed by the
// booking's own ApplicationId. Gated on WorkflowStage='Review' rather than
// Status='Pending' — Status stays 'Pending' for the entire Review ->
// MarketingHeadApproval -> DirectorApproval pipeline now, only WorkflowStage
// actually tracks where a booking is.

// GET /:id/checklist — current Data Review checklist state for this booking.
router.get("/:id/checklist", requirePageRight("crm-bookings", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const bk = await getBookingApplicationId(pool, id);
    if (!bk) return res.status(404).json({ error: "Booking not found" });

    const items = await ensureChecklistRows(pool, bk.ApplicationId, 1);
    const allChecked = items.length > 0 && items.every((it) => it.CheckStatus === "Checked");
    const hasOpenRecheck = items.some((it) => it.CheckStatus === "NeedsRecheck");
    res.json({ items, allChecked, hasOpenRecheck, bookingStatus: bk.BookingStatus });
  } catch (e) {
    console.error("[crm-bookings] GET checklist error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/checklist/:itemKey/check — reviewer ticks one item. Only valid
// while the Booking is at the Review stage. remarks optional (confirming note).
router.put("/:id/checklist/:itemKey/check", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { itemKey } = req.params;
  try {
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const actor = actorId(req);
    const bk = await getBookingApplicationId(pool, id);
    if (!bk) return res.status(404).json({ error: "Booking not found" });
    const stage = await getStageState(pool, id);
    if (stage?.WorkflowStage !== "Review") {
      return res.status(400).json({ error: `Checklist can only be verified while the booking is at the Review stage — current stage: ${stageLabel(stage?.WorkflowStage)}` });
    }

    await ensureChecklistRows(pool, bk.ApplicationId, 1);
    const item = await checkItem(pool, bk.ApplicationId, itemKey, { actor, remarks: req.body?.remarks, level: 1 });

    const items = await ensureChecklistRows(pool, bk.ApplicationId, 1);
    const allChecked = items.every((it) => it.CheckStatus === "Checked");
    // Money Receipt is NOT created here anymore — the checklist being fully
    // checked is only half the gate. It's created once the booking is
    // actually submitted for approval (PUT /:id/ready-for-approval, "Confirm
    // & Book"), which itself requires this same checklist complete first.
    // See createMoneyReceiptAfterDataReview's call site there.

    res.json({ success: true, item, allChecked });
  } catch (e) {
    console.error("[crm-bookings] checklist check error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/checklist/:itemKey/uncheck — reviewer retracts their own check.
router.put("/:id/checklist/:itemKey/uncheck", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { itemKey } = req.params;
  try {
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const actor = actorId(req);
    const bk = await getBookingApplicationId(pool, id);
    if (!bk) return res.status(404).json({ error: "Booking not found" });
    const stage = await getStageState(pool, id);
    if (stage?.WorkflowStage !== "Review") {
      return res.status(400).json({ error: `Checklist can only be verified while the booking is at the Review stage — current stage: ${stageLabel(stage?.WorkflowStage)}` });
    }

    await ensureChecklistRows(pool, bk.ApplicationId, 1);
    const item = await uncheckItem(pool, bk.ApplicationId, itemKey, { actor, level: 1 });
    res.json({ success: true, item });
  } catch (e) {
    console.error("[crm-bookings] checklist uncheck error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/checklist/:itemKey/flag — reviewer flags one item as wrong.
// Remark mandatory. Logged to CrmApplicationStatusLog (against the
// booking's own ApplicationId) so it's visible in the same Status History
// panel other flags already show up in.
router.put("/:id/checklist/:itemKey/flag", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { itemKey } = req.params;
  try {
    if (!req.body?.remarks?.trim()) {
      return res.status(400).json({ error: "A remark is required so the preparer knows what to fix on this item" });
    }
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const actor = actorId(req);
    const bk = await getBookingApplicationId(pool, id);
    if (!bk) return res.status(404).json({ error: "Booking not found" });
    const stage = await getStageState(pool, id);
    if (stage?.WorkflowStage !== "Review") {
      return res.status(400).json({ error: `Checklist can only be verified while the booking is at the Review stage — current stage: ${stageLabel(stage?.WorkflowStage)}` });
    }

    await ensureChecklistRows(pool, bk.ApplicationId, 1);
    const remark = req.body.remarks.trim();
    const item = await flagItem(pool, bk.ApplicationId, itemKey, { actor, remarks: remark, level: 1 });

    const itemDef = CHECKLIST_ITEMS.find((c) => c.key === itemKey);
    await logStatusChange(pool, bk.ApplicationId, CrmStatus.PENDING, CrmStatus.PENDING, "DataReviewRecheck", `${itemDef?.label || itemKey}: ${remark}`, actor);

    res.json({ success: true, item });
  } catch (e) {
    console.error("[crm-bookings] checklist flag error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/checklist/:itemKey/resubmit — preparer-side: "I've fixed what
// was flagged." Only valid on an item currently NeedsRecheck, only while
// the Booking is still at the Review stage.
router.put("/:id/checklist/:itemKey/resubmit", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { itemKey } = req.params;
  try {
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const actor = actorId(req);
    const bk = await getBookingApplicationId(pool, id);
    if (!bk) return res.status(404).json({ error: "Booking not found" });
    const stage = await getStageState(pool, id);
    if (stage?.WorkflowStage !== "Review") {
      return res.status(400).json({ error: `Checklist can only be revised while the booking is at the Review stage — current stage: ${stageLabel(stage?.WorkflowStage)}` });
    }

    const item = await resubmitItem(pool, bk.ApplicationId, itemKey, { actor, level: 1 });

    const itemDef = CHECKLIST_ITEMS.find((c) => c.key === itemKey);
    await logStatusChange(pool, bk.ApplicationId, CrmStatus.PENDING, CrmStatus.PENDING, "DataReviewRevised", `${itemDef?.label || itemKey}: marked as revised, awaiting recheck`, actor);

    res.json({ success: true, item });
  } catch (e) {
    console.error("[crm-bookings] checklist resubmit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — staged Booking approval. Review -> Marketing Head ->
// Director -> Confirmed. The old separate Level-2 checklist approval is no
// longer a gate; its review logic now lives in the booking page checklist.
router.put("/:id/approve", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    const pool0 = getPool();
    if (await assertNotFrozen(pool0, id, res)) return;
    const stageRow = await getStageState(pool0, id);
    const stage = stageRow?.WorkflowStage;
    const result = await approveStageRequest(pool0, id, stage, userEmail, req.user?.role, actorId(req));

    // Auto-flow: an approved booking's very next step is the welcome call —
    // push that to the assigned salesperson instead of waiting for them to
    // notice the booking list changed.
    if (result.confirmed) {
      const pool = pool0;
      const row = await pool.request().input("id", sql.Int, id)
        .query("SELECT BookingNo, AssignedTo FROM dbo.CrmBooking WHERE Id = @id");
      const booking = row.recordset[0];
      if (booking?.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_welcome_call_due",
          "Welcome Call Due",
          `Booking ${booking.BookingNo} is approved — make the welcome call to proceed.`,
          id, "crm_booking");
      }
      // A12: Trigger automated customer communication (SMS/WhatsApp/Email).
      // This used to sit inside the `if (booking?.AssignedTo)` block above —
      // triggerBookingConfirmed() only ever reads the applicant's own
      // Mobile/Email (verified in services/communicationTriggers.js), it has
      // no dependency on the booking having an assigned salesperson. Nesting
      // it there meant any booking approved before a salesperson got
      // assigned silently never sent the customer their booking-confirmed
      // SMS/WhatsApp/Email at all.
      await triggerBookingConfirmed(pool, id);
    }

    res.json({ success: true, status: result.confirmed ? "Approved" : "Pending", ...result });
  } catch (e) {
    console.error("[crm-bookings] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — mandatory remarks; bounces back one stage, never cancels.
router.put("/:id/reject", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    if (await assertNotFrozen(pool, id, res)) return;
    const stageRow = await getStageState(pool, id);
    const result = await rejectStageRequest(pool, id, stageRow?.WorkflowStage, userEmail, req.user?.role, actorId(req), req.body?.note || req.body?.remarks);
    res.json({ success: true, status: CrmStatus.PENDING, ...result });
  } catch (e) {
    console.error("[crm-bookings] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// POST /:id/freeze — admin-only. Puts a hard lock on the booking preventing any
// staff-driven status change (submit for approval, document generation, etc.).
// Used for: legal disputes, court injunctions, developer-initiated project holds.
// FreezeExpiresAt is required — freezes must not be open-ended.
router.post("/:id/freeze", allowRoles("admin", "super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { reason, expiresAt } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: "reason is required to freeze a booking" });
  if (!expiresAt) return res.status(400).json({ error: "expiresAt is required — freezes must have an expiry date" });
  try {
    const pool = getPool();
    const check = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingNo, IsFrozen FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1");
    if (!check.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (check.recordset[0].IsFrozen) return res.status(409).json({ error: "Booking is already frozen" });

    await pool.request()
      .input("id",  sql.Int,       id)
      .input("by",  sql.Int,       actorId(req))
      .input("rsn", sql.NVarChar(500), reason.trim())
      .input("exp", sql.DateTime2, new Date(expiresAt))
      .query(`
        UPDATE dbo.CrmBooking SET
          IsFrozen = 1, FrozenAt = SYSDATETIME(),
          FrozenBy = @by, FreezeReason = @rsn, FreezeExpiresAt = @exp,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    await logCrmAudit(pool, "Booking", id, actorId(req), [
      { field: "IsFrozen", oldVal: 0, newVal: 1 },
      { field: "FreezeReason", oldVal: null, newVal: reason.trim() },
    ]);
    res.json({ success: true, message: `Booking ${check.recordset[0].BookingNo} frozen until ${expiresAt}` });
  } catch (e) {
    console.error("[crm-bookings] freeze error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// DELETE /:id/freeze (unfreeze) — admin-only. Clears the freeze lock.
router.delete("/:id/freeze", allowRoles("admin", "super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const check = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingNo, IsFrozen FROM dbo.CrmBooking WHERE Id = @id");
    if (!check.recordset.length) return res.status(404).json({ error: "Booking not found" });
    if (!check.recordset[0].IsFrozen) return res.status(409).json({ error: "Booking is not frozen" });

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmBooking SET
        IsFrozen = 0, FrozenAt = NULL,
        FrozenBy = NULL, FreezeReason = NULL, FreezeExpiresAt = NULL,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
    await logCrmAudit(pool, "Booking", id, actorId(req), [
      { field: "IsFrozen", oldVal: 1, newVal: 0 },
    ]);
    res.json({ success: true, message: `Booking ${check.recordset[0].BookingNo} unfrozen` });
  } catch (e) {
    console.error("[crm-bookings] unfreeze error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// DELETE /:id - admin cleanup only. This is intentionally not the business
// cancellation flow: once a booking has entered approval or downstream
// execution, staff must use Cancellation Request so refunds, parking, legal
// records, and audit steps are handled explicitly.
router.delete("/:id", allowRoles("admin", "super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const rowRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT Id, BookingNo, ApplicationId, UnitId, Status, IsActive, WorkflowStage,
             ReadyForApprovalAt, MarketingHeadApprovedAt, DirectorApprovedAt, ConfirmedAt
      FROM dbo.CrmBooking
      WHERE Id = @id AND IsActive = 1
    `);
    const booking = rowRes.recordset[0];
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const isCancelled = booking.Status === "Cancelled";
    const progressedReasons = [];

    if (!isCancelled) {
      // For active bookings, redirect to the cancellation workflow if already progressed.
      if (booking.Status === CrmStatus.APPROVED) progressedReasons.push("booking is fully approved");
      if (booking.WorkflowStage && booking.WorkflowStage !== "Review") progressedReasons.push(`workflow is at ${booking.WorkflowStage}`);
      if (booking.ReadyForApprovalAt) progressedReasons.push("booking has been submitted for approval");
      if (booking.MarketingHeadApprovedAt || booking.DirectorApprovedAt || booking.ConfirmedAt) progressedReasons.push("approval stamps already exist");
    }

    // Cancelled bookings: only legal/financial records are permanent — operational
    // records (handover, NOC, welcome call, etc.) are cleaned up on permanent delete.
    // Active bookings: the full downstream check applies to redirect to cancellation.
    const downstreamSql = isCancelled ? `
      SELECT
        (SELECT COUNT(*) FROM dbo.CrmAgreement WHERE BookingId = @bid) AS Agreements,
        (SELECT COUNT(*) FROM dbo.CrmSalesDeed WHERE BookingId = @bid) AS SalesDeeds,
        (SELECT COUNT(*) FROM dbo.CrmInvoice WHERE BookingId = @bid AND Status NOT IN ('Void','Rejected')) AS Invoices,
        (SELECT COUNT(*) FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status <> 'Rejected') AS MoneyReceipts,
        (SELECT COUNT(*) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS OnAccountPayments,
        (SELECT COUNT(*) FROM dbo.CrmPaymentReceipt r
          JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId WHERE m.BookingId = @bid) AS PaymentReceipts,
        (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid
          AND (AmountPaid > 0 OR Status IN ('Paid', 'Waived'))) AS PaidMilestones,
        (SELECT COUNT(*) FROM dbo.ReceivedPayment rp
          WHERE (rp.CrmBookingId = @bid OR rp.CrmMilestoneId IN
            (SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid))
            AND ISNULL(rp.RPStatus,'') <> 'Rejected') AS ReceivedPayments
    ` : bookingDownstreamSql;

    const downstream = await pool.request().input("bid", sql.Int, id).query(downstreamSql);
    const d = downstream.recordset[0] || {};
    for (const [label, count] of Object.entries(d)) {
      if (Number(count) > 0) progressedReasons.push(label);
    }
    if (progressedReasons.length) {
      return res.status(400).json({
        error: isCancelled
          ? `Cannot remove booking ${booking.BookingNo} — it has legal or financial records (${progressedReasons.join(", ")}) that form a permanent audit trail and cannot be deleted.`
          : `Cannot delete booking ${booking.BookingNo} because it has progressed: ${progressedReasons.join(", ")}. Use Cancellation Request instead.`,
      });
    }

    const actor = actorId(req);
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBooking
        SET IsActive = 0, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Revert Application-stage rows so the application can be corrected and
    // re-booked without stale child rows remaining pinned to the deleted booking.
    // Parking allotments are fully deactivated (IsActive = 0) rather than just
    // orphaned (BookingId = NULL) — a NULL-BookingId row with IsActive = 1
    // permanently blocks the slot in the availability matrix for everyone.
      await tx.request().input("bid", sql.Int, id).input("aid", sql.Int, booking.ApplicationId).query(`
      UPDATE dbo.CrmCustomerBankDetail SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.CrmBookingDocument SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.CrmParkingAllotment SET BookingId = NULL, IsActive = 0 WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.CrmCoApplicant SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.CrmExtraCharge SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.CrmCommunicationLog SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      UPDATE dbo.SaLead SET CrmBookingId = NULL WHERE CrmBookingId = @bid;
      UPDATE dbo.ReceivedPayment SET CrmBookingId = NULL, CrmMilestoneId = NULL
      WHERE (CrmBookingId = @bid OR CrmMilestoneId IN (SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid))
        AND ISNULL(RPStatus, '') = 'Rejected';

      DELETE FROM dbo.CrmWelcomeCallBankPreference WHERE BookingId = @bid;
      DELETE FROM dbo.CrmWelcomeChecklistItem WHERE BookingId = @bid;
      DELETE FROM dbo.CrmWelcomeCallSubmission WHERE BookingId = @bid;
      DELETE FROM dbo.CrmBookingAmendmentRequest WHERE BookingId = @bid AND Status IN ('Rejected', 'Cancelled');
      DELETE FROM dbo.CrmBookingAttachment WHERE BookingId = @bid;
      DELETE FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid;
    `);

    // Void any pending brokerage tranches — orphaned Pending tranches would
    // inflate the brokerage liability reports and confuse clawback tracking
    // if the application is later re-booked with fresh brokerage.
      await tx.request().input("bid", sql.Int, id).query(`
      UPDATE dbo.CrmBrokerageMaster
      SET Status = 'Voided', UpdatedAt = SYSDATETIME(),
          Notes = ISNULL(Notes, '') + char(10) + 'Auto-voided — booking deleted by admin.'
      WHERE BookingId = @bid AND Status = 'Pending'
    `);

      await tx.commit();
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }

    // Revert the Application from Approved → back to a cancellable/re-bookable
    // state. createCrmBookingRecord force-advanced Application to Approved when
    // the booking was created; without this call the Application stays at
    // Approved forever with no live booking behind it — it can't be cancelled
    // through the normal UI (APPLICATION_TRANSITIONS['Approved'] = []) and
    // can't be re-booked, leaving the Application orphaned with no recovery path.
    // For cancelled bookings these steps were already executed when the
    // cancellation was approved — skip to avoid double-sync and ghost holds.
    if (!isCancelled) {
      await syncApplicationOnBookingTerminal(pool, id, CrmStatus.CANCELLED,
        "BookingAdminDelete", "Booking deleted by admin", actor);

      if (booking.UnitId) {
        try {
          await placeHoldIfNeeded(pool, {
            entityType: "Unit",
            entityId: booking.UnitId,
            applicationId: booking.ApplicationId,
            holdDays: 3,
            reason: "Booking deleted by admin - application reverted to pre-booking hold",
            userId: actor,
          });
        } catch (holdErr) {
          console.error("[crm-bookings] unit hold restore after delete failed:", holdErr.message);
        }
      }
    }

    await logCrmAudit(pool, "Booking", id, actor, [
      { field: "IsActive", oldVal: 1, newVal: 0 },
    ]);

    res.json({ success: true, message: `Booking ${booking.BookingNo} deleted` });
  } catch (e) {
    console.error("[crm-bookings] DELETE error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// DELETE /:id/permanent - hard delete from the soft-deleted (cancelled pool)
// booking section. Only Agreements, Sale Deeds, and actual monetary records
// are protected — if those exist the delete is permanently blocked because
// they are the legal/financial audit trail. Operational lifecycle records
// (welcome calls, handovers, NOC, service tickets, etc.) are deleted with the
// booking row since they have no standalone legal standing.
router.delete("/:id/permanent", allowRoles("admin", "super_admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const rowRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT Id, BookingNo, ApplicationId, Status, IsActive, WorkflowStage,
             ReadyForApprovalAt, MarketingHeadApprovedAt, DirectorApprovedAt, ConfirmedAt
      FROM dbo.CrmBooking
      WHERE Id = @id
    `);
    const booking = rowRes.recordset[0];
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.IsActive) return res.status(400).json({ error: "Only soft-deleted bookings can be permanently deleted" });

    const isCancelled = booking.Status === "Cancelled";
    const progressedReasons = [];
    if (!isCancelled) {
      // For non-cancelled bookings, workflow progress guards still apply.
      if (booking.Status === CrmStatus.APPROVED) progressedReasons.push("booking is fully approved");
      if (booking.WorkflowStage && booking.WorkflowStage !== "Review") progressedReasons.push(`workflow is at ${booking.WorkflowStage}`);
      if (booking.ReadyForApprovalAt) progressedReasons.push("booking has been submitted for approval");
      if (booking.MarketingHeadApprovedAt || booking.DirectorApprovedAt || booking.ConfirmedAt) progressedReasons.push("approval stamps already exist");
    }

    // Only Agreements, Sale Deeds, and monetary footprints block permanent
    // deletion — they are the legal/financial audit trail and can never be
    // removed. Operational records (handover, NOC, welcome calls, etc.) are
    // deleted below as part of the transaction.
    const protectedRes = await pool.request().input("bid", sql.Int, id).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.CrmAgreement WHERE BookingId = @bid) AS Agreements,
        (SELECT COUNT(*) FROM dbo.CrmSalesDeed WHERE BookingId = @bid) AS SalesDeeds,
        (SELECT COUNT(*) FROM dbo.CrmInvoice WHERE BookingId = @bid AND Status NOT IN ('Void','Rejected')) AS Invoices,
        (SELECT COUNT(*) FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status <> 'Rejected') AS MoneyReceipts,
        (SELECT COUNT(*) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS OnAccountPayments,
        (SELECT COUNT(*) FROM dbo.CrmPaymentReceipt r
          JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId WHERE m.BookingId = @bid) AS PaymentReceipts,
        (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid
          AND (AmountPaid > 0 OR Status IN ('Paid', 'Waived'))) AS PaidMilestones,
        (SELECT COUNT(*) FROM dbo.ReceivedPayment rp
          WHERE (rp.CrmBookingId = @bid OR rp.CrmMilestoneId IN
            (SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid))
            AND ISNULL(rp.RPStatus,'') <> 'Rejected') AS ReceivedPayments,
        (SELECT COUNT(*) FROM dbo.CrmLoanDetail WHERE BookingId = @bid
          AND SanctionStatus NOT IN ('NotApplied','Rejected')) AS ActiveLoans
    `);
    const p = protectedRes.recordset[0] || {};
    for (const [label, count] of Object.entries(p)) {
      if (Number(count) > 0) progressedReasons.push(label);
    }
    if (progressedReasons.length) {
      return res.status(400).json({
        error: `Cannot permanently delete booking ${booking.BookingNo} — it has protected records that cannot be removed: ${progressedReasons.join(", ")}. Agreements, Sale Deeds, and monetary records are permanent audit trail.`,
      });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      // Detach shared application-level records (bank details, docs, parking,
      // co-applicants, extra charges) back to the application rather than
      // deleting them — they belong to the application, not the booking.
      await tx.request().input("bid", sql.Int, id).input("aid", sql.Int, booking.ApplicationId).query(`
        UPDATE dbo.CrmCustomerBankDetail SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
        UPDATE dbo.CrmBookingDocument SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
        UPDATE dbo.CrmParkingAllotment SET BookingId = NULL, IsActive = 0 WHERE BookingId = @bid AND ApplicationId = @aid;
        UPDATE dbo.CrmCoApplicant SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
        UPDATE dbo.CrmExtraCharge SET BookingId = NULL WHERE BookingId = @bid AND ApplicationId = @aid;
      `);
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmBookingAttachment WHERE BookingId = @bid");

      // Operational lifecycle records — no legal standing; deleted with the booking.
      // Snag items must precede handover rows (FK dependency).
      await tx.request().input("bid", sql.Int, id).query(
        "DELETE FROM dbo.CrmSnagItem WHERE HandoverId IN (SELECT Id FROM dbo.CrmHandover WHERE BookingId = @bid)"
      );
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmHandover WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmNoc WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmPrePossession WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmPossessionNotice WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmServiceTicket WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmQueryPayment WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmRegistry WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmLegalMilestone WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeCallBankPreference WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeChecklistItem WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeCallSubmission WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeCall WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmBookingAmendmentRequest WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmCancellation WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("UPDATE dbo.CrmCommunicationLog SET BookingId = NULL WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("UPDATE dbo.SaLead SET CrmBookingId = NULL WHERE CrmBookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query(`
        UPDATE dbo.ReceivedPayment SET CrmBookingId = NULL, CrmMilestoneId = NULL
        WHERE CrmBookingId = @bid OR CrmMilestoneId IN (SELECT Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid)
      `);
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
      // MCA FY2024 mandate: audit trail rows must be tamper-proof and cannot be
      // deleted even by admins. Orphaned rows (BookingId → deleted booking) are
      // intentional — they are the evidence that the booking once existed.
      await tx.request().input("bid", sql.Int, id).query(
        // CrmUnitChangeLog has a FK; NULL-out instead of delete so the history
        // survives (migration 367 made BookingId nullable for this purpose).
        "UPDATE dbo.CrmUnitChangeLog SET BookingId = NULL WHERE BookingId = @bid"
      );
      // CrmBookingStageLog, ApprovalAuditLog, and CrmAuditLog have no FK
      // constraints — leave them entirely; they become orphaned audit records.
      // CrmBrokerageMaster rows must be removed before the parent CrmBooking
      // row to avoid FK constraint violations. At this point the booking is
      // already soft-deleted and its Pending tranches were voided at that
      // time — any remaining rows here are Voided/Clawback records.
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmBrokerageMaster WHERE BookingId = @bid");
      await tx.request().input("bid", sql.Int, id).query("DELETE FROM dbo.CrmBooking WHERE Id = @bid");
      await tx.commit();
    } catch (txErr) {
      await tx.rollback().catch(() => {});
      throw txErr;
    }

    res.json({ success: true, message: `Booking ${booking.BookingNo} permanently deleted` });
  } catch (e) {
    console.error("[crm-bookings] permanent DELETE error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id/loan — home loan / bank coordination detail for a booking.
// DisbursedAmount is no longer a manually-typed column — it's computed live
// from real money: CrmPaymentReceipt rows (via CrmPaymentMilestone.BookingId)
// plus CrmOnAccountPayment rows (BookingId direct), both filtered to
// PaymentMode = 'Home Loan' (the real mode value used by CrmPaymentMilestones.tsx's
// PAY_MODES list). A manual figure that can silently drift from receipts is
// worse than no figure at all.
router.get("/:id/loan", requirePageRight("crm-loan-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("bid", sql.Int, id)
      .query("SELECT * FROM dbo.CrmLoanDetail WHERE BookingId = @bid");

    const received = await pool.request().input("bid", sql.Int, id).query(`
      SELECT
        ISNULL((SELECT SUM(r.Amount) FROM dbo.CrmPaymentReceipt r
                JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
                WHERE m.BookingId = @bid AND r.PaymentMode = 'Home Loan'), 0)
        +
        ISNULL((SELECT SUM(o.Amount) FROM dbo.CrmOnAccountPayment o
                WHERE o.BookingId = @bid AND o.PaymentMode = 'Home Loan'), 0)
        AS DisbursedAmount
    `);

    const row = result.recordset[0] || null;
    res.json({
      ...(row || { BookingId: id }),
      DisbursedAmount: received.recordset[0].DisbursedAmount,
      HasLoanRecord: !!row,
    });
  } catch (e) {
    console.error("[crm-bookings] GET /:id/loan error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/loan — upsert loan detail for a booking. DisbursedAmount is
// intentionally not accepted here — it's computed on GET, never stored.
router.put("/:id/loan", requirePageRight("crm-loan-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const actor = actorId(req);

    if (await assertNotFrozen(pool, id, res)) return;

    const existing = await pool.request().input("bid", sql.Int, id)
      .query("SELECT Id FROM dbo.CrmLoanDetail WHERE BookingId = @bid");

    if (existing.recordset.length) {
      await pool.request()
        .input("bid",   sql.Int,           id)
        .input("bank",  sql.NVarChar(200), b.BankName    || null)
        .input("branch",sql.NVarChar(200), b.BranchName  || null)
        .input("amt",   sql.Decimal(18,2), b.LoanAmount  != null ? parseFloat(b.LoanAmount) : null)
        .input("st",    sql.NVarChar(30),  b.SanctionStatus || null)
        .input("sdate", sql.Date,          b.SanctionDate   || null)
        .input("acc",   sql.NVarChar(100), b.LoanAccountNo || null)
        .input("rm",    sql.NVarChar(200), b.RmName || null)
        .input("rmc",   sql.NVarChar(20),  b.RmContact || null)
        .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("ub",    sql.Int,           actor)
        .query(`
          UPDATE dbo.CrmLoanDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            LoanAmount = ISNULL(@amt, LoanAmount), SanctionStatus = ISNULL(@st, SanctionStatus),
            SanctionDate = ISNULL(@sdate, SanctionDate),
            LoanAccountNo = ISNULL(@acc, LoanAccountNo), RmName = ISNULL(@rm, RmName), RmContact = ISNULL(@rmc, RmContact),
            Notes = @notes, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          WHERE BookingId = @bid
        `);
    } else {
      await pool.request()
        .input("bid",   sql.Int,           id)
        .input("bank",  sql.NVarChar(200), b.BankName    || null)
        .input("branch",sql.NVarChar(200), b.BranchName  || null)
        .input("amt",   sql.Decimal(18,2), b.LoanAmount  != null ? parseFloat(b.LoanAmount) : null)
        .input("st",    sql.NVarChar(30),  b.SanctionStatus || "NotApplied")
        .input("sdate", sql.Date,          b.SanctionDate   || null)
        .input("acc",   sql.NVarChar(100), b.LoanAccountNo || null)
        .input("rm",    sql.NVarChar(200), b.RmName || null)
        .input("rmc",   sql.NVarChar(20),  b.RmContact || null)
        .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cb",    sql.Int,           actor)
        .query(`
          INSERT INTO dbo.CrmLoanDetail
            (BookingId, BankName, BranchName, LoanAmount, SanctionStatus, SanctionDate, LoanAccountNo, RmName, RmContact, Notes, CreatedBy, CreatedAt)
          VALUES (@bid, @bank, @branch, @amt, @st, @sdate, @acc, @rm, @rmc, @notes, @cb, SYSDATETIME())
        `);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] PUT /:id/loan error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── Invoice tab ──────────────────────────────────────────────────────────────

// GET /:id/invoices — every invoice generated for this booking
router.get("/:id/invoices", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT inv.*, cu.name AS CreatedByName
      FROM dbo.CrmInvoice inv
      LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
      WHERE inv.BookingId = @id
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/invoices error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /:id/invoices — generate a real, permanently-numbered invoice.
// Visible to the customer in their portal immediately (no separate "send"
// step — an invoice is a record of a real transaction, not a draft that
// needs sign-off like the Agreement/Sales Deed documents).
router.post("/:id/invoices", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const type = b.InvoiceType || "Maintenance";

    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const allowedManualTypes = new Set(["Booking", "Milestone", "Maintenance", "Other", "OnAccount"]);
    if (!allowedManualTypes.has(type)) {
      return res.status(400).json({ error: "Invoice type is not supported for manual generation" });
    }

    // "Milestone" invoices (Foundation, Superstructure, Slab Casting,
    // Plastering, On Possession, parking/extra-charge line items — every
    // real payment after Booking) stay manual-trigger by design, but the
    // amount/date are always pulled from the milestone's own real payment
    // data, never typed freehand — that's what keeps them "synced" instead
    // of just another disconnected ad-hoc entry. MilestoneId's unique index
    // (migration 268) guarantees a milestone can never be invoiced twice.
    let milestoneId = null;
    let onAccountPaymentId = null;
    let amount, invoiceDate, description;
    if (type === "OnAccount") {
      // On-account deposits (dbo.CrmOnAccountPayment — money received in
      // excess of what's currently due, auto-parked and later auto-applied
      // to future milestones) are real cash received and must not go
      // un-invoiced. Amount is the deposit's own full Amount (what was
      // actually received), not AppliedAmount — an invoice documents money
      // received, independent of how it's later allocated across
      // milestones. OnAccountPaymentId's unique index (migration 288)
      // guarantees a deposit can never be invoiced twice.
      onAccountPaymentId = parseInt(b.OnAccountPaymentId);
      if (!onAccountPaymentId) return res.status(400).json({ error: "OnAccountPaymentId is required for an OnAccount invoice" });
      const oa = await pool.request().input("oid", sql.Int, onAccountPaymentId).input("bid", sql.Int, id).query(`
        SELECT Id, ReceiptNo, Amount, ReceivedDate, PaymentMode FROM dbo.CrmOnAccountPayment WHERE Id = @oid AND BookingId = @bid
      `);
      const oaRow = oa.recordset[0];
      if (!oaRow) return res.status(404).json({ error: "On-account payment not found on this booking" });
      const already = await pool.request().input("oid", sql.Int, onAccountPaymentId).query("SELECT Id FROM dbo.CrmInvoice WHERE OnAccountPaymentId = @oid AND Status <> 'Void'");
      if (already.recordset.length) return res.status(400).json({ error: `On-account payment "${oaRow.ReceiptNo}" already has an invoice` });
      amount = Number(oaRow.Amount);
      invoiceDate = oaRow.ReceivedDate;
      description = b.Description || `On-account payment received — ${oaRow.ReceiptNo}`;
    } else if (type === "Milestone" || type === "Booking") {
      milestoneId = parseInt(b.MilestoneId);
      if (!milestoneId) return res.status(400).json({ error: "MilestoneId is required for a Milestone/Booking invoice" });
      const m = await pool.request().input("mid", sql.Int, milestoneId).input("bid", sql.Int, id).query(`
        SELECT Id, MilestoneNo, MilestoneName, AmountDue, AmountPaid, Status, PaidDate, DemandStatus, DemandRaisedOn FROM dbo.CrmPaymentMilestone WHERE Id = @mid AND BookingId = @bid
      `);
      const mRow = m.recordset[0];
      if (!mRow) return res.status(404).json({ error: "Milestone not found on this booking" });
      // Invoice is a billing document — generated after Demand is raised, BEFORE
      // On Account Adjustment settles the milestone. Flow: Demand → Invoice → On Account
      // Adjustment → Milestone Settlement. Do NOT gate on Status = Paid.
      if (mRow.DemandStatus === CrmStatus.PENDING) {
        return res.status(400).json({ error: `A demand must be raised for "${mRow.MilestoneName}" (from the Demands page) before its invoice can be generated` });
      }
      const already = await pool.request().input("mid", sql.Int, milestoneId).query("SELECT Id FROM dbo.CrmInvoice WHERE MilestoneId = @mid AND Status <> 'Void'");
      if (already.recordset.length) return res.status(400).json({ error: `"${mRow.MilestoneName}" already has an invoice` });
      amount = Number(mRow.AmountDue);
      invoiceDate = mRow.DemandRaisedOn || null;
      description = b.Description || `${mRow.MilestoneName} — invoice`;
    } else {
      amount = parseFloat(b.Amount);
      if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
      invoiceDate = b.InvoiceDate || null;
      description = b.Description || null;

      // Maintenance/Other invoices aren't tied to a milestone, so there's no
      // MilestoneId to anchor a uniqueness check on the way "Milestone" does
      // above. The billing period (calendar month of InvoiceDate) is the
      // next best anchor — one Maintenance/Other invoice per booking per
      // month, blocking accidental double-generation while still allowing
      // legitimate repeat billing (e.g. next quarter's maintenance) once the
      // period rolls over. Checked here for a fast, clear error message, and
      // enforced again at the DB level (migration 270's unique index on
      // BookingId/InvoiceType/BillingPeriod) so it can never be raced by two
      // near-simultaneous requests.
      const effectiveDate = invoiceDate ? new Date(invoiceDate) : new Date();
      const periodYear = effectiveDate.getFullYear();
      const periodMonth = effectiveDate.getMonth() + 1;
      const dup = await pool.request()
        .input("bid", sql.Int, id)
        .input("type", sql.NVarChar(30), type)
        .input("yr", sql.Int, periodYear)
        .input("mo", sql.Int, periodMonth)
        .query(`
          SELECT TOP 1 Id, InvoiceNo FROM dbo.CrmInvoice
          WHERE BookingId = @bid AND InvoiceType = @type AND Status <> 'Void'
            AND YEAR(InvoiceDate) = @yr AND MONTH(InvoiceDate) = @mo
        `);
      if (dup.recordset.length) {
        const monthLabel = effectiveDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        return res.status(400).json({
          error: `A ${type} invoice (${dup.recordset[0].InvoiceNo}) already exists for ${monthLabel} on this booking — only one ${type} invoice is allowed per billing period`,
        });
      }
    }

    // Customisable numbering — three ways to land on an InvoiceNo, in order
    // of precedence:
    //  1. CustomInvoiceNo — the exact, full number typed by staff (a
    //     migrated legacy number, a one-off promised reference). Bypasses
    //     CrmDocNumberSequence entirely — never consumes a counter slot, so
    //     it can't desync auto-numbering for any other invoice.
    //  2. InvoicePrefix — staff supply only the prefix (a project's own
    //     pre-printed stationery series, e.g. "TSTRSD" instead of "INV");
    //     the number after it still auto-increments, through the exact same
    //     race-safe getNextDocNumber() sequence every other doc type in this
    //     app already uses — just keyed to this prefix's own row instead of
    //     "INV". Sanitized to A-Z0-9 only so it stays a safe DocType key.
    //  3. Neither — the standard INV-YYYY-NNNNN series (unchanged default).
    // InvoiceNo's own UNIQUE constraint (migration 185) is still the real,
    // race-safe guard against a collision in every case.
    const customNo = String(b.CustomInvoiceNo || "").trim();
    const rawPrefix = String(b.InvoicePrefix || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    let invoiceNo;
    if (customNo) {
      if (customNo.length > 30) return res.status(400).json({ error: "Custom invoice number must be 30 characters or fewer" });
      const clash = await pool.request().input("no", sql.NVarChar(30), customNo).query("SELECT Id FROM dbo.CrmInvoice WHERE InvoiceNo = @no");
      if (clash.recordset.length) return res.status(400).json({ error: `Invoice number "${customNo}" is already in use` });
      invoiceNo = customNo;
    } else if (rawPrefix) {
      if (rawPrefix.length > 10) return res.status(400).json({ error: "Invoice prefix must be 10 characters or fewer" });
      invoiceNo = await getNextDocNumber(pool, rawPrefix, rawPrefix);
    } else {
      invoiceNo = await getNextDocNumber(pool, "INV", "INV");
    }
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  invoiceNo)
      .input("bid",  sql.Int,           id)
      .input("type", sql.NVarChar(30),  type)
      .input("amt",  sql.Decimal(18,2), amount)
      .input("dt",   sql.Date,          invoiceDate)
      .input("desc", sql.NVarChar(500), description)
      .input("cb",   sql.Int,           actorId(req))
      .input("mid",  sql.Int,           milestoneId)
      .input("oaid", sql.Int,           onAccountPaymentId)
      .query(`
        INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, InvoiceDate, Description, CreatedBy, CreatedAt, MilestoneId, OnAccountPaymentId)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @type, @amt, ISNULL(@dt, CAST(SYSDATETIME() AS DATE)), @desc, @cb, SYSDATETIME(), @mid, @oaid)
      `);
    const invoiceId = result.recordset[0].Id;
    // Best-effort, same request — the invoice record itself is the source of
    // truth and must not fail to create just because PDF rendering hit a
    // problem; generateInvoicePdf writes the base64 straight onto the row,
    // and the download route regenerates + re-persists on demand if it's
    // ever missing, so a rendering failure here is recoverable, not data loss.
    try {
      await generateInvoicePdf(pool, invoiceId);
    } catch (pdfErr) {
      console.error("[crm-bookings] invoice PDF generation failed:", pdfErr.message);
    }
    res.status(201).json({ success: true, id: invoiceId, InvoiceNo: invoiceNo });
  } catch (e) {
    // Two near-simultaneous requests can both pass the app-level duplicate
    // check above and then race into the INSERT — the unique indexes
    // (migration 268 for MilestoneId, 270 for BookingId/InvoiceType/
    // BillingPeriod, 288 for OnAccountPaymentId) are the real backstop and
    // will reject the second one. Surface that as the same clear 400
    // instead of a raw SQL 500.
    if (e.number === 2601 || e.number === 2627) {
      return res.status(400).json({ error: "An invoice already exists for this milestone, on-account payment, or billing period — it can't be generated twice" });
    }
    console.error("[crm-bookings] POST /:id/invoices error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id/invoices/:invoiceId/pdf — stream the invoice PDF straight from
// the CrmInvoice row's stored base64. Regenerates + re-persists it on the
// fly if the row predates the PdfBase64 column (getInvoicePdfBuffer handles
// that) instead of 404ing on a real, existing invoice.
router.get("/:id/invoices/:invoiceId/pdf", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.id);
    const invoiceId = parseInt(req.params.invoiceId);
    const row = await pool.request().input("iid", sql.Int, invoiceId).input("bid", sql.Int, bookingId)
      .query("SELECT InvoiceNo FROM dbo.CrmInvoice WHERE Id = @iid AND BookingId = @bid");
    if (!row.recordset.length) return res.status(404).json({ error: "Invoice not found" });
    const invoiceNo = row.recordset[0].InvoiceNo;
    const buffer = await getInvoicePdfBuffer(pool, invoiceId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoiceNo}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/invoices/:invoiceId/pdf error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Invoices are otherwise write-once (no UPDATE/DELETE route exists) — Void
// is the one, audited correction path: it never deletes the row (InvoiceNo
// stays on record for audit trail, matching this app's no-hard-delete
// convention elsewhere in CRM), but it does free the invoice's MilestoneId /
// OnAccountPaymentId / BillingPeriod slot (migration 325's re-scoped unique
// indexes + the Status <> 'Void' guards above) so a corrected invoice can be
// generated in its place. Gated tighter than plain "crm-bookings edit" —
// same approver set as Money Receipt approval (crmMoneyReceiptWorkflow.js's
// APPROVER_ROLES) since this is a financial-document correction, not routine
// booking editing.
const INVOICE_VOID_ROLES = ["admin", "super_admin", "dba", "accounts_head"];
router.put("/:id/invoices/:invoiceId/void", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    if (!INVOICE_VOID_ROLES.includes(normalizeRole(req.user?.role))) {
      return res.status(403).json({ error: "Only Finance / Accounts Head can void an invoice" });
    }
    const pool = getPool();
    const bookingId = parseInt(req.params.id);
    const invoiceId = parseInt(req.params.invoiceId);
    const reason = String(req.body?.reason || req.body?.Reason || "").trim();
    if (!reason) return res.status(400).json({ error: "A reason is required to void an invoice" });

    const cur = await pool.request().input("iid", sql.Int, invoiceId).input("bid", sql.Int, bookingId).query(`
      SELECT Id, InvoiceNo, Status FROM dbo.CrmInvoice WHERE Id = @iid AND BookingId = @bid
    `);
    const row = cur.recordset[0];
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    if (row.Status === "Void") return res.status(400).json({ error: `"${row.InvoiceNo}" is already void` });

    await pool.request()
      .input("iid", sql.Int, invoiceId)
      .input("by", sql.Int, actorId(req))
      .input("reason", sql.NVarChar(500), reason)
      .query(`
        UPDATE dbo.CrmInvoice SET
          Status = 'Void', VoidedBy = @by, VoidedAt = SYSDATETIME(), VoidReason = @reason
        WHERE Id = @iid
      `);
    await logCrmAudit(pool, "CrmInvoice", invoiceId, actorId(req), [
      { field: "Status", oldVal: row.Status, newVal: "Void" },
      { field: "VoidReason", oldVal: null, newVal: reason },
    ]);

    res.json({ success: true, InvoiceNo: row.InvoiceNo });
  } catch (e) {
    console.error("[crm-bookings] PUT /:id/invoices/:invoiceId/void error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /:id/resync-schedule — retroactive fix for bookings whose payment
// schedule was generated before Milestone #1 tracked the booking's real
// BookingAmount (it used to be sized off the payment plan's own fixed %,
// which could badly mismatch what the customer actually booked with — see
// generateMilestonesForBooking). Pulls Milestone #1's AmountDue/Percent into
// line with the booking's real BookingAmount, then redistributes every other
// still-open milestone across (GrandTotal - BookingAmount), preserving their
// relative weighting to each other — the exact same math new bookings get at
// creation time, just re-run on demand for one already created. Safe/
// idempotent: a no-op if Milestone #1 already matches, and never touches a
// Waived milestone or reduces AmountDue below what's already been collected.
router.post("/:id/resync-schedule", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);

    const activeErr = await requireActiveBooking(pool, id);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const bk = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingAmount, GrandTotal, TotalValue FROM dbo.CrmBooking WHERE Id = @id");
    if (!bk.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const booking = bk.recordset[0];
    const bookingAmount = Number(booking.BookingAmount || 0);
    if (!bookingAmount) return res.status(400).json({ error: "This booking has no BookingAmount recorded — nothing to resync against" });
    const grandTotal = Number(booking.GrandTotal || booking.TotalValue || 0);
    if (!grandTotal) return res.status(400).json({ error: "This booking has no total value set" });

    const m1Res = await pool.request().input("bid", sql.Int, id)
      .query("SELECT TOP 1 Id, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
    if (!m1Res.recordset.length) return res.status(400).json({ error: "No milestones found on this booking" });
    const m1 = m1Res.recordset[0];
    if (m1.Status === "Waived") return res.status(400).json({ error: "Milestone 1 has been waived — nothing to resync" });

    if (Math.abs(Number(m1.AmountDue) - bookingAmount) < 1) {
      return res.json({ success: true, changed: false, message: "Milestone 1 already matches the booking amount — nothing to do" });
    }

    const newAmountDue = Math.max(bookingAmount, Number(m1.AmountPaid || 0));
    const newPercent = Math.round((newAmountDue / grandTotal) * 10000) / 100;
    await pool.request()
      .input("id", sql.Int, m1.Id)
      .input("amt", sql.Decimal(18, 2), newAmountDue)
      .input("pct", sql.Decimal(5, 2), newPercent)
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          AmountDue = @amt,
          [Percent] = @pct,
          -- Bug fixed here: previously "WHEN Status = '${CrmStatus.PAID}' THEN Status"
          -- kept a milestone frozen as Paid forever once it first reached
          -- that status, even after resync raised AmountDue past what was
          -- actually collected (e.g. a stale schedule undercounted the real
          -- Booking Amount by a few hundred rupees, so "fully paid against
          -- the wrong number" no longer means fully paid). Re-evaluate
          -- honestly against the just-updated amount every time instead —
          -- never silently mask a real shortfall.
          Status = CASE WHEN AmountPaid >= @amt THEN '${CrmStatus.PAID}' ELSE '${CrmStatus.PENDING}' END,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await recalculateRemainingMilestones(pool, id, { fixedMilestoneId: m1.Id });

    res.json({ success: true, changed: true });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/resync-schedule error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// ── Attachments tab ──────────────────────────────────────────────────────────

// GET /:id/attachments — every file attached to this booking
router.get("/:id/attachments", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    // Return both booking-level attachments AND application-level KYC documents
    // (uploaded during the Application wizard) in one unified list, so staff
    // see everything in one place without re-uploading.
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT a.Id, a.Label, a.FileName, a.FileSize, a.MimeType,
             a.UploadedAt AS CreatedAt, u.name AS UploaderName,
             'booking' AS Source, NULL AS DocumentType
      FROM dbo.CrmBookingAttachment a
      LEFT JOIN dbo.Users u ON u.id = a.UploadedBy
      WHERE a.BookingId = @id

      UNION ALL

      SELECT d.Id, d.DocumentType AS Label, d.FileName, d.FileSize, d.MimeType,
             d.CreatedAt, cu.name AS UploaderName,
             'application' AS Source, d.DocumentType
      FROM dbo.CrmBookingDocument d
      LEFT JOIN dbo.Users cu ON cu.id = d.CreatedBy
      WHERE d.BookingId = @id
         OR (d.ApplicationId = (
              SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1
            ) AND d.BookingId IS NULL)

      ORDER BY CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-bookings] GET /:id/attachments error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /:id/attachments — upload one or more files
router.post("/:id/attachments", requirePageRight("crm-bookings", "edit"), upload.array("files", 10), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });
    for (const file of files) {
      const sigErr = verifyFileMatchesDeclaredType(file);
      if (sigErr) return res.status(400).json({ error: `${file.originalname}: ${sigErr}` });
    }

    const statusCheck = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if ([CrmStatus.CANCELLED,CrmStatus.REJECTED].includes(statusCheck.recordset[0]?.Status)) return res.status(400).json({ error: "Attachments cannot be added to a cancelled or rejected booking." });

    const inserted = [];
    for (const file of files) {
      const result = await pool.request()
        .input("bid",   sql.Int,           id)
        .input("label", sql.NVarChar(200), req.body.Label || null)
        .input("fname", sql.NVarChar(300), file.originalname)
        .input("fb64",  sql.NVarChar(sql.MAX), file.buffer.toString("base64"))
        .input("fsize", sql.Int,           file.size)
        .input("mime",  sql.NVarChar(150), file.mimetype)
        .input("cb",    sql.Int,           actorId(req))
        .query(`
          INSERT INTO dbo.CrmBookingAttachment (BookingId, Label, FileName, FileBase64, FileSize, MimeType, UploadedBy, UploadedAt)
          OUTPUT INSERTED.Id
          VALUES (@bid, @label, @fname, @fb64, @fsize, @mime, @cb, SYSDATETIME())
        `);
      inserted.push(result.recordset[0].Id);
    }
    res.status(201).json({ success: true, ids: inserted });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/attachments error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id/attachments/file/:attId — download/preview a stored file
router.get("/:id/attachments/file/:attId", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.id);
    const attId = parseInt(req.params.attId);
    const result = await pool.request().input("id", sql.Int, attId).input("bid", sql.Int, bookingId)
      .query("SELECT FileBase64, FileName, MimeType FROM dbo.CrmBookingAttachment WHERE Id = @id AND BookingId = @bid");
    if (!result.recordset.length || !result.recordset[0].FileBase64) return res.status(404).json({ error: "Attachment not found" });
    const row = result.recordset[0];
    res.setHeader("Content-Type", row.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.FileName.replace(/"/g, "")}"`);
    res.send(Buffer.from(row.FileBase64, "base64"));
  } catch (e) {
    console.error("[crm-bookings] GET /:id/attachments/file/:attId error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// DELETE /:id/attachments/:attId
router.delete("/:id/attachments/:attId", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.id);
    const attId = parseInt(req.params.attId);
    const statusCheck = await pool.request().input("id", sql.Int, bookingId).query("SELECT Status FROM dbo.CrmBooking WHERE Id = @id");
    if ([CrmStatus.CANCELLED,CrmStatus.REJECTED].includes(statusCheck.recordset[0]?.Status)) return res.status(400).json({ error: "Attachments cannot be removed from a cancelled or rejected booking." });

    const result = await pool.request().input("id", sql.Int, attId).input("bid", sql.Int, bookingId)
      .query("SELECT Id FROM dbo.CrmBookingAttachment WHERE Id = @id AND BookingId = @bid");
    if (!result.recordset.length) return res.status(404).json({ error: "Attachment not found" });
    await pool.request().input("id", sql.Int, attId).query("DELETE FROM dbo.CrmBookingAttachment WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] DELETE /:id/attachments/:attId error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id/portal-status — staff-facing: shows whether the customer portal
// account has been provisioned for this booking's customer. Includes masked
// mobile (initial password hint) so support staff can help a customer who
// forgot their first-login credential. Only meaningful once the booking is
// Confirmed, but readable at any stage.
router.get("/:id/portal-status", requirePageRight("crm-bookings", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();

    // Query 1: booking + customer — always safe (no portal table join)
    const bkgResult = await pool.request().input("bid", sql.Int, id).query(`
      SELECT
        b.Status        AS BookingStatus,
        b.WorkflowStage,
        b.ConfirmedAt,
        b.ApplicationId,
        a.CustomerId,
        c.CustomerName,
        c.Email         AS CustomerEmail,
        c.Mobile        AS CustomerMobile
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE b.Id = @bid AND b.IsActive = 1
    `);
    if (!bkgResult.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const bkgRow = bkgResult.recordset[0];

    // Query 2: portal user lookup — may fail if migration 254 not yet applied;
    // degrade gracefully so the frontend still gets the booking stage.
    let portalRow = null;
    try {
      // Try CustomerId-keyed lookup (post-migration-254 schema)
      let pResult = null;
      if (bkgRow.CustomerId) {
        pResult = await pool.request().input("cid", sql.Int, bkgRow.CustomerId).query(`
          SELECT Id, Email, IsActive, MustChangePassword, CreatedAt
          FROM dbo.CrmCustomerPortalUser
          WHERE CustomerId = @cid
        `);
      }
      // Fall back to ApplicationId-keyed lookup (pre-migration-254 rows)
      if ((!pResult || !pResult.recordset.length) && bkgRow.ApplicationId) {
        pResult = await pool.request().input("aid", sql.Int, bkgRow.ApplicationId).query(`
          SELECT Id, Email, IsActive, MustChangePassword, CreatedAt
          FROM dbo.CrmCustomerPortalUser
          WHERE ApplicationId = @aid
        `);
      }
      if (pResult && pResult.recordset.length) portalRow = pResult.recordset[0];
    } catch (pe) {
      // Column missing (migration not run) or other transient issue — log and continue
      console.warn("[crm-bookings] portal user lookup failed (non-fatal):", pe.message);
    }

    const mob = bkgRow.CustomerMobile;
    res.json({
      hasPortal: !!portalRow,
      portalUserId: portalRow ? portalRow.Id : null,
      email: portalRow ? portalRow.Email : (bkgRow.CustomerEmail || null),
      maskedMobile: mob || null,
      isActive: portalRow ? !!portalRow.IsActive : false,
      mustChangePassword: portalRow ? !!portalRow.MustChangePassword : false,
      portalCreatedAt: portalRow ? portalRow.CreatedAt : null,
      customerName: bkgRow.CustomerName || null,
      bookingStatus: bkgRow.BookingStatus,
      workflowStage: bkgRow.WorkflowStage,
      confirmedAt: bkgRow.ConfirmedAt || null,
    });
  } catch (e) {
    console.error("[crm-bookings] GET /:id/portal-status error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST /:id/provision-portal — idempotent recovery route. The portal is
// normally auto-provisioned at booking confirmation, but if that failed
// (e.g. customer had no email on file at that moment and it was added later),
// staff can trigger it here without re-running the full approval flow.
router.post("/:id/provision-portal", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const bkg = await pool.request().input("bid", sql.Int, id)
      .query("SELECT ApplicationId, WorkflowStage FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    if (!bkg.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const { ApplicationId, WorkflowStage } = bkg.recordset[0];
    if (WorkflowStage !== "Confirmed") {
      return res.status(400).json({ error: "Portal can only be provisioned once the booking is fully confirmed" });
    }
    const { ensurePortalUser } = require("../services/crmPortalProvision");
    const result = await ensurePortalUser(pool, ApplicationId);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("[crm-bookings] POST /:id/provision-portal error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// Helper shared by deactivate + reactivate below
async function setBookingPortalActive(pool, bookingId, isActive) {
  // Look up portal user via booking → application → customer (CustomerId-keyed first, then ApplicationId fallback)
  const bkg = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT b.ApplicationId, a.CustomerId FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id = @bid AND b.IsActive = 1
  `);
  if (!bkg.recordset.length) return { error: "Booking not found", status: 404 };
  const { ApplicationId, CustomerId } = bkg.recordset[0];

  let portalUserId = null;
  if (CustomerId) {
    try {
      const r = await pool.request().input("cid", sql.Int, CustomerId)
        .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE CustomerId = @cid");
      if (r.recordset.length) portalUserId = r.recordset[0].Id;
    } catch (_) {}
  }
  if (!portalUserId && ApplicationId) {
    try {
      const r = await pool.request().input("aid", sql.Int, ApplicationId)
        .query("SELECT Id FROM dbo.CrmCustomerPortalUser WHERE ApplicationId = @aid");
      if (r.recordset.length) portalUserId = r.recordset[0].Id;
    } catch (_) {}
  }
  if (!portalUserId) return { error: "No portal account exists for this customer yet", status: 404 };
  await pool.request().input("id", sql.Int, portalUserId).input("act", sql.Bit, isActive ? 1 : 0)
    .query("UPDATE dbo.CrmCustomerPortalUser SET IsActive = @act WHERE Id = @id");
  return { ok: true };
}

router.put("/:id/portal/deactivate", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await setBookingPortalActive(getPool(), id, false);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] portal deactivate error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

router.put("/:id/portal/reactivate", requirePageRight("crm-bookings", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await setBookingPortalActive(getPool(), id, true);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-bookings] portal reactivate error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET /:id/lifecycle — structured step-by-step lifecycle state for one booking.
// Powers the BookingLifecycleBar component in CrmBookingDetail.
// Step order and gates here MUST match what each feature route's POST / actually
// requires — verified against crmPrePossession.js, crmHandover.js, crmSalesDeed.js,
// crmQueryPayment.js, crmRegistry.js, crmMutation.js, crmNoc.js.
router.get("/:id/lifecycle", requirePageRight("crm-bookings", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "Invalid booking id" });
  try {
    const pool = getPool();

    const [bkRes, wcRes, agRes, lmRes, ppRes, pnRes, hoRes, sdRes, orgNocRes, bankNocRes, qpRes, regRes, mutRes] = await Promise.all([
      // booking itself
      pool.request().input("id", sql.Int, id)
        .query("SELECT Id, BookingNo, Status, BookingDate, ApplicationId FROM dbo.CrmBooking WHERE Id = @id"),
      // welcome call — any 'Welcomed' outcome
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 CallDate, Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = @id AND Outcome = 'Welcomed' ORDER BY CallDate DESC"),
      // agreement
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, AgreementDate, CreatedAt FROM dbo.CrmAgreement WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // legal milestones — parallel bookkeeping, no strict status gate
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, CurrentStep, OverallStatus, CreatedAt FROM dbo.CrmLegalMilestone WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // pre-possession — real gate: Agreement.Status = 'Registered' (crmPrePossession.js POST /)
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, CreatedAt FROM dbo.CrmPrePossession WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // possession notice — real gate: PrePossession.Status = 'Ready'
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, OfferedDate, CreatedAt FROM dbo.CrmPossessionNotice WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // handover — real gate: Agreement Registered AND Possession Notice Acknowledged (crmHandover.js POST /)
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, ActualHandoverDate, CreatedAt FROM dbo.CrmHandover WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // sales deed — real gate: Handover Completed + Agreement Registered + Loan Processing
      // cleared (crmSalesDeed.js POST /). Its own comment: "AFS registered → possession
      // → handover → Sale Deed drafted → registered."
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, CustomerApprovalStatus, DirectorApprovalStatus, RegistrationNo, CreatedAt FROM dbo.CrmSalesDeed WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // Org NOC — real gate: Agreement exists (any status). Separated from Bank NOC
      // because their gates and timing in the real workflow are completely different:
      // Org NOC can be requested as soon as an agreement exists (well before handover);
      // Bank NOC requires a Sale Deed. A single combined lookup can't represent both
      // without misleading one of them.
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, CreatedAt FROM dbo.CrmNoc WHERE BookingId = @id AND NocType = 'Organisation' ORDER BY CreatedAt DESC"),
      // Bank NOC — real gate: Sale Deed exists (crmNoc.js POST / Bank branch)
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, CreatedAt FROM dbo.CrmNoc WHERE BookingId = @id AND NocType = 'Bank' ORDER BY CreatedAt DESC"),
      // query payment — real gate: Sale Deed exists (crmQueryPayment.js POST /)
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, CreatedAt FROM dbo.CrmQueryPayment WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // registry — real gate: QueryPayment.Status = 'Confirmed' (crmRegistry.js POST /)
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, ScheduledDate, CompletedDate, CreatedAt FROM dbo.CrmRegistry WHERE BookingId = @id ORDER BY CreatedAt DESC"),
      // mutation — real gate: Registry.Status = 'Completed' (crmMutation.js POST /).
      // Was missing entirely from the old lifecycle — chain silently ended at Registry.
      pool.request().input("id", sql.Int, id)
        .query("SELECT TOP 1 Id, Status, CreatedAt FROM dbo.CrmMutation WHERE BookingId = @id ORDER BY CreatedAt DESC"),
    ]);

    if (!bkRes.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const bk      = bkRes.recordset[0];
    const wc      = wcRes.recordset[0];
    const ag      = agRes.recordset[0];
    const lm      = lmRes.recordset[0];
    const pp      = ppRes.recordset[0];
    const pn      = pnRes.recordset[0];
    const ho      = hoRes.recordset[0];
    const sd      = sdRes.recordset[0];
    const orgNoc  = orgNocRes.recordset[0];
    const bankNoc = bankNocRes.recordset[0];
    const qp      = qpRes.recordset[0];
    const reg     = regRes.recordset[0];
    const mut     = mutRes.recordset[0];

    // agDone (Executed-or-Registered) — used for Legal Milestones gate only.
    // agRegistered is the strict gate Pre-Possession and Handover actually require.
    const agDone       = ag  && [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(ag.Status);
    const agRegistered = ag  && ag.Status === CrmStatus.REGISTERED;
    // Sale Deed "done" = director approved (full approval chain completed).
    const sdDone  = sd  && sd.DirectorApprovalStatus === CrmStatus.APPROVED;
    const qpDone  = qp  && qp.Status === "Confirmed";
    const ppDone  = pp  && pp.Status === "Ready";
    const pnDone  = pn  && pn.Status === "Acknowledged";
    const hoDone  = ho  && ho.Status === "Completed";
    const regDone = reg && reg.Status === "Completed";
    const mutDone = mut && mut.Status === "Approved";

    // Possession sub-steps (Pre-Possession + Possession Notice) are tracked on
    // their dedicated pages; here we show one "Handover" chip whose gate reflects
    // the full sequence: Agreement Registered → Pre-Possession → Possession Notice
    // → Handover. Active once Agreement is Registered; done only when Handover is Completed.
    const possessionActive = agRegistered;
    const possessionDone   = hoDone;
    const possessionInProgress = pp || pn || ho;

    const { nocType: resolvedNocType } = await resolveNocType(pool, id);
    const activeNoc = resolvedNocType === "Bank" ? bankNoc : orgNoc;

    const d = (v) => v ? String(v).slice(0, 10) : null;

    // Minimal high-level lifecycle — 9 stages.
    // Sub-step detail (Legal Milestones, Pre-Possession, Possession Notice,
    // Query Payment) lives on each step's own dedicated page; the bar here
    // shows only the major milestones so it stays readable at a glance.
    const steps = [
      {
        key: "application",
        label: "Application",
        status: "done",
        date: d(bk.BookingDate),
        link: bk.ApplicationId ? `/crm/applications?id=${bk.ApplicationId}` : null,
        blockedBy: null,
      },
      {
        key: "booking",
        label: "Booking",
        status: "done",
        date: d(bk.BookingDate),
        link: `/crm/bookings?view=${id}`,
        blockedBy: null,
      },
      {
        key: "welcome_call",
        label: "Welcome Call",
        status: wc ? "done" : "active",
        date: wc ? d(wc.CallDate) : null,
        link: `/crm/welcome-calls?bookingId=${id}`,
        blockedBy: null,
      },
      {
        // Covers the full Agreement phase: AFS registration, legal milestones,
        // all Agreement sub-steps. Detail is on the dedicated Agreement and
        // Legal Milestones pages — this chip shows only the headline status.
        key: "agreement",
        label: "Agreement",
        status: agDone ? "done" : ag ? "active" : wc ? "active" : "locked",
        date: agDone ? d(ag.AgreementDate || ag.CreatedAt) : ag ? d(ag.CreatedAt) : null,
        link: `/crm/agreements?bookingId=${id}`,
        blockedBy: wc ? null : "Welcome Call must be completed first",
      },
      {
        key: "noc",
        label: resolvedNocType === "Bank" ? "Bank NOC" : "NOC",
        status: activeNoc && activeNoc.Status === "Issued" ? "done"
               : activeNoc ? "active"
               : agRegistered ? "active"
               : "locked",
        date: activeNoc ? d(activeNoc.CreatedAt) : null,
        link: `/crm/noc?bookingId=${id}`,
        blockedBy: agRegistered ? null : "Agreement must be Registered first",
      },
      {
        // Single "Handover" chip covers: Pre-Possession inspection → Possession
        // Notice → Handover. Sub-step detail is on the Pre-Possession and
        // Possession Notice pages; this chip is done when Handover is Completed.
        key: "handover",
        label: "Handover",
        status: possessionDone ? "done"
               : possessionInProgress ? "active"
               : possessionActive ? "active"
               : "locked",
        date: ho ? d(ho.ActualHandoverDate || ho.CreatedAt)
             : pn ? d(pn.OfferedDate || pn.CreatedAt)
             : pp ? d(pp.CreatedAt) : null,
        link: "/crm/handover",
        blockedBy: agRegistered ? null : "Agreement must be Registered first",
      },
      {
        key: "sales_deed",
        label: "Sale Deed",
        status: sdDone ? "done" : sd ? "active" : hoDone ? "active" : "locked",
        date: sd ? d(sd.CreatedAt) : null,
        link: `/crm/sales-deed?bookingId=${id}`,
        blockedBy: hoDone ? null : "Handover must be Completed first",
      },
      {
        // Single "Registry" chip covers: Query Payment → Registry appointment
        // → completion. Query Payment detail is on its own dedicated page.
        key: "registry",
        label: "Registry",
        status: regDone ? "done"
               : reg ? "active"
               : qpDone ? "active"
               : qp ? "active"
               : sd ? "active"
               : "locked",
        date: reg ? d(reg.CompletedDate || reg.ScheduledDate || reg.CreatedAt)
             : qp ? d(qp.CreatedAt) : null,
        link: `/crm/registry?bookingId=${id}`,
        blockedBy: sd ? null : "Sale Deed must be created first",
      },
      {
        key: "mutation",
        label: "Mutation",
        status: mutDone ? "done" : mut ? "active" : regDone ? "active" : "locked",
        date: mut ? d(mut.CreatedAt) : null,
        link: `/crm/mutation?bookingId=${id}`,
        blockedBy: regDone ? null : "Registry must be Completed first",
      },
    ];

    res.json({ BookingId: id, BookingNo: bk.BookingNo, steps });
  } catch (e) {
    console.error("[crm-bookings] lifecycle error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
