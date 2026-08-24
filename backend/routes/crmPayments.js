const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");
const { maybeAutoCreateSalesDeed, maybeAutoCreateBrokerage, requireActiveBooking, recalculateRemainingMilestones } = require("../services/crmWorkflowGuards");
const { postCrmReceiptToGL, postCrmOnAccountToGL, postCrmOnAccountApplied } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");

router.use(authMiddleware);
router.use(apiRateLimit);

async function getGstSplit(pool, bookingId, amount) {
  const r = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT ISNULL(TotalGstAmount,0) AS TotalGstAmount, ISNULL(GrandTotal,0) AS GrandTotal FROM dbo.CrmBooking WHERE Id = @bid");
  const row = r.recordset[0] || {};
  const ratio = Number(row.GrandTotal) > 0 ? Number(row.TotalGstAmount) / Number(row.GrandTotal) : 0;
  const gst = Math.round(amount * ratio * 100) / 100;
  return { gstAmount: gst, baseAmount: Math.round((amount - gst) * 100) / 100 };
}

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

// Shared by PUT /on-account/:id/apply (an explicit staff pick) AND
// autoApplyOnAccount below (the automatic sweep that now runs right after
// money lands on a booking's On Account balance) — applies part or all of
// one on-account deposit's remaining balance to one target milestone,
// enforcing the same "earlier milestones must already be Paid/Waived"
// sequencing guard either way, so on-account money can never be used to
// skip ahead in the payment plan regardless of which path put it there.
// Returns { error } on failure, or { applied, remaining, becamePaid } on
// success — callers decide how to surface that (HTTP response vs. just
// looping to the next deposit/milestone).
async function applyOnAccountToMilestone(pool, { onAccountId, milestoneId, amount, actorUserId, actorEmail }) {
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

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    return { error: `Cannot apply to "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first` };
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
  let requested, becamePaidCheck;
  try {
    await tx.begin();

    const oa = await tx.request().input("id", sql.Int, onAccountId).query(`
      SELECT Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    const oaRow = oa.recordset[0];
    const remaining = Number(oaRow.Amount) - Number(oaRow.AppliedAmount);

    const m = await tx.request().input("id", sql.Int, milestoneId).query(`
      SELECT AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
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
    await tx.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("mid",  sql.Int,           milestoneId)
      .input("amt",  sql.Decimal(18,2), requested)
      .input("base", sql.Decimal(18,2), rcpBase)
      .input("gst",  sql.Decimal(18,2), rcpGst)
      .input("oaid", sql.Int,           onAccountId)
      .input("cb",   sql.Int,           actorUserId)
      .query(`
        INSERT INTO dbo.CrmPaymentReceipt
          (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, Notes, OnAccountPaymentId, CreatedBy, CreatedAt)
        VALUES (@no, @mid, @amt, @base, @gst, CAST(SYSDATETIME() AS DATE), 'OnAccount', 'Auto-applied from on-account balance', @oaid, @cb, SYSDATETIME())
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
  // received. This just moves the party's advance balance (OnAccountLedger)
  // from "unapplied" to "applied against this milestone."
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

// Auto-sweep: whenever money lands on a booking's On Account balance —
// either a manual deposit (POST /booking/:id/on-account) or overflow
// diverted off an overpayment (PUT /:id, e.g. a customer paying more than
// the fixed Booking Amount) — immediately walk forward and apply as much
// of it as possible to the earliest outstanding milestone(s) in sequence,
// splitting across several deposits/milestones as needed. This is now the
// default: the excess never just sits unapplied waiting for a staff click.
// PUT /on-account/:id/apply still exists for any manual top-up/adjustment,
// but in the normal flow it should rarely have anything left to do.
async function autoApplyOnAccount(pool, bookingId, actorUserId, actorEmail) {
  const results = [];
  // Hard safety cap — no real payment plan has anywhere near this many
  // milestones, this just guards against an unexpected infinite loop.
  for (let i = 0; i < 50; i++) {
    const deposit = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id FROM dbo.CrmOnAccountPayment
      WHERE BookingId = @bid AND Amount > AppliedAmount
      ORDER BY CreatedAt ASC
    `);
    if (!deposit.recordset.length) break;

    const milestone = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND Status NOT IN ('${CrmStatus.PAID}', 'Waived') AND AmountDue > ISNULL(AmountPaid, 0)
      ORDER BY MilestoneNo ASC
    `);
    if (!milestone.recordset.length) break;

    const outcome = await applyOnAccountToMilestone(pool, {
      onAccountId: deposit.recordset[0].Id, milestoneId: milestone.recordset[0].Id,
      amount: null, actorUserId, actorEmail,
    });
    if (outcome.error || !outcome.applied) break;
    results.push(outcome);
  }
  return results;
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
    const req0 = pool.request();
    const conds = [
      "b.IsActive = 1",
      "b.Status NOT IN ('Cancelled', 'Rejected')",
      "m.Status NOT IN ('Waived')",
    ];
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
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
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
      ${where}
      ORDER BY b.BookingNo, m.MilestoneNo
    `);

    const rows = result.recordset;
    const summary = {
      pendingCount: 0, pendingAmount: 0,
      demandedCount: 0, demandedAmount: 0,
      paidCount: 0, paidAmount: 0,
      overdueCount: 0, overdueAmount: 0,
    };
    for (const r of rows) {
      const balance = Math.max(0, Number(r.AmountDue || 0) - Number(r.AmountPaid || 0));
      if (r.DemandStatus === CrmStatus.PENDING) { summary.pendingCount++; summary.pendingAmount += balance; }
      else if (r.DemandStatus === CrmStatus.DEMANDED) { summary.demandedCount++; summary.demandedAmount += balance; }
      else if (r.DemandStatus === CrmStatus.PAID) { summary.paidCount++; summary.paidAmount += balance; }
      if (r.IsOverdue && r.DemandStatus !== CrmStatus.PAID) { summary.overdueCount++; summary.overdueAmount += balance; }
    }
    res.json({ demands: rows, summary });
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
// the Sales Deed / Brokerage where applicable, auto-raise the NEXT
// milestone's demand if it's still Pending, and surface the broker-unpaid
// warning. Previously this whole block only lived inline inside
// applyCrmMilestonePaymentApproval, so a milestone settled via the
// on-account sweep (applyOnAccountToMilestone / autoApplyOnAccount) — a
// manual deposit, an overpayment overflow, or a manual on-account apply —
// never triggered any of it. That meant the next milestone's demand simply
// never got raised on that path, and nobody was notified: a bug, not
// intentional behavior. Both settlement paths now call this exact same
// function so the outcome can't depend on which one happened to clear the
// balance.
async function handleMilestoneBecamePaid(pool, { bookingId, bookingNo, milestoneNo, actorUserId }) {
  await maybeAutoCreateSalesDeed(pool, bookingId, actorUserId);
  if (Number(milestoneNo) === 1) {
    await maybeAutoCreateBrokerage(pool, bookingId, actorUserId);
  }
  try {
    const next = await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("mno", sql.Int, milestoneNo)
      .query(`
        SELECT TOP 1 Id, DemandStatus, Status FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND MilestoneNo > @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
        ORDER BY MilestoneNo
      `);
    const nextRow = next.recordset[0];
    if (nextRow && nextRow.DemandStatus === CrmStatus.PENDING) {
      await raiseDemandForMilestone(pool, nextRow.Id, `Auto-raised — milestone #${milestoneNo} payment settled for Booking ${bookingNo || bookingId}`);
    }
  } catch (demandErr) {
    console.error("[crm-payments] next-milestone demand auto-raise failed:", demandErr.message);
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
    const { projectName, milestoneName } = req.body || {};

    const req0 = pool.request();
    const conds = [
      "m.DemandStatus = 'Pending'",
      "b.IsActive = 1",
      "a.Status NOT IN ('Cancelled','Rejected','Expired')",
      "(m.AmountDue - ISNULL(m.AmountPaid, 0)) > 0",
    ];
    if (projectName) {
      req0.input("pname", sql.NVarChar(200), projectName);
      conds.push("b.ProjectName = @pname");
    }
    if (milestoneName) {
      req0.input("mname", sql.NVarChar(200), milestoneName);
      conds.push("m.MilestoneName = @mname");
    }
    const rows = await req0.query(`
      SELECT m.Id
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
    const id = parseInt(req.params.id);
    const result = await raiseDemandForMilestone(pool, id, req.body?.Notes);
    res.json({ success: true, ...result });
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
    const id = parseInt(req.params.id);
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
    const id = parseInt(req.params.id);
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
// enforceBankMandate defaults true for every direct caller (POST /:id/receipts
// below), and — now that CrmApplication.tsx's Details step actually captures
// a Payment Details section (Token Type/Value, Payment Mode, Deposit Bank) —
// also true for createCrmBookingRecord's auto-sync (crmEntityCreation.js).
// Still wrapped in that caller's own try/catch, so a genuinely missing bank
// (e.g. an Application submitted before this field existed) fails the
// auto-receipt-sync alone rather than blocking Booking creation itself;
// staff can then record it manually through the mandate-enforced path like
// any other receipt.
async function createReceiptForMilestone(pool, milestoneId, data, actorUserId, actorEmail, { enforceBankMandate = true } = {}) {
  const amount = parseFloat(data.Amount);
  if (!amount || amount <= 0) throw new ReceiptError("Amount must be greater than 0");

  const target = await pool.request().input("id", sql.Int, milestoneId)
    .query(`
      SELECT m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid,
             bk.ProjectId, bk.ProjectName, bk.CompanyId, bk.ApplicationId, bk.BookingNo,
             a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
      WHERE m.Id = @id
    `);
  if (!target.recordset.length) throw new ReceiptError("Milestone not found", 404);
  const targetRow = target.recordset[0];

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) throw new ReceiptError(activeErr);

  if (enforceBankMandate) {
    const tagged = await pool.request().input("pid", sql.Int, targetRow.ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !data.DepositBankId) {
      throw new ReceiptError("Deposit bank is required for this project");
    }
  }

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    throw new ReceiptError(`Cannot pay "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first`);
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
  const { createReceivedPaymentInternal } = require("./receivedPayment");
  const rp = await createReceivedPaymentInternal(pool, {
    RPReceivedFrom: targetRow.ApplicantName,
    RPCustomerName: targetRow.ApplicantName,
    RPProjectName: targetRow.ProjectName,
    RPProjectId: targetRow.ProjectId,
    RPCompanyId: targetRow.CompanyId,
    RPDocDate: data.ReceivedDate || null,
    RPMode: data.PaymentMode || null,
    RPAmount: amount,
    RPTransactionID: data.TransactionRef || null,
    RPCheckNumber: data.PaymentMode === "Cheque" ? (data.TransactionRef || null) : null,
    RPChequeDate: data.ChequeDate || null,
    RPRemarks: data.Notes || `CRM — ${targetRow.BookingNo} / ${targetRow.MilestoneName}`,
    RPDepositBankId: data.DepositBankId || null,
    RPDepositBankName: data.DepositBankName || null,
    CrmMilestoneId: milestoneId,
    CrmBookingId: targetRow.BookingId,
    CrmApplicationId: targetRow.ApplicationId,
  }, actorEmail || String(actorUserId));
  return { submitted: true, ReceivedPaymentId: rp.RPPaymentID, RPDocNo: rp.RPDocNo, bookingId: targetRow.BookingId };
}

// Runs once Finance actually approves a CRM-linked ReceivedPayment row (see
// receivedPayment.js PUT /:id/approve) — this is where the real CRM side
// effects that createReceiptForMilestone used to do immediately now happen:
// the receipt insert, milestone AmountPaid/Status rollup, GL posting, and
// every downstream auto-trigger (Sales Deed, Possession invoice, Brokerage).
// Deliberately plain pool.request() calls with no explicit SQL transaction —
// matches the exact non-transactional pattern createReceiptForMilestone
// always used (GL posting and the auto-triggers below are each individually
// best-effort/idempotent already), so behavior here is unchanged from before
// this ReceivedPayment detour existed. The predecessor-milestone check is
// re-run here (not just at submission) since two payments can be approved
// out of submission order.
async function applyCrmMilestonePaymentApproval(pool, rp, actorUserId, actorEmail) {
  // Fast validation reads outside any lock — the predecessor-milestone rule
  // and existence check don't need serialising against concurrent apply of
  // an unrelated RP on this same milestone.
  const target = await pool.request().input("id", sql.Int, rp.CrmMilestoneId).query(`
    SELECT m.Id, m.BookingId, m.MilestoneNo, m.MilestoneName, m.AmountDue, b.BookingNo
    FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId
    WHERE m.Id = @id
  `);
  if (!target.recordset.length) throw new ReceiptError("Milestone no longer exists");
  const targetRow = target.recordset[0];

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    throw new ReceiptError(`Cannot approve payment for "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first`);
  }

  const milestoneId = targetRow.Id;
  const amount = Number(rp.RPAmount);
  let receiptId = null, receiptNo = null, overflowAmount = 0, receiptAmount = 0;
  let becamePaid = false;
  let onAccountId = null, onAccountReceiptNo = null, brokerWarning = null;
  const { gstAmount: gstSplitFull, baseAmount: baseSplitFull } = await getGstSplit(pool, targetRow.BookingId, amount);

  // Everything from here reads-then-writes the milestone's outstanding
  // balance — two concurrent RP approvals against the same milestone (two
  // staff processing two separate cheques within seconds of each other)
  // used to both read the same stale AmountPaid and both compute
  // overflowAmount = 0, resulting in the milestone ending up overpaid
  // WITHOUT any CrmOnAccountPayment row for the excess (real bug: the SUM-
  // based rollup correctly totals to the overpaid amount, but nothing
  // parks the excess on-account so the "extra" ₹X just vanishes into the
  // milestone). UPDLOCK+HOLDLOCK on the milestone row inside a transaction
  // serialises any such pair: the second call blocks until the first
  // commits, then re-reads the now-updated AmountPaid and correctly
  // computes overflow against the real remaining balance. Mirrors the
  // exact same fix already applied to applyOnAccountToMilestone.
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const locked = await tx.request().input("id", sql.Int, milestoneId).query(`
      SELECT AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
    const balance = Math.max(0, Number(locked.recordset[0].AmountDue) - Number(locked.recordset[0].AmountPaid || 0));
    receiptAmount = Math.min(amount, balance);
    overflowAmount = Math.round((amount - receiptAmount) * 100) / 100;

    if (receiptAmount > 0) {
      // Reserved from the pool, not this tx — see getNextDocNumber's own
      // pool.transaction() call in docNumber.js; only ConnectionPool has
      // that method, passing a Transaction would throw.
      receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
      // Scale GST split proportionally if receiptAmount < full amount (rest goes on-account)
      const rcpGstRatio = amount > 0 ? gstSplitFull / amount : 0;
      const rcpGst  = Math.round(receiptAmount * rcpGstRatio * 100) / 100;
      const rcpBase = Math.round((receiptAmount - rcpGst) * 100) / 100;
      const insResult = await tx.request()
        .input("no",   sql.NVarChar(30),  receiptNo)
        .input("mid",  sql.Int,           milestoneId)
        .input("amt",  sql.Decimal(18,2), receiptAmount)
        .input("base", sql.Decimal(18,2), rcpBase)
        .input("gst",  sql.Decimal(18,2), rcpGst)
        .input("rdt",  sql.Date,          rp.RPDocDate || null)
        .input("mode", sql.NVarChar(50),  rp.RPMode || null)
        .input("tref", sql.NVarChar(200), rp.RPTransactionID || null)
        .input("cdt",  sql.Date,          rp.RPChequeDate || null)
        .input("note", sql.NVarChar(sql.MAX), rp.RPRemarks || null)
        .input("cb",   sql.Int,           actorUserId)
        .input("bkid", sql.Int,           rp.RPDepositBankId || null)
        .input("bkname", sql.NVarChar(200), rp.RPDepositBankName || null)
        .input("srp",  sql.Int,           rp.RPPaymentID)
        .query(`
          INSERT INTO dbo.CrmPaymentReceipt
            (ReceiptNo, MilestoneId, Amount, BaseAmount, GSTAmount, ReceivedDate, PaymentMode, TransactionRef, ChequeDate, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName, SourceReceivedPaymentId)
          OUTPUT INSERTED.Id
          VALUES (@no, @mid, @amt, @base, @gst, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @cdt, @note, @cb, SYSDATETIME(), @bkid, @bkname, @srp)
        `);
      receiptId = insResult.recordset[0].Id;

      const rollup = await tx.request().input("id", sql.Int, milestoneId).query(`
        UPDATE dbo.CrmPaymentMilestone SET
          AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
          Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                         THEN '${CrmStatus.PAID}' ELSE Status END,
          PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                          THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
          DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                          THEN '${CrmStatus.PAID}' ELSE DemandStatus END,
          UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.Status
        WHERE Id = @id
      `);
      becamePaid = rollup.recordset[0]?.Status === CrmStatus.PAID;
    }

    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch {}
    throw e;
  }

  // Post-commit: GL posting has its own transaction (postCrmReceiptToGL ->
  // postVoucher), so it deliberately runs after the milestone lock releases —
  // never allowed to fail the receipt itself. Same pattern the original code
  // already used; only the pre-INSERT balance read moved inside the lock.
  if (receiptId) {
    try {
      const outcome = await postCrmReceiptToGL(pool, receiptId, actorEmail);
      await recordGLPosting("crm-payment-receipt", receiptId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-payment-receipt", receiptId, { failed: true, reason: glErr.message }, actorEmail);
    }

    if (becamePaid) {
      const outcome = await handleMilestoneBecamePaid(pool, {
        bookingId: targetRow.BookingId, bookingNo: targetRow.BookingNo,
        milestoneNo: targetRow.MilestoneNo, actorUserId,
      });
      brokerWarning = outcome.brokerWarning;
    }
  }

  if (overflowAmount > 0) {
    onAccountReceiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const oaResult = await pool.request()
      .input("no",   sql.NVarChar(30),  onAccountReceiptNo)
      .input("bid",  sql.Int,           targetRow.BookingId)
      .input("amt",  sql.Decimal(18,2), overflowAmount)
      .input("rdt",  sql.Date,          rp.RPDocDate || null)
      .input("mode", sql.NVarChar(50),  rp.RPMode || null)
      .input("tref", sql.NVarChar(200), rp.RPTransactionID || null)
      .input("note", sql.NVarChar(sql.MAX), `Auto-parked — payment for "${targetRow.MilestoneName}" exceeded its due amount by ₹${overflowAmount.toLocaleString("en-IN")}`)
      .input("cb",   sql.Int,           actorUserId)
      .input("bkid", sql.Int,           rp.RPDepositBankId || null)
      .input("bkname", sql.NVarChar(200), rp.RPDepositBankName || null)
      .input("srp",  sql.Int,           rp.RPPaymentID)
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName, SourceReceivedPaymentId)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname, @srp)
      `);
    onAccountId = oaResult.recordset[0].Id;
    try {
      const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
      await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
    }

    // This overflow is exactly the same kind of "money sitting unapplied on
    // the booking" that a manual on-account deposit produces (see POST
    // /booking/:id/on-account below) — it must get the same auto-sweep onto
    // the next due milestone rather than sitting parked until a staff member
    // manually applies it. Previously missing here, which is why a real
    // overpayment (e.g. ABIR DUTTA's ₹198.02 on BKG-2026-00001) stayed
    // Unapplied indefinitely even though the very next milestone (PILING)
    // was open and would have accepted it.
    await autoApplyOnAccount(pool, targetRow.BookingId, actorUserId, actorEmail);
  }

  // Every approved CRM payment gets its own Money Receipt — not just the
  // Booking Amount's first one. Idempotent (see ensureMoneyReceiptForApproved
  // Payment): the Booking Amount's first payment already has one from the
  // separate Pending-MR-first flow, so this just refreshes its PDF; every
  // other payment (a top-up, milestone 2+) gets a new one here for the
  // first time. Best-effort, never allowed to fail the approval itself.
  try {
    const { ensureMoneyReceiptForApprovedPayment } = require("../services/crmMoneyReceiptWorkflow");
    await ensureMoneyReceiptForApprovedPayment(pool, rp.RPPaymentID, actorUserId);
  } catch (mrErr) {
    console.error("[crm-payments] Money Receipt generation on approval failed:", mrErr.message);
  }

  return { receiptId, ReceiptNo: receiptNo, bookingId: targetRow.BookingId, overflowAmount, onAccountId, OnAccountReceiptNo: onAccountReceiptNo, brokerWarning };
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
    .input("bkid", sql.Int,           rp.RPDepositBankId || null)
    .input("bkname", sql.NVarChar(200), rp.RPDepositBankName || null)
    .input("srp",  sql.Int,           rp.RPPaymentID)
    .query(`
      INSERT INTO dbo.CrmOnAccountPayment
        (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName, SourceReceivedPaymentId)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME(), @bkid, @bkname, @srp)
    `);
  const onAccountId = result.recordset[0].Id;

  const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);

  // Same auto-sweep a milestone overflow already gets — the deposit
  // shouldn't sit unapplied any more than an overpayment's overflow does.
  await autoApplyOnAccount(pool, rp.CrmBookingId, actorUserId, actorEmail);

  // Same "every approved CRM payment gets its own Money Receipt" rule as
  // applyCrmMilestonePaymentApproval — an on-account deposit is real money
  // received too, just not tied to a specific milestone yet.
  try {
    const { ensureMoneyReceiptForApprovedPayment } = require("../services/crmMoneyReceiptWorkflow");
    await ensureMoneyReceiptForApprovedPayment(pool, rp.RPPaymentID, actorUserId);
  } catch (mrErr) {
    console.error("[crm-payments] Money Receipt generation on approval failed:", mrErr.message);
  }

  return { ...outcome, onAccountId, ReceiptNo: receiptNo };
}

// POST /:id/receipts — record a receipt against a milestone (supports partial/installment receipts)
router.post("/:id/receipts", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actorEmail = req.user?.email || req.user?.name || null;
    const { ReceivedPaymentId, RPDocNo } = await createReceiptForMilestone(pool, id, req.body, actorId(req), actorEmail);
    res.status(201).json({ success: true, submitted: true, ReceivedPaymentId, RPDocNo });
  } catch (e) {
    if (e instanceof ReceiptError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-payments] POST /:id/receipts error:", e.message);
    res.status(500).json({ error: e.message });
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
        AND b.IsActive = 1 AND b.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')
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
    for (const m of overdue.recordset) {
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
    }
    // NOTE: still no de-dup tracking — running this twice in the same day
    // re-notifies every still-overdue milestone again. Doing this properly
    // needs a DemandEscalatedAt (or similar) column on CrmPaymentMilestone
    // to check/stamp here; flagging rather than guessing at a column that
    // may not exist in this schema yet.
    res.json({ success: true, overdueCount: overdue.recordset.length, notified });
  } catch (e) {
    console.error("[crm-payments] POST /escalate-overdue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — milestone payment schedule for a booking
router.get("/booking/:bookingId", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const [milRes, bkRes] = await Promise.all([
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
        SELECT b.BookingNo, b.Status AS BookingStatus, b.TotalValue, b.UnitNo, b.ProjectId, b.ProjectName, b.BookingAmount,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal, b.UnitParkingGstRate,
               a.ApplicantName, a.Mobile
        FROM dbo.CrmBooking b
        JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE b.Id = @bid
      `),
    ]);
    if (!bkRes.recordset[0]) return res.status(404).json({ error: "Booking not found" });

    // Compute summary
    const milestones = milRes.recordset;
    const totalDue  = milestones.reduce((s, m) => s + (m.AmountDue  || 0), 0);
    const totalPaid = milestones.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    const overdue   = milestones.filter((m) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < new Date()).length;

    res.json({
      booking: bkRes.recordset[0],
      milestones,
      summary: { totalDue, totalPaid, balance: totalDue - totalPaid, overdue },
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
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    if (!b.MilestoneName?.trim()) return res.status(400).json({ error: "MilestoneName is required" });

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Get next MilestoneNo
    const noRes = await pool.request().input("bid", sql.Int, bid)
      .query("SELECT ISNULL(MAX(MilestoneNo),0) + 1 AS NextNo FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
    const nextNo = noRes.recordset[0].NextNo;

    await pool.request()
      .input("bid",   sql.Int,           bid)
      .input("mno",   sql.Int,           nextNo)
      .input("mname", sql.NVarChar(200), b.MilestoneName.trim())
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), b.AmountDue != null ? parseFloat(b.AmountDue) : 0)
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @mno, @mname, @due, @amt, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
      `);
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
    const id = parseInt(req.params.id);

    const paidRaw = b.AmountPaid != null ? parseFloat(b.AmountPaid) : null;
    const amountDueOverride = b.AmountDue != null ? parseFloat(b.AmountDue) : null;

    // Fetch the current row up front — needed for the AmountDue override's
    // %-recompute against the booking's GrandTotal.
    const curRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.AmountDue, m.MilestoneName, bk.GrandTotal, bk.TotalValue, bk.ProjectId
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId
      WHERE m.Id = @id
    `);
    if (!curRes.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const curRow = curRes.recordset[0];

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
        TransactionRef: b.TransactionRef || null,
        DepositBankId: b.DepositBankId || null,
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

    const result = await pool.request()
      .input("id",    sql.Int,           id)
      .input("mname", sql.NVarChar(200), b.MilestoneName || null)
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), amountDueOverride)
      .input("pct",   sql.Decimal(5,2),  percentOverride)
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          MilestoneName  = ISNULL(@mname, MilestoneName),
          DueDate        = ISNULL(@due,   DueDate),
          AmountDue      = ISNULL(@amt,   AmountDue),
          [Percent]      = ISNULL(@pct,   [Percent]),
          RequiredDocuments = ISNULL(@rdocs, RequiredDocuments),
          ResponsibleDepartment = ISNULL(@dept, ResponsibleDepartment),
          Remarks   = @rem,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.BookingId
        WHERE Id = @id
      `);

    const updated = result.recordset[0];

    // Manual override of this milestone's own AmountDue cascades to the
    // OTHER still-open milestones so the schedule keeps summing to
    // GrandTotal — this one stays fixed at what staff just typed in.
    if (amountDueOverride != null && updated?.BookingId) {
      await recalculateRemainingMilestones(pool, updated.BookingId, { fixedMilestoneId: id });

      // Re-run the Paid/DemandStatus rollup for THIS milestone — a manual
      // reduction can retroactively cross the paid threshold against
      // receipts already on file, and that must be reflected immediately
      // rather than waiting on some unrelated future payment event to
      // happen to re-trigger the same CASE logic. If it's still open and
      // already had a formal demand raised against the OLD amount, that
      // demand no longer describes the real balance — reset it to Pending
      // (clearing DemandNo) so it must be consciously re-raised rather than
      // silently misrepresenting what was actually asked for.
      const selfRollup = await pool.request().input("id", sql.Int, id).query(`
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
        await handleMilestoneBecamePaid(pool, {
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
      const staleDemands = await pool.request().input("bid", sql.Int, updated.BookingId).input("fid", sql.Int, id).query(`
        UPDATE dbo.CrmPaymentMilestone SET
          DemandStatus = '${CrmStatus.PENDING}', DemandNo = NULL, DemandRaisedOn = NULL,
          DemandNotes = NULL, DemandRaisedAt = NULL, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.MilestoneName
        WHERE BookingId = @bid AND Id <> @fid AND MilestoneNo <> 1
          AND Status NOT IN ('${CrmStatus.PAID}','Waived') AND ISNULL(AmountPaid,0) = 0 AND DemandStatus = '${CrmStatus.DEMANDED}'
      `);
      if (staleDemands.recordset.length) {
        const bk = await pool.request().input("bid", sql.Int, updated.BookingId)
          .query("SELECT AssignedTo, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
        const bkRow = bk.recordset[0];
        if (bkRow?.AssignedTo) {
          const names = staleDemands.recordset.map((r) => r.MilestoneName).join(", ");
          await emitNotification(pool, bkRow.AssignedTo, "payment_demand_invalidated",
            "Demand amount changed — re-raise required",
            `Booking ${bkRow.BookingNo}: the due amount was recalculated for ${names}. The previously raised demand(s) were reset to "Not Raised" since they no longer match the real balance — please review and re-raise.`,
            updated.BookingId, "crm_booking");
        }
      }
    }

    if (paymentSubmission) {
      return res.json({ success: true, submitted: true, ReceivedPaymentId: paymentSubmission.ReceivedPaymentId, RPDocNo: paymentSubmission.RPDocNo });
    }
    res.json({ success: true });
  } catch (e) {
    if (e instanceof ReceiptError) return res.status(e.status).json({ error: e.message });
    console.error("[crm-payments] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/waive — explicit business decision to waive a milestone. Requires
// a reason so it's auditable, unlike a free Status dropdown pick.
router.put("/:id/waive", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body || {};
    if (!b.Reason) return res.status(400).json({ error: "Reason is required to waive a milestone" });

    const cur = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!cur.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    if (cur.recordset[0].Status === CrmStatus.PAID) {
      return res.status(400).json({ error: "Cannot waive an already-paid milestone" });
    }

    const result = await pool.request()
      .input("id",  sql.Int, id)
      .input("rem", sql.NVarChar(sql.MAX), b.Reason)
      .input("ub",  sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          Status = 'Waived', Remarks = @rem, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.BookingId
        WHERE Id = @id
      `);

    // Auto-flow: a waived milestone can also be the last one outstanding.
    await maybeAutoCreateSalesDeed(pool, result.recordset[0].BookingId, actorId(req));

    res.json({ success: true, status: "Waived" });
  } catch (e) {
    console.error("[crm-payments] waive error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId/on-account — every on-account deposit for this
// booking, plus the balance still unapplied. Used by Welcome Call and the
// Booking Details tab to show "customer has ₹X sitting on account" instead
// of that money just disappearing into a milestone it wasn't actually
// meant for yet.
router.get("/booking/:bookingId/on-account", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const result = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT o.*, cu.name AS CreatedByName,
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
      WHERE o.BookingId = @bid
      ORDER BY o.CreatedAt DESC
    `);
    const rows = result.recordset;
    const available = rows.reduce((s, r) => s + (Number(r.Amount) - Number(r.AppliedAmount)), 0);
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
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const bkRes = await pool.request().input("bid", sql.Int, bid)
      .query("SELECT ProjectId, ProjectName, CompanyId, ApplicationId, BookingNo FROM dbo.CrmBooking WHERE Id = @bid");
    if (!bkRes.recordset.length) return res.status(404).json({ error: "Booking not found" });
    const booking = bkRes.recordset[0];

    // Same rule as a milestone payment: a deposit against a project with one
    // or more tagged bank accounts must say which one it landed in. A
    // project with nothing tagged falls back to the open company bank
    // list, so nothing is mandated there.
    const tagged = await pool.request().input("pid", sql.Int, booking.ProjectId)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmProjectBank WHERE ProjectId = @pid AND IsActive = 1");
    if (tagged.recordset[0].Cnt > 0 && !b.DepositBankId) {
      return res.status(400).json({ error: "Deposit bank is required for this project" });
    }

    const actorEmail = req.user?.email || req.user?.name || null;
    const { createReceivedPaymentInternal } = require("./receivedPayment");
    const rp = await createReceivedPaymentInternal(pool, {
      RPReceivedFrom: booking.BookingNo,
      RPProjectName: booking.ProjectName,
      RPProjectId: booking.ProjectId,
      RPCompanyId: booking.CompanyId,
      RPDocDate: b.ReceivedDate || null,
      RPMode: b.PaymentMode || null,
      RPAmount: amount,
      RPTransactionID: b.TransactionRef || null,
      RPRemarks: b.Notes || `CRM on-account deposit — ${booking.BookingNo}`,
      RPDepositBankId: b.DepositBankId || null,
      RPDepositBankName: b.DepositBankName || null,
      CrmBookingId: bid,
      CrmApplicationId: booking.ApplicationId,
    }, actorEmail || String(actorId(req)));

    res.status(201).json({ success: true, submitted: true, ReceivedPaymentId: rp.RPPaymentID, RPDocNo: rp.RPDocNo });
  } catch (e) {
    console.error("[crm-payments] POST /booking/:id/on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /on-account/:id/apply — now mostly a manual override/adjustment
// path, since the default flow (autoApplyOnAccount) already sweeps new
// on-account money onto the next due milestone automatically the moment it
// lands. Still available for staff to explicitly redirect or top up a
// specific milestone. Delegates to the same applyOnAccountToMilestone the
// auto-sweep uses, so both paths enforce identical rules (sequencing,
// balance caps, GL posting, auto-flow triggers) and can't drift apart.
router.put("/on-account/:id/apply", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const onAccountId = parseInt(req.params.id);
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

module.exports = router;
// Reused by crmEntityCreation.js's createCrmBookingRecord to sync an
// Application-stage token payment onto the new Booking's first milestone.
module.exports.createReceiptForMilestone = createReceiptForMilestone;
module.exports.applyCrmMilestonePaymentApproval = applyCrmMilestonePaymentApproval;
module.exports.applyCrmOnAccountPaymentApproval = applyCrmOnAccountPaymentApproval;
module.exports.autoApplyOnAccount = autoApplyOnAccount;
module.exports.ReceiptError = ReceiptError;
module.exports.raiseDemandForMilestone = raiseDemandForMilestone;
