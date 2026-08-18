const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { maybeAutoCreateAgreement, requireActiveBooking } = require("../services/crmWorkflowGuards");
const { logCommunication } = require("../services/crmCommunicationLog");
const { emitNotification } = require("../services/notify");

router.use(authMiddleware);
router.use(apiRateLimit);

const WC_SELECT = `
  SELECT
    wc.Id, wc.BookingId, wc.CalledBy, wc.CallDate, wc.DurationSeconds,
    wc.Outcome, wc.NextCallDate, wc.Notes, wc.CustomFields, wc.PreferredAgreementDate,
    wc.PaymentPlanConfirmed, wc.PaymentPlanConfirmedAt, wc.CreatedAt,
    u.name  AS CalledByName,
    b.BookingNo, b.UnitNo, b.ProjectName,
    a.ApplicantName, a.Mobile
  FROM dbo.CrmWelcomeCall wc
  JOIN  dbo.CrmBooking b     ON b.Id = wc.BookingId
  JOIN  dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.Users u      ON u.id = wc.CalledBy
`;

const OUTCOMES = ["Welcomed","NotReachable","RequestedCallback","VoiceMail","Busy","SwitchedOff"];

// GET /queue — the work queue: Approved bookings that still need a welcome
// call, or have a callback due today/overdue. Never Cancelled/Rejected/
// Pending bookings — those have no business being called yet.
router.get("/queue", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id AS BookingId, b.BookingNo, b.UnitNo, b.ProjectName, b.BookingDate,
        a.ApplicantName, a.Mobile,
        last.Id AS LastCallId, last.Outcome AS LastOutcome, last.CallDate AS LastCallDate,
        last.NextCallDate,
        streak.ConsecutiveNonReached
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      OUTER APPLY (
        SELECT TOP 1 Id, Outcome, CallDate, NextCallDate
        FROM dbo.CrmWelcomeCall
        WHERE BookingId = b.Id
        ORDER BY CallDate DESC, CreatedAt DESC
      ) last
      OUTER APPLY (
        SELECT COUNT(*) AS ConsecutiveNonReached
        FROM (
          SELECT TOP 100 Outcome
          FROM dbo.CrmWelcomeCall
          WHERE BookingId = b.Id
          ORDER BY CallDate DESC, CreatedAt DESC
        ) recent
        WHERE recent.Outcome IN ('NotReachable','Busy','SwitchedOff','VoiceMail')
      ) streak
      WHERE b.Status = 'Approved' AND b.IsActive = 1
        AND (
          last.Id IS NULL
          OR (last.Outcome <> 'Welcomed' AND (last.NextCallDate IS NULL OR last.NextCallDate <= CAST(SYSDATETIME() AS DATE)))
        )
      ORDER BY ISNULL(last.NextCallDate, b.BookingDate)
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-calls] GET /queue error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId/checklist — aggregate status of every intake step for one
// booking, so the detail panel can show a single progress checklist instead
// of staff hopping between pages to check each one manually.
router.get("/:bookingId/checklist", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const [welcome, callCount, docs, coApplicants, bankDetail, noc, agreement] = await Promise.all([
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = @bid ORDER BY CallDate DESC, CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmWelcomeCall WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Total, SUM(CASE WHEN IsVerified = 1 THEN 1 ELSE 0 END) AS Verified FROM dbo.CrmBookingDocument WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1"),
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT TOP 1 CASE WHEN
          NULLIF(LTRIM(RTRIM(ISNULL(BankName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(IfscCode, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AccountHolderName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(NomineeName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(NomineeRelation, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(PanNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(AadhaarNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(Occupation, ''))), '') IS NOT NULL
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsComplete
        FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid
      `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT Id, NocType, Status FROM dbo.CrmNoc WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
    ]);

    res.json({
      // done: the real "Welcome Call page finished cleanly" signal (Welcomed
      // specifically). called: at least one call attempt is on file, even if
      // it hasn't landed on Welcomed yet — lets the frontend show yellow
      // ("in progress") instead of collapsing "never called" and "called but
      // not yet Welcomed" into the same blank state.
      welcomeCall: { done: welcome.recordset[0]?.Outcome === "Welcomed", called: (callCount.recordset[0]?.Cnt || 0) > 0 },
      documents: { total: docs.recordset[0]?.Total || 0, verified: docs.recordset[0]?.Verified || 0 },
      coApplicants: { count: coApplicants.recordset[0]?.Cnt || 0 },
      // started: a CrmCustomerBankDetail row exists at all (even partially
      // filled) — distinct from complete, so the frontend can show yellow
      // for "in progress" instead of only blank/green.
      bankDetails: { started: bankDetail.recordset.length > 0, complete: !!bankDetail.recordset[0]?.IsComplete },
      noc: noc.recordset,
      agreement: agreement.recordset[0] || null,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/checklist error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:bookingId/call-context — everything a telecaller needs on-screen
// DURING the call: what's outstanding, what's already been invoiced, the
// customer's bank/loan preference on file, the assigned payment plan, and
// any on-account credit sitting unapplied — one fetch instead of the
// telecaller (or the page) hopping across four separate pages mid-call.
router.get("/:bookingId/call-context", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bookingId = parseInt(req.params.bookingId);

    const [bkRes, custRes, milRes, invRes, loanRes, oaRes, mrRes, streakRes] = await Promise.all([
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.BookingAmount, b.GrandTotal,
               b.ParkingTotal, b.ExtraChargesTotal, b.UnitGstAmount,
               b.PaymentPlanId, pp.PlanName AS PaymentPlanName,
               a.ApplicantName, a.Mobile, a.Email
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = b.PaymentPlanId
        WHERE b.Id = @bid
      `),
      // Address columns added for the "Communication address confirmed"
      // checklist item (welcome-checklist.js's PersonalContact section) —
      // this call-context route used to only carry Name/Mobile/Email/PAN,
      // so that item had no data anywhere on the page to actually check
      // against. Current* wins when set (the customer's real mailing
      // address); falls back to the permanent Address/City/State/Pincode
      // otherwise, same precedence CrmCustomers.tsx's own display uses.
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT c.CustomerName, c.Mobile, c.Email, c.PanNo,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentAddress)), ''), c.Address) AS Address,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentCity)), ''), c.City) AS City,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentState)), ''), c.State) AS State,
               ISNULL(NULLIF(LTRIM(RTRIM(c.CurrentPincode)), ''), c.Pincode) AS Pincode
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id
        WHERE b.Id = @bid
      `),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT MilestoneName, AmountDue, AmountPaid, Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT InvoiceNo, InvoiceType, Amount, InvoiceDate FROM dbo.CrmInvoice WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT BankName, LoanAmount, SanctionStatus, LoanAccountNo FROM dbo.CrmLoanDetail WHERE BookingId = @bid"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ReceiptNo, Amount, AppliedAmount, Status FROM dbo.CrmOnAccountPayment WHERE BookingId = @bid ORDER BY CreatedAt DESC"),
      pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ISNULL(SUM(Amount), 0) AS MRTotal FROM dbo.CrmMoneyReceipt WHERE BookingId = @bid AND Status IN ('Pending','Approved')"),
      pool.request().input("bid", sql.Int, bookingId).query(`
        SELECT COUNT(*) AS ConsecutiveNonReached
        FROM (
          SELECT TOP 100 Outcome
          FROM dbo.CrmWelcomeCall WHERE BookingId = @bid
          ORDER BY CallDate DESC, CreatedAt DESC
        ) recent
        WHERE recent.Outcome IN ('NotReachable','Busy','SwitchedOff','VoiceMail')
      `),
    ]);
    if (!bkRes.recordset.length) return res.status(404).json({ error: "Booking not found" });

    const milestones = milRes.recordset;
    const totalDue = milestones.reduce((s, m) => s + (m.AmountDue || 0), 0);
    const totalPaid = milestones.reduce((s, m) => s + (m.AmountPaid || 0), 0);
    const onAccountBalance = oaRes.recordset.reduce((s, r) => s + (Number(r.Amount) - Number(r.AppliedAmount)), 0);
    const mrReceived = Number(mrRes.recordset[0]?.MRTotal || 0);

    res.json({
      booking: bkRes.recordset[0],
      customer: custRes.recordset[0] || null,
      outstanding: { totalDue, totalPaid, balance: totalDue - totalPaid },
      invoices: invRes.recordset,
      loan: loanRes.recordset[0] || null,
      onAccount: { payments: oaRes.recordset, availableBalance: onAccountBalance },
      mrReceived,
      consecutiveNonReached: streakRes.recordset[0]?.ConsecutiveNonReached ?? 0,
    });
  } catch (e) {
    console.error("[crm-welcome-calls] GET /:bookingId/call-context error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET / — all welcome calls
router.get("/", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { bookingId, pending } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (bookingId) { req0.input("bid", sql.Int, parseInt(bookingId)); conds.push("wc.BookingId = @bid"); }
    if (pending === "1") conds.push("wc.NextCallDate <= CAST(SYSDATETIME() AS DATE)");
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${WC_SELECT} ${where} ORDER BY wc.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-welcome-calls] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — log a welcome call
router.post("/", requirePageRight("crm-welcome-calls", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const activeErr = await requireActiveBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Idempotency window: reject a duplicate log for the same booking + outcome
    // within 30 seconds (catches slow-network double-submits from the frontend).
    const recent = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .input("out", sql.NVarChar(50), b.Outcome || null)
      .query(`SELECT TOP 1 Id FROM dbo.CrmWelcomeCall
              WHERE BookingId = @bid AND Outcome = @out
              AND CreatedAt >= DATEADD(second, -30, SYSDATETIME())`);
    if (recent.recordset.length) {
      return res.status(409).json({ error: "A call log with the same outcome was just submitted for this booking — please wait a moment before submitting again." });
    }

    if (b.Outcome && !OUTCOMES.includes(b.Outcome))
      return res.status(400).json({ error: `Invalid Outcome. Must be: ${OUTCOMES.join(", ")}` });

    // A customer explicitly declining the payment plan is a real business
    // problem, not a silent checkbox left unticked — staff must say why, so
    // whoever picks it up next (Communication Log) has something to act on
    // rather than just "not confirmed".
    if (b.PaymentPlanConfirmed === false && !String(b.PaymentPlanDisputeReason || "").trim()) {
      return res.status(400).json({ error: "A reason is required when the customer does not agree to the payment plan" });
    }

    // Ad-hoc custom fields: array of {key, value} the caller can freely add
    // to at call time, no admin setup needed — stored as JSON, never parsed
    // into columns.
    let customFieldsJson = null;
    if (Array.isArray(b.CustomFields) && b.CustomFields.length) {
      const cleaned = b.CustomFields
        .filter((f) => f && String(f.key || "").trim())
        .map((f) => ({ key: String(f.key).trim(), value: String(f.value ?? "").trim() }));
      if (cleaned.length) customFieldsJson = JSON.stringify(cleaned);
    }

    const bookingId = parseInt(b.BookingId);
    await pool.request()
      .input("bid",  sql.Int,           bookingId)
      .input("cb",   sql.Int,           b.CalledBy ? parseInt(b.CalledBy) : actorId(req))
      .input("dt",   sql.DateTime2(3),  b.CallDate || null)
      .input("dur",  sql.Int,           b.DurationSeconds ? parseInt(b.DurationSeconds) : null)
      .input("out",  sql.NVarChar(50),  b.Outcome || null)
      .input("ncd",  sql.Date,          b.NextCallDate || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cf",   sql.NVarChar(sql.MAX), customFieldsJson)
      .input("pad",  sql.Date,          b.PreferredAgreementDate || null)
      .input("ppc",  sql.Bit,           b.PaymentPlanConfirmed === true ? 1 : b.PaymentPlanConfirmed === false ? 0 : null)
      .input("ppcat",sql.DateTime2(3),  b.PaymentPlanConfirmed === true ? new Date() : null)
      .input("ppr",  sql.NVarChar(500), b.PaymentPlanConfirmed === false ? String(b.PaymentPlanDisputeReason).trim() : null)
      .input("acb",  sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmWelcomeCall
          (BookingId, CalledBy, CallDate, DurationSeconds, Outcome, NextCallDate, Notes, CustomFields, PreferredAgreementDate, PaymentPlanConfirmed, PaymentPlanConfirmedAt, PaymentPlanDisputeReason, CreatedBy, CreatedAt)
        VALUES (@bid, @cb, ISNULL(@dt, SYSDATETIME()), @dur, @out, @ncd, @note, @cf, @pad, @ppc, @ppcat, @ppr, @acb, SYSDATETIME())
      `);

    const bookingRow = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
    const booking = bookingRow.recordset[0];

    // Auto-flow: every logged call is itself a customer touchpoint — seed it
    // into the Communication Log automatically so that page becomes the
    // unified, continuing record of "further works and other tasks" instead
    // of staff having to separately re-log the same call there by hand.
    if (booking) {
      await pool.request()
        .input("aid",  sql.Int, booking.ApplicationId)
        .input("bid",  sql.Int, bookingId)
        .input("subj", sql.NVarChar(300), `Welcome Call${b.Outcome ? ` — ${b.Outcome}` : ""}`)
        .input("sum",  sql.NVarChar(sql.MAX), b.Notes || null)
        .input("cat",  sql.DateTime2(3), b.CallDate || null)
        .input("cb",   sql.Int, actorId(req))
        .query(`
          INSERT INTO dbo.CrmCommunicationLog
            (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
          VALUES (@aid, @bid, 'Call', 'Outbound', @subj, @sum, ISNULL(@cat, SYSDATETIME()), @cb, SYSDATETIME())
        `);

      // A customer declining the payment plan is a real, open issue — hand
      // it to the Communication Log as its own entry (Inbound, since it's
      // the customer's own objection) so whoever works that page next has
      // something concrete to follow up on, not just a checkbox buried on
      // this page.
      if (b.PaymentPlanConfirmed === false) {
        await logCommunication(pool, {
          applicationId: booking.ApplicationId, bookingId,
          direction: "Inbound",
          subject: "Payment Plan Not Confirmed",
          summary: String(b.PaymentPlanDisputeReason).trim(),
          createdBy: actorId(req),
        });
        if (booking.AssignedTo) {
          await emitNotification(pool, booking.AssignedTo, "crm_payment_plan_disputed",
            "Customer Did Not Agree to Payment Plan",
            `${booking.BookingNo}: ${String(b.PaymentPlanDisputeReason).trim()}`,
            bookingId, "crm_booking");
        }
      }
    }

    // Auto-flow: a completed welcome call is one of two prerequisites for
    // agreement prep — fire the auto-create check (no-op if bank/nominee
    // details aren't in yet) rather than waiting on staff to notice.
    if (b.Outcome === "Welcomed") {
      const created = await maybeAutoCreateAgreement(pool, bookingId, actorId(req));
      if (!created && booking?.AssignedTo) {
        await emitNotification(pool, booking.AssignedTo, "crm_bank_details_due",
          "Customer Details Needed",
          `Welcome call done for booking ${booking.BookingNo} — collect bank, nominee, PAN, and Aadhaar details to proceed to agreement.`,
          bookingId, "crm_booking");
      }
    }

    res.status(201).json({ success: true, bookingId });
  } catch (e) {
    console.error("[crm-welcome-calls] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit an already-logged call (correcting outcome, notes, dates, etc.)
router.put("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    if (b.Outcome && !OUTCOMES.includes(b.Outcome))
      return res.status(400).json({ error: `Invalid Outcome. Must be: ${OUTCOMES.join(", ")}` });
    if (b.PaymentPlanConfirmed === false && !String(b.PaymentPlanDisputeReason || "").trim()) {
      return res.status(400).json({ error: "A reason is required when the customer does not agree to the payment plan" });
    }

    const existing = await pool.request().input("id", sql.Int, id)
      .query("SELECT Id, BookingId, Outcome, PaymentPlanConfirmed FROM dbo.CrmWelcomeCall WHERE Id = @id");
    if (!existing.recordset.length) return res.status(404).json({ error: "Call log not found" });

    // Distinguish "field genuinely absent from this request" (preserve the
    // existing value) from "field explicitly sent, even as empty/null"
    // (apply it — including clearing it on purpose). A partial-body edit
    // (e.g. a caller that only sends { Outcome: "Welcomed" } to correct a
    // mis-entry) must never silently wipe DurationSeconds/NextCallDate/
    // Notes/CustomFields/PreferredAgreementDate just because it didn't
    // mention them — while a caller that DOES want to clear one of these
    // (e.g. NextCallDate: null, once no callback is needed anymore) must
    // still be able to. CalledBy/CallDate/Outcome/PaymentPlanConfirmed
    // already got this right via ISNULL and are unchanged below.
    const has = (key) => Object.prototype.hasOwnProperty.call(b, key);

    let customFieldsJson = null;
    if (Array.isArray(b.CustomFields)) {
      const cleaned = b.CustomFields
        .filter((f) => f && String(f.key || "").trim())
        .map((f) => ({ key: String(f.key).trim(), value: String(f.value ?? "").trim() }));
      customFieldsJson = cleaned.length ? JSON.stringify(cleaned) : null;
    }

    await pool.request()
      .input("id",   sql.Int, id)
      .input("cb",   sql.Int, b.CalledBy ? parseInt(b.CalledBy) : null)
      .input("dt",   sql.DateTime2(3), b.CallDate || null)
      .input("dur",  sql.Int, b.DurationSeconds != null ? parseInt(b.DurationSeconds) : null)
      .input("durP", sql.Bit, has("DurationSeconds") ? 1 : 0)
      .input("out",  sql.NVarChar(50), b.Outcome || null)
      .input("ncd",  sql.Date, b.NextCallDate || null)
      .input("ncdP", sql.Bit, has("NextCallDate") ? 1 : 0)
      .input("note", sql.NVarChar(sql.MAX), b.Notes ?? null)
      .input("noteP",sql.Bit, has("Notes") ? 1 : 0)
      .input("cf",   sql.NVarChar(sql.MAX), customFieldsJson)
      .input("cfP",  sql.Bit, has("CustomFields") ? 1 : 0)
      .input("pad",  sql.Date, b.PreferredAgreementDate || null)
      .input("padP", sql.Bit, has("PreferredAgreementDate") ? 1 : 0)
      .input("ppc",  sql.Bit,  b.PaymentPlanConfirmed != null ? (b.PaymentPlanConfirmed ? 1 : 0) : null)
      .input("ppr",  sql.NVarChar(500), b.PaymentPlanConfirmed === false ? String(b.PaymentPlanDisputeReason).trim() : null)
      .query(`
        UPDATE dbo.CrmWelcomeCall SET
          CalledBy = ISNULL(@cb, CalledBy),
          CallDate = ISNULL(@dt, CallDate),
          DurationSeconds = CASE WHEN @durP = 1 THEN @dur ELSE DurationSeconds END,
          Outcome = ISNULL(@out, Outcome),
          NextCallDate = CASE WHEN @ncdP = 1 THEN @ncd ELSE NextCallDate END,
          Notes = CASE WHEN @noteP = 1 THEN @note ELSE Notes END,
          CustomFields = CASE WHEN @cfP = 1 THEN @cf ELSE CustomFields END,
          PreferredAgreementDate = CASE WHEN @padP = 1 THEN @pad ELSE PreferredAgreementDate END,
          PaymentPlanConfirmed = ISNULL(@ppc, PaymentPlanConfirmed),
          PaymentPlanConfirmedAt = CASE WHEN @ppc = 1 THEN ISNULL(PaymentPlanConfirmedAt, SYSDATETIME()) ELSE PaymentPlanConfirmedAt END,
          -- Revertible: re-confirming (true) clears any prior dispute reason;
          -- disputing (false) always overwrites with the fresh reason; a
          -- request that doesn't touch PaymentPlanConfirmed at all (@ppc
          -- NULL) leaves the existing reason untouched — @ppr is bound to
          -- NULL in that case too, but the ELSE branch below never reads it.
          PaymentPlanDisputeReason = CASE
            WHEN @ppc = 1 THEN NULL
            WHEN @ppc = 0 THEN @ppr
            ELSE PaymentPlanDisputeReason
          END
        WHERE Id = @id
      `);
    // Same auto-flow POST / fires — a welcome call can be logged with one
    // outcome and later corrected to Welcomed (e.g. a mis-entry), and that
    // correction is just as real a "prerequisite met" event as getting it
    // right the first time. maybeAutoCreateAgreement re-derives the
    // booking's actual latest-call outcome itself (not just this row), so
    // this is a safe no-op if some other, more recent call for the booking
    // still isn't Welcomed, or if the bank-detail prerequisite isn't in yet.
    if (b.Outcome === "Welcomed" && existing.recordset[0].BookingId) {
      await maybeAutoCreateAgreement(pool, existing.recordset[0].BookingId, actorId(req));
    }

    // Same "hand a real dispute to Communication Log" flow as POST / —
    // only fires on the actual transition into disputed (not on every save
    // of an already-disputed row), so editing unrelated fields on a
    // previously-disputed call doesn't spam a duplicate log entry.
    if (b.PaymentPlanConfirmed === false && existing.recordset[0].PaymentPlanConfirmed !== false) {
      const bkg = await pool.request().input("bid", sql.Int, existing.recordset[0].BookingId)
        .query("SELECT BookingNo, ApplicationId, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
      const bkgRow = bkg.recordset[0];
      if (bkgRow) {
        await logCommunication(pool, {
          applicationId: bkgRow.ApplicationId, bookingId: existing.recordset[0].BookingId,
          direction: "Inbound",
          subject: "Payment Plan Not Confirmed",
          summary: String(b.PaymentPlanDisputeReason).trim(),
          createdBy: actorId(req),
        });
        if (bkgRow.AssignedTo) {
          await emitNotification(pool, bkgRow.AssignedTo, "crm_payment_plan_disputed",
            "Customer Did Not Agree to Payment Plan",
            `${bkgRow.BookingNo}: ${String(b.PaymentPlanDisputeReason).trim()}`,
            existing.recordset[0].BookingId, "crm_booking");
        }
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — remove a mis-logged call entry.
// Blocked once an Agreement exists for the booking — deleting the only
// 'Welcomed' call log would leave the Agreement without its prerequisite.
router.delete("/:id", requirePageRight("crm-welcome-calls", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const call = await pool.request().input("id", sql.Int, id)
      .query("SELECT BookingId, Outcome FROM dbo.CrmWelcomeCall WHERE Id = @id");
    if (!call.recordset.length) return res.status(404).json({ error: "Call log not found" });
    const { BookingId, Outcome } = call.recordset[0];
    if (Outcome === "Welcomed") {
      const agr = await pool.request().input("bid", sql.Int, BookingId)
        .query("SELECT TOP 1 Id FROM dbo.CrmAgreement WHERE BookingId = @bid AND IsActive = 1");
      if (agr.recordset.length) {
        return res.status(400).json({ error: "This welcome call log cannot be deleted — an Agreement already exists for this booking. Delete the Agreement first if this call was mis-logged." });
      }
    }
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmWelcomeCall WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-welcome-calls] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;