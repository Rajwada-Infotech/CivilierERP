const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { validateBody } = require("../middleware/validateRequest");
const { crmCancellationCreateSchema } = require("../validation/crmCancellationSchemas");
const { actorId, requireUserEmail } = require("../services/saAccess");

const { getNextDocNumber } = require("../services/docNumber");
const { applyPagination } = require("../services/crmListPagination");
// Approve/reject is gated to admin/super_admin/marketing_head via this shared
// engine — same mechanism BOQ/Purchase Orders/etc. use — instead of any
// editor being able to self-approve a cancellation/refund on this page.
const { transition: approvalTransition } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { releaseAllParkingForBooking } = require("./crmParking");
const { emitNotification } = require("../services/notify");
const { getIo } = require("../socket");
const { findActiveHold, releaseHold } = require("../services/crmHoldService");
const { syncApplicationOnBookingTerminal } = require("../services/crmApplicationWorkflow");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// The set of company banks THIS booking's real payments actually landed in
// (milestone receipts + on-account deposits, wherever DepositBankId is set).
// Feeds the refund's own bank default: "the same account, same" only makes
// sense to auto-apply when every payment agrees on one bank — a booking
// whose milestones landed across more than one company bank has no single
// "same account" answer, so the frontend forces an explicit pick instead of
// guessing.
const DEPOSIT_BANKS_FOR_BOOKING = `
  (SELECT r.DepositBankId FROM dbo.CrmPaymentReceipt r
     JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
     WHERE m.BookingId = b.Id AND r.DepositBankId IS NOT NULL
   UNION ALL
   SELECT DepositBankId FROM dbo.CrmOnAccountPayment WHERE BookingId = b.Id AND DepositBankId IS NOT NULL) x
`;

// The single hard fallback deduction % when no CrmCancellationPolicy slab
// matches. It was read from an AppSetting row, but dbo.AppSetting does not
// exist in every deployment — the raw query threw, 500-ing /policy and
// POST / for any project without a configured slab (and the intended 10%
// default was never reached). Now: try the setting, fall back to 10 on any
// failure (missing table included).
async function resolveDefaultDeductionPct(pool) {
  try {
    const r = await pool.request()
      .query("SELECT TOP 1 Value FROM dbo.AppSetting WHERE [Key] = 'CancellationDefaultPct'");
    return r.recordset.length ? (parseFloat(r.recordset[0].Value) || 10) : 10;
  } catch {
    return 10;
  }
}

const CANCEL_SELECT = `
  SELECT
    c.Id, c.CancellationNo, c.BookingId, c.RequestedDate, c.Reason, c.AmountPaidTillDate,
    c.DeductionPercent, c.DeductionAmount, c.RefundAmount, c.Status,
    c.RequestedBy, c.ApprovedBy, c.ApprovedAt, c.RefundDate, c.RefundMode,
    c.RefundRef, c.RefundBankId, c.Notes, c.CreatedAt, c.UpdatedAt,
    b.BookingNo,
    COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
    COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
    b.ProjectId, b.TotalValue, b.AssignedTo,
    a.ApplicantName, a.Mobile,
    rb.name AS RequestedByName, ab.name AS ApprovedByName,
    -- Settlement/refund is no longer tracked on CrmCancellation — the money
    -- side moved to the general-purpose Refund page (dbo.CrmRefund). These
    -- are DERIVED for the Cancellations list: the held credit parked at
    -- approval (hc), and the latest linked refund request (lr).
    hc.Id AS HeldOnAccountId, hc.Amount AS HeldAmount, hc.AppliedAmount AS HeldApplied,
    lr.Id AS RefundId, lr.RefundNo, lr.Status AS RefundStatus,
    lr.NetAmount AS RefundNetAmount, lr.RefundDueDate,
    CASE
      WHEN hc.Id IS NULL THEN NULL
      WHEN hc.Status = 'Applied' OR hc.AppliedAmount >= hc.Amount THEN 'Settled'
      ELSE 'RefundPending'
    END AS SettlementStatus,
    CASE
      WHEN lr.RefundDueDate IS NOT NULL AND ISNULL(lr.Status,'') <> 'Paid'
           AND CAST(SYSDATETIME() AS DATE) > lr.RefundDueDate
      THEN 1 ELSE 0
    END AS IsRefundOverdue,
    CASE
      WHEN lr.RefundDueDate IS NOT NULL AND ISNULL(lr.Status,'') <> 'Paid'
      THEN DATEDIFF(day, CAST(SYSDATETIME() AS DATE), lr.RefundDueDate)
      ELSE NULL
    END AS RefundDaysRemaining,
    (SELECT COUNT(DISTINCT x.DepositBankId) FROM ${DEPOSIT_BANKS_FOR_BOOKING}) AS DistinctDepositBankCount,
    (SELECT TOP 1 x.DepositBankId FROM ${DEPOSIT_BANKS_FOR_BOOKING}) AS SingleDepositBankId
  FROM dbo.CrmCancellation c
  JOIN  dbo.CrmBooking b     ON b.Id = c.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.Users rb ON rb.id = c.RequestedBy
  LEFT JOIN dbo.Users ab ON ab.id = c.ApprovedBy
  OUTER APPLY (
    SELECT TOP 1 oa.Id, oa.Amount, oa.AppliedAmount, oa.Status
    FROM dbo.CrmOnAccountPayment oa
    WHERE oa.HeldSourceType = 'Cancellation' AND oa.HeldSourceRefId = c.Id
    ORDER BY oa.Id DESC
  ) hc
  OUTER APPLY (
    SELECT TOP 1 r.Id, r.RefundNo, r.Status, r.NetAmount, r.RefundDueDate
    FROM dbo.CrmRefund r
    WHERE r.SourceCancellationId = c.Id
    ORDER BY r.Id DESC
  ) lr
`;

// GET /policy — returns the applicable cancellation penalty slab for a given
// project and booking date. Called by the frontend when a booking is selected
// in the Request Cancellation dialog so staff see the policy before submitting.
//
// Priority:  1. Project-specific slab (ProjectId = bookingId's project)
//            2. Global slab (ProjectId IS NULL)
//            3. AppSetting 'CancellationDefaultPct' (single hard fallback)
//            4. 10 % if nothing is configured at all
//
// The "days since booking" calculation uses today's date vs. BookingDate so
// the slab shown is the one that will actually apply at submission time.
router.get("/policy", requirePageRight("crm-cancellations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId } = req.query;
    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

    const bkgRow = await pool.request().input("bid", sql.Int, parseInt(bookingId))
      .query("SELECT ProjectId, BookingDate FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
    if (!bkgRow.recordset.length) return res.status(404).json({ error: "Booking not found or not eligible for cancellation" });

    const { ProjectId, BookingDate } = bkgRow.recordset[0];
    const daysSince = BookingDate
      ? Math.floor((Date.now() - new Date(BookingDate).getTime()) / 86_400_000)
      : 0;

    // Find the matching slab: project-specific first, then global (NULL).
    // A slab matches when daysSince >= Min AND (Max IS NULL OR daysSince <= Max).
    const slabRes = await pool.request()
      .input("pid", sql.Int, ProjectId || null)
      .input("days", sql.Int, daysSince)
      .query(`
        SELECT TOP 1
          Id, ProjectId, PolicyName, DaysFromBookingMin, DaysFromBookingMax,
          DeductionPercent, Notes
        FROM dbo.CrmCancellationPolicy
        WHERE IsActive = 1
          AND @days >= DaysFromBookingMin
          AND (DaysFromBookingMax IS NULL OR @days <= DaysFromBookingMax)
          AND (ProjectId = @pid OR ProjectId IS NULL)
        ORDER BY
          CASE WHEN ProjectId = @pid THEN 0 ELSE 1 END,  -- project-specific wins
          DaysFromBookingMin DESC                          -- most restrictive slab first
      `);

    if (slabRes.recordset.length) {
      return res.json({ ...slabRes.recordset[0], daysSinceBooking: daysSince, source: "policy" });
    }

    // No slab configured — fall back to the app default (10% if unset).
    const fallbackPct = await resolveDefaultDeductionPct(pool);
    return res.json({ DeductionPercent: fallbackPct, daysSinceBooking: daysSince, source: "default" });
  } catch (e) {
    console.error("[crm-cancellations] GET /policy error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// GET / — all cancellation requests
router.get("/", requirePageRight("crm-cancellations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("c.Status = @st"); }
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
    if (blockId) { req0.input("blockId", sql.Int, blockId); conds.push("um.BlockId = @blockId"); }
    if (search) {
      req0.input("search", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @search OR b.BookingNo LIKE @search OR c.CancellationNo LIKE @search)");
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const SELECT_WITH_BLOCK = `${CANCEL_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId`;

    if (!req.query.page) {
      const result = await req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY c.CreatedAt DESC`);
      return res.json(result.recordset);
    }

    const { page, pageSize, offset } = applyPagination(req);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const [result, countResult] = await Promise.all([
      req0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY c.CreatedAt DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      pool.request()
        .input("st2", sql.NVarChar(30), status || null)
        .input("companyId2", sql.Int, companyId)
        .input("projectId2", sql.Int, projectId)
        .input("blockId2", sql.Int, blockId)
        .input("search2", sql.NVarChar(200), search ? `%${search}%` : null)
        .query(`
          SELECT COUNT(*) AS total
          FROM dbo.CrmCancellation c
          JOIN dbo.CrmBooking b ON b.Id = c.BookingId
          JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
          WHERE (@st2 IS NULL OR c.Status = @st2)
            AND (@companyId2 IS NULL OR b.CompanyId = @companyId2)
            AND (@projectId2 IS NULL OR b.ProjectId = @projectId2)
            AND (@blockId2 IS NULL OR um.BlockId = @blockId2)
            AND (@search2 IS NULL OR (a.ApplicantName LIKE @search2 OR b.BookingNo LIKE @search2 OR c.CancellationNo LIKE @search2))
        `),
    ]);
    res.json({ rows: result.recordset, total: countResult.recordset[0].total, page, pageSize });
  } catch (e) {
    console.error("[crm-cancellations] GET error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// POST / — request a cancellation; auto-computes refund from paid milestones
//
// Workflow guard: once the sales deed is Registered, the unit is legally
// conveyed — a simple refund-and-release cancellation is no longer the
// correct instrument (that needs a formal deed-cancellation/deed-of-
// rescission process, not this flow). Blocked here rather than silently
// letting staff "cancel" a booking whose title has already legally passed.
router.post("/", requirePageRight("crm-cancellations", "create"), validateBody(crmCancellationCreateSchema), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId);

    const activeErr = await requireActiveBooking(pool, bookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Explicit duplicate guard — clearer error than relying on a DB UNIQUE catch.
    const existingCancel = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT TOP 1 CancellationNo, Status FROM dbo.CrmCancellation WHERE BookingId = @bid AND Status NOT IN ('Rejected')");
    if (existingCancel.recordset.length) {
      const ex = existingCancel.recordset[0];
      return res.status(409).json({ error: `A cancellation request (${ex.CancellationNo}) already exists for this booking and is currently ${ex.Status}` });
    }

    const deed = await pool.request().input("bid", sql.Int, bookingId)
      .query(`SELECT TOP 1 Status FROM dbo.CrmSalesDeed WHERE BookingId = @bid ORDER BY CreatedAt DESC`);
    if (deed.recordset.length && deed.recordset[0].Status === CrmStatus.REGISTERED) {
      return res.status(400).json({ error: "This booking's sales deed is already Registered — a legal deed-cancellation process is required, not a standard cancellation request" });
    }

    const paidRes = await pool.request().input("bid", sql.Int, bookingId)
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) +
          (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount,0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS TotalPaid
      `);
    const totalPaid = paidRes.recordset[0].TotalPaid || 0;

    // Determine the deduction %:
    //   1. If the requester explicitly passes DeductionPercent, validate and use it
    //      (admin override — still capped 0-100 to prevent typos or malicious values)
    //   2. Otherwise auto-look up the matching slab from CrmCancellationPolicy
    //      (project-specific first, global default second)
    //   3. Final fallback: AppSetting 'CancellationDefaultPct', then 10%
    let deductionPct;
    if (b.DeductionPercent != null && String(b.DeductionPercent).trim() !== "") {
      deductionPct = parseFloat(b.DeductionPercent);
      if (!Number.isFinite(deductionPct) || deductionPct < 0 || deductionPct > 100) {
        return res.status(400).json({ error: "DeductionPercent must be a number between 0 and 100" });
      }
    } else {
      // Auto-resolve from policy
      const bkgMeta = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ProjectId, BookingDate FROM dbo.CrmBooking WHERE Id = @bid");
      const { ProjectId: pId, BookingDate } = bkgMeta.recordset[0] || {};
      const daysSince = BookingDate
        ? Math.floor((Date.now() - new Date(BookingDate).getTime()) / 86_400_000)
        : 0;
      const policyRes = await pool.request()
        .input("pid", sql.Int, pId || null).input("days", sql.Int, daysSince)
        .query(`
          SELECT TOP 1 DeductionPercent FROM dbo.CrmCancellationPolicy
          WHERE IsActive = 1
            AND @days >= DaysFromBookingMin
            AND (DaysFromBookingMax IS NULL OR @days <= DaysFromBookingMax)
            AND (ProjectId = @pid OR ProjectId IS NULL)
          ORDER BY CASE WHEN ProjectId = @pid THEN 0 ELSE 1 END, DaysFromBookingMin DESC
        `);
      if (policyRes.recordset.length) {
        deductionPct = Number(policyRes.recordset[0].DeductionPercent);
      } else {
        deductionPct = await resolveDefaultDeductionPct(pool);
      }
    }
    // The resolved deduction % is REMEMBERED on the request but NOT taken now.
    // The full paid amount is what gets parked as 'Held' credit on approval;
    // the deduction is only applied later, and only if the customer chooses a
    // refund (not a re-booking) — that logic lives on the Refund page
    // (dbo.CrmRefund). So AmountPaidTillDate = RefundAmount = gross, and
    // DeductionAmount stays 0 on the cancellation record.
    const cancellationNo = await getNextDocNumber(pool, "CXL", "CXL");

    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  cancellationNo)
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("reason",sql.NVarChar(sql.MAX), b.Reason || null)
      .input("paid",  sql.Decimal(18,2), totalPaid)
      .input("dpct",  sql.Decimal(5,2),  deductionPct)
      .input("damt",  sql.Decimal(18,2), 0)
      .input("ramt",  sql.Decimal(18,2), totalPaid)
      .input("rb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCancellation
          (CancellationNo, BookingId, Reason, AmountPaidTillDate, DeductionPercent, DeductionAmount, RefundAmount, Status, RequestedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @reason, @paid, @dpct, @damt, @ramt, 'Pending', @rb, SYSDATETIME())
      `);

    res.status(201).json({
      success: true, id: result.recordset[0].Id, CancellationNo: cancellationNo,
      totalPaid, deductionAmt: 0, refundAmt: totalPaid,
    });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A cancellation request already exists for this booking" });
    console.error("[crm-cancellations] POST error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id — edit notes only. Status is never settable here — Approved/
// Rejected go through the endpoints below. The money side (refund/settlement)
// now lives on dbo.CrmRefund (the Refunds page), not on this record.
// Blocked once the cancellation is Approved — its held credit and linked
// refund are already in flight; notes shouldn't be quietly rewritable then.
router.put("/:id", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if ([CrmStatus.APPROVED, "Cancelled"].includes(cur.recordset[0].Status)) {
      return res.status(400).json({ error: "This cancellation is already approved — its held credit and refund are in flight; notes can no longer be edited here" });
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .query("UPDATE dbo.CrmCancellation SET Notes = ISNULL(@notes, Notes), UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-cancellations] PUT error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/submit — Rejected -> Pending (resubmit)
router.put("/:id/submit", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-cancellations", id, CrmStatus.PENDING, userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/marketing_head only, enforced inside
// approvalTransition(). On approval:
//   1. Refund figures are recomputed fresh (AmountPaidTillDate/DeductionAmount/
//      RefundAmount were frozen at request time — if a payment landed on the
//      booking while the request sat Pending, that would otherwise be
//      silently absorbed into the refund liability without ever updating
//      the record). Never blocks approval, just corrects the numbers.
//   2. The underlying booking is cancelled. Status='Cancelled' is what every
//      active-workflow dropdown now excludes by default (see crmBookings.js
//      GET /) — IsActive is deliberately left alone since it's an orthogonal
//      soft-delete flag used elsewhere, not a cancellation signal.
//   3. Every parking slot allotted to this booking is released back to
//      available inventory (previously a permanent leak — nothing released
//      a cancelled booking's parking).
//   4. Any pending CrmBookingAmendmentRequest for this booking is
//      auto-rejected — approving one after the booking is cancelled would
//      otherwise create a live Extra Charge/Parking allotment on a dead
//      booking (the requireActiveBooking() guards added to those apply*
//      functions would now reject it anyway, but leaving the request
//      dangling forever as "Pending" is its own kind of clutter/confusion).
router.put("/:id/approve", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();

    // ── Pre-transaction reads ────────────────────────────────────────────────
    // These reads inform the transaction but do not themselves need to be
    // atomic with the writes — the UPDLOCK inside approvalTransition's own
    // internal transaction is what prevents concurrent double-approvals.
    const before = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, CancellationNo, AmountPaidTillDate, DeductionPercent, Notes FROM dbo.CrmCancellation WHERE Id = @id");
    if (!before.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    const { BookingId: bookingId, CancellationNo: cancellationNo, AmountPaidTillDate: staleAmountPaid, DeductionPercent: deductionPct, Notes: existingNotes } = before.recordset[0];

    const freshPaidRes = await pool.request().input("bid", sql.Int, bookingId)
      .query(`
        SELECT
          (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) +
          (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount,0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid AND ISNULL(Status,'') <> 'Held') AS TotalPaid
      `);
    const freshTotalPaid = freshPaidRes.recordset[0].TotalPaid || 0;

    // Context for the held-credit row + the auto-created draft CrmRefund.
    const ctxRes = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT b.CompanyId, b.ProjectId, a.CustomerId,
             (SELECT TOP 1 BankName    FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid ORDER BY Id DESC) AS BankName,
             (SELECT TOP 1 AccountNo   FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid ORDER BY Id DESC) AS AccountNo,
             (SELECT TOP 1 IfscCode    FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid ORDER BY Id DESC) AS IfscCode
      FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE b.Id = @bid
    `);
    const ctx = ctxRes.recordset[0] || {};
    const refundNo = ctx.CustomerId ? await getNextDocNumber(pool, "CRFD", "CRFD") : null;

    // approvalTransition has its own internal transaction and locking — it must
    // run on pool (not on a tx object) BEFORE we open our own transaction.
    // It enforces role-based access and status-machine guards; if it rejects,
    // we bail before touching any other table.
    const result = await approvalTransition("crm-cancellations", id, CrmStatus.APPROVED, userEmail, req.user?.role);

    // Multi-level approval workflows: approvalTransition returns newStatus
    // 'Pending' (not 'Approved') until the FINAL level signs off. The whole
    // booking-cancellation cascade below — cancel booking, reject receipts,
    // release parking, void brokerage, stamp the RERA refund date — must run
    // ONLY on that final approval. A first-level approve on a multi-step
    // workflow previously fell straight through and cancelled the booking
    // while the request itself was still mid-chain.
    if (result.newStatus !== CrmStatus.APPROVED) {
      return res.json({ success: true, status: result.newStatus });
    }

    // ── BEGIN ATOMIC SECTION ─────────────────────────────────────────────────
    // Every downstream state mutation runs inside a single transaction so that
    // a transient DB error in any step rolls back ALL preceding writes —
    // no partially-cancelled bookings, no stale parking, no orphaned brokerage.
    //
    // This fixes the non-atomicity bug: previously ~10 independent pool.request()
    // calls ran sequentially without a transaction — a failure at step 5+
    // would leave the booking Cancelled, application synced to terminal, and
    // receipts rejected, while parking/brokerage/amendments remained in their
    // pre-cancellation state with no compensating action and no resume path.
    const tx = pool.transaction();
    await tx.begin();
    // Collect notification payloads to emit AFTER commit (pure websocket —
    // no DB write, so they must not run inside the transaction).
    const pendingNotifications = [];
    try {
      // Re-snapshot the gross paid amount if a payment landed while the request
      // sat Pending. The deduction is NOT taken here anymore — the full paid
      // amount is what gets parked as held credit; deduction only applies later
      // on a refund (see dbo.CrmRefund). So AmountPaidTillDate = RefundAmount =
      // gross, DeductionAmount stays 0 on the cancellation record.
      if (Math.abs(freshTotalPaid - Number(staleAmountPaid || 0)) >= 1) {
        const note = `[Re-snapshotted at approval] Paid amount changed from ₹${Number(staleAmountPaid || 0).toLocaleString("en-IN")} to ₹${freshTotalPaid.toLocaleString("en-IN")} since the request was filed.`;
        await tx.request()
          .input("id", sql.Int, id)
          .input("paid", sql.Decimal(18, 2), freshTotalPaid)
          .input("notes", sql.NVarChar(sql.MAX), existingNotes ? `${existingNotes}\n${note}` : note)
          .query(`
            UPDATE dbo.CrmCancellation SET
              AmountPaidTillDate = @paid, RefundAmount = @paid, DeductionAmount = 0,
              Notes = @notes, UpdatedAt = SYSDATETIME()
            WHERE Id = @id
          `);
      }

      // The generic approvalTransition() engine only ever writes the Status
      // column — ApprovedBy/ApprovedAt exist on this table but were never
      // populated by anything, permanently NULL despite CANCEL_SELECT joining
      // them in as ApprovedByName. Set explicitly here rather than changing
      // the shared engine (which every other approval-gated CRM module also
      // uses, with its own column-naming conventions).
      await tx.request().input("id", sql.Int, id).input("ab", sql.Int, actorId(req))
        .query("UPDATE dbo.CrmCancellation SET ApprovedBy = @ab, ApprovedAt = SYSDATETIME() WHERE Id = @id");

      // The cancellation workflow ends at 'Approved'. The MONEY side (finance
      // approval, disbursement, RERA timer) no longer lives here — it moved to
      // the general-purpose Refund page (dbo.CrmRefund). This handler parks the
      // full paid amount as a 'Held' on-account credit and auto-creates a
      // linked draft CrmRefund below; staff then either refund it or apply it
      // to a re-booking from /crm/refunds.

      await tx.request().input("bid", sql.Int, bookingId)
        .query("UPDATE dbo.CrmBooking SET Status = 'Cancelled', UpdatedAt = SYSDATETIME() WHERE Id = @bid");

      // The Application was force-advanced to 'Approved' the instant this
      // Booking was created and nothing has touched it since — without this,
      // it would sit at 'Approved' forever with a Cancelled Booking
      // underneath, indistinguishable from a genuinely active sale.
      await syncApplicationOnBookingTerminal(tx, bookingId, CrmStatus.CANCELLED, "BookingCancelled",
        "Application cancelled — its booking was cancelled", actorId(req));

      // Reject any money receipts still in Pending verification — without this a
      // bank teller could later verify and credit the payment to a dead booking,
      // overstating the refund liability and creating a floating unreconciled balance.
      await tx.request().input("bid", sql.Int, bookingId).query(`
        UPDATE dbo.CrmMoneyReceipt
        SET Status = 'Rejected', UpdatedAt = SYSDATETIME()
        WHERE BookingId = @bid AND Status = 'Pending'
      `);

      // Reject any Pending ReceivedPayment rows in Finance's queue — without
      // this a Finance approver can process and post a payment against a
      // cancelled booking (updates milestone AmountPaid, triggers GL, Sales
      // Deed, brokerage auto-create — all against a dead record).
      // NOTE: dbo.ReceivedPayment uses the RP-prefixed column convention
      // (RPUpdatedAt/RPUpdatedBy/RPRejectedAt) — a bare `UpdatedAt` here once
      // threw "Invalid column name 'UpdatedAt'", which rolled back this entire
      // cascade and left the cancellation stuck at Status='Approved' with a
      // still-live booking. Keep the column names exact.
      await tx.request()
        .input("bid", sql.Int, bookingId)
        .input("rb", sql.Int, actorId(req))
        .query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus = 'Rejected', RPRejectedBy = @rb, RPRejectedAt = SYSDATETIME(),
            RPRejectionNote = 'Auto-rejected — booking cancelled',
            RPUpdatedBy = @rb, RPUpdatedAt = SYSDATETIME()
        WHERE CrmBookingId = @bid AND RPStatus = 'Pending'
      `);

      await releaseAllParkingForBooking(tx, bookingId);

      // Orphaned Brokerage Clawback
      // Void any pending brokerage tranches for this cancelled booking, and flag paid ones for clawback.
      await tx.request().input("bid", sql.Int, bookingId).query(`
        UPDATE dbo.CrmBrokerageMaster
        SET Status = '${CrmStatus.VOIDED}', UpdatedAt = SYSDATETIME(), Notes = ISNULL(Notes, '') + char(10) + 'Auto-voided due to booking cancellation.'
        WHERE BookingId = @bid AND Status = '${CrmStatus.PENDING}';

        UPDATE dbo.CrmBrokerageMaster
        SET Status = '${CrmStatus.CLAWBACK_REQUIRED}', UpdatedAt = SYSDATETIME(), Notes = ISNULL(Notes, '') + char(10) + 'Clawback required due to booking cancellation.'
        WHERE BookingId = @bid AND Status = '${CrmStatus.PAID}';
      `);

      // Void any finance payment vouchers (NewPayment) linked to brokerage
      // tranches that were just voided above. Without this, Finance can still
      // see — and process — a live PAY document for a cancelled deal, which is
      // a real cash-outflow risk.
      await tx.request().input("bid", sql.Int, bookingId).query(`
        UPDATE dbo.NewPayment
        SET Status = 'Rejected', UpdatedAt = SYSDATETIME()
        WHERE SourceCrmBrokerageId IN (
          SELECT Id FROM dbo.CrmBrokerageMaster WHERE BookingId = @bid
        )
        AND Status NOT IN ('Paid', 'Rejected', 'Deleted')
      `);

      // guardAndConvertHold() closes the Unit's hold to 'Converted' the moment
      // a Booking is created from it — but if an Active hold on this same unit
      // still lingers for any reason (e.g. legacy data from before that
      // conversion existed), a Cancelled booking must not leave it standing:
      // that would keep blocking every other genuinely current applicant for
      // a unit that just became free again.
      const unitRow = await tx.request().input("bid", sql.Int, bookingId)
        .query("SELECT UnitId FROM dbo.CrmBooking WHERE Id = @bid");
      const unitId = unitRow.recordset[0]?.UnitId;
      if (unitId) {
        const stuckHold = await findActiveHold(tx, "Unit", unitId);
        if (stuckHold) await releaseHold(tx, stuckHold.Id, actorId(req));
      }

      const pendingAmendments = await tx.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id, RequestedBy FROM dbo.CrmBookingAmendmentRequest WHERE BookingId = @bid AND Status = 'Pending'");
      for (const amend of pendingAmendments.recordset) {
        await tx.request().input("id", sql.Int, amend.Id).input("rb", sql.Int, actorId(req))
          .query(`
            UPDATE dbo.CrmBookingAmendmentRequest SET
              Status = '${CrmStatus.REJECTED}', ReviewedBy = @rb, ReviewedAt = SYSDATETIME(),
              ReviewNotes = 'Auto-rejected — the booking was cancelled'
            WHERE Id = @id
          `);
        // Defer websocket notification until after commit — emitNotification is
        // a pure outbound push (no DB write) and must not run inside a tx.
        if (amend.RequestedBy) {
          pendingNotifications.push({ userId: amend.RequestedBy, amendId: amend.Id });
        }
      }

      // ── Park the money as HELD on-account credit ─────────────────────────
      // The full paid amount (milestone receipts + any existing unapplied
      // on-account) is consolidated into ONE CrmOnAccountPayment row with
      // Status='Held', keyed back to this cancellation. NO GL is posted — the
      // customer ledger head already carries this liability from the original
      // receipts; the hold is a pure CRM tracking record. The ledgers move
      // only when the held credit is later refunded or applied to a re-booking.
      const heldTotal = Number(freshTotalPaid) || 0;
      let heldRowId = null;
      if (heldTotal > 0) {
        // Fold the booking's still-open on-account rows into the hold so they
        // aren't double-counted (their money is now represented by the Held row).
        await tx.request().input("bid", sql.Int, bookingId)
          .query(`
            UPDATE dbo.CrmOnAccountPayment
            SET AppliedAmount = Amount, Status = 'Applied',
                Notes = ISNULL(Notes,'') + char(10) + 'Rolled into held credit on booking cancellation.'
            WHERE BookingId = @bid AND ISNULL(Status,'') IN ('Unapplied','PartiallyApplied')
          `);
        const heldIns = await tx.request()
          .input("no", sql.NVarChar(30), cancellationNo ? `${cancellationNo}-HOLD` : null)
          .input("bid", sql.Int, bookingId)
          .input("amt", sql.Decimal(18, 2), heldTotal)
          .input("cid", sql.Int, id)
          .input("cb", sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmOnAccountPayment
              (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode,
               Notes, HeldFromBookingId, HeldSourceType, HeldSourceRefId, HeldAt, CreatedBy, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES
              (@no, @bid, @amt, 0, 'Held', CAST(SYSDATETIME() AS DATE), 'HeldCredit',
               'Held credit from cancelled booking — refund or apply to a re-booking from the Refunds page.',
               @bid, 'Cancellation', @cid, SYSDATETIME(), @cb, SYSDATETIME())
          `);
        heldRowId = heldIns.recordset[0].Id;
      }

      // ── Auto-create the linked draft CrmRefund ───────────────────────────
      // RERA Section 18: 45 days from cancellation approval. The deduction %
      // resolved at request time is carried onto the refund; it only bites if
      // the customer takes a refund (a re-booking waives it entirely).
      if (heldRowId && ctx.CustomerId && refundNo) {
        const pct = Number(deductionPct) || 0;
        const damt = Math.round(heldTotal * pct / 100 * 100) / 100;
        const net = Math.max(0, heldTotal - damt);
        await tx.request()
          .input("rno", sql.NVarChar(30), refundNo)
          .input("cust", sql.Int, ctx.CustomerId)
          .input("comp", sql.Int, ctx.CompanyId ?? null)
          .input("proj", sql.Int, ctx.ProjectId ?? null)
          .input("bid", sql.Int, bookingId)
          .input("held", sql.Int, heldRowId)
          .input("cid", sql.Int, id)
          .input("gross", sql.Decimal(18, 2), heldTotal)
          .input("pct", sql.Decimal(5, 2), pct)
          .input("damt", sql.Decimal(18, 2), damt)
          .input("net", sql.Decimal(18, 2), net)
          .input("cbank", sql.NVarChar(200), ctx.BankName || null)
          .input("cacc", sql.NVarChar(50), ctx.AccountNo || null)
          .input("cifsc", sql.NVarChar(20), ctx.IfscCode || null)
          .input("due", sql.Date, new Date(Date.now() + 45 * 86400000))
          .input("rb", sql.Int, actorId(req))
          .query(`
            INSERT INTO dbo.CrmRefund
              (RefundNo, CustomerId, CompanyId, ProjectId, BookingId, SourceType,
               SourceOnAccountId, SourceCancellationId, GrossAmount, DeductionPercent,
               DeductionAmount, NetAmount, CustomerBankName, CustomerAccountNo, CustomerIfscCode,
               Status, RefundDueDate, RequestedBy, RequestedAt, CreatedBy, CreatedAt)
            VALUES
              (@rno, @cust, @comp, @proj, @bid, 'CancellationHeldCredit',
               @held, @cid, @gross, @pct,
               @damt, @net, @cbank, @cacc, @cifsc,
               'Draft', @due, @rb, SYSDATETIME(), @rb, SYSDATETIME())
          `);
      }

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      // approvalTransition already committed Status='Approved' on its own
      // transaction before this block opened. The downstream cascade just
      // rolled back, so the booking was NOT actually cancelled and NO held
      // credit / draft refund was created — walk the request back to 'Pending'
      // so it can be retried cleanly from a consistent state.
      try {
        await pool.request().input("id", sql.Int, id).query(
          "UPDATE dbo.CrmCancellation SET Status = 'Pending', UpdatedAt = SYSDATETIME() WHERE Id = @id AND Status = 'Approved'",
        );
      } catch (compErr) {
        console.error("[crm-cancellations] approve compensation failed:", compErr.message);
      }
      throw txErr;
    }
    // ── END ATOMIC SECTION ───────────────────────────────────────────────────

    // Post-commit: fire websocket notifications for auto-rejected amendments.
    // These are pure outbound pushes — no DB write — so they're safe outside
    // the transaction and correct to skip if the transaction failed.
    for (const n of pendingNotifications) {
      try {
        await emitNotification(pool, n.userId, "crm_booking_amendment_rejected",
          "Amendment Request Auto-Rejected",
          "Your requested change was auto-rejected because the booking was cancelled.",
          n.amendId, "crm_booking_amendment");
      } catch (notifyErr) {
        console.error("[crm-cancellations] amendment notification failed:", notifyErr.message);
      }
    }

    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});


// PUT /:id/reject — admin/super_admin/marketing_head only.
router.put("/:id/reject", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-cancellations", id, CrmStatus.REJECTED, userEmail, req.user?.role, req.body?.note || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-cancellations] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});


module.exports = router;
