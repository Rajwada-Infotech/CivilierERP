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
// Approve/reject is gated to admin/super_admin/marketing_head via this shared
// engine — same mechanism BOQ/Purchase Orders/etc. use — instead of any
// editor being able to self-approve a cancellation/refund on this page.
const { transition: approvalTransition, recordGLPosting } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { postCrmCancellationRefundToGL } = require("../services/crmLedger");
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
    c.SettlementStatus, c.RefundDueDate, c.SettledAt, c.SettledBy, c.SettlementNotes,
    sb.name AS SettledByName,
    CASE
      WHEN c.RefundDueDate IS NOT NULL AND c.SettlementStatus = 'RefundPending'
           AND CAST(SYSDATETIME() AS DATE) > c.RefundDueDate
      THEN 1 ELSE 0
    END AS IsRefundOverdue,
    CASE
      WHEN c.RefundDueDate IS NOT NULL AND c.SettlementStatus = 'RefundPending'
      THEN DATEDIFF(day, CAST(SYSDATETIME() AS DATE), c.RefundDueDate)
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
  LEFT JOIN dbo.Users sb ON sb.id = c.SettledBy
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
      .query("SELECT ProjectId, BookingDate FROM dbo.CrmBooking WHERE Id = @bid AND IsActive = 1");
    if (!bkgRow.recordset.length) return res.status(404).json({ error: "Booking not found" });

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

    // No slab configured — fall back to AppSetting
    const settingRes = await pool.request()
      .query("SELECT TOP 1 Value FROM dbo.AppSetting WHERE [Key] = 'CancellationDefaultPct'");
    const fallbackPct = settingRes.recordset.length
      ? parseFloat(settingRes.recordset[0].Value) || 10
      : 10;
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
    const { status, companyId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("c.Status = @st"); }
    if (companyId) { req0.input("companyId", sql.Int, parseInt(companyId, 10)); conds.push("b.CompanyId = @companyId"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${CANCEL_SELECT} ${where} ORDER BY c.CreatedAt DESC`);
    res.json(result.recordset);
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
        const settingRes = await pool.request()
          .query("SELECT TOP 1 Value FROM dbo.AppSetting WHERE [Key] = 'CancellationDefaultPct'");
        deductionPct = settingRes.recordset.length
          ? parseFloat(settingRes.recordset[0].Value) || 10
          : 10;
      }
    }
    const deductionAmt = Math.round(totalPaid * deductionPct / 100 * 100) / 100;
    const refundAmt = Math.max(0, totalPaid - deductionAmt);
    const cancellationNo = await getNextDocNumber(pool, "CXL", "CXL");

    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  cancellationNo)
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("reason",sql.NVarChar(sql.MAX), b.Reason || null)
      .input("paid",  sql.Decimal(18,2), totalPaid)
      .input("dpct",  sql.Decimal(5,2),  deductionPct)
      .input("damt",  sql.Decimal(18,2), deductionAmt)
      .input("ramt",  sql.Decimal(18,2), refundAmt)
      .input("rb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmCancellation
          (CancellationNo, BookingId, Reason, AmountPaidTillDate, DeductionPercent, DeductionAmount, RefundAmount, Status, RequestedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @reason, @paid, @dpct, @damt, @ramt, 'Pending', @rb, SYSDATETIME())
      `);

    res.status(201).json({
      success: true, id: result.recordset[0].Id, CancellationNo: cancellationNo,
      totalPaid, deductionAmt, refundAmt,
    });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A cancellation request already exists for this booking" });
    console.error("[crm-cancellations] POST error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id — edit notes only. Status is never settable here — Approved/
// Rejected go through the endpoints below, Refunded through /:id/mark-refunded.
// Blocked once Refunded — that's the final, GL-posted state; the notes on a
// completed refund shouldn't be quietly rewritable afterward.
router.put("/:id", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query("SELECT Status FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status === CrmStatus.REFUNDED) {
      return res.status(400).json({ error: "This cancellation has already been refunded — notes can no longer be edited" });
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
      .query("SELECT BookingId, AmountPaidTillDate, DeductionPercent, Notes FROM dbo.CrmCancellation WHERE Id = @id");
    if (!before.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    const { BookingId: bookingId, AmountPaidTillDate: staleAmountPaid, DeductionPercent: deductionPct, Notes: existingNotes } = before.recordset[0];

    const freshPaidRes = await pool.request().input("bid", sql.Int, bookingId)
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) +
          (SELECT ISNULL(SUM(Amount - ISNULL(AppliedAmount,0)), 0) FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid) AS TotalPaid
      `);
    const freshTotalPaid = freshPaidRes.recordset[0].TotalPaid || 0;

    // approvalTransition has its own internal transaction and locking — it must
    // run on pool (not on a tx object) BEFORE we open our own transaction.
    // It enforces role-based access and status-machine guards; if it rejects,
    // we bail before touching any other table.
    const result = await approvalTransition("crm-cancellations", id, CrmStatus.APPROVED, userEmail, req.user?.role);

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
      // Recompute refund figures if a payment landed while the request sat Pending.
      if (Math.abs(freshTotalPaid - Number(staleAmountPaid || 0)) >= 1) {
        const deductionAmt = Math.round(freshTotalPaid * deductionPct / 100 * 100) / 100;
        const refundAmt = Math.max(0, freshTotalPaid - deductionAmt);
        const note = `[Auto-recomputed at approval] Paid amount changed from ₹${Number(staleAmountPaid || 0).toLocaleString("en-IN")} to ₹${freshTotalPaid.toLocaleString("en-IN")} since the request was filed — refund figures updated accordingly.`;
        await tx.request()
          .input("id", sql.Int, id)
          .input("paid", sql.Decimal(18, 2), freshTotalPaid)
          .input("damt", sql.Decimal(18, 2), deductionAmt)
          .input("ramt", sql.Decimal(18, 2), refundAmt)
          .input("notes", sql.NVarChar(sql.MAX), existingNotes ? `${existingNotes}\n${note}` : note)
          .query(`
            UPDATE dbo.CrmCancellation SET
              AmountPaidTillDate = @paid, DeductionAmount = @damt, RefundAmount = @ramt,
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

      // ── Maker-Checker Finance Gate ────────────────────────────────────────
      // Sales/marketing approval confirms the cancellation is commercially
      // valid. Finance approval (below, /:id/finance-approve) is the second,
      // independent gate that clears the actual cash disbursement. We flip the
      // status to FinancePending immediately after the approvalTransition commit
      // so the refund cannot be recorded until a finance-authorised user
      // explicitly approves it — preventing any editor from triggering a cash
      // outflow unilaterally. Operational side-effects (booking cancellation,
      // parking release, brokerage clawback) happen here at sales-approval time
      // since they are commercial decisions, not financial ones.
      if (result.newStatus === CrmStatus.APPROVED) {
        await tx.request().input("id", sql.Int, id)
          .query("UPDATE dbo.CrmCancellation SET Status = 'FinancePending', UpdatedAt = SYSDATETIME() WHERE Id = @id");
      }

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
      await tx.request().input("bid", sql.Int, bookingId).query(`
        UPDATE dbo.ReceivedPayment
        SET RPStatus = 'Rejected', UpdatedAt = SYSDATETIME()
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

      // RERA Section 18: promoter must refund within 45 days. Stamp the due date
      // now so finance dashboards and overdue escalation queries can check it.
      // If RefundAmount = 0 (full forfeiture), there is nothing to refund —
      // mark as ForfeitureDocumented immediately so the pool shows it as settled.
      const finalAmts = await tx.request().input("id", sql.Int, id)
        .query("SELECT RefundAmount FROM dbo.CrmCancellation WHERE Id = @id");
      const refundAmt = Number(finalAmts.recordset[0]?.RefundAmount || 0);
      const newSettlementStatus = refundAmt === 0 ? "ForfeitureDocumented" : "RefundPending";
      await tx.request()
        .input("id",  sql.Int, id)
        .input("ss",  sql.NVarChar(30), newSettlementStatus)
        .input("rdd", sql.Date, refundAmt > 0 ? new Date(Date.now() + 45 * 86400000) : null)
        .query(`
          UPDATE dbo.CrmCancellation SET
            SettlementStatus = @ss,
            RefundDueDate    = @rdd,
            UpdatedAt        = SYSDATETIME()
          WHERE Id = @id
        `);

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
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

    res.json({ success: true, status: result.newStatus === CrmStatus.APPROVED ? "FinancePending" : result.newStatus });
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

// PUT /:id/finance-approve — second gate in the maker-checker refund chain.
// Gated to accounts_head / finance_head / admin / super_admin — i.e. the
// finance authorisation tier that is separate from the CRM/sales approver.
// Moves Status: FinancePending → Approved, which is the gate mark-refunded
// already checks for — so no other route needs to change.
// Records FinanceClearedBy/FinanceClearedAt (if those columns exist) for a
// full audit trail of who cleared the cash disbursement.
const FINANCE_APPROVER_ROLES = ["accounts_head", "finance_head", "admin", "super_admin"];
router.put("/:id/finance-approve", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const actor = actorId(req);
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_APPROVER_ROLES.includes(role)) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can clear refunds for disbursement" });
    }

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, RequestedBy, RefundAmount, BookingId FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status !== CrmStatus.FINANCE_PENDING) {
      return res.status(400).json({ error: `Cannot finance-approve — status must be FinancePending (currently '${cur.recordset[0].Status}')` });
    }

    // Move to Approved — this is the status mark-refunded already requires.
    // Try to write FinanceClearedBy/FinanceClearedAt if those columns exist;
    // degrade gracefully if the migration hasn't been run yet (IGNORE ERRORS).
    try {
      await pool.request().input("id", sql.Int, id).input("ab", sql.Int, actor)
        .query(`
          UPDATE dbo.CrmCancellation SET
            Status = '${CrmStatus.APPROVED}',
            FinanceClearedBy = @ab,
            FinanceClearedAt = SYSDATETIME(),
            UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    } catch {
      // Column may not exist yet — run the migration SQL to add it
      await pool.request().input("id", sql.Int, id)
        .query("UPDATE dbo.CrmCancellation SET Status = 'Approved', UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }

    // Notify the requestor that their refund has been finance-cleared
    const { RequestedBy, RefundAmount } = cur.recordset[0];
    if (RequestedBy) {
      const fmtCurrency = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
      await emitNotification(pool, RequestedBy, "crm_cancellation_finance_approved",
        "Refund Cleared for Disbursement",
        `Your cancellation refund of ${fmtCurrency(RefundAmount)} has been finance-approved and is now cleared for disbursement.`,
        id, "crm_cancellation");
    }

    res.json({ success: true, status: CrmStatus.APPROVED });
  } catch (e) {
    console.error("[crm-cancellations] finance-approve error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/finance-reject — finance head sends the request back to the CRM
// team with a note (e.g. "refund amount mismatch — recalculate"). Moves
// FinancePending back to Pending so sales can revise and re-submit.
router.put("/:id/finance-reject", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_APPROVER_ROLES.includes(role)) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can finance-reject a cancellation" });
    }
    const note = req.body?.note || "Finance rejected — please revise and resubmit";
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, RequestedBy, Notes FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status !== CrmStatus.FINANCE_PENDING) {
      return res.status(400).json({ error: `Cannot finance-reject — status must be FinancePending (currently '${cur.recordset[0].Status}')` });
    }
    const appendedNotes = cur.recordset[0].Notes
      ? `${cur.recordset[0].Notes}\n[Finance Rejection] ${note}`
      : `[Finance Rejection] ${note}`;
    await pool.request().input("id", sql.Int, id).input("notes", sql.NVarChar(sql.MAX), appendedNotes)
      .query("UPDATE dbo.CrmCancellation SET Status = 'Pending', Notes = @notes, UpdatedAt = SYSDATETIME() WHERE Id = @id");

    // Notify the requestor
    if (cur.recordset[0].RequestedBy) {
      await emitNotification(pool, cur.recordset[0].RequestedBy, "crm_cancellation_finance_rejected",
        "Refund Finance-Rejected",
        `Your cancellation refund request was sent back by finance: ${note}`,
        id, "crm_cancellation");
    }
    res.json({ success: true, status: CrmStatus.PENDING });
  } catch (e) {
    console.error("[crm-cancellations] finance-reject error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/mark-refunded — a business action (recording that money actually
// moved), not an approval decision — any editor can do this once Approved.
router.put("/:id/mark-refunded", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;

    const cur = await pool.request().input("id", sql.Int, id)
      .query(`
        SELECT c.Status, b.ProjectId
        FROM dbo.CrmCancellation c
        JOIN dbo.CrmBooking b ON b.Id = c.BookingId
        WHERE c.Id = @id
      `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation request not found" });
    if (cur.recordset[0].Status !== CrmStatus.APPROVED) {
      return res.status(400).json({ error: `Cannot mark refunded — cancellation must be Approved (currently '${cur.recordset[0].Status}')` });
    }

    // Same mandatory-bank rule as every deposit — mirrored for the money
    // going back out. "Same account, same" is only ever a frontend default;
    // the requirement itself doesn't relax just because this is a refund.
    const tagged = await pool.request().input("pid", sql.Int, cur.recordset[0].ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !b.RefundBankId) {
      return res.status(400).json({ error: "Refund bank is required for this project" });
    }

    await pool.request()
      .input("id",    sql.Int,           id)
      .input("rdate", sql.Date,          b.RefundDate || null)
      .input("rmode", sql.NVarChar(50),  b.RefundMode || null)
      .input("rref",  sql.NVarChar(200), b.RefundRef  || null)
      .input("rbank", sql.Int,           b.RefundBankId ? parseInt(b.RefundBankId) : null)
      .input("actor", sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmCancellation SET
          Status = '${CrmStatus.REFUNDED}',
          RefundDate = ISNULL(@rdate, CAST(SYSDATETIME() AS DATE)),
          RefundMode = @rmode, RefundRef = @rref, RefundBankId = @rbank,
          SettlementStatus = 'Settled', SettledAt = SYSDATETIME(), SettledBy = @actor,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Post to the core Finance GL — cash actually paid back to the customer.
    // Never allowed to fail the refund record itself.
    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      const outcome = await postCrmCancellationRefundToGL(pool, id, actorEmail);
      await recordGLPosting("crm-cancellation-refund", id, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-cancellation-refund", id, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-cancellations] mark-refunded error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

// PUT /:id/settle — finance/admin only. Explicitly marks a cancellation as
// settled when there is no cash refund to disburse (full forfeiture, or the
// buyer has acknowledged and agreed). This closes the RERA 45-day loop for
// zero-refund cancellations and moves the record out of the overdue queue.
const SETTLE_ROLES = ["accounts_head", "finance_head", "admin", "super_admin"];
router.put("/:id/settle", requirePageRight("crm-cancellations", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const role = (req.user?.role || "").toLowerCase();
    if (!SETTLE_ROLES.includes(role)) {
      return res.status(403).json({ error: "Only accounts/finance heads or admins can mark a cancellation as settled" });
    }
    const { notes } = req.body || {};
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, SettlementStatus, RefundAmount FROM dbo.CrmCancellation WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Cancellation not found" });
    const { Status, SettlementStatus, RefundAmount } = cur.recordset[0];
    if (!["Approved", "FinancePending", "Refunded"].includes(Status)) {
      return res.status(400).json({ error: `Cannot settle — cancellation must be Approved or FinancePending (currently '${Status}')` });
    }
    if (SettlementStatus === "Settled") {
      return res.status(409).json({ error: "Cancellation is already settled" });
    }
    if (Number(RefundAmount || 0) > 0 && Status !== "Refunded") {
      return res.status(400).json({
        error: "A refund is owed on this cancellation — use mark-refunded to settle it, not manual settle",
      });
    }
    await pool.request()
      .input("id",    sql.Int,          id)
      .input("actor", sql.Int,          actorId(req))
      .input("notes", sql.NVarChar(500), notes ? String(notes).trim() : null)
      .query(`
        UPDATE dbo.CrmCancellation SET
          SettlementStatus = 'Settled',
          SettledAt        = SYSDATETIME(),
          SettledBy        = @actor,
          SettlementNotes  = @notes,
          UpdatedAt        = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, message: "Cancellation marked as settled" });
  } catch (e) {
    console.error("[crm-cancellations] settle error:", e.message);
    res.status(500).json({ error: "An internal error occurred. Please try again later." });
  }
});

module.exports = router;
