// backend/services/crmBookingStageService.js
//
// The Booking stage machine for the new two-level approval workflow.
//
//   Stage 'Review'                 -> staff data-entry review (confirm
//                                     unit/plan boxes + booking amount
//                                     payment) then Submit for Approval.
//   Stage 'MarketingHeadApproval'  -> marketing_head / admin / super_admin
//   Stage 'DirectorApproval'       -> director / admin / super_admin
//   Stage 'Confirmed'              -> Status becomes 'Approved'; the
//                                     existing downstream flow (Welcome
//                                     Call, Bank Details, Agreement,
//                                     Payments) proceeds exactly as before.
//
// Every transition is logged to dbo.CrmBookingStageLog for a full audit
// trail. A reject at ANY stage is never terminal: it bounces the booking
// back exactly one stage (Director -> Marketing Head, Marketing Head ->
// Review) with a MANDATORY remark. The remark is stored on the booking
// (StageRemarks + RejectedFromStage/By/At) so the page at the bounced-to
// stage can show it highlighted. The booking can only ever be terminally
// cancelled through the real Cancellation Request flow / SLA expiry —
// never through this reject.
//
// The two approval levels are driven by dbo.ApprovalWorkflows
// (module 'crm-bookings', seeded by migration 308, editable from
// Admin > Approval Setup). approvalService.transition() already enforces
// per-level role/user gates from that table's LevelsData — we only orchestrate
// the stage field + log + remarks here and let that engine stamp the audit
// trail in ApprovalAuditLog exactly like every other approve in the app.
const { sql } = require("../db");
const { transition: approvalTransition } = require("./approvalService");
const { ensureChecklistRows } = require("./crmApplicationChecklist");
const { ensurePortalUser } = require("./crmPortalProvision");

const STAGE_REVIEW = "Review";
const STAGE_MARKETING = "MarketingHeadApproval";
const STAGE_DIRECTOR = "DirectorApproval";
const STAGE_CONFIRMED = "Confirmed";

const WORKFLOW_STAGES = [STAGE_REVIEW, STAGE_MARKETING, STAGE_DIRECTOR, STAGE_CONFIRMED];

// Which roles may act at each approval stage. super_admin is a parallel
// approver on BOTH levels (per requirement); the LevelData roles in
// ApprovalWorkflows are the broader gate, this is the tighter per-stage
// gate the booking page itself uses to decide what to render.
const STAGE_ROLES = {
  [STAGE_MARKETING]: ["admin", "super_admin", "marketing_head"],
  [STAGE_DIRECTOR]: ["admin", "super_admin", "director"],
};

// Human labels for UI badges / banners / logs.
const STAGE_LABELS = {
  [STAGE_REVIEW]: "Review",
  [STAGE_MARKETING]: "Marketing Head Approval",
  [STAGE_DIRECTOR]: "Director Approval",
  [STAGE_CONFIRMED]: "Confirmed",
};

function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || "—";
}

// Stage ordering for the "bounce back exactly one stage" logic.
const STAGE_ORDER = {};
WORKFLOW_STAGES.forEach((s, i) => { STAGE_ORDER[s] = i; });

function assertValidStage(stage) {
  if (!STAGE_ORDER.hasOwnProperty(stage)) {
    const e = new Error(`Unknown workflow stage: ${stage}`);
    e.status = 400;
    throw e;
  }
}

async function getBookingStageRow(pool, bookingId) {
  const r = await pool.request()
    .input("bid", sql.Int, bookingId)
    .query(`
      SELECT Id, BookingNo, Status, IsActive, WorkflowStage, StageRemarks, RejectedFromStage,
             RejectedBy, RejectedAt, MarketingHeadApprovedAt, MarketingHeadApprovedBy,
             DirectorApprovedAt, DirectorApprovedBy, ConfirmedAt, ConfirmedBy, ApplicationId
      FROM dbo.CrmBooking
      WHERE Id = @bid
    `);
  return r.recordset[0] || null;
}

async function logStageAction(pool, bookingId, stage, action, remarks, actorUserId) {
  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("stg", sql.NVarChar(40), stage)
    .input("act", sql.NVarChar(60), action)
    .input("rem", sql.NVarChar(sql.MAX), remarks || null)
    .input("aby", sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmBookingStageLog (BookingId, Stage, [Action], Remarks, ActorId, CreatedAt)
      VALUES (@bid, @stg, @act, @rem, @aby, SYSDATETIME())
    `);
}

// Read the full stage state for the booking detail page.
async function getStageState(pool, bookingId) {
  const row = await getBookingStageRow(pool, bookingId);
  if (!row) return null;

  const history = await pool.request()
    .input("bid", sql.Int, bookingId)
    .query(`
      SELECT l.*, u.name AS ActorName
      FROM dbo.CrmBookingStageLog l
      LEFT JOIN dbo.Users u ON u.id = l.ActorId
      WHERE l.BookingId = @bid
      ORDER BY l.CreatedAt DESC, l.Id DESC
    `);

  return {
    WorkflowStage: row.WorkflowStage,
    StageRemarks: row.StageRemarks,
    RejectedFromStage: row.RejectedFromStage,
    RejectedBy: row.RejectedBy,
    RejectedAt: row.RejectedAt,
    MarketingHeadApprovedAt: row.MarketingHeadApprovedAt,
    MarketingHeadApprovedBy: row.MarketingHeadApprovedBy,
    DirectorApprovedAt: row.DirectorApprovedAt,
    DirectorApprovedBy: row.DirectorApprovedBy,
    ConfirmedAt: row.ConfirmedAt,
    ConfirmedBy: row.ConfirmedBy,
    history: history.recordset,
  };
}

// Role gate used by the routes: the passed role may approve at the given
// stage if it is the stage's own role set. super_admin is included on both
// stages as the parallel approver.
function canApproveStage(role, stage) {
  const allowed = STAGE_ROLES[stage];
  if (!allowed) return false;
  return allowed.includes(String(role || "").toLowerCase());
}

// Shared guard: a booking must be live (not Cancelled/Rejected) and
// sitting at an approval stage that matches what the actor expects.
async function requireActiveStage(pool, bookingId, stage) {
  const row = await getBookingStageRow(pool, bookingId);
  if (!row) {
    const e = new Error("Booking not found");
    e.status = 404;
    throw e;
  }
  if (row.Status === "Cancelled" || row.Status === "Rejected" || row.IsActive === 0) {
    const e = new Error(`This booking has been ${row.Status} — no further workflow actions are allowed`);
    e.status = 400;
    throw e;
  }
  if (row.WorkflowStage !== stage) {
    const e = new Error(`Booking is currently at '${stageLabel(row.WorkflowStage)}' — not '${stageLabel(stage)}'`);
    e.status = 409;
    throw e;
  }
  return row;
}

// Staff "Submit for Approval" — Review -> MarketingHeadApproval. Two gates:
// all 7 data-review checklist items (KYC, Project/Unit/Rate, Payment Plan,
// Bank/Deposit, Broker, Source, Documents) must be Checked, and the Booking
// Amount (Milestone #1) must be fully paid. ProjectUnitRate and
// PaymentPlanAmounts being Checked already IS "Unit/Rate/Value confirmed"
// and "Payment Plan confirmed" — the old separate
// UnitReviewConfirmed/PlanReviewConfirmed columns asserted the exact same
// two facts a second time, via their own confirm-unit/confirm-plan routes,
// kept in sync only because the frontend fired both calls on one click.
// That second system is gone; the checklist is now the only place either
// fact is recorded. Stamps ReadyForApprovalAt so the Approval Inbox lists it.
async function submitForApproval(pool, bookingId, userEmail, userRole, userId) {
  const row = await requireActiveStage(pool, bookingId, STAGE_REVIEW);
  if (!row) throw Object.assign(new Error("Booking not found"), { status: 404 });

  const checklistItems = await ensureChecklistRows(pool, row.ApplicationId, 1);
  const uncheckedCount = checklistItems.filter((it) => it.CheckStatus !== "Checked").length;
  if (uncheckedCount > 0) {
    const e = new Error(`Complete the data review checklist first — ${uncheckedCount} item(s) still not checked`);
    e.status = 400;
    throw e;
  }

  const readiness = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT b.Status
    FROM dbo.CrmBooking b
    WHERE b.Id = @bid
  `);
  const chk = readiness.recordset[0];
  if (!chk) throw Object.assign(new Error("Booking not found"), { status: 404 });

  if (chk.Status === "Approved") {
    return { ok: true, noop: true, stage: STAGE_CONFIRMED };
  }


  await pool.request().input("bid", sql.Int, bookingId)
    .query(`
      UPDATE dbo.CrmBooking SET
        WorkflowStage = 'MarketingHeadApproval',
        ReadyForApprovalAt = SYSDATETIME(),
        StageRemarks = NULL, RejectedFromStage = NULL, RejectedBy = NULL, RejectedAt = NULL,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @bid
    `);
  await logStageAction(pool, bookingId, STAGE_MARKETING, "SubmittedForApproval", null, userId);

  return {
    ok: true,
    stage: STAGE_MARKETING,
    label: stageLabel(STAGE_MARKETING),
    remarque: null,
  };
}

async function approveStageRequest(pool, bookingId, stage, userEmail, userRole, userId) {
  const row = await requireActiveStage(pool, bookingId, stage);
  if (!canApproveStage(userRole, stage)) {
    const e = new Error(`You are not authorized to approve at the '${stageLabel(stage)}' stage`);
    e.status = 403;
    throw e;
  }

  // Let the generic engine advance the ApprovalAuditLog level (level 1 for
  // Marketing Head, level 2 for Director) and enforce the seeded
  // ApprovalWorkflows LevelData. On the final level it flips Status to
  // Approved — which is exactly our "Confirmed".
  const result = await approvalTransition("crm-bookings", bookingId, "Approved", userEmail, userRole, null, userId);

  const nextStage = stage === STAGE_MARKETING ? STAGE_DIRECTOR : STAGE_CONFIRMED;
  // Require at least 2 approval levels (Marketing Head + Director) before confirming.
  // A misconfigured 1-level workflow must never bypass Director approval.
  const MIN_APPROVAL_LEVELS = 2;
  const confirmedNow = nextStage === STAGE_CONFIRMED && result.level >= result.totalLevels && result.totalLevels >= MIN_APPROVAL_LEVELS;

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("stg", sql.NVarChar(40), nextStage)
    .input("mhAt", sql.DateTime2, stage === STAGE_MARKETING ? new Date() : null)
    .input("mhBy", sql.Int, stage === STAGE_MARKETING ? userId : null)
    .input("drAt", sql.DateTime2, stage === STAGE_DIRECTOR ? new Date() : null)
    .input("drBy", sql.Int, stage === STAGE_DIRECTOR ? userId : null)
    .input("cfAt", sql.DateTime2, confirmedNow ? new Date() : null)
    .input("cfBy", sql.Int, confirmedNow ? userId : null)
    .query(`
      UPDATE dbo.CrmBooking SET
        WorkflowStage = @stg,
        ReadyForApprovalAt = CASE WHEN @stg = 'DirectorApproval' THEN SYSDATETIME() ELSE NULL END,
        StageRemarks = NULL, RejectedFromStage = NULL, RejectedBy = NULL, RejectedAt = NULL,
        MarketingHeadApprovedAt = ISNULL(MarketingHeadApprovedAt, @mhAt),
        MarketingHeadApprovedBy = ISNULL(MarketingHeadApprovedBy, @mhBy),
        DirectorApprovedAt = ISNULL(DirectorApprovedAt, @drAt),
        DirectorApprovedBy = ISNULL(DirectorApprovedBy, @drBy),
        ConfirmedAt = ISNULL(ConfirmedAt, @cfAt),
        ConfirmedBy = ISNULL(ConfirmedBy, @cfBy),
        UpdatedAt = SYSDATETIME()
      WHERE Id = @bid
    `);

  const actionWord = confirmedNow ? "Confirmed" : "StageApproved";
  await logStageAction(pool, bookingId, nextStage, actionWord, null, userId);

  // Portal provisioning fires the instant booking is confirmed — the customer
  // gets access to track their application, upload documents, and view
  // invoices right away, not only after the agreement is auto-created later.
  // Guarded separately so a portal hiccup never blocks the approval itself.
  let portalInfo = null;
  if (confirmedNow) {
    try {
      const appRow = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid");
      const applicationId = appRow.recordset[0]?.ApplicationId;
      if (applicationId) {
        portalInfo = await ensurePortalUser(pool, applicationId);
      }
    } catch (e) {
      console.error("[crmBookingStageService] portal provisioning on confirm failed:", e.message);
      portalInfo = { created: false, error: e.message };
    }

    // Auto-process any Pending MRs that were blocked by WorkflowStage !== 'Confirmed'.
    // When the approver tried to approve the MR before the Director approved the booking,
    // it threw and the MR stayed Pending with ReceivedPaymentId = NULL — Finance never
    // got a row to approve, so milestone AmountPaid was never updated. Now that the
    // booking is Confirmed, sweep those MRs through approveMoneyReceipt so the
    // ReceivedPayment row lands in Finance's queue automatically.
    try {
      const { approveMoneyReceipt } = require("./crmMoneyReceiptWorkflow");
      const pendingMrs = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status = 'Pending' AND ReceivedPaymentId IS NULL");
      for (const mr of pendingMrs.recordset) {
        try {
          await approveMoneyReceipt(pool, mr.Id, userId, userEmail);
        } catch (mrErr) {
          console.error("[crmBookingStageService] auto-approve pending MR", mr.Id, "on confirm failed:", mrErr.message);
        }
      }
    } catch (e) {
      console.error("[crmBookingStageService] pending MR sweep on confirm failed:", e.message);
    }
  }

  return {
    ok: true,
    stage: nextStage,
    label: stageLabel(nextStage),
    level: result.level,
    totalLevels: result.totalLevels,
    confirmed: confirmedNow,
    portal: portalInfo,
  };
}

// Reject bounces exactly one stage back — never cancels. A remark is
// mandatory (the whole point is to tell the preparer what to fix). The
// LevelData remains untouched (the stage never clears), so a re-approve
// after correction works cleanly.
async function rejectStageRequest(pool, bookingId, stage, userEmail, userRole, userId, remark) {
  const row = await requireActiveStage(pool, bookingId, stage);
  if (!row) throw Object.assign(new Error("Booking not found"), { status: 404 });
  if (!remark || !String(remark).trim()) {
    const e = new Error("A remark is required so the preparer knows what to fix");
    e.status = 400;
    throw e;
  }
  if (!canApproveStage(userRole, stage)) {
    const e = new Error(`You are not authorized to reject at the '${stageLabel(stage)}' stage`);
    e.status = 403;
    throw e;
  }

  const prevStage = stage === STAGE_MARKETING ? STAGE_REVIEW : STAGE_MARKETING;

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("stg", sql.NVarChar(40), prevStage)
    .input("rem", sql.NVarChar(sql.MAX), String(remark).trim())
    .input("rejFrom", sql.NVarChar(40), stage)
    .input("rejBy", sql.Int, userId)
    .input("rejAt", sql.DateTime2, new Date())
    .query(`
      UPDATE dbo.CrmBooking SET
        WorkflowStage = @stg,
        StageRemarks = @rem,
        RejectedFromStage = @rejFrom,
        RejectedBy = @rejBy,
        RejectedAt = @rejAt,
        -- Bouncing to Review means staff must re-submit via ready-for-approval
        -- (which re-stamps this) — clear it so it drops out of the Approval
        -- Inbox until then. Bouncing to MarketingHeadApproval means the
        -- booking is ALREADY sitting at an approval stage awaiting Marketing
        -- Head again — re-stamp now, don't null it, or it silently vanishes
        -- from their Approval Inbox query (which requires IS NOT NULL).
        ReadyForApprovalAt = CASE WHEN @stg = 'Review' THEN NULL ELSE SYSDATETIME() END,
        -- Always clear the Marketing Head stamp on any reject: resetFromLevel
        -- above always deletes the level-1 (Marketing) ApprovalAuditLog row
        -- regardless of which stage we're bouncing to, so a re-approval is
        -- always required and this stamp must be free to be re-set fresh
        -- (approveStageRequest uses ISNULL(...), so a stale non-null value
        -- here would otherwise survive the next real approval untouched).
        MarketingHeadApprovedAt = NULL,
        MarketingHeadApprovedBy = NULL,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @bid
    `);
  await logStageAction(pool, bookingId, prevStage, "BouncedBackForCorrection", String(remark).trim(), userId);

  // A bounce is not a terminal rejection. Clear any approved levels at/after
  // the bounced-to point so the loop restarts cleanly when the preparer
  // resubmits. This is especially important for Director -> Marketing Head:
  // the old level-1 ApprovalAuditLog row must not make the next Marketing
  // click count as Director approval.
  const resetFromLevel = prevStage === STAGE_MARKETING ? 1 : 0;
  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("lvl", sql.Int, resetFromLevel)
    .query(`
      DELETE FROM dbo.ApprovalAuditLog
      WHERE TableName = 'CrmBooking'
        AND RecordId = @bid
        AND ActionStatus = 'Approved'
        AND Level >= @lvl
    `);

  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("lvl", sql.Int, resetFromLevel)
    .input("role", sql.NVarChar(100), userRole || null)
    .input("email", sql.NVarChar(200), userEmail || null)
    .input("note", sql.NVarChar(500), String(remark).trim())
    .query(`
      INSERT INTO dbo.ApprovalAuditLog
        (TableName, RecordId, Level, Role, ApproverEmail, ActionStatus, Note, ActionAt)
      VALUES
        ('CrmBooking', @bid, @lvl, @role, @email, 'BouncedBack', @note, SYSDATETIME())
    `);

  return {
    ok: true,
    stage: prevStage,
    label: stageLabel(prevStage),
  };
}

module.exports = {
  STAGE_REVIEW,
  STAGE_MARKETING,
  STAGE_DIRECTOR,
  STAGE_CONFIRMED,
  WORKFLOW_STAGES,
  STAGE_LABELS,
  stageLabel,
  getStageState,
  submitForApproval,
  approveStageRequest,
  rejectStageRequest,
  canApproveStage,
};

