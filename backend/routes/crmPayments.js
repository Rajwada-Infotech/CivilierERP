const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, isSaAdmin } = require("../services/saAccess");
const { emitNotification } = require("../services/notify");
const { getNextDocNumber } = require("../services/docNumber");
const { maybeAutoCreateSalesDeed, maybeAutoGenerateInvoice, maybeAutoCreateBrokerage, requireActiveBooking, recalculateRemainingMilestones } = require("../services/crmWorkflowGuards");
const { postCrmReceiptToGL, postCrmOnAccountToGL, postCrmOnAccountApplied } = require("../services/crmLedger");
const { recordGLPosting } = require("../services/approvalService");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

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
    WHERE BookingId = @bid AND Status IN ('Pending', 'Approved')
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
    const { status, search } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status && ["Pending", "Demanded", "Paid"].includes(status)) {
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
             a.ApplicantName, a.Mobile
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY CASE WHEN m.DemandStatus = 'Pending' THEN 0 ELSE 1 END, m.DueDate ASC, b.BookingNo, m.MilestoneNo
    `);

    const rows = result.recordset;
    const summary = {
      pendingCount: 0, pendingAmount: 0,
      demandedCount: 0, demandedAmount: 0,
      paidCount: 0, paidAmount: 0,
    };
    for (const r of rows) {
      const balance = Number(r.AmountDue || 0) - Number(r.AmountPaid || 0);
      if (r.DemandStatus === "Pending") { summary.pendingCount++; summary.pendingAmount += balance; }
      else if (r.DemandStatus === "Demanded") { summary.demandedCount++; summary.demandedAmount += balance; }
      else if (r.DemandStatus === "Paid") { summary.paidCount++; summary.paidAmount += balance; }
    }
    res.json({ demands: rows, summary });
  } catch (e) {
    console.error("[crm-payments] GET /demands error:", e.message);
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
    const m = await pool.request().input("id", sql.Int, id).query(`
      SELECT m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.Status, m.DemandStatus,
             b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Id = @id
    `);
    if (!m.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const row = m.recordset[0];
    if (row.Status === "Paid" || row.Status === "Waived") {
      return res.status(400).json({ error: `This milestone is already ${row.Status.toLowerCase()} — nothing to demand` });
    }
    if (row.DemandStatus !== "Pending") {
      return res.status(400).json({ error: `Cannot raise demand — current status is ${row.DemandStatus}` });
    }

    const balance = (row.AmountDue || 0) - (row.AmountPaid || 0);
    const demandNo = buildDemandNo(row.BookingNo, row.MilestoneNo);
    const demandRaisedOn = new Date().toISOString().slice(0, 10);
    const notes = (req.body?.Notes || "").trim() || null;

    await pool.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar(60), demandNo)
      .input("dt", sql.Date, demandRaisedOn)
      .input("notes", sql.NVarChar(500), notes)
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          DemandStatus = 'Demanded', DemandNo = @no, DemandRaisedOn = @dt,
          DemandNotes = ISNULL(@notes, DemandNotes),
          DemandRaisedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    if (row.AssignedTo) {
      await emitNotification(pool, row.AssignedTo, "payment_demand",
        "Payment Demand Raised",
        `${row.ApplicantName} · ${row.BookingNo} — ${row.MilestoneName} demand raised (₹${balance.toLocaleString("en-IN")})`,
        id, "payment_milestone");
    }
    res.json({ success: true, DemandNo: demandNo, DemandRaisedOn: demandRaisedOn });
  } catch (e) {
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
    if (cur.recordset[0].DemandStatus === "Paid") {
      return res.status(400).json({ error: "Cannot undo a demand that's already paid" });
    }

    await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        DemandStatus = 'Pending', DemandNo = NULL, DemandRaisedOn = NULL,
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
async function createReceiptForMilestone(pool, milestoneId, data, actorUserId, actorEmail) {
  const amount = parseFloat(data.Amount);
  if (!amount || amount <= 0) throw new ReceiptError("Amount must be greater than 0");

  const target = await pool.request().input("id", sql.Int, milestoneId)
    .query("SELECT BookingId, MilestoneNo, MilestoneName FROM dbo.CrmPaymentMilestone WHERE Id = @id");
  if (!target.recordset.length) throw new ReceiptError("Milestone not found", 404);
  const targetRow = target.recordset[0];

  const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
  if (activeErr) throw new ReceiptError(activeErr);

  const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
    .query(`
      SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('Paid', 'Waived')
      ORDER BY MilestoneNo
    `);
  if (earlier.recordset.length) {
    throw new ReceiptError(`Cannot pay "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first`);
  }

  const receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
  const insResult = await pool.request()
    .input("no",   sql.NVarChar(30),  receiptNo)
    .input("mid",  sql.Int,           milestoneId)
    .input("amt",  sql.Decimal(18,2), amount)
    .input("rdt",  sql.Date,          data.ReceivedDate || null)
    .input("mode", sql.NVarChar(50),  data.PaymentMode || null)
    .input("tref", sql.NVarChar(200), data.TransactionRef || null)
    .input("cdt",  sql.Date,          data.ChequeDate || null)
    .input("note", sql.NVarChar(sql.MAX), data.Notes || null)
    .input("cb",   sql.Int,           actorUserId)
    .input("bkid", sql.Int,           data.DepositBankId ? parseInt(data.DepositBankId) : null)
    .input("bkname", sql.NVarChar(200), data.DepositBankName || null)
    .query(`
      INSERT INTO dbo.CrmPaymentReceipt
        (ReceiptNo, MilestoneId, Amount, ReceivedDate, PaymentMode, TransactionRef, ChequeDate, Notes, CreatedBy, CreatedAt, DepositBankId, DepositBankName)
      OUTPUT INSERTED.Id
      VALUES (@no, @mid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @cdt, @note, @cb, SYSDATETIME(), @bkid, @bkname)
    `);
  const receiptId = insResult.recordset[0].Id;

  // Roll up receipts into the milestone's AmountPaid / Status. A milestone
  // that just became Paid also settles its own demand (if one was ever
  // raised) — DemandStatus tracks real money received, not left dangling
  // at 'Demanded' forever once the customer has actually paid.
  const rollup = await pool.request().input("id", sql.Int, milestoneId).query(`
    UPDATE dbo.CrmPaymentMilestone SET
      AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
      Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                     THEN 'Paid' ELSE Status END,
      PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                      THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
      DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                      THEN 'Paid' ELSE DemandStatus END,
      UpdatedAt = SYSDATETIME()
    OUTPUT INSERTED.Status
    WHERE Id = @id
  `);

  // Post to the core Finance GL — money actually received. Never allowed
  // to fail the receipt itself; outcome logged to dbo.GLPostingLog so an
  // unposted receipt is findable, same as every other GL-posting module.
  try {
    const outcome = await postCrmReceiptToGL(pool, receiptId, actorEmail);
    await recordGLPosting("crm-payment-receipt", receiptId, outcome, actorEmail);
  } catch (glErr) {
    await recordGLPosting("crm-payment-receipt", receiptId, { failed: true, reason: glErr.message }, actorEmail);
  }

  // This milestone may have just been the last one outstanding — the direct
  // milestone-edit (PUT /:id) and /waive routes already fire this same check
  // on the same "just became Paid/Waived" trigger; recording payment via a
  // real receipt (the properly-accounted path, with GL posting and cheque/
  // transaction tracking) was the one route missing it, leaving Sales Deed
  // and the Possession invoice stuck waiting on staff to notice even though
  // every milestone was genuinely settled.
  if (rollup.recordset[0]?.Status === "Paid") {
    await maybeAutoCreateSalesDeed(pool, targetRow.BookingId, actorUserId);
    await maybeAutoGenerateInvoice(pool, targetRow.BookingId, actorUserId);

    // Brokerage's own trigger is Milestone #1 specifically becoming Paid —
    // unlike the two guards above, which react to "all milestones settled" —
    // so it needs its own inline condition, not the same "Paid" check reused.
    if (targetRow.MilestoneNo === 1) {
      await maybeAutoCreateBrokerage(pool, targetRow.BookingId, actorUserId);
    }
  }

  return { receiptId, ReceiptNo: receiptNo, bookingId: targetRow.BookingId };
}

// POST /:id/receipts — record a receipt against a milestone (supports partial/installment receipts)
router.post("/:id/receipts", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const actorEmail = req.user?.email || req.user?.name || null;
    const { ReceiptNo } = await createReceiptForMilestone(pool, id, req.body, actorId(req), actorEmail);
    res.status(201).json({ success: true, ReceiptNo });
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
    const overdue = await pool.request().query(`
      SELECT m.Id, m.MilestoneName, m.AmountDue, m.AmountPaid, m.DueDate,
             b.BookingNo, b.AssignedTo, a.ApplicantName
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Status = 'Pending' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
    `);
    let notified = 0;
    for (const m of overdue.recordset) {
      const balance = (m.AmountDue || 0) - (m.AmountPaid || 0);
      if (m.AssignedTo) {
        await emitNotification(pool, m.AssignedTo, "payment_overdue",
          "Payment Overdue",
          `${m.ApplicantName} · ${m.BookingNo} — ${m.MilestoneName} overdue (₹${balance.toLocaleString("en-IN")} pending)`,
          m.Id, "payment_milestone");
        notified++;
      }
    }
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
        SELECT m.*, cu.name AS CreatedByName
        FROM dbo.CrmPaymentMilestone m
        LEFT JOIN dbo.Users cu ON cu.id = m.CreatedBy
        WHERE m.BookingId = @bid
        ORDER BY m.MilestoneNo
      `),
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT b.BookingNo, b.TotalValue, b.UnitNo, b.ProjectName, b.BookingAmount,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
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
    const overdue   = milestones.filter((m) => m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date()).length;

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

    const paid = b.AmountPaid != null ? parseFloat(b.AmountPaid) : null;
    const amountDueOverride = b.AmountDue != null ? parseFloat(b.AmountDue) : null;

    // A manual AmountDue override changes this milestone's own weight in
    // the schedule — recompute its stored Percent alongside it (against the
    // booking's current GrandTotal), or the % shown right next to the new
    // ₹ figure would silently go stale.
    let percentOverride = null;
    if (amountDueOverride != null) {
      const bk = await pool.request().input("id", sql.Int, id).query(`
        SELECT bk.GrandTotal, bk.TotalValue FROM dbo.CrmPaymentMilestone m
        JOIN dbo.CrmBooking bk ON bk.Id = m.BookingId WHERE m.Id = @id
      `);
      const grandTotal = Number(bk.recordset[0]?.GrandTotal || bk.recordset[0]?.TotalValue || 0);
      if (grandTotal > 0) percentOverride = Math.round((amountDueOverride / grandTotal) * 10000) / 100;
    }

    const result = await pool.request()
      .input("id",    sql.Int,           id)
      .input("mname", sql.NVarChar(200), b.MilestoneName || null)
      .input("due",   sql.Date,          b.DueDate || null)
      .input("amt",   sql.Decimal(18,2), amountDueOverride)
      .input("pct",   sql.Decimal(5,2),  percentOverride)
      .input("paid",  sql.Decimal(18,2), paid)
      .input("pdate", sql.Date,          b.PaidDate || null)
      .input("pmode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref",  sql.NVarChar(200), b.TransactionRef || null)
      .input("rdocs", sql.NVarChar(sql.MAX), b.RequiredDocuments || null)
      .input("dept",  sql.NVarChar(100), b.ResponsibleDepartment || null)
      .input("rem",   sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("bkid",  sql.Int,           b.DepositBankId ? parseInt(b.DepositBankId) : null)
      .input("bkname",sql.NVarChar(200), b.DepositBankName || null)
      .input("ub",    sql.Int,           actorId(req))
      .query(`
        UPDATE dbo.CrmPaymentMilestone SET
          MilestoneName  = ISNULL(@mname, MilestoneName),
          DueDate        = ISNULL(@due,   DueDate),
          AmountDue      = ISNULL(@amt,   AmountDue),
          [Percent]      = ISNULL(@pct,   [Percent]),
          AmountPaid     = ISNULL(@paid,  AmountPaid),
          PaidDate       = ISNULL(@pdate, PaidDate),
          PaymentMode    = ISNULL(@pmode, PaymentMode),
          TransactionRef = ISNULL(@tref,  TransactionRef),
          RequiredDocuments = ISNULL(@rdocs, RequiredDocuments),
          ResponsibleDepartment = ISNULL(@dept, ResponsibleDepartment),
          DepositBankId   = ISNULL(@bkid,   DepositBankId),
          DepositBankName = ISNULL(@bkname, DepositBankName),
          Status = CASE
            WHEN Status = 'Waived' THEN Status
            WHEN @paid IS NOT NULL AND @paid >= AmountDue THEN 'Paid'
            ELSE Status
          END,
          DemandStatus = CASE
            WHEN @paid IS NOT NULL AND @paid >= AmountDue THEN 'Paid'
            ELSE DemandStatus
          END,
          Remarks   = @rem,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        OUTPUT INSERTED.BookingId, INSERTED.Status
        WHERE Id = @id
      `);

    // Auto-flow: this milestone may have just been the last one outstanding —
    // fire the auto-create check (no-op unless the agreement is also Executed).
    const updated = result.recordset[0];
    let brokerWarning = null;
    if (updated?.Status === "Paid") {
      await maybeAutoCreateSalesDeed(pool, updated.BookingId, actorId(req));
      await maybeAutoGenerateInvoice(pool, updated.BookingId, actorId(req));
      brokerWarning = await warnIfBrokerUnpaid(pool, updated.BookingId, actorId(req));
    }

    // Manual override of this milestone's own AmountDue cascades to the
    // OTHER still-open milestones so the schedule keeps summing to
    // GrandTotal — this one stays fixed at what staff just typed in.
    if (amountDueOverride != null && updated?.BookingId) {
      await recalculateRemainingMilestones(pool, updated.BookingId, { fixedMilestoneId: id });
    }

    res.json({ success: true, brokerWarning });
  } catch (e) {
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
    if (cur.recordset[0].Status === "Paid") {
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
    await maybeAutoGenerateInvoice(pool, result.recordset[0].BookingId, actorId(req));

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
      SELECT o.*, cu.name AS CreatedByName
      FROM dbo.CrmOnAccountPayment o
      LEFT JOIN dbo.Users cu ON cu.id = o.CreatedBy
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

// POST /booking/:bookingId/on-account — record a new on-account deposit.
// Not tied to any milestone at creation time — that's the whole point;
// it's applied later via PUT /on-account/:id/apply, possibly split across
// several milestones as they come due.
router.post("/booking/:bookingId/on-account", requirePageRight("crm-payments", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const amount = parseFloat(b.Amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const receiptNo = await getNextDocNumber(pool, "OACC", "OACC");
    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  receiptNo)
      .input("bid",  sql.Int,           bid)
      .input("amt",  sql.Decimal(18,2), amount)
      .input("rdt",  sql.Date,          b.ReceivedDate || null)
      .input("mode", sql.NVarChar(50),  b.PaymentMode || null)
      .input("tref", sql.NVarChar(200), b.TransactionRef || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmOnAccountPayment
          (ReceiptNo, BookingId, Amount, ReceivedDate, PaymentMode, TransactionRef, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @amt, ISNULL(@rdt, CAST(SYSDATETIME() AS DATE)), @mode, @tref, @note, @cb, SYSDATETIME())
      `);
    const onAccountId = result.recordset[0].Id;

    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      const outcome = await postCrmOnAccountToGL(pool, onAccountId, actorEmail);
      await recordGLPosting("crm-on-account-payment", onAccountId, outcome, actorEmail);
    } catch (glErr) {
      await recordGLPosting("crm-on-account-payment", onAccountId, { failed: true, reason: glErr.message }, actorEmail);
    }

    res.status(201).json({ success: true, id: onAccountId, ReceiptNo: receiptNo });
  } catch (e) {
    console.error("[crm-payments] POST /booking/:id/on-account error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /on-account/:id/apply — allocate (some or all of) an on-account
// deposit's remaining balance to a specific milestone. Re-uses the exact
// same receipt-insert + AmountPaid/Status rollup that POST /:id/receipts
// uses, and the exact same "earlier milestones must already be Paid/
// Waived" sequencing guard — on-account money still can't be used to skip
// ahead in the payment plan, only to pre-fund the milestone that's
// actually next.
router.put("/on-account/:id/apply", requirePageRight("crm-payments", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const onAccountId = parseInt(req.params.id);
    const b = req.body;
    const milestoneId = parseInt(b.MilestoneId);
    if (!milestoneId) return res.status(400).json({ error: "MilestoneId is required" });

    const oa = await pool.request().input("id", sql.Int, onAccountId)
      .query("SELECT BookingId, Amount, AppliedAmount FROM dbo.CrmOnAccountPayment WHERE Id = @id");
    if (!oa.recordset.length) return res.status(404).json({ error: "On-account payment not found" });
    const oaRow = oa.recordset[0];
    const remaining = Number(oaRow.Amount) - Number(oaRow.AppliedAmount);

    const target = await pool.request().input("id", sql.Int, milestoneId)
      .query("SELECT BookingId, MilestoneNo, MilestoneName, AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (!target.recordset.length) return res.status(404).json({ error: "Milestone not found" });
    const targetRow = target.recordset[0];
    if (targetRow.BookingId !== oaRow.BookingId) {
      return res.status(400).json({ error: "This on-account deposit belongs to a different booking" });
    }

    const activeErr = await requireActiveBooking(pool, targetRow.BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const earlier = await pool.request().input("bid", sql.Int, targetRow.BookingId).input("mno", sql.Int, targetRow.MilestoneNo)
      .query(`
        SELECT TOP 1 MilestoneName FROM dbo.CrmPaymentMilestone
        WHERE BookingId = @bid AND MilestoneNo < @mno AND Status NOT IN ('Paid', 'Waived')
        ORDER BY MilestoneNo
      `);
    if (earlier.recordset.length) {
      return res.status(400).json({ error: `Cannot apply to "${targetRow.MilestoneName}" — "${earlier.recordset[0].MilestoneName}" is still due first` });
    }

    const milestoneBalance = Number(targetRow.AmountDue) - Number(targetRow.AmountPaid || 0);
    const requested = b.Amount != null ? parseFloat(b.Amount) : Math.min(remaining, milestoneBalance);
    if (!requested || requested <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });
    if (requested > remaining) return res.status(400).json({ error: `Only ₹${remaining.toLocaleString("en-IN")} is available on this deposit` });
    if (requested > milestoneBalance) return res.status(400).json({ error: `This milestone only needs ₹${milestoneBalance.toLocaleString("en-IN")} more` });

    const receiptNo = await getNextDocNumber(pool, "RCP", "RCP");
    await pool.request()
      .input("no",  sql.NVarChar(30),  receiptNo)
      .input("mid", sql.Int,           milestoneId)
      .input("amt", sql.Decimal(18,2), requested)
      .input("oaid",sql.Int,           onAccountId)
      .input("cb",  sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentReceipt
          (ReceiptNo, MilestoneId, Amount, ReceivedDate, PaymentMode, Notes, OnAccountPaymentId, CreatedBy, CreatedAt)
        VALUES (@no, @mid, @amt, CAST(SYSDATETIME() AS DATE), 'OnAccount', 'Applied from on-account deposit', @oaid, @cb, SYSDATETIME())
      `);

    await pool.request().input("id", sql.Int, milestoneId).query(`
      UPDATE dbo.CrmPaymentMilestone SET
        AmountPaid = (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id),
        Status = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                       THEN 'Paid' ELSE Status END,
        PaidDate = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN CAST(SYSDATETIME() AS DATE) ELSE PaidDate END,
        DemandStatus = CASE WHEN (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmPaymentReceipt WHERE MilestoneId = @id) >= AmountDue
                        THEN 'Paid' ELSE DemandStatus END,
        UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

    const newApplied = Number(oaRow.AppliedAmount) + requested;
    await pool.request()
      .input("id", sql.Int, onAccountId)
      .input("applied", sql.Decimal(18,2), newApplied)
      .input("status", sql.NVarChar(20), newApplied >= Number(oaRow.Amount) ? "Applied" : "PartiallyApplied")
      .query("UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = @applied, Status = @status WHERE Id = @id");

    // Not new cash — the deposit's cash was already posted to GL when it was
    // received. This just moves the party's advance balance (OnAccountLedger)
    // from "unapplied" to "applied against this milestone."
    const actorEmail = req.user?.email || req.user?.name || null;
    try {
      await postCrmOnAccountApplied(pool, onAccountId, requested, actorEmail);
    } catch (glErr) {
      console.error("[crm-payments] postCrmOnAccountApplied failed:", glErr.message);
    }

    const finalCheck = await pool.request().input("id", sql.Int, milestoneId).query("SELECT Status FROM dbo.CrmPaymentMilestone WHERE Id = @id");
    if (finalCheck.recordset[0]?.Status === "Paid") {
      await maybeAutoCreateSalesDeed(pool, targetRow.BookingId, actorId(req));
      await maybeAutoGenerateInvoice(pool, targetRow.BookingId, actorId(req));
    }

    res.json({ success: true, applied: requested, remaining: remaining - requested });
  } catch (e) {
    console.error("[crm-payments] PUT /on-account/:id/apply error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
// Reused by crmEntityCreation.js's createCrmBookingRecord to sync an
// Application-stage token payment onto the new Booking's first milestone.
module.exports.createReceiptForMilestone = createReceiptForMilestone;
