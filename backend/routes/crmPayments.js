const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
{ const { crmProjectGuards, crmViaBookingSql } = require("../services/projectScope"); crmProjectGuards(router, { "/on-account/": crmViaBookingSql("CrmOnAccountPayment"), default: crmViaBookingSql("CrmPaymentMilestone") }); }
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");
const { maybeAutoCreateSalesDeed, maybeAutoCreateBrokerage, requireActiveBooking, recalculateRemainingMilestones, syncParkingPaymentStatus } = require("../services/crmWorkflowGuards");
const { postCrmOnAccountToGL, postCrmOnAccountApplied, getGstSplit } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");
const { applyPagination } = require("../services/crmListPagination");
const { areEarlierMilestonesCoveredByOnAccount, getBookingOnAccountCoverage } = require("../services/crmOnAccountCoverage");
const { getBookingFunding, onAccountAvailableSql, onAccountWithAvailableSql } = require("../services/crmPaymentFunding");
const { bulkDemandSchema } = require("../validation/crmBookingSchemas");
const ON_ACCOUNT_AVAILABLE_SQL = onAccountAvailableSql("o");

router.use(apiRateLimit);
router.use(authMiddleware);

// Spec: "BROKER PAYMENT -> NEXT MILESTONE DUE". Business confirmed this should
// be a soft warning, not a hard block (a customer's payment must never be
// refused over unrelated broker bookkeeping) — so this fires alongside the
// milestone being marked Paid rather than gating it. Returns a short string
// for the caller's response (surfaced as a toast) and also drops a proactive
// reminder notification into the bell for whoever registered the brokerage,
// since they're the one who'd action the actual payout.
async function warnIfBrokerUnpaid(pool, bookingId, actorUserId) {
  const br = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id, BrokerName, Status, CreatedBy
    FROM dbo.CrmBrokerageMaster
    WHERE BookingId = @bid AND Status IN ('${CrmStatus.PENDING}', '${CrmStatus.APPROVED}')
    ORDER BY CreatedAt DESC
  `);
  if (!br.recordset.length) return null;
  const row = br.recordset[0];

  const warning = `Broker ${row.BrokerName || ""} has not been fully paid yet (brokerage status: ${row.Status}) — the next milestone is now due regardless, but broker payout is outstanding.`.trim();

  if (row.CreatedBy) {
    await emitNotification(
      pool, row.CreatedBy, "brokerage_payment_reminder",
      "Broker payment still pending",
      warning, row.Id, "crm-brokerage",
    );
  }
  return warning;
}

// Core apply function — shared by PUT /on-account/:id/apply (manual staff
// adjustment) and autoApplyOnAccount (utility for bulk adjustment). Applies
// part or all of one on-account deposit's remaining balance to one milestone,
// enforcing sequencing (earlier milestones must be Paid/Waived first), locking
// both rows in a transaction to prevent concurrent double-application.
// Returns { error } on failure, or { applied, remaining, becamePaid } on success.
async function applyOnAccountToMilestone(pool, { onAccountId, milestoneId, amount, actorUserId, actorEmail, source = "manual" }) {
  // Fast validation reads, outside any lock — these don't need serialising
  // against a concurrent apply (booking-active and milestone-sequencing
  // don't change just because another apply is in flight), so failing them
  // quickly here avoids opening a transaction for a request that's about
  // to be rejected anyway.
  const oaCheck = await pool.request().input("id", sql.Int, onAccountId)
    .query("SELECT BookingId FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  if (!oaCheck.recordset.length) return { error: "On-account payment not found" };

  const target = await pool.request().input("id", sql.Int, milestoneId).query(`
    SELECT m.BookingId, m.MilestoneNo, m.MilestoneName, b.BookingNo
    FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    WHERE m.Id = @id
  `);
  if (!target.recordset.length) return { error: "Milestone not found" };
  const targetRow = target.recordset[0];
  if (targetRow.BookingId !== oaCheck.recordset[0].BookingId) {
    return { error: "This on-account deposit belongs to a different booking" };
  }

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) return { error: activeErr };

  // Full-booking hold: every rupee a customer pays lands in On Account
  // first and stays there — untouched, uncounted as "paid" against any
  // milestone — until the on-account pool covers the booking's ENTIRE
  // GrandTotal (all milestones combined), not just the one milestone being
  // adjusted. Only once the whole booking is fully funded can staff start
  // sweeping it onto individual milestones in order.
  const funding = await getBookingFunding(pool, targetRow.BookingId);
  if (funding.requiredAmount > 0 && funding.totalFunded + 0.005 < funding.requiredAmount) {
    return { error: `Cannot adjust On Account yet — ₹${funding.shortfall.toLocaleString("en-IN")} is still due after counting milestone payments and available on-account funds.` };
  }

  // Same "earlier milestone must be settled first" predicate as
  // createReceiptForMilestone and applyCrmMilestonePaymentApproval below —
  // deliberately does NOT exempt zero-amount milestones (this one used to,
  // the other two never did; a zero-AmountDue milestone left Pending should
  // be explicitly marked Paid/Waived through one of these same flows, not
  // silently treated as "no blockage" in only one of the three paths staff
  // can use to settle the exact same pair of milestones).
  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    return { error: `Cannot apply to "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first` };
  }
  // A villa on the buyer's own plot is one property: the plot's balance is the
  // first part of the villa's schedule, so it is settled before any villa milestone.
  const landFirst = (await require("../services/villaLand").propertyOfBooking(pool, targetRow.BookingId)).schedule
    .find((m) => m.Part === "Land" && m.BookingId !== targetRow.BookingId && !["Paid", "Waived"].includes(m.Status));
  if (landFirst) {
    return { error: `Cannot apply to "${targetRow.MilestoneName}" — the plot's balance "${landFirst.MilestoneName}" (${landFirst.BookingNo}) is settled first` };
  }

  // Required flow: Payment -> On Account -> Demand -> On Account Adjustment
  // -> Milestone Settlement -> Invoice. Gated on the Demand having been
  // raised (DemandStatus <> 'Pending'), NOT on an Invoice already existing —
  // crmBookings.js's own invoice-creation route (POST /:id/invoices, type
  // Milestone/Booking) requires the milestone to already be Status='Paid'
  // before it will generate an invoice for it (an invoice there documents
  // payment already received, like a receipt, not a pre-payment demand).
  // Gating this on Invoice existence would be circular — the milestone can
  // only become Paid by applying on-account money here, but the invoice this
  // function would demand can only be created once it's already Paid.
  const demandCheck = await pool.request().input("mid", sql.Int, milestoneId)
    .query("SELECT DemandStatus FROM dbo.CrmPaymentMilestone WHERE Id = @mid");
  if (demandCheck.recordset[0]?.DemandStatus === CrmStatus.PENDING) {
    return { error: `Cannot apply to "${targetRow.MilestoneName}" — raise the Demand for it first (from the Demands page), then adjust On Account against it` };
  }

  // Everything from here on reads-then-writes the deposit's remaining
  // balance and the milestone's outstanding amount — two concurrent calls
  // (a double-click on Apply, or the auto-sweep racing a manual apply) can
  // target the same deposit and/or the same milestone. Locking both rows
  // with UPDLOCK+HOLDLOCK inside one transaction serialises any such pair:
  // the second call blocks until the first commits, then re-reads the
  // now-updated balances instead of computing off a stale snapshot.
  // GST ratio is derived pre-transaction from the booking (read-only; rate
  // doesn't change mid-payment) so the split is available for the INSERT.
  const bookingGstData = { bookingId: targetRow.BookingId };

  const tx = new sql.Transaction(pool);
  let requested, becamePaidCheck, remaining;
  try {
    await tx.begin();

    // Booking-level mutex shared with the bounce unwind: a bounce can reverse
    // allocations from every deposit on this booking, so per-deposit locks
    // alone do not serialize it against an apply using a different deposit.
    await tx.request().input("bid", sql.Int, targetRow.BookingId).query(`
      SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid
    `);
    // Refund/transfer claim creation serializes on the source deposit row.
    // Lock every deposit before measuring booking funding so a claim on a
    // different deposit cannot appear between the funding check and apply.
    await tx.request().input("bid", sql.Int, targetRow.BookingId).query(`
      SELECT Id FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK)
      WHERE BookingId = @bid ORDER BY Id
    `);
    const lockedFunding = await getBookingFunding(tx, targetRow.BookingId);
    if (lockedFunding.requiredAmount > 0 && lockedFunding.totalFunded + 0.005 < lockedFunding.requiredAmount) {
      await tx.rollback();
      return { error: `Cannot adjust On Account yet — ₹${lockedFunding.shortfall.toLocaleString("en-IN")} is still due after counting milestone payments and available on-account funds.` };
    }

    const oa = await tx.request().input("id", sql.Int, onAccountId).query(`
      SELECT Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    const oaRow = oa.recordset[0];
    if (!oaRow) {
      await tx.rollback();
      return { error: "On-account payment not found" };
    }
    if (["Bounced", "Held", "Void", "Cancelled", "Refunded"].includes(oaRow.Status)) {
      await tx.rollback();
      return { error: `This on-account payment is ${oaRow.Status.toLowerCase()} and cannot be applied` };
    }
    remaining = Number(oaRow.Amount) - Number(oaRow.AppliedAmount);
    // Refunds and re-booking transfers reserve on-account funds before they
    // are actually paid/applied. Do not let a manual adjustment or the
    // automatic full-funding sweep spend those same rupees while a claim is
    // still live. This runs after locking the deposit row, in the same
    // transaction as the receipt and AppliedAmount update.
    const claims = await tx.request().input("id", sql.Int, onAccountId).query(`
      SELECT
        ISNULL((SELECT SUM(GrossAmount) FROM dbo.CrmRefund
          WHERE SourceOnAccountId = @id AND Status NOT IN ('Rejected', 'Paid')), 0) AS ReservedByRefunds,
        ISNULL((SELECT SUM(Amount) FROM dbo.CrmRebookingTransfer
          WHERE HeldOnAccountId = @id AND Status NOT IN ('Rejected', 'Applied')), 0) AS ReservedByTransfers
    `);
    const reserved = Number(claims.recordset[0]?.ReservedByRefunds || 0)
      + Number(claims.recordset[0]?.ReservedByTransfers || 0);
    remaining = Math.max(0, Math.round((remaining - reserved) * 100) / 100);

    const m = await tx.request().input("id", sql.Int, milestoneId).query(`
      SELECT AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    // A Paid milestone is self-protected (its balance is already 0, so
    // `requested <= 0` below catches it) — but a Waived one is NOT: waiving
    // only sets Status='Waived', it never zeroes AmountDue or touches
    // AmountPaid, so milestoneBalance can still be a large positive number.
    // Without this check, on-account money applied to an already-waived
    // milestone would insert a real receipt and the UPDATE below would flip
    // Status back to 'Paid' — silently un-waiving money staff explicitly
    // decided to forgive, and re-firing handleMilestoneBecamePaid's
    // downstream cascade (sales deed, brokerage, next-demand auto-raise).
    if (m.recordset[0].Status === "Waived") {
      await tx.rollback();
      return { error: `Cannot apply to "${targetRow.MilestoneName}" — it has been Waived` };
    }
    const milestoneBalance = Number(m.recordset[0].AmountDue) - Number(m.recordset[0].AmountPaid || 0);

    requested = Math.min(remaining, milestoneBalance, amount != null ? amount : Infinity);
    if (!requested || requested <= 0) {
      await tx.rollback();
      return { error: "Nothing to apply" };
    }

    // Reserved from the pool (its own inner transaction via sp_getapplock,
    // see docNumber.js), NOT this tx — getNextDocNumber calls
    // pool.transaction() internally, which only exists on ConnectionPool.
    // Passing tx here throws at runtime; caught late.
    const receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
    const { gstAmount: rcpGst, baseAmount: rcpBase } = await getGstSplit(pool, bookingGstData.bookingId, requested);
    const applyNote = source === "auto" ? "Auto-applied from on-account balance" : "Applied from on-account balance by staff";
    await tx.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("mid",  sql.Int,           milestoneId)
      .input("amt",  sql.Decimal(18,2), requested)
      .input("base", sql.Decimal(18,2), rcpBase)
      .input("gst",  sql.Decimal(18,2), rcpGst)
      .input("oaid", sql.Int,           onAccountId)
      .input("cb",   sql.Int,           actorUserId)
      .input("note", sql.NVarChar(200), applyNote)
      .query(`
        INSERT INTO dbo.CrmPaymentReceipt
          (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, Notes, OnAccountPaymentId, CreatedBy, CreatedAt)
        VALUES (@no, @mid, @amt, @base, @gst, CAST(SYSDATETIME() AS DATE), 'OnAccount', @note, @oaid, @cb, SYSDATETIME())
      `);

    await tx.request().input("id", sql.Int, milestoneId).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
        Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                       THEN '${CrmStatus.PAID}' ELSE Status END,
        PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
        DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN '${CrmStatus.PAID}' ELSE DemandStatus END,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    // Additive, not a snapshot overwrite — the earlier `SET AppliedAmount =
    // @applied` computed off a read taken before this lock was acquired,
    // so a second concurrent apply could overwrite the first one's result
    // instead of stacking on top of it. `+= @requested` inside the lock is
    // correct regardless of how many callers are queued behind it.
    await tx.request()
      .input("id", sql.Int, onAccountId)
      .input("req", sql.Decimal(18,2), requested)
      .query(`
        UPDATE dbo.CrmOnAccountPayment SET
          AppliedAmount = AppliedAmount + @req,
          Status = CASE WHEN AppliedAmount + @req >= Amount THEN 'Applied' ELSE 'PartiallyApplied' END
        WHERE Id = @id
      `);

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }

  // Not new cash — the deposit's cash was already posted to GL when it was
  // received. Moves the party's advance balance (OnAccountLedger) from
  // "unapplied" to "applied against this milestone," and — for deposits
  // originally posted to the pooled "Advance from Customer" head —
  // also posts a reallocation voucher onto the customer's own head (see
  // postCrmOnAccountApplied's docstring in crmLedger.js).
  try {
    await postCrmOnAccountApplied(pool, onAccountId, requested, actorEmail);
  } catch (glErr) {
    console.error("[crm-payments] postCrmOnAccountApplied failed:", glErr.message);
  }

  const finalCheck = await pool.request().input("id", sql.Int, milestoneId).query("SELECT Status FROM dbo.CrmPaymentMilestone WHERE Id = @id");
  const becamePaid = finalCheck.recordset[0]?.Status === CrmStatus.PAID;
  let brokerWarning = null;
  if (becamePaid) {
    const outcome = await handleMilestoneBecamePaid(pool, {
      bookingId: targetRow.BookingId, bookingNo: targetRow.BookingNo,
      milestoneNo: targetRow.MilestoneNo, actorUserId,
    });
    brokerWarning = outcome.brokerWarning;
  }

  return { applied: requested, remaining: remaining - requested, becamePaid, milestoneId, onAccountId, brokerWarning };
}

// Called automatically once the on-account pool covers the booking's entire
// GrandTotal — see autoApplyOnAccountIfFullyFunded below, wired into both
// approval paths (applyCrmMilestonePaymentApproval and
// applyCrmOnAccountPaymentApproval). Business rule (confirmed 2026-09-15):
// money sits on-account, untouched, until the WHOLE booking is funded — at
// that point every milestone is swept automatically, in order, with no
// manual "Apply" action required. PUT /on-account/:id/apply
// (applyOnAccountToMilestone directly) still exists as a manual fallback —
// it enforces the identical full-booking gate, so it's a no-op until this
// function would fire anyway.
async function autoApplyOnAccount(pool, bookingId, actorUserId, actorEmail) {
  const results = [];
  // Hard safety cap — no real payment plan has anywhere near this many
  // milestones, this just guards against an unexpected infinite loop.
  for (let i = 0; i < 50; i++) {
    const deposit = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id FROM dbo.CrmOnAccountPayment
      WHERE BookingId = @bid
        AND ISNULL(Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded')
        AND Amount > ISNULL(AppliedAmount, 0)
      ORDER BY CreatedAt ASC
    `);
    if (!deposit.recordset.length) break;

    const milestone = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id, DemandStatus,
             CASE WHEN DueDate <= CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END AS IsDue
      FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND Status NOT IN ('${CrmStatus.PAID}', 'Waived') AND AmountDue > ISNULL(AmountPaid, 0)
      ORDER BY MilestoneNo ASC
    `);
    if (!milestone.recordset.length) break;
    // Only reached once the full price is in (autoApplyOnAccountIfFullyFunded).
    // A demand is raised when its milestone falls due (crmDemandScheduler.js), so
    // a milestone not yet demanded and not yet due stops the sweep: the rest of
    // the money stays On Account until that milestone's due date. A due one whose
    // demand the hourly run has not reached yet is raised here — the trail stays
    // Payment -> Demand -> Adjustment -> Invoice.
    if (milestone.recordset[0].DemandStatus === CrmStatus.PENDING) {
      if (!milestone.recordset[0].IsDue) break;
      try { await raiseDemandForMilestone(pool, milestone.recordset[0].Id, "Auto-raised — full booking amount received"); }
      catch (e) { console.error("[crm-payments] autoApplyOnAccount: demand auto-raise failed —", e.message, `| milestoneId=${milestone.recordset[0].Id}`); break; }
    }

    const outcome = await applyOnAccountToMilestone(pool, {
      onAccountId: deposit.recordset[0].Id, milestoneId: milestone.recordset[0].Id,
      amount: null, actorUserId, actorEmail, source: "auto",
    });
    if (outcome.error) {
      console.error("[crm-payments] autoApplyOnAccount: applyOnAccountToMilestone failed —", outcome.error,
        `| onAccountId=${deposit.recordset[0].Id} milestoneId=${milestone.recordset[0].Id} bookingId=${bookingId}`);
      // Sequencing errors mean no deposit can advance until an earlier milestone is settled — break
      // to avoid re-querying the same blocked pair 50 times. Non-sequencing errors also break
      // (e.g. balance already zero) since retrying the same pair repeatedly won't help.
      break;
    }
    if (!outcome.applied) break;
    results.push(outcome);
  }
  return results;
}

// Gate for autoApplyOnAccount: only sweep once settled milestone receipts
// plus remaining valid on-account funds cover all non-waived dues. Called
// after every approved
// deposit lands — most deposits won't cross the threshold and this is a
// no-op; the one that does triggers the full sweep immediately, in the same
// request, so staff see every eligible milestone flip to Paid without a
// separate manual step. Best-effort: a failure here must never fail the
// payment approval itself (the money is already safely on-account either
// way — worst case, the existing manual "Apply" path still exists as a
// fallback since it enforces this identical gate).
async function autoApplyOnAccountIfFullyFunded(pool, bookingId, actorUserId, actorEmail) {
  try {
    const funding = await getBookingFunding(pool, bookingId);
    if (funding.requiredAmount > 0 && funding.totalFunded + 0.005 >= funding.requiredAmount) {
      const results = await autoApplyOnAccount(pool, bookingId, actorUserId, actorEmail);
      if (results.length) {
        console.log(`[crm-payments] auto-adjusted ${results.length} milestone(s) for booking ${bookingId} — full booking amount received`);
      }
      return results;
    }
  } catch (e) {
    console.error("[crm-payments] autoApplyOnAccountIfFullyFunded failed:", e.message, `| bookingId=${bookingId}`);
  }
  return [];
}

// Same DemandNo shape the Followup module's demand workflow already uses
// (followupDemands.js buildDemandNo) — DEM-{BookingNo}-{3-digit milestone
// sequence} — kept identical purely for staff familiarity across the two
// modules; the tables themselves are entirely separate.
function buildDemandNo(bookingNo, milestoneNo) {
  return `DEM-${bookingNo}-${String(milestoneNo).padStart(3, "0")}`;
}

// GET /demands — every milestone across every booking, for the CRM Demand
// page's list + summary. Deliberately not scoped to "has a demand raised
// yet" — Pending ones are exactly what the page exists to surface.
router.get("/demands", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search, view } = req.query;
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const blockId = req.query.blockId ? parseInt(req.query.blockId, 10) : null;
    const req0 = pool.request();
    const conds = [
      "b.IsActive = 1",
      // Dead bookings owe nothing — a resold seller's or an expired booking's
      // unpaid instalments are not dues to chase.
      `b.Status NOT IN ${DEAD_BOOKING_SQL}`,
      "m.Status NOT IN ('Waived')",
    ];
    if (req.projectScope) conds.push(require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (view !== "all") {
      conds.push("(m.AmountDue - ISNULL(m.AmountPaid, 0)) > 0");
    }
    if (status && [CrmStatus.PENDING, CrmStatus.DEMANDED, CrmStatus.PAID].includes(status)) {
      req0.input("st", sql.NVarChar(20), status);
      conds.push("m.DemandStatus = @st");
    }
    if (search) {
      req0.input("q", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @q OR b.BookingNo LIKE @q OR m.DemandNo LIKE @q OR m.MilestoneName LIKE @q)");
    }
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
    if (blockId) { req0.input("blockId", sql.Int, blockId); conds.push("b.BlockId = @blockId"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const BASE_SELECT = `
      SELECT m.Id, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.[Percent], m.DueDate, m.Status,
             m.DemandStatus, m.DemandNo, m.DemandRaisedOn, m.DemandNotes,
             b.Id AS BookingId, b.BookingNo, b.ProjectName, b.UnitNo, b.AssignedTo,
             b.GrandTotal AS BookingGrandTotal, b.TotalValue AS BookingTotalValue,
             a.ApplicantName, a.Mobile,
             u.name AS AssignedToName,
             CASE WHEN m.DueDate < CAST(SYSDATETIME() AS DATE) AND m.Status = '${CrmStatus.PENDING}' THEN 1 ELSE 0 END AS IsOverdue,
             DATEDIFF(DAY, m.DueDate, CAST(SYSDATETIME() AS DATE)) AS DaysOverdue
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.Users u ON u.id = b.AssignedTo
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
    `;

    // Summary is always computed over the FULL filtered set, independent of
    // pagination — it drives the tab badges (pending/demanded/paid/overdue
    // counts+amounts), which must stay accurate no matter which page is on
    // screen. Kept as a single unpaginated pass exactly like before, just
    // now honoring the new Company/Project/Block scope too.
    function computeSummary(rows) {
      const summary = {
        pendingCount: 0, pendingAmount: 0,
        demandedCount: 0, demandedAmount: 0,
        paidCount: 0, paidAmount: 0,
        overdueCount: 0, overdueAmount: 0,
      };
      for (const r of rows) {
        const balance = Math.max(0, Number(r.AmountDue || 0) - Number(r.AmountPaid || 0));
        const paid = Number(r.AmountPaid || 0);
        if (r.DemandStatus === CrmStatus.PENDING) { summary.pendingCount++; summary.pendingAmount += balance; }
        else if (r.DemandStatus === CrmStatus.DEMANDED) { summary.demandedCount++; summary.demandedAmount += balance; }
        else if (r.DemandStatus === CrmStatus.PAID) { summary.paidCount++; summary.paidAmount += paid; }
        if (r.IsOverdue && r.DemandStatus !== CrmStatus.PAID) { summary.overdueCount++; summary.overdueAmount += balance; }
      }
      return summary;
    }

    if (!req.query.page) {
      const result = await req0.query(`${BASE_SELECT} ${where} ORDER BY b.BookingNo, m.MilestoneNo`);
      return res.json({ demands: result.recordset, summary: computeSummary(result.recordset) });
    }

    const { page, pageSize, offset } = applyPagination(req);
    // Summary needs only the fields computeSummary reads — a lighter query
    // than BASE_SELECT's full join set, still over every matching row (not
    // just the current page).
    const summaryReq = pool.request()
      .input("st", sql.NVarChar(20), status && [CrmStatus.PENDING, CrmStatus.DEMANDED, CrmStatus.PAID].includes(status) ? status : null)
      .input("q", sql.NVarChar(200), search ? `%${search}%` : null)
      .input("companyId", sql.Int, companyId)
      .input("projectId", sql.Int, projectId)
      .input("blockId", sql.Int, blockId);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const [rowsResult, summaryRows] = await Promise.all([
      req0.query(`${BASE_SELECT} ${where} ORDER BY b.BookingNo, m.MilestoneNo OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      summaryReq.query(`
        SELECT m.AmountDue, m.AmountPaid, m.DemandStatus,
               CASE WHEN m.DueDate < CAST(SYSDATETIME() AS DATE) AND m.Status = '${CrmStatus.PENDING}' THEN 1 ELSE 0 END AS IsOverdue
        FROM dbo.CrmPaymentMilestone m
        JOIN dbo.CrmBooking b ON b.Id = m.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
        WHERE b.IsActive = 1
          AND b.Status NOT IN ('Cancelled', 'Rejected', 'Expired', 'Transferred')
          AND m.Status NOT IN ('Waived')
          ${view !== "all" ? "AND (m.AmountDue - ISNULL(m.AmountPaid, 0)) > 0" : ""}
          AND (@st IS NULL OR m.DemandStatus = @st)
          AND (@q IS NULL OR (a.ApplicantName LIKE @q OR b.BookingNo LIKE @q OR m.DemandNo LIKE @q OR m.MilestoneName LIKE @q))
          AND (@companyId IS NULL OR b.CompanyId = @companyId)
          AND (@projectId IS NULL OR b.ProjectId = @projectId)
          AND (@blockId IS NULL OR b.BlockId = @blockId)
      `),
    ]);
    res.json({
      demands: rowsResult.recordset,
      summary: computeSummary(summaryRows.recordset),
      total: summaryRows.recordset.length,
      page, pageSize,
    });
  } catch (e) {
    console.error("[crm-payments] GET /demands error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Shared demand-raising logic behind POST /:id/demand below — pulled out so
// the Money Receipt approval flow (crmMoneyReceipts.js) can raise a demand
// against a booking's milestone the exact same way, per "reuse the existing
// Demands feature" rather than building a parallel demand concept. Throws
// (with .status set) on the same conditions the route below used to
// res.status(...).json(...) on, so callers can handle failures uniformly.
async function raiseDemandForMilestone(pool, milestoneId, notes) {
  const m = await pool.request().input("id", sql.Int, milestoneId).query(`
    SELECT m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.Status, m.DemandStatus,
           b.BookingNo, b.AssignedTo, a.ApplicantName
    FROM dbo.CrmPaymentMilestone m
    JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE m.Id = @id
  `);
  if (!m.recordset.length) { const e = new Error("Milestone not found"); e.status = 404; throw e; }
  const row = m.recordset[0];
  if (row.Status === CrmStatus.PAID || row.Status === "Waived") {
    const e = new Error(`This milestone is already ${row.Status.toLowerCase()} — nothing to demand`);
    e.status = 400;
    throw e;
  }
  const balance = (row.AmountDue || 0) - (row.AmountPaid || 0);
  if (balance <= 0) {
    const e = new Error("This milestone has no outstanding balance — nothing to demand");
    e.status = 400;
    throw e;
  }
  if (row.DemandStatus !== CrmStatus.PENDING) {
    const e = new Error(`Cannot raise demand — current status is ${row.DemandStatus}`);
    e.status = 400;
    throw e;
  }

  const demandNo = buildDemandNo(row.BookingNo, row.MilestoneNo);
  const demandRaisedOn = new Date().toISOString().slice(0, 10);
  const cleanNotes = (notes || "").trim() || null;

  await pool.request()
    .input("id", sql.Int, milestoneId)
    .input("no", sql.NVarChar(60), demandNo)
    .input("dt", sql.Date, demandRaisedOn)
    .input("notes", sql.NVarChar(500), cleanNotes)
    .query(`
      UPDATE dbo.CrmPaymentMilestone SET
        DemandStatus = '${CrmStatus.DEMANDED}', DemandNo = @no, DemandRaisedOn = @dt,
        DemandNotes = ISNULL(@notes, DemandNotes),
        DemandRaisedAt = SYSDATETIME()
      WHERE Id = @id
    `);

  if (row.AssignedTo) {
    await emitNotification(pool, row.AssignedTo, "payment_demand",
      "Payment Demand Raised",
      `${row.ApplicantName} · ${row.BookingNo} — ${row.MilestoneName} demand raised (₹${balance.toLocaleString("en-IN")})`,
      milestoneId, "payment_milestone");
  }
  return { DemandNo: demandNo, DemandRaisedOn: demandRaisedOn };
}

// Shared side-effects for "this milestone just became Paid" — auto-create
// the Sales Deed / Brokerage where applicable and surface the broker-unpaid
// warning. The NEXT milestone's demand is not raised here: demands are raised
// when a milestone falls due (services/crmDemandScheduler.js), not when the
// previous one is paid. Previously this whole block only lived inline inside
// applyCrmMilestonePaymentApproval, so a milestone settled via the
// on-account sweep (applyOnAccountToMilestone / autoApplyOnAccount) — a
// manual deposit, an overpayment overflow, or a manual on-account apply —
// never triggered any of it. Both settlement paths now call this exact same
// function so the outcome can't depend on which one happened to clear the
// balance.
async function handleMilestoneBecamePaid(pool, { bookingId, bookingNo, milestoneNo, actorUserId }) {
  await maybeAutoCreateSalesDeed(pool, bookingId, actorUserId);
  if (Number(milestoneNo) === 1) {
    await maybeAutoCreateBrokerage(pool, bookingId, actorUserId);
  }
  // Sync parking PaymentStatus — only triggers transition if all milestones now settled
  try { await syncParkingPaymentStatus(pool, bookingId); } catch (e) {
    console.error("[crm-payments] syncParkingPaymentStatus failed:", e.message);
  }
  const brokerWarning = await warnIfBrokerUnpaid(pool, bookingId, actorUserId);
  return { brokerWarning };
}

// POST /demands/bulk — raise demands for all eligible Pending milestones in
// one shot.  Accepts optional filters { projectName, milestoneName } —
// without filters it targets every Pending milestone that has a balance.
// Returns { raised, skipped, errors } so the caller knows exactly what
// happened; partial success is the expected case (some milestones may already
// be Demanded or have no balance).
router.post("/demands/bulk", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    // Input validation
    const parsed = bulkDemandSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request body" });
    }
    const { projectName, milestoneName } = req.body || {};
    const int = (v) => (v != null && v !== "" && Number.isInteger(Number(v)) ? Number(v) : null);
    const companyId = int(req.body?.companyId), projectId = int(req.body?.projectId), blockId = int(req.body?.blockId);

    const req0 = pool.request();
    // The same milestones the Demands list shows as "ready to raise": live bookings, not waived, a balance left — and
    // only in the user's projects (it used to raise across every project, and on dead bookings the list leaves out).
    const conds = [
      "m.DemandStatus = 'Pending'",
      "m.Status NOT IN ('Waived')",
      "b.IsActive = 1",
      `b.Status NOT IN ${DEAD_BOOKING_SQL}`,
      "a.Status NOT IN ('Cancelled','Rejected','Expired')",
      "(m.AmountDue - ISNULL(m.AmountPaid, 0)) > 0",
    ];
    if (req.projectScope) conds.push(require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (companyId) { req0.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
    if (projectId) { req0.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
    if (blockId) { req0.input("blockId", sql.Int, blockId); conds.push("b.BlockId = @blockId"); }
    if (projectName) {
      if (req.projectScope) {
        const { assertProjectRawAllowed } = require("../services/projectScope");
        if (!await assertProjectRawAllowed(req, res, projectName)) return;
      }
      req0.input("pname", sql.NVarChar(200), projectName);
      // Filter by ProjectId via enterprise master so a renamed project still matches.
      conds.push("b.ProjectId IN (SELECT id FROM dbo.enterprise WHERE name = @pname AND business_type = 'P')");
    }
    if (req.projectScope) conds.push(require("../services/projectScope").projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (milestoneName) {
      req0.input("mname", sql.NVarChar(200), milestoneName);
      conds.push("m.MilestoneName = @mname");
    }
    const rows = await req0.query(`
      SELECT m.Id, m.BookingId
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE ${conds.join(" AND ")}
    `);

    const ids = rows.recordset.map((r) => r.Id);
    if (!ids.length) return res.json({ raised: 0, skipped: 0, errors: [] });

    let raised = 0, skipped = 0;
    const errors = [];
    for (const id of ids) {
      try {
        await raiseDemandForMilestone(pool, id, null);
        raised++;
      } catch (e) {
        // Already-demanded / paid / zero-balance — skip silently; anything
        // unexpected is logged and collected for the response.
        if (e.status === 400) { skipped++; }
        else { errors.push({ id, message: e.message }); console.error("[crm-payments] bulk demand error for milestone", id, e.message); }
      }
    }
    // Same as a single demand: a booking already paid in full settles now.
    const bookingIds = [...new Set(rows.recordset.map((r) => r.BookingId).filter((x) => x != null))];
    for (const b of bookingIds) await autoApplyOnAccountIfFullyFunded(pool, b, actorId(req), req.user?.email || req.user?.name || null);
    res.json({ raised, skipped, errors });
  } catch (e) {
    console.error("[crm-payments] POST /demands/bulk error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/demand — raise a payment demand for a milestone: assigns a real
// DemandNo, moves DemandStatus Pending -> Demanded, and notifies the
// applicant's assignee. Blocked on an already-fully-paid milestone (nothing
// left to demand) or one that's already been demanded/paid (use undo first).
router.post("/:id/demand", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const result = await raiseDemandForMilestone(pool, id, req.body?.Notes);
    // If the full price is already on account, settle now (the sweep is
    // otherwise only triggered by a newly approved payment).
    const bk = (await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmPaymentMilestone WHERE Id = @id")).recordset[0];
    const settled = bk ? await autoApplyOnAccountIfFullyFunded(pool, bk.BookingId, actorId(req), req.user?.email || req.user?.name || null) : [];
    res.json({ success: true, ...result, settled: settled.length });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error("[crm-payments] POST /:id/demand error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /:id/demand/undo — walk a wrongly-raised demand back to Pending.
// Blocked once the milestone is actually paid (DemandStatus='Paid') —
// undoing a settled demand would misrepresent real money already collected.
router.patch("/:id/demand/undo", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT DemandStatus FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    if (cur.recordset[0].DemandStatus === CrmStatus.PAID) {
      return res.status(400).json({ error: "Cannot undo a demand that's already paid" });
    }

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        DemandStatus = '${CrmStatus.PENDING}', DemandNo = NULL, DemandRaisedOn = NULL,
        DemandNotes = NULL, DemandRaisedAt = NULL
      WHERE Id = @id
    `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-payments] PATCH /:id/demand/undo error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/receipts — receipt history for a milestone
router.get("/:id/receipts", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT r.*, cu.name AS CreatedByName
      FROM dbo.CrmPaymentReceipt r
      LEFT JOIN dbo.Users cu ON cu.id = r.CreatedBy
      WHERE r.MilestoneId = @id
      ORDER BY r.ReceivedDate DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-payments] GET /:id/receipts error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

class ReceiptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// A customer bank only exists for money that actually moved through one.
// Cash never does, and "Other" is unknown — both store NULL regardless of
// what the client sent, the same way RPCheckNumber is already nulled for
// non-Cheque modes below. The UI hides the field for these modes; this is
// the server-side half of that rule so a direct API call can't bypass it.
const MODES_WITH_BANK = ["Cheque", "NEFT", "RTGS", "UPI", "Home Loan"];
const bankNameForMode = (mode, bankName) =>
  MODES_WITH_BANK.includes(mode) ? (bankName || null) : null;

// Shared by POST /:id/receipts below AND by createCrmBookingRecord
// (crmEntityCreation.js), which calls this the moment a Booking auto-creates
// if the originating Application already captured a token payment (cheque/
// card/UPI/etc — see CrmApplication.tsx's Payment Details step) — so that
// payment lands as a real, GL-posted receipt against the booking's first
// milestone immediately, instead of Finance only finding out once someone
// manually re-enters what sales already recorded. Exact same validation,
// rollup, and GL-posting path either way — nothing about how a receipt
// gets accounted for changes based on who/what triggered it.
//
// Workflow guard: "MILESTONE => ... NEXT MILESTONE DUE => MILESTONE WISE
// PAYMENT" is explicit sequencing — a customer paying milestone #5 while
// #1-4 are still outstanding would leave earlier stages permanently
// unaccounted for. Every earlier-numbered milestone on the same booking
// must already be Paid or Waived first (always true for milestone #1, the
// only one the auto-booking caller ever targets, since it has no earlier
// milestone to check against).
// No deposit bank from CRM — Accounts sets it on the Received Payment before approval.
async function createReceiptForMilestone(pool, milestoneId, data, actorUserId, actorEmail, _opts = {}) {
  const amount = parseFloat(data.Amount);
  if (!amount || amount <= 0) throw new ReceiptError("Amount must be greater than 0");

  const target = await pool.request().input("id", sql.Int, milestoneId)
    .query(`
      SELECT m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid,
             bk.ProjectId, bk.ProjectName, bk.CompanyId, bk.ApplicationId, bk.BookingNo,
             a.ApplicantName, e.name AS CompanyName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
      LEFT JOIN dbo.enterprise e ON e.id = bk.CompanyId
      WHERE m.Id = @id
    `);
  if (!target.recordset.length) throw new ReceiptError("Milestone not found", 404);
  const targetRow = target.recordset[0];

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) throw new ReceiptError(activeErr);

  // No deposit bank at CRM entry — the CRM user records the cheque/cash
  // received; Accounts decides which bank it goes into, on the Pending
  // Received Payment (receivedPayment.js PATCH /:id/deposit-bank), before
  // approval. Any DepositBankId sent here is deliberately ignored.

  // Real settlement only happens via the automatic full-booking sweep, so
  // Milestone 1 can never be physically Paid until every later milestone's
  // money (including this one) is already in — checking real Status here
  // would make it impossible to ever submit a payment past Milestone 1.
  // Virtual coverage (money genuinely on-account, even if not yet swept)
  // is the right predecessor check instead.
  if (!(await areEarlierMilestonesCoveredByOnAccount(pool, targetRow.BookingId, targetRow.MilestoneNo))) {
    const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
      .query(`
        SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
        ORDER BY MilestoneNo
      `);
    throw new ReceiptError(`Cannot pay "${targetRow.MilestoneName}" — "${earlier.recordset[0]?.MilestoneName || "an earlier milestone"}" is still due first`);
  }

  // Every CRM payment now submits into Finance's existing Received Payment
  // approval queue (dbo.ReceivedPayment, see receivedPayment.js) instead of
  // posting to CrmPaymentReceipt directly — Account's Head (or the module's
  // existing admin/super_admin/dba approvers) must approve before this money
  // is reflected as Paid anywhere in CRM (milestone AmountPaid, Booking
  // Amount Paid checklist, GL). This function's job is now only to validate
  // and submit the Pending request; applyCrmMilestonePaymentApproval (below)
  // does the actual receipt/rollup/GL/downstream-trigger work, and only runs
  // once an approver acts. The overpayment-cap split (receipt vs on-account
  // overflow) is deliberately NOT computed here — it's resolved against the
  // milestone's balance AS OF approval time, since more than one submission
  // can be sitting Pending at once and only approval order should decide who
  // fills the milestone versus overflows to on-account.
  const { createReceivedPaymentInternal, invalidateReceivedPaymentWorkflowCaches } = require("./receivedPayment");

  const docDate = data.ReceivedDate || null;
  const finYearRow = docDate
    ? await pool.request().input("d", sql.Date, new Date(docDate))
        .query("SELECT TOP 1 FName FROM dbo.FinYear WHERE FStatus = 1 AND @d BETWEEN FStartDate AND FEndDate ORDER BY FStartDate DESC")
    : null;
  const rpFinYear = finYearRow?.recordset[0]?.FName || null;

  // Insert + Draft->Pending promotion run in one transaction — if either
  // step fails (crash, dropped connection) the whole thing rolls back
  // instead of leaving a Draft row stuck forever, invisible to the Approval
  // Inbox (which only lists RPStatus = 'Pending'). Was previously two
  // separate pool.request() calls with no such guarantee.
  const tx = new sql.Transaction(pool);
  let rp;
  try {
    await tx.begin();
    try {
      rp = await createReceivedPaymentInternal(tx, {
      RPReceivedFrom: targetRow.ApplicantName,
      RPCustomerName: targetRow.ApplicantName,
      RPProjectName: targetRow.ProjectName,
      RPProjectId: targetRow.ProjectId,
      RPCompanyId: targetRow.CompanyId,
      RPCompanyName: targetRow.CompanyName || null,
      RPFinYear: rpFinYear,
      RPDocDate: docDate,
      RPMode: data.PaymentMode || null,
      RPAmount: amount,
      // Customer's own bank (the account the money came FROM), captured at
      // CRM entry the same way Received Payment's own form captures it.
      // Distinct from RPDepositBankId, which is OUR account and stays for
      // Accounts to assign before approval.
      RPBankName: bankNameForMode(data.PaymentMode, data.BankName),
      RPTransactionID: data.TransactionRef || null,
      RPCheckNumber: data.PaymentMode === "Cheque" ? (data.TransactionRef || null) : null,
      RPChequeDate: data.ChequeDate || null,
      RPRemarks: data.Notes || `CRM — ${targetRow.BookingNo} / ${targetRow.MilestoneName}`,
      RPDepositBankId: null, // set by Accounts before approval (see above)
      RPDepositBankName: null,
      CrmMilestoneId: milestoneId,
      CrmBookingId: targetRow.BookingId,
      CrmApplicationId: targetRow.ApplicationId,
      }, actorEmail || String(actorUserId));
    } catch (createErr) {
      if (createErr.status) throw new ReceiptError(createErr.message, createErr.status);
      throw createErr;
    }
    await tx.request().input("rpid", sql.Int, rp.RPPaymentID)
      .query("UPDATE dbo.ReceivedPayment SET RPStatus = 'Pending' WHERE RPPaymentID = @rpid AND RPStatus = 'Draft'");
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }
  await invalidateReceivedPaymentWorkflowCaches();

  return { submitted: true, ReceivedPaymentId: rp.RPPaymentID, RPDocNo: rp.RPDocNo, bookingId: targetRow.BookingId };
}

// Runs once Finance actually approves a CRM-linked ReceivedPayment row (see
// receivedPayment.js PUT /:id/approve) for a payment submitted against a
// specific milestone. Required accounting flow (business-confirmed):
// Payment -> On Account -> Demand -> Invoice -> On Account Adjustment ->
// Milestone Settlement. This function is ONLY the first step — it deposits
// the full approved amount to CrmOnAccountPayment and posts it to GL. It
// never creates a CrmPaymentReceipt and never touches CrmPaymentMilestone's
// AmountPaid/Status — a milestone can only ever become Paid through the
// explicit On Account Adjustment action (applyOnAccountToMilestone below,
// reached via PUT /on-account/:id/apply), matching the same rule already
// enforced for on-account deposits submitted with no milestone at all
// (applyCrmOnAccountPaymentApproval). The predecessor-milestone check is
// re-run here (not just at submission) since two payments can be approved
// out of submission order.
async function applyCrmMilestonePaymentApproval(pool, rp, actorUserId, actorEmail) {
  const target = await pool.request().input("id", sql.Int, rp.CrmMilestoneId).query(`
    SELECT m.Id, m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, b.BookingNo
    FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    WHERE m.Id = @id
  `);
  if (!target.recordset.length) throw new ReceiptError("Milestone no longer exists");
  const targetRow = target.recordset[0];

  // Same virtual-coverage predecessor check as submission time (see
  // createReceiptForMilestone above) — real Status can't be the gate here
  // either, for the same reason.
  if (!(await areEarlierMilestonesCoveredByOnAccount(pool, targetRow.BookingId, targetRow.MilestoneNo))) {
    const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
      .query(`
        SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
        ORDER BY MilestoneNo
      `);
    throw new ReceiptError(`Cannot approve payment for "${targetRow.MilestoneName}" — "${earlier.recordset[0]?.MilestoneName || "an earlier milestone"}" is still due first`);
  }

  // Idempotency guard — same pattern as applyCrmOnAccountPaymentApproval:
  // if this RP was already processed (e.g. server crashed after the Finance
  // commit but before this function completed), reuse the existing row
  // instead of depositing the same money twice.
  const existing = await pool.request().input("srp", sql.Int, rp.RPPaymentID)
    .query("SELECT Id, ReceiptNo FROM dbo.CrmOnAccountPayment WHERE SourceReceivedPaymentId = @srp");
  let onAccountId, onAccountReceiptNo;
  if (existing.recordset.length) {
    onAccountId = existing.recordset[0].Id;
    onAccountReceiptNo = existing.recordset[0].ReceiptNo;
  } else {
    onAccountReceiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const oaResult = await pool.request()
      .input("no",   sql.NVarChar(30),  onAccountReceiptNo)
      .input("bid",  sql.Int,           targetRow.BookingId)
      .input("amt",  sql.Decimal(18,2), Number(rp.RPAmount))
      .input("rdt",  sql.Date,          rp.RPDocDate || null)
      .input("mode", sql.NVarChar(50),  rp.RPMode || null)
      .input("tref", sql.NVarChar(200), rp.RPTransactionID || null)
      .input("note", sql.NVarChar(sql.MAX), `Payment for "${targetRow.MilestoneName}" — held On Account until adjusted against a demand/invoice`)
      .input("cb",   sql.Int,           actorUserId)
      .input("bkid", sql.Int,           rp.RPDepositBankId != null ? rp.RPDepositBankId : null)
      .input("bkname", sql.NVarChar(200), rp.RPDepositBankName || null)
      .input("srp",  sql.Int,           rp.RPPaymentID)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName, SourceReceivedPaymentId)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname, @srp)
      `);
    onAccountId = oaResult.recordset[0].Id;
  }

  // Run even when the source row already exists: a prior attempt may have
  // inserted the deposit and then failed before its best-effort GL posting.
  try {
    const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
    await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
  } catch (glErr) {
    await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
  }

  // Stays in On Account unless this deposit was the one that tipped the
  // booking's total over its full GrandTotal — in that case every eligible
  // milestone is auto-adjusted right now, in order (see
  // autoApplyOnAccountIfFullyFunded above).
  await autoApplyOnAccountIfFullyFunded(pool, targetRow.BookingId, actorUserId, actorEmail);

  // Every approved CRM payment gets its own Money Receipt — not just the
  // Booking Amount's first one. Idempotent (see ensureMoneyReceiptForApproved
  // Payment): the Booking Amount's first payment already has one from the
  // separate Pending-MR-first flow, so this just refreshes its PDF; every
  // other payment (a top-up, milestone 2+) gets a new one here for the
  // first time. Best-effort, never allowed to fail the approval itself.
  // Independent of the on-account deposit above — it reflects money the
  // customer physically handed over, not whether it's been adjusted yet.
  try {
    const { ensureMoneyReceiptForApprovedPayment } = require("../services/crmMoneyReceiptWorkflow");
    await ensureMoneyReceiptForApprovedPayment(pool, rp.RPPaymentID, actorUserId);
  } catch (mrErr) {
    console.error("[crm-payments] Money Receipt generation on approval failed:", mrErr.message);
  }

  return { bookingId: targetRow.BookingId, onAccountId, OnAccountReceiptNo: onAccountReceiptNo, brokerWarning: null };
}

// Runs once Finance approves a CRM-linked ReceivedPayment row that has
// CrmBookingId set but no CrmMilestoneId — a manual on-account deposit
// (POST /booking/:id/on-account below), not a payment against a specific
// milestone. Mirrors applyCrmMilestonePaymentApproval's role: this is where
// the real CrmOnAccountPayment insert, GL posting, and auto-sweep onto the
// next due milestone now happen, only once an approver acts. Previously
// this all ran synchronously in the same request that submitted it,
// bypassing Finance approval entirely.
async function applyCrmOnAccountPaymentApproval(pool, rp, actorUserId, actorEmail) {
  // Idempotency guard — if this RP was already processed (e.g. server crashed after
  // the Finance commit but before this function completed), reuse the existing row.
  const existing = await pool.request().input("srp", sql.Int, rp.RPPaymentID)
    .query("SELECT Id FROM dbo.CrmOnAccountPayment WHERE SourceReceivedPaymentId = @srp");
  let onAccountId;
  if (existing.recordset.length) {
    onAccountId = existing.recordset[0].Id;
  } else {
    const receiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("bid",  sql.Int,           rp.CrmBookingId)
      .input("amt",  sql.Decimal(18,2), rp.RPAmount)
      .input("rdt",  sql.Date,          rp.RPDocDate || null)
      .input("mode", sql.NVarChar(50),  rp.RPMode || null)
      .input("tref", sql.NVarChar(200), rp.RPTransactionID || null)
      .input("note", sql.NVarChar(sql.MAX), rp.RPRemarks || null)
      .input("cb",   sql.Int,           actorUserId)
      .input("bkid", sql.Int,           rp.RPDepositBankId != null ? rp.RPDepositBankId : null)
      .input("bkname", sql.NVarChar(200), rp.RPDepositBankName || null)
      .input("srp",  sql.Int,           rp.RPPaymentID)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName, SourceReceivedPaymentId)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname, @srp)
      `);
    onAccountId = result.recordset[0].Id;
  }

  // GL posting is best-effort — same pattern as applyCrmMilestonePaymentApproval.
  // A GL failure must not abort the auto-sweep or MR generation that follow.
  let glOutcome;
  try {
    glOutcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
    await recordGLPosting("crm-on-account-payment", onAccountId, glOutcome, actorEmail);
  } catch (glErr) {
    await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
    glOutcome = {};
  }

  // Stays in On Account unless this deposit was the one that tipped the
  // booking's total over its full GrandTotal (see
  // autoApplyOnAccountIfFullyFunded above).
  await autoApplyOnAccountIfFullyFunded(pool, rp.CrmBookingId, actorUserId, actorEmail);

  // Same "every approved CRM payment gets its own Money Receipt" rule as
  // applyCrmMilestonePaymentApproval — an on-account deposit is real money
  // received too, just not tied to a specific milestone yet.
  try {
    const { ensureMoneyReceiptForApprovedPayment } = require("../services/crmMoneyReceiptWorkflow");
    await ensureMoneyReceiptForApprovedPayment(pool, rp.RPPaymentID, actorUserId);
  } catch (mrErr) {
    console.error("[crm-payments] Money Receipt generation on approval failed:", mrErr.message);
  }

  // Fetch ReceiptNo for return (may come from existing idempotent row or newly inserted row)
  const oaRow = await pool.request().input("id", sql.Int, onAccountId)
    .query("SELECT ReceiptNo FROM dbo.CrmOnAccountPayment WHERE Id = @id");
  const ReceiptNo = oaRow.recordset[0]?.ReceiptNo || null;
  return { ...glOutcome, onAccountId, ReceiptNo };
}

// POST /:id/receipts — record a receipt against a milestone (supports partial/installment receipts)
router.post("/:id/receipts", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const actorEmail = req.user?.email || req.user?.name || null;
    const { ReceivedPaymentId, RPDocNo } = await createReceiptForMilestone(pool, id, req.body, actorId(req), actorEmail);
    res.status(201).json({ success: true, submitted: true, ReceivedPaymentId, RPDocNo });
  } catch (e) {
    if (e instanceof ReceiptError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-payments] POST /:id/receipts error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /escalate-overdue — scan for overdue milestones and notify the assigned
// salesperson + marketing head once per milestone (admin/cron-triggered).
router.post("/escalate-overdue", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    if (!isSaAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const pool = getPool();
    // NOTE: matches GET /demands' filter — this previously had NO IsActive /
    // Cancelled / Rejected exclusion at all, so a booking that had been
    // cancelled could still trigger an overdue escalation notification even
    // though it's already hidden from the Demands page itself.
    const overdue = await pool.request().query(`
      SELECT m.Id, m.MilestoneName, m.AmountDue, m.AmountPaid, m.DueDate,
             b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
        AND b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}', 'Expired', 'Transferred')
    `);

    const { normalizeRole } = require("../middleware/role");
    const allActive = await pool.request().query(`
      SELECT u.id, r.RName AS roleName
      FROM dbo.Users u
      LEFT JOIN dbo.Role r ON u.RoleId = r.RId
      WHERE u.discontinue = 0
    `);
    const mktHeadIds = allActive.recordset
      .filter((u) => normalizeRole(u.roleName) === "marketing_head")
      .map((u) => u.id);

    let notified = 0;
    let skipped = 0;
    for (const m of overdue.recordset) {
      // De-dup: skip milestones already escalated today (CrmSlaEscalationLog, migration 171)
      const alreadyEscalated = await pool.request()
        .input("eid", sql.Int, m.Id)
        .query(`
          SELECT TOP 1 Id FROM dbo.CrmSlaEscalationLog
          WHERE EntityType = 'crm-payment-milestone' AND EntityId = @eid
            AND CAST(EscalatedAt AS DATE) = CAST(SYSDATETIME() AS DATE)
        `);
      if (alreadyEscalated.recordset.length) { skipped++; continue; }

      const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
      const msg = `${m.ApplicantName} · ${m.BookingNo} — ${m.MilestoneName} overdue (₹${balance.toLocaleString("en-IN")} pending)`;
      if (m.AssignedTo) {
        await emitNotification(pool, m.AssignedTo, "payment_overdue", "Payment Overdue", msg, m.Id, "payment_milestone");
        notified++;
      }
      for (const headId of mktHeadIds) {
        if (headId !== m.AssignedTo) {
          await emitNotification(pool, headId, "payment_overdue", "Payment Overdue", msg, m.Id, "payment_milestone");
          notified++;
        }
      }
      // Record escalation so a second trigger today is a no-op for this milestone
      await pool.request().input("eid", sql.Int, m.Id)
        .query("INSERT INTO dbo.CrmSlaEscalationLog (EntityType, EntityId) VALUES ('crm-payment-milestone', @eid)");
    }
    res.json({ success: true, overdueCount: overdue.recordset.length, notified, skipped });
  } catch (e) {
    console.error("[crm-payments] POST /escalate-overdue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — milestone payment schedule for a booking
router.get("/booking/:bookingId", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseId(req.params.bookingId);
    if (bid === null) return res.status(400).json({ error: "Invalid bookingId" });
    const [milRes, bkRes, oaRes] = await Promise.all([
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT m.*, cu.name AS CreatedByName,
               (SELECT ISNULL(SUM(rp.RPAmount), 0) FROM dbo.ReceivedPayment rp
                WHERE rp.CrmMilestoneId = m.Id AND rp.RPStatus = '${CrmStatus.PENDING}') AS PendingVerificationAmount
        FROM dbo.CrmPaymentMilestone m
        LEFT JOIN dbo.Users cu ON cu.id = m.CreatedBy
        WHERE m.BookingId = @bid
        ORDER BY m.MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT b.BookingNo, b.Status AS BookingStatus, b.TotalValue,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bpx WHERE bpx.BookingId = b.Id) THEN 1 ELSE 0 END AS BIT) AS IsPlotSale,
               COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
               b.ProjectId,
               COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
               b.BookingAmount,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal, b.UnitParkingGstRate,
               a.ApplicantName, a.Mobile
        FROM dbo.CrmBooking b
        JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
        WHERE b.Id = @bid
      `),
      // On Account Adjustment is a full-booking hold (see
      // applyOnAccountToMilestone above) — surfaced here so the frontend can
      // show how much of the booking's GrandTotal is actually on hand yet.
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT
          ISNULL(SUM(CASE WHEN ISNULL(o.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') THEN o.Amount ELSE 0 END), 0) AS OnAccountTotalReceived,
          ISNULL(SUM(o.AvailableAmount), 0) AS OnAccountAvailable
        FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = @bid
      `),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });

    // Compute summary
    const activeMilestones = milRes.recordset.filter((m) => m.Status !== "Waived");
    const waivedMilestones = milRes.recordset.filter((m) => m.Status === "Waived");
    const totalDue  = activeMilestones.reduce((s, m) => s + Number(m.AmountDue || 0), 0);
    const totalPaid = milRes.recordset.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    const balance = activeMilestones.reduce((s, m) => s + Math.max(0, Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)), 0);
    const waivedDue = waivedMilestones.reduce((s, m) => s + Number(m.AmountDue || 0), 0);
    const overdue   = milRes.recordset.filter((m) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date()).length;

    // VirtuallyCovered: money is genuinely on-account for this milestone
    // even though the real sweep (Status='Paid') only fires automatically
    // once the WHOLE booking is funded — surfaced per-row so the UI can show
    // "customer has paid this" transparently instead of a misleading
    // Pending/Overdue on money that's already, verifiably, in hand.
    const { milestones: coverage } = await getBookingOnAccountCoverage(pool, bid);
    const coverageById = new Map(coverage.map((c) => [c.Id, c.VirtuallyCovered]));
    const milestones = milRes.recordset.map((m) => ({ ...m, VirtuallyCovered: !!coverageById.get(m.Id) }));

    res.json({
      booking: {
        ...bkRes.recordset[0],
        OnAccountTotalReceived: Number(oaRes.recordset[0]?.OnAccountTotalReceived) || 0,
        OnAccountAvailable: Number(oaRes.recordset[0]?.OnAccountAvailable) || 0,
      },
      milestones,
      summary: { totalDue, totalPaid, balance, waivedDue, waivedCount: waivedMilestones.length, overdue },
    });
  } catch (e) {
    console.error("[crm-payments] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId — add a custom milestone
router.post("/booking/:bookingId", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseId(req.params.bookingId);
    if (bid === null) return res.status(400).json({ error: "Invalid bookingId" });
    const b = req.body;
    if (!b.MilestoneName?.trim()) return res.status(400).json({ error: "MilestoneName is required" });
    const amountDue = b.AmountDue != null && b.AmountDue !== "" ? Number(b.AmountDue) : 0;
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
      return res.status(400).json({ error: "Amount Due must be greater than zero" });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      // Serialize schedule creation with cancellation and other booking-level
      // mutations; the preflight eligibility read alone is subject to a race.
      await tx.request().input("bid", sql.Int, bid).query(`
        SELECT Id FROM dbo.CrmBooking WITH (XLOCK, HOLDLOCK) WHERE Id = @bid
      `);
      const activeErr = await requireActiveBooking(tx, bid);
      if (activeErr) throw Object.assign(new Error(activeErr), { status: 409 });
      const noRes = await tx.request().input("bid", sql.Int, bid)
        .query("SELECT ISNULL(MAX(MilestoneNo),0) + 1 AS NextNo FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
      const nextNo = noRes.recordset[0].NextNo;

      await tx.request()
      .input("bid",   sql.Int,           bid)
      .input("mno",   sql.Int,           nextNo)
      .input("mname", sql.NVarChar(200), b.MilestoneName.trim())
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), amountDue)
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @mno, @mname, @due, @amt, @rdocs, @dept, '${CrmStatus.PENDING}', @cb, SYSDATETIME())
      `);
      await tx.commit();
    } catch (txError) {
      try { await tx.rollback(); } catch {}
      if (txError.status) return res.status(txError.status).json({ error: txError.message });
      throw txError;
    }
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[crm-payments] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update milestone (record payment, update due date). Status is
// never accepted from the request body — it is always derived from the
// AmountPaid vs AmountDue comparison. Waived is a distinct, explicit business
// decision and only happens via /:id/waive below.
router.put("/:id", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });

    const paidRaw = b.AmountPaid != null && b.AmountPaid !== "" ? parseFloat(b.AmountPaid) : null;
    const amountDueOverride = b.AmountDue != null && b.AmountDue !== "" ? parseFloat(b.AmountDue) : null;
    if (amountDueOverride != null && (!Number.isFinite(amountDueOverride) || amountDueOverride < 0)) {
      return res.status(400).json({ error: "Amount Due must be a valid non-negative amount" });
    }

    // Fetch the current row up front — needed for the AmountDue override's
    // %-recompute against the booking's GrandTotal.
    const curRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.AmountDue, m.MilestoneName, bk.Id AS BookingId, bk.GrandTotal, bk.TotalValue, bk.ProjectId
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      WHERE m.Id = @id
    `);
    if (!curRes.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const curRow = curRes.recordset[0];

    // Every other mutation on this table gates on the booking still being
    // active — a payment (paidRaw != null) already gets this for free via
    // createReceiptForMilestone below, but an AmountDue/DueDate/Remarks-only
    // edit skipped straight to the transaction with no check at all,
    // letting a cancelled/rejected booking's payment schedule still be
    // reproportioned (recalculateRemainingMilestones cascades to every
    // other open milestone) and its demands invalidated. Checked
    // unconditionally here so both paths are covered.
    const activeErr = await requireActiveBooking(pool, curRow.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Recording an actual payment here now goes through the exact same
    // submit-for-approval path POST /:id/receipts uses (createReceiptForMilestone)
    // instead of writing AmountPaid/Status onto the milestone directly — this
    // route used to be the one CRM payment surface that bypassed a real
    // receipt row and GL posting entirely (see migration 269). Every field
    // below that ISN'T the payment itself (due date, remarks, AmountDue
    // override, etc.) still applies immediately in the same request; only
    // AmountPaid/PaidDate/PaymentMode/TransactionRef/DepositBank* are no
    // longer written here — they're what the submitted, Pending receipt
    // carries instead, applied to the milestone only once approved.
    let paymentSubmission = null;
    if (paidRaw != null) {
      const actorEmail = req.user?.email || req.user?.name || null;
      paymentSubmission = await createReceiptForMilestone(pool, id, {
        Amount: paidRaw,
        ReceivedDate: b.PaidDate || null,
        PaymentMode: b.PaymentMode || null,
        BankName: b.BankName || null,
        TransactionRef: b.TransactionRef || null,
        DepositBankId: b.DepositBankId != null ? b.DepositBankId : null,
        DepositBankName: b.DepositBankName || null,
        Notes: b.Remarks || null,
      }, actorId(req), actorEmail);
    }

    // A manual AmountDue override changes this milestone's own weight in
    // the schedule — recompute its stored Percent alongside it (against the
    // booking's current GrandTotal), or the % shown right next to the new
    // ₹ figure would silently go stale.
    let percentOverride = null;
    const grandTotal = Number(curRow.GrandTotal || curRow.TotalValue || 0);
    if (amountDueOverride != null && grandTotal > 0) {
      percentOverride = Math.round((amountDueOverride / grandTotal) * 10000) / 100;
    }

    // createReceiptForMilestone above (if it ran) owns its own internal
    // transaction and runs on the plain pool first — same established rule
    // as every other approve/submit path. The milestone field UPDATE and,
    // on an AmountDue override, the whole reproportion-and-rollup cascade
    // are wrapped together: a failure partway through could otherwise leave
    // the schedule not summing to GrandTotal, a milestone's Paid/Demand
    // status stale against its own just-changed AmountDue, or a stale
    // demand invalidated on other milestones with no notification sent to
    // explain why (notification itself stays outside — pure websocket).
    const tx = pool.transaction();
    await tx.begin();
    let updated, staleDemandsRecordset = [];
    try {
      // The earlier active-booking check is only a fast preflight. Serialize
      // this schedule write with cancellation and validate again under the
      // booking lock before changing the milestone or redistributing dues.
      await tx.request().input("bid", sql.Int, curRow.BookingId).query(`
        SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid
      `);
      const lockedActiveError = await requireActiveBooking(tx, curRow.BookingId);
      if (lockedActiveError) throw Object.assign(new Error(lockedActiveError), { status: 409 });
      const result = await tx.request()
        .input("id",    sql.Int,           id)
        .input("mname", sql.NVarChar(200), b.MilestoneName || null)
        .input("due",   sql.Date,          b.DueDate || null)
        .input("amt",   sql.Decimal(18,2), amountDueOverride)
        .input("pct",   sql.Decimal(5,2),  percentOverride)
        .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
        .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
        .input("rem",   sql.NVarChar(sql.MAX), b.Remarks || null)
        .input("remSet", sql.Bit, "Remarks" in b ? 1 : 0)
        .input("ub",    sql.Int,           actorId(req))
        .query(`
          UPDATE dbo.CrmPaymentMilestone SET
            MilestoneName  = ISNULL(@mname, MilestoneName),
            DueDate        = ISNULL(@due,   DueDate),
            AmountDue      = ISNULL(@amt,   AmountDue),
            [Percent]      = ISNULL(@pct,   [Percent]),
            RequiredDocuments = ISNULL(@rdocs, RequiredDocuments),
            ResponsibleDepartment = ISNULL(@dept, ResponsibleDepartment),
            Remarks   = CASE WHEN @remSet = 1 THEN @rem ELSE Remarks END,
            UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          OUTPUT INSERTED.BookingId
          WHERE Id = @id
        `);

      updated = result.recordset[0];

      // Manual override of this milestone's own AmountDue cascades to the
      // OTHER still-open milestones so the schedule keeps summing to
      // GrandTotal — this one stays fixed at what staff just typed in.
      if (amountDueOverride != null && updated?.BookingId) {
        await recalculateRemainingMilestones(tx, updated.BookingId, { fixedMilestoneId: id });

        // Re-run the Paid/DemandStatus rollup for THIS milestone — a manual
        // reduction can retroactively cross the paid threshold against
        // receipts already on file, and that must be reflected immediately
        // rather than waiting on some unrelated future payment event to
        // happen to re-trigger the same CASE logic. If it's still open and
        // already had a formal demand raised against the OLD amount, that
        // demand no longer describes the real balance — reset it to Pending
        // (clearing DemandNo) so it must be consciously re-raised rather than
        // silently misrepresenting what was actually asked for.
        const selfRollup = await tx.request().input("id", sql.Int, id).query(`
          UPDATE dbo.CrmPaymentMilestone SET
            Status = CASE WHEN ISNULL(AmountPaid,0) >= AmountDue THEN '${CrmStatus.PAID}' ELSE Status END,
            PaidDate = CASE WHEN ISNULL(AmountPaid,0) >= AmountDue AND PaidDate IS NULL THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
            DemandStatus = CASE
              WHEN ISNULL(AmountPaid,0) >= AmountDue THEN '${CrmStatus.PAID}'
              WHEN DemandStatus = '${CrmStatus.DEMANDED}' THEN '${CrmStatus.PENDING}'
              ELSE DemandStatus END,
            DemandNo = CASE WHEN ISNULL(AmountPaid,0) < AmountDue AND DemandStatus = '${CrmStatus.DEMANDED}' THEN NULL ELSE DemandNo END,
            DemandRaisedOn = CASE WHEN ISNULL(AmountPaid,0) < AmountDue AND DemandStatus = '${CrmStatus.DEMANDED}' THEN NULL ELSE DemandRaisedOn END,
            DemandNotes = CASE WHEN ISNULL(AmountPaid,0) < AmountDue AND DemandStatus = '${CrmStatus.DEMANDED}' THEN NULL ELSE DemandNotes END,
            DemandRaisedAt = CASE WHEN ISNULL(AmountPaid,0) < AmountDue AND DemandStatus = '${CrmStatus.DEMANDED}' THEN NULL ELSE DemandRaisedAt END,
            UpdatedAt = SYSDATETIME()
          OUTPUT INSERTED.Status, INSERTED.MilestoneNo
          WHERE Id = @id
        `);
        if (selfRollup.recordset[0]?.Status === CrmStatus.PAID) {
          await handleMilestoneBecamePaid(tx, {
            bookingId: updated.BookingId, milestoneNo: selfRollup.recordset[0].MilestoneNo, actorUserId: actorId(req),
          });
        }

        // recalculateRemainingMilestones protects any milestone with real
        // money on it (AmountPaid > 0) from being reproportioned, but a
        // milestone that's Demanded with ZERO received yet has no such
        // protection — it's still in the "open" pool and its AmountDue can
        // get silently redistributed while a formal demand notice quoting the
        // old figure is already sitting with the customer. Invalidate any
        // such demand the cascade could have touched and tell whoever's
        // assigned to re-raise it.
        const staleDemands = await tx.request().input("bid", sql.Int, updated.BookingId).input("fid", sql.Int, id).query(`
          UPDATE dbo.CrmPaymentMilestone SET
            DemandStatus = '${CrmStatus.PENDING}', DemandNo = NULL, DemandRaisedOn = NULL,
            DemandNotes = NULL, DemandRaisedAt = NULL, UpdatedAt = SYSDATETIME()
          OUTPUT INSERTED.MilestoneName
          WHERE BookingId = @bid AND Id <> @fid AND MilestoneNo <> 1
            AND Status NOT IN ('${CrmStatus.PAID}','Waived') AND ISNULL(AmountPaid,0) = 0 AND DemandStatus = '${CrmStatus.DEMANDED}'
        `);
        staleDemandsRecordset = staleDemands.recordset;
      }

      await tx.commit();
    } catch (txErr) {
      try { await tx.rollback(); } catch (_) { /* already rolled back or connection lost */ }
      throw txErr;
    }

    if (staleDemandsRecordset.length) {
      const bk = await pool.request().input("bid", sql.Int, updated.BookingId)
        .query("SELECT AssignedTo, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
      const bkRow = bk.recordset[0];
      if (bkRow?.AssignedTo) {
        const names = staleDemandsRecordset.map((r) => r.MilestoneName).join(", ");
        await emitNotification(pool, bkRow.AssignedTo, "payment_demand_invalidated",
          "Demand amount changed — re-raise required",
          `Booking ${bkRow.BookingNo}: the due amount was recalculated for ${names}. The previously raised demand(s) were reset to "Not Raised" since they no longer match the real balance — please review and re-raise.`,
          updated.BookingId, "crm_booking");
      }
    }

    if (paymentSubmission) {
      return res.json({ success: true, submitted: true, ReceivedPaymentId: paymentSubmission.ReceivedPaymentId, RPDocNo: paymentSubmission.RPDocNo });
    }
    res.json({ success: true });
  } catch (e) {
    if (e instanceof ReceiptError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-payments] PUT error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /:id/waive — explicit business decision to waive a milestone. Requires
// a reason so it's auditable, unlike a free Status dropdown pick.
router.put("/:id/waive", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body || {};
    if (!b.Reason) return res.status(400).json({ error: "Reason is required to waive a milestone" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, BookingId FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    if (cur.recordset[0].Status === CrmStatus.PAID) {
      return res.status(400).json({ error: "Cannot waive an already-paid milestone" });
    }
    // Every other mutation endpoint in this file guards on this — waive was
    // the one gap, letting a milestone on a Cancelled/inactive booking be
    // waived after the fact (its balance is already being handled through
    // the Cancellation/refund flow, not this one).
    const bookingId = cur.recordset[0].BookingId;
    const tx = pool.transaction();
    await tx.begin();
    let result;
    try {
      await tx.request().input("bid", sql.Int, bookingId).query(`
        SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid
      `);
      const activeErr = await requireActiveBooking(tx, bookingId);
      if (activeErr) throw Object.assign(new Error(activeErr), { status: 409 });
      result = await tx.request()
        .input("id",  sql.Int, id)
        .input("rem", sql.NVarChar(sql.MAX), b.Reason)
        .input("ub",  sql.Int, actorId(req))
        .query(`
          UPDATE dbo.CrmPaymentMilestone SET
            Status = 'Waived', Remarks = @rem, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
          OUTPUT INSERTED.BookingId, INSERTED.MilestoneNo
          WHERE Id = @id AND Status <> '${CrmStatus.PAID}'
        `);
      if (!result.recordset.length) {
        throw Object.assign(new Error("This milestone was paid before the waiver could be applied"), { status: 409 });
      }
      await tx.commit();
    } catch (txError) {
      try { await tx.rollback(); } catch {}
      throw txError;
    }

    const { BookingId: waivedBookingId, MilestoneNo: waivedMilestoneNo } = result.recordset[0];
    // Auto-flow: a waived milestone can also be the last one outstanding.
    await maybeAutoCreateSalesDeed(pool, waivedBookingId, actorId(req));
    // Milestone #1 waive must also trigger brokerage auto-create — same gate
    // as handleMilestoneBecamePaid, which only fires on payment, not waive.
    if (Number(waivedMilestoneNo) === 1) {
      await maybeAutoCreateBrokerage(pool, waivedBookingId, actorId(req));
    }
    try { await syncParkingPaymentStatus(pool, waivedBookingId); } catch (e) {
      console.error("[crm-payments] syncParkingPaymentStatus (waive) failed:", e.message);
    }

    res.json({ success: true, status: "Waived" });
  } catch (e) {
    console.error("[crm-payments] waive error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /booking/:bookingId/on-account — every on-account deposit for this
// booking, plus the balance still unapplied. Used by Welcome Call and the
// Booking Details tab to show "customer has ₹X sitting on account" instead
// of that money just disappearing into a milestone it wasn't actually
// meant for yet.
// The Invoices page reads it to invoice an on-account payment.
router.get("/booking/:bookingId/on-account", requireAnyPageRight(["crm-payments", "crm-invoices"], "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseId(req.params.bookingId);
    if (bid === null) return res.status(400).json({ error: "Invalid bookingId" });
    const result = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT o.*, CAST(${ON_ACCOUNT_AVAILABLE_SQL} AS DECIMAL(18,2)) AS AvailableBalance,
             cu.name AS CreatedByName,
             inv.Id AS InvoiceId, inv.InvoiceNo, inv.InvoiceDate, inv.Status AS InvoiceStatus
      FROM dbo.CrmOnAccountPayment o
      LEFT JOIN dbo.Users cu ON cu.id = o.CreatedBy
      -- Excludes Void invoices from the join, not just from downstream
      -- filters — a voided invoice must not keep InvoiceId set (which would
      -- permanently block re-invoicing after migration 325's Status <>
      -- 'Void' unique-index carve-out), and without this the LEFT JOIN could
      -- also double-match a deposit that has both a voided and a live
      -- invoice, duplicating the row in the result set.
      LEFT JOIN dbo.CrmInvoice inv ON inv.OnAccountPaymentId = o.Id AND inv.Status <> 'Void'
      WHERE o.BookingId = @bid AND ISNULL(o.Status, '') <> 'Held'
      ORDER BY o.CreatedAt DESC
    `);
    const rows = result.recordset;
    const available = rows.reduce((s, r) => s + (Number(r.AvailableBalance) || 0), 0);
    res.json({ payments: rows, availableBalance: available });
  } catch (e) {
    console.error("[crm-payments] GET /booking/:id/on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /booking/:bookingId/on-account — submit a new on-account deposit for
// Finance approval. Previously this inserted CrmOnAccountPayment, posted GL,
// and auto-swept the money onto the next milestone all in this same request
// — bypassing Finance approval entirely, unlike every other CRM payment
// (migration 269's whole point: "Every CRM payment ... now submits into
// Finance's existing Received Payment approval queue"). That gap let real
// money reach the ledger and the customer's balance with zero review. Fixed
// by submitting into the same ReceivedPayment queue milestone payments use
// (CrmBookingId set, CrmMilestoneId left null so receivedPayment.js's
// approve handler routes it to applyCrmOnAccountPaymentApproval below
// instead of applyCrmMilestonePaymentApproval) — the real insert/GL/auto-
// sweep now only happens once an approver acts.
router.post("/booking/:bookingId/on-account", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseId(req.params.bookingId);
    if (bid === null) return res.status(400).json({ error: "Invalid bookingId" });
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const bkRes = await pool.request().input("bid", sql.Int, bid)
      .query(`
        SELECT bk.ProjectId, bk.ProjectName, bk.CompanyId, bk.ApplicationId, bk.BookingNo,
               e.name AS CompanyName
        FROM dbo.CrmBooking bk
        LEFT JOIN dbo.enterprise e ON e.id = bk.CompanyId
        WHERE bk.Id = @bid
      `);
    if (!bkRes.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const booking = bkRes.recordset[0];


    const actorEmail = req.user?.email || req.user?.name || null;
    const { createReceivedPaymentInternal, invalidateReceivedPaymentWorkflowCaches } = require("./receivedPayment");

    const oaDocDate = b.ReceivedDate || null;
    const oaFinYearRow = oaDocDate
      ? await pool.request().input("d", sql.Date, new Date(oaDocDate))
          .query("SELECT TOP 1 FName FROM dbo.FinYear WHERE FStatus = 1 AND @d BETWEEN FStartDate AND FEndDate ORDER BY FStartDate DESC")
      : null;
    const oaFinYear = oaFinYearRow?.recordset[0]?.FName || null;

    // Insert + Draft->Pending promotion run in one transaction — if either
    // step fails (crash, dropped connection) the whole thing rolls back
    // instead of leaving a Draft row stuck forever, invisible to the
    // Approval Inbox (which only lists RPStatus = 'Pending') and never
    // reaching applyCrmOnAccountPaymentApproval.
    const tx = new sql.Transaction(pool);
    let rp;
    try {
      await tx.begin();
      rp = await createReceivedPaymentInternal(tx, {
        RPReceivedFrom: booking.BookingNo,
        RPProjectName: booking.ProjectName,
        RPProjectId: booking.ProjectId,
        RPCompanyId: booking.CompanyId,
        RPCompanyName: booking.CompanyName || null,
        RPFinYear: oaFinYear,
        RPDocDate: oaDocDate,
        RPMode: b.PaymentMode || null,
        RPAmount: amount,
        RPBankName: bankNameForMode(b.PaymentMode, b.BankName),
        RPTransactionID: b.TransactionRef || null,
        RPRemarks: b.Notes || `CRM on-account deposit — ${booking.BookingNo}`,
        // No deposit bank from CRM — Accounts sets it on the Received
        // Payment before approval (receivedPayment.js PATCH /:id/deposit-bank).
        RPDepositBankId: null,
        RPDepositBankName: null,
        CrmBookingId: bid,
        CrmApplicationId: booking.ApplicationId,
      }, actorEmail || String(actorId(req)));
      await tx.request().input("rpid", sql.Int, rp.RPPaymentID)
        .query("UPDATE dbo.ReceivedPayment SET RPStatus = 'Pending' WHERE RPPaymentID = @rpid AND RPStatus = 'Draft'");
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch {}
      throw e;
    }
    await invalidateReceivedPaymentWorkflowCaches();

    res.status(201).json({ success: true, submitted: true, ReceivedPaymentId: rp.RPPaymentID, RPDocNo: rp.RPDocNo });
  } catch (e) {
    console.error("[crm-payments] POST /booking/:id/on-account error:", e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// PUT /on-account/:id/apply — the canonical path for adjusting an On Account
// deposit against a specific milestone/invoice. Payments always land in On Account
// first; Finance staff adjust them here once the demand/invoice is ready.
// Flow: Payment → On Account → Demand → Invoice → On Account Adjustment → Milestone Settled.
// Delegates to applyOnAccountToMilestone which enforces identical sequencing,
// balance caps, GL posting, auto-flow triggers) and can't drift apart.
router.put("/on-account/:id/apply", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const onAccountId = parseId(req.params.id);
    if (onAccountId === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;
    const milestoneId = parseInt(b.MilestoneId);
    if (!milestoneId) return res.status(400).json({ error: "MilestoneId is required" });

    const actorEmail = req.user?.email || req.user?.name || null;
    const outcome = await applyOnAccountToMilestone(pool, {
      onAccountId, milestoneId,
      amount: b.Amount != null ? parseFloat(b.Amount) : null,
      actorUserId: actorId(req), actorEmail,
    });
    if (outcome.error) return res.status(400).json({ error: outcome.error });

    res.json({ success: true, applied: outcome.applied, remaining: outcome.remaining });
  } catch (e) {
    console.error("[crm-payments] PUT /on-account/:id/apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /on-account — global list of all CRM on-account deposits across all bookings.
// Supports filters: status, projectId, search (applicant name / booking no), dateFrom, dateTo.
// Used by the On Account management page.
// The On Account list's filters, built once onto any request — the list, its count and the summary all use it, so
// they always agree. Project scope included: these listed every project's deposits to a restricted user.
// 'Held' rows are frozen cancellation credit managed from the Refunds page — out unless asked for.
const OA_FROM = `
  FROM dbo.CrmOnAccountPayment o
  JOIN dbo.CrmBooking b ON b.Id = o.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'`;
function onAccountWhere(request, query, projectScope, { withStatus = true } = {}) {
  const { status, projectId, companyId, blockId, search, dateFrom, dateTo, mode } = query;
  let where = "WHERE o.BookingId IS NOT NULL";
  if (projectScope) where += ` AND ${require("../services/projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim()}`;
  if (withStatus && status) { where += " AND o.Status = @status"; request.input("status", sql.NVarChar(30), status); }
  else                      { where += " AND ISNULL(o.Status,'') <> 'Held'"; }
  if (projectId) { where += " AND b.ProjectId = @pid";    request.input("pid",  sql.Int, parseInt(projectId, 10)); }
  if (companyId) { where += " AND b.CompanyId = @cid";    request.input("cid",  sql.Int, parseInt(companyId, 10)); }
  if (blockId)   { where += " AND b.BlockId = @bid2";     request.input("bid2", sql.Int, parseInt(blockId, 10)); }
  if (dateFrom)  { where += " AND o.ReceivedDate >= @df"; request.input("df",   sql.Date, dateFrom); }
  if (dateTo)    { where += " AND o.ReceivedDate <= @dt"; request.input("dt",   sql.Date, dateTo); }
  // Payment mode was filtered on the page over the 50 rows it had, so the count and the other pages ignored it.
  if (mode)      { where += " AND o.PaymentMode = @mode"; request.input("mode", sql.NVarChar(50), mode); }
  if (search) {
    where += " AND (a.ApplicantName LIKE @s OR a.Mobile LIKE @s OR b.BookingNo LIKE @s OR o.ReceiptNo LIKE @s OR proj.name LIKE @s OR COALESCE(um.UnitName, b.UnitNo) LIKE @s)";
    request.input("s", sql.NVarChar(200), `%${search}%`);
  }
  return where;
}

router.get("/on-account", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { page, pageSize, offset } = applyPagination(req, 50);

    const req_ = pool.request()
      .input("pageSize", sql.Int, pageSize)
      .input("offset",   sql.Int, offset);
    const where = onAccountWhere(req_, req.query, req.projectScope);
    const countReq = pool.request();
    const countWhere = onAccountWhere(countReq, req.query, req.projectScope);

    const [result, countResult] = await Promise.all([
      req_.query(`
        SELECT
          o.Id, o.ReceiptNo, o.BookingId, o.Amount, o.AppliedAmount,
          CAST(${ON_ACCOUNT_AVAILABLE_SQL} AS DECIMAL(18,2)) AS AvailableBalance,
          o.Status, o.ReceivedDate, o.PaymentMode, o.TransactionRef, o.Notes,
          o.CreatedAt, o.DepositBankId, o.DepositBankName, o.SourceReceivedPaymentId,
          b.BookingNo, b.ProjectId,
          COALESCE(proj.name, b.ProjectName) AS ProjectName,
          COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
          b.GrandTotal,
          a.ApplicantName, a.Mobile,
          u.name AS CreatedByName
        ${OA_FROM}
        LEFT JOIN dbo.Users u ON u.id = o.CreatedBy
        ${where}
        ORDER BY o.CreatedAt DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `),
      countReq.query(`SELECT COUNT(*) AS Total ${OA_FROM} ${countWhere}`),
    ]);

    res.json({
      deposits: result.recordset,
      total: countResult.recordset[0]?.Total || 0,
      page,
      pageSize,
    });
  } catch (e) {
    console.error("[crm-payments] GET /on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /on-account/summary — the On Account figures, for the same filters as the list (status aside) and the
// user's projects. It used to total every project, ignore the filters and count 'Held' cancellation credit.
router.get("/on-account/summary", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const request = pool.request();
    const where = onAccountWhere(request, req.query, req.projectScope, { withStatus: false });
    const result = await request.query(`
      SELECT
        COUNT(*)                                                          AS TotalCount,
        ISNULL(SUM(CASE WHEN ISNULL(o.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') THEN o.Amount ELSE 0 END), 0) AS TotalReceived,
        ISNULL(SUM(o.AvailableAmount), 0) AS TotalAvailable,
        ISNULL(SUM(CASE WHEN ISNULL(o.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded') THEN o.AppliedAmount ELSE 0 END), 0) AS TotalApplied,
        ISNULL(SUM(CASE WHEN o.Status = 'Unapplied'        THEN 1 ELSE 0 END), 0) AS UnappliedCount,
        ISNULL(SUM(CASE WHEN o.Status = 'PartiallyApplied' THEN 1 ELSE 0 END), 0) AS PartialCount,
        ISNULL(SUM(CASE WHEN o.Status = 'Applied'          THEN 1 ELSE 0 END), 0) AS AppliedCount,
        ISNULL(SUM(CASE WHEN o.Status = 'Bounced'          THEN 1 ELSE 0 END), 0) AS BouncedCount,
        ISNULL(SUM(CASE WHEN o.Status = 'Unapplied' THEN o.AvailableAmount ELSE 0 END), 0) AS UnappliedBalance,
        ISNULL(SUM(CASE WHEN o.Status = 'PartiallyApplied' THEN o.AvailableAmount ELSE 0 END), 0) AS PartialBalance
      ${OA_FROM.replace("FROM dbo.CrmOnAccountPayment o", `FROM ${onAccountWithAvailableSql("o")}`)}
      ${where}
    `);
    res.json(result.recordset[0]);
  } catch (e) {
    console.error("[crm-payments] GET /on-account/summary error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Retry CRM payment side-effects after ReceivedPayment approval has committed.
// The approval route deliberately surfaces CRM follow-up failures as warnings
// instead of rolling back Finance's already-recorded approval. These handlers
// reuse the source-RP idempotency constraints, so revisiting approved rows is
// safe and also retries GL, auto-application, and money-receipt work.
async function settleApprovedCrmReceivedPayments(pool, actorEmail = "CRM recovery") {
  // Rows whose CrmBookingId/CrmMilestoneId points at a since-deleted Booking
  // or Milestone can never be recovered - normal app flow never hard-deletes
  // a booking or milestone, so this only happens from a direct DB edit (a
  // dev reset/reseed, manual cleanup, etc). Without this exclusion the
  // recovery job retried and re-logged the same unfixable rows every 5
  // minutes forever. Counted separately as "orphaned" so a caller can
  // surface it once (e.g. at server start) instead of as a recurring
  // "failed" count.
  const rows = (await pool.request().query(`
    SELECT rp.RPPaymentID, rp.RPAmount, rp.RPDocDate, rp.RPMode, rp.RPTransactionID, rp.RPRemarks,
           rp.RPDepositBankId, rp.RPDepositBankName, rp.CrmMilestoneId, rp.CrmBookingId
    FROM dbo.ReceivedPayment rp
    WHERE rp.RPStatus = 'Approved' AND rp.CrmBookingId IS NOT NULL
      AND EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.Id = rp.CrmBookingId)
      AND (rp.CrmMilestoneId IS NULL OR EXISTS (SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.Id = rp.CrmMilestoneId))
      AND (
        NOT EXISTS (SELECT 1 FROM dbo.CrmOnAccountPayment oa WHERE oa.SourceReceivedPaymentId = rp.RPPaymentID)
        OR NOT EXISTS (SELECT 1 FROM dbo.CrmMoneyReceipt mr WHERE mr.ReceivedPaymentId = rp.RPPaymentID)
        OR EXISTS (
          SELECT 1 FROM dbo.CrmOnAccountPayment oa
          WHERE oa.SourceReceivedPaymentId = rp.RPPaymentID
            AND ISNULL(oa.Status, '') NOT IN ('Bounced', 'Held', 'Void', 'Cancelled', 'Refunded')
            AND NOT EXISTS (
              SELECT 1 FROM dbo.GeneralLedgerEntry gle
              WHERE gle.SourceType = 'CrmOnAccountPayment' AND gle.SourceId = oa.Id AND gle.IsReversed = 0
            )
        )
      )
    ORDER BY RPPaymentID
  `)).recordset;
  const orphanedRes = await pool.request().query(`
    SELECT COUNT(*) AS c
    FROM dbo.ReceivedPayment rp
    WHERE rp.RPStatus = 'Approved' AND rp.CrmBookingId IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.Id = rp.CrmBookingId)
        OR (rp.CrmMilestoneId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.Id = rp.CrmMilestoneId))
      )
  `);
  const orphaned = Number(orphanedRes.recordset[0]?.c) || 0;
  let settled = 0, failed = 0;
  for (const rp of rows) {
    try {
      const outcome = rp.CrmMilestoneId != null
        ? await applyCrmMilestonePaymentApproval(pool, rp, null, actorEmail)
        : await applyCrmOnAccountPaymentApproval(pool, rp, null, actorEmail);
      await recordGLPosting("crm-received-payment", rp.RPPaymentID, outcome, actorEmail);
      settled++;
    } catch (err) {
      failed++;
      await recordGLPosting("crm-received-payment", rp.RPPaymentID, { failed: true, reason: err.message }, actorEmail);
      console.error(`[crm-payments] approved payment recovery failed for RP ${rp.RPPaymentID}:`, err.message);
    }
  }
  if (rows.length) {
    try { await require("./receivedPayment").invalidateReceivedPaymentWorkflowCaches(); } catch {}
  }
  return { scanned: rows.length, settled, failed, orphaned };
}

module.exports = router;
// Reused by crmEntityCreation.js's createCrmBookingRecord to sync an
// Application-stage token payment onto the new Booking's first milestone.
module.exports.createReceiptForMilestone = createReceiptForMilestone;
module.exports.applyCrmMilestonePaymentApproval = applyCrmMilestonePaymentApproval;
module.exports.applyCrmOnAccountPaymentApproval = applyCrmOnAccountPaymentApproval;
module.exports.settleApprovedCrmReceivedPayments = settleApprovedCrmReceivedPayments;
module.exports.autoApplyOnAccount = autoApplyOnAccount;
module.exports.ReceiptError = ReceiptError;
module.exports.raiseDemandForMilestone = raiseDemandForMilestone;
module.exports.autoApplyOnAccountIfFullyFunded = autoApplyOnAccountIfFullyFunded;
