const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { maybeAutoCreateAgreement, requireActiveBooking, isLegalWorkStarted } = require("../services/crmWorkflowGuards");
const { CRM_APPROVER_ROLES } = require("../services/approvalService");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Once KYC data is on file it's sensitive (bank account, PAN, Aadhaar) and
// shouldn't be casually editable by any staff member with page rights —
// only the salesperson this booking/application is actually assigned to, or
// an admin-tier role, may save changes here. requirePageRight already gates
// who can reach this route at all; this is the second, ownership-specific
// gate on top of it, mirroring the "same actor/role" reasoning already used
// for the Booking auto-approve-on-Application-approve flow elsewhere in CRM.
async function requireAssignedOrApprover(req, res, pool, { bookingId, applicationId }) {
  const role = String(req.user?.role || "").trim().toLowerCase();
  if (CRM_APPROVER_ROLES.includes(role)) return true;

  const actor = actorId(req);
  const query = bookingId
    ? pool.request().input("bid", sql.Int, bookingId).query("SELECT AssignedTo FROM dbo.CrmBooking WHERE Id = @bid")
    : pool.request().input("aid", sql.Int, applicationId).query("SELECT AssignedTo FROM dbo.CrmApplication WHERE Id = @aid");
  const row = await query;
  const assignedTo = row.recordset[0]?.AssignedTo ?? null;

  if (assignedTo != null && actor != null && assignedTo === actor) return true;

  res.status(403).json({ error: "This record is locked — only the assigned salesperson or an admin can edit it" });
  return false;
}

// GET / — every Approved booking with its live KYC-completeness status, so
// the list page can group by Pending/Complete without a per-row fetch.
// A booking with no CrmCustomerBankDetail row at all is naturally "Pending"
// via the LEFT JOIN (every completeness column is NULL).
router.get("/", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        b.Id AS BookingId, b.BookingNo, b.ProjectName, b.UnitNo, b.Status AS BookingStatus, b.AssignedTo,
        b.FinancingType,
        a.ApplicantName, a.Mobile,
        wc.Outcome AS LastCallOutcome,
        CASE WHEN
          NULLIF(LTRIM(RTRIM(ISNULL(d.BankName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AccountNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.IfscCode, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AccountHolderName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeName, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.NomineeRelation, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.PanNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.AadhaarNo, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(d.Occupation, ''))), '') IS NOT NULL AND
          NULLIF(LTRIM(RTRIM(ISNULL(b.FinancingType, ''))), '') IS NOT NULL
        THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS IsComplete
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.CrmCustomerBankDetail d ON d.BookingId = b.Id
      OUTER APPLY (
        SELECT TOP 1 Outcome FROM dbo.CrmWelcomeCall WHERE BookingId = b.Id ORDER BY CallDate DESC, CreatedAt DESC
      ) wc
      WHERE b.IsActive = 1 AND b.Status = '${CrmStatus.APPROVED}'
      ORDER BY b.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-customer-bank-details] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    // FinancingType and Milestone-1 payment status live outside
    // CrmCustomerBankDetail (on CrmBooking/CrmPaymentMilestone) but the
    // dialog needs both — Milestone 1 to decide whether the form should even
    // be usable yet, FinancingType as a field on the same save.
    // Milestone1PendingApproval: money has been submitted for Milestone 1 and
    // is sitting in Finance's approval queue — surfaced so staff see "awaiting
    // Finance approval" instead of reading a locked form as simply stuck.
    const bookingRow = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT b.FinancingType,
             (SELECT TOP 1 Status FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id ORDER BY MilestoneNo) AS Milestone1Status,
             (SELECT TOP 1 Id FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id ORDER BY MilestoneNo) AS Milestone1Id,
             CAST(CASE WHEN EXISTS (
               SELECT 1 FROM dbo.ReceivedPayment rp
               JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
               WHERE m.BookingId = b.Id AND m.MilestoneNo = (SELECT MIN(MilestoneNo) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id)
                 AND rp.RPStatus = '${CrmStatus.PENDING}'
             ) THEN 1 ELSE 0 END AS BIT) AS Milestone1PendingApproval
      FROM dbo.CrmBooking b WHERE b.Id = @bid
    `);
    const bookingExtra = bookingRow.recordset[0] || {};

    const result = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT d.*, vu.name AS BookingStageVerifiedByName
      FROM dbo.CrmCustomerBankDetail d
      LEFT JOIN dbo.users vu ON vu.id = d.BookingStageVerifiedBy
      WHERE d.BookingId = @bid
    `);
    if (result.recordset.length) return res.json({ ...result.recordset[0], ...bookingExtra });

    // No bank-detail row saved yet — PAN, Aadhaar, Occupation, Annual Income
    // and the account holder's name are already on file at Customer intake
    // (dbo.CrmCustomer), so pre-fill them here instead of making staff retype
    // data the system already has. These come back flagged _prefilledFrom so
    // the UI can render them locked (view-only) with an explicit unlock/edit
    // option to recheck and confirm against the customer, rather than
    // silently editable as if freshly typed. Bank/nominee fields are
    // genuinely new information this form is the first place to capture, so
    // they stay blank and unlocked.
    const prefill = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT c.PanNo, c.CustomerName AS AccountHolderName, c.AadhaarNo, c.Occupation, c.AnnualIncome
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE b.Id = @bid
    `);
    if (!prefill.recordset.length) return res.json({ ...bookingExtra });
    const p = prefill.recordset[0];
    res.json({
      PanNo: p.PanNo || null, AccountHolderName: p.AccountHolderName || null,
      AadhaarNo: p.AadhaarNo || null, Occupation: p.Occupation || null,
      AnnualIncome: p.AnnualIncome != null ? p.AnnualIncome : null,
      _prefilledFrom: "customer",
      ...bookingExtra,
    });
  } catch (e) {
    console.error("[crm-customer-bank-details] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/booking/:bookingId", requirePageRight("crm-customer-bank-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const bid = parseInt(req.params.bookingId);
    const b = req.body;
    const actor = actorId(req);

    if (!(await requireAssignedOrApprover(req, res, pool, { bookingId: bid }))) return;

    const activeErr = await requireActiveBooking(pool, bid);
    if (activeErr) return res.status(400).json({ error: activeErr });

    // The frontend already refuses to save unless Milestone 1 (Booking
    // Amount) is Paid — bookingAmountPaid check in CrmCustomerBankDetails.tsx
    // — but that was client-side only. Anyone calling this endpoint directly
    // (a stale tab, a race between two staff members, a future frontend
    // change that forgets to re-check) could write KYC data before the
    // booking amount was actually paid. Mirror the same rule here, server-
    // side, using the identical Milestone1Status subquery GET already uses.
    const m1 = await pool.request().input("bid", sql.Int, bid).query(`
      SELECT TOP 1 Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
    `);
    if (m1.recordset[0]?.Status !== CrmStatus.PAID) {
      return res.status(400).json({ error: "Booking Amount (Milestone 1) must be paid before Bank/KYC details can be saved" });
    }

    // Financing Type (Self-funded / Loan-financed) lives on CrmBooking, not
    // CrmCustomerBankDetail — it's a simple declaration, not sensitive KYC
    // data (bank account/PAN/Aadhaar), so it's exempt from the
    // Approved-locks-everything rule below. Without this exemption, a
    // booking that reached Approved before this field existed could never
    // have it set at all — permanently blocking Agreement prep for every
    // pre-existing booking (validateAgreementPreparationPrerequisites now
    // requires it). Validated against the fixed set rather than accepting
    // any string.
    if (b.FinancingType !== undefined && b.FinancingType !== null && !["SelfFunded", "LoanFinanced"].includes(b.FinancingType)) {
      return res.status(400).json({ error: "FinancingType must be either SelfFunded or LoanFinanced" });
    }
    if (b.FinancingType) {
      await pool.request().input("bid", sql.Int, bid).input("ft", sql.NVarChar(20), b.FinancingType)
        .query("UPDATE dbo.CrmBooking SET FinancingType = @ft WHERE Id = @bid");
      await maybeAutoCreateAgreement(pool, bid, actor);
    }

    // Locked once the Agreement actually has an uploaded document — that's
    // the real "point of no return" (same trigger Unit/Parking/Extra-Charge
    // edits gate on via isLegalWorkStarted, see crmWorkflowGuards.js), not
    // "Status became Approved". Status flips to Approved BEFORE the Welcome
    // Call even fires (crmBookings.js's approval notifies the assignee to go
    // do it) and never changes again afterward — locking KYC writes at that
    // same instant meant the write window for Bank/Nominee/PAN/Aadhaar never
    // actually existed: Welcome Call and KYC are only ever attempted post-
    // approval, but a Status=== CrmStatus.APPROVED lock closes the door the moment
    // that happens. This was a real, unconditional deadlock, not a rare edge
    // case. FinancingType is saved above regardless either way.
    if (await isLegalWorkStarted(pool, bid)) {
      if (b.FinancingType) return res.json({ success: true });
      return res.status(400).json({ error: "The agreement already has documents uploaded — Bank/KYC details can no longer be edited." });
    }

    const existing = await pool.request().input("bid", sql.Int, bid).query("SELECT Id FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");

    const fields = {
      bank: b.BankName || null, branch: b.BranchName || null, acc: b.AccountNo || null, ifsc: b.IfscCode || null,
      holder: b.AccountHolderName || null, nname: b.NomineeName || null, nrel: b.NomineeRelation || null,
      ndob: b.NomineeDob || null, ncon: b.NomineeContact || null, naddr: b.NomineeAddress || null,
      pan: b.PanNo || null, aadh: b.AadhaarNo || null,
      occ: b.Occupation || null, inc: b.AnnualIncome != null && b.AnnualIncome !== "" ? parseFloat(b.AnnualIncome) : null,
      cheque: b.ChequeNo || null, chqdate: b.ChequeDate || null, tref: b.TransactionRef || null,
      notes: b.Notes || null,
    };

    if (fields.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(fields.pan.toUpperCase()))
      return res.status(400).json({ error: "PAN must be in the format ABCDE1234F (5 letters, 4 digits, 1 letter)" });
    if (fields.pan) fields.pan = fields.pan.toUpperCase();
    if (fields.aadh && !/^\d{12}$/.test(fields.aadh))
      return res.status(400).json({ error: "Aadhaar must be exactly 12 digits" });
    if (fields.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(fields.ifsc))
      return res.status(400).json({ error: "IFSC code must be in the format ABCD0123456 (4 letters, 0, 6 alphanumeric)" });
    if (fields.ifsc) fields.ifsc = fields.ifsc.toUpperCase();
    if (fields.ncon && !/^\d{10}$/.test(fields.ncon))
      return res.status(400).json({ error: "Nominee contact must be exactly 10 digits" });
    if (fields.acc && fields.acc.length > 20 && !/^\d+$/.test(fields.acc))
      return res.status(400).json({ error: "Account number must be numeric" });

    if (existing.recordset.length) {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("ub", sql.Int, actor)
        .query(`
          UPDATE dbo.CrmCustomerBankDetail SET
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            AccountNo = ISNULL(@acc, AccountNo), IfscCode = ISNULL(@ifsc, IfscCode),
            AccountHolderName = ISNULL(@holder, AccountHolderName),
            NomineeName = ISNULL(@nname, NomineeName), NomineeRelation = ISNULL(@nrel, NomineeRelation),
            NomineeDob = ISNULL(@ndob, NomineeDob), NomineeContact = ISNULL(@ncon, NomineeContact),
            NomineeAddress = ISNULL(@naddr, NomineeAddress),
            PanNo = ISNULL(@pan, PanNo), AadhaarNo = ISNULL(@aadh, AadhaarNo),
            Occupation = ISNULL(@occ, Occupation), AnnualIncome = ISNULL(@inc, AnnualIncome),
            ChequeNo = ISNULL(@cheque, ChequeNo), ChequeDate = ISNULL(@chqdate, ChequeDate),
            TransactionRef = ISNULL(@tref, TransactionRef),
            Notes = ISNULL(@notes, Notes), UpdatedBy = @ub, UpdatedAt = SYSDATETIME(),
            -- This is a later, separate edit surface (the final standalone
            -- Bank & KYC page) than the Booking-tab verify action below —
            -- whatever was verified at the Booking stage no longer matches
            -- once this save changes the row, so that verification is stale
            -- and must be cleared, not left claiming a row it no longer describes.
            BookingStageVerifiedAt = NULL, BookingStageVerifiedBy = NULL
          WHERE BookingId = @bid
        `);
    } else {
      await pool.request()
        .input("bid", sql.Int, bid)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("cb", sql.Int, actor)
        .query(`
          INSERT INTO dbo.CrmCustomerBankDetail
            (BookingId, BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeDob, NomineeContact, NomineeAddress,
             PanNo, AadhaarNo, Occupation, AnnualIncome, ChequeNo, ChequeDate, TransactionRef, Notes, CreatedBy, CreatedAt)
          VALUES (@bid, @bank, @branch, @acc, @ifsc, @holder, @nname, @nrel, @ndob, @ncon, @naddr, @pan, @aadh, @occ, @inc, @cheque, @chqdate, @tref, @notes, @cb, SYSDATETIME())
        `);
    }

    // Auto-flow: saved details are the other agreement-prep prerequisite —
    // fire the auto-create check (no-op if the welcome call isn't done yet).
    await maybeAutoCreateAgreement(pool, bid, actor);

    // Sync KYC fields back to the centralized Customer record so the
    // data remains consistent across the ERP.
    await pool.request()
      .input("bid", sql.Int, bid)
      .input("pan", sql.NVarChar(20), fields.pan)
      .input("aadh", sql.NVarChar(20), fields.aadh)
      .input("occ", sql.NVarChar(100), fields.occ)
      .input("inc", sql.Decimal(18,2), fields.inc)
      .query(`
        UPDATE c SET
          c.PanNo = ISNULL(@pan, c.PanNo),
          c.AadhaarNo = ISNULL(@aadh, c.AadhaarNo),
          c.Occupation = ISNULL(@occ, c.Occupation),
          c.AnnualIncome = ISNULL(@inc, c.AnnualIncome)
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id
        WHERE b.Id = @bid
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-customer-bank-details] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /application/:applicationId — same record, keyed by Application
// instead of Booking, for the new Application-stage payment/KYC capture
// (Phase 1 of the Application/Booking redesign — a booking doesn't exist
// yet at this point, so BookingId stays NULL on this row until one does).
router.get("/application/:applicationId", requirePageRight("crm-customer-bank-details", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const aid = parseInt(req.params.applicationId);
    const result = await pool.request().input("aid", sql.Int, aid).query(`
      SELECT d.*, vu.name AS BookingStageVerifiedByName
      FROM dbo.CrmCustomerBankDetail d
      LEFT JOIN dbo.users vu ON vu.id = d.BookingStageVerifiedBy
      WHERE d.ApplicationId = @aid
    `);
    if (result.recordset.length) return res.json(result.recordset[0]);

    // No bank-detail row saved yet — same PAN/Aadhaar/Occupation/Annual
    // Income/account-holder pre-fill as the BookingId-keyed route above, so
    // staff never have to retype data the system already captured at
    // Customer intake (dbo.CrmCustomer). Flagged _prefilledFrom so the UI can
    // lock these fields for review/confirm rather than freshly-typed edit.
    const prefill = await pool.request().input("aid", sql.Int, aid).query(`
      SELECT c.PanNo, c.CustomerName AS AccountHolderName, c.AadhaarNo, c.Occupation, c.AnnualIncome
      FROM dbo.CrmApplication a
      JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
      WHERE a.Id = @aid
    `);
    if (!prefill.recordset.length) return res.json(null);
    const p = prefill.recordset[0];
    res.json({
      PanNo: p.PanNo || null, AccountHolderName: p.AccountHolderName || null,
      AadhaarNo: p.AadhaarNo || null, Occupation: p.Occupation || null,
      AnnualIncome: p.AnnualIncome != null ? p.AnnualIncome : null,
      _prefilledFrom: "customer",
    });
  } catch (e) {
    console.error("[crm-customer-bank-details] GET /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/application/:applicationId", requirePageRight("crm-customer-bank-details", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const aid = parseInt(req.params.applicationId);
    const b = req.body;
    const actor = actorId(req);

    const app = await pool.request().input("aid", sql.Int, aid).query("SELECT Id FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
    if (!app.recordset.length) return res.status(404).json({ error: "Application not found" });

    if (!(await requireAssignedOrApprover(req, res, pool, { applicationId: aid }))) return;

    // Once the Application's Booking exists, this row is shared with — and
    // frozen the same way as — the Booking-keyed endpoint below (both write
    // the same CrmCustomerBankDetail row once BookingId gets backfilled in
    // createCrmBookingRecord). Without this check, a Cancelled/Rejected
    // booking's KYC data could still be silently edited through this older
    // Application-side form even though the Booking-side "Bank Details" tab
    // correctly refuses — the exact kind of two-endpoints-disagree sync
    // conflict this route pair is prone to.
    const linkedBooking = await pool.request().input("aid", sql.Int, aid)
      .query("SELECT Id FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1");
    const linkedBookingId = linkedBooking.recordset[0]?.Id || null;
    if (linkedBookingId) {
      const activeErr = await requireActiveBooking(pool, linkedBookingId);
      if (activeErr) return res.status(400).json({ error: activeErr });
      // Same real freeze point as the Booking-keyed endpoint — this comment
      // above already said these two endpoints were SUPPOSED to freeze
      // together; they never actually did until now (this route had no
      // Approved/legal-work check at all, which is exactly how KYC data kept
      // getting written through here after a booking's Approved-based lock
      // elsewhere made the Booking-side endpoint refuse the same edit).
      if (await isLegalWorkStarted(pool, linkedBookingId)) {
        return res.status(400).json({ error: "The agreement already has documents uploaded — Bank/KYC details can no longer be edited." });
      }
    }

    const existing = await pool.request().input("aid", sql.Int, aid).query("SELECT Id FROM dbo.CrmCustomerBankDetail WHERE ApplicationId = @aid");

    const fields = {
      bank: b.BankName || null, branch: b.BranchName || null, acc: b.AccountNo || null, ifsc: b.IfscCode || null,
      holder: b.AccountHolderName || null, nname: b.NomineeName || null, nrel: b.NomineeRelation || null,
      ndob: b.NomineeDob || null, ncon: b.NomineeContact || null, naddr: b.NomineeAddress || null,
      pan: b.PanNo || null, aadh: b.AadhaarNo || null,
      occ: b.Occupation || null, inc: b.AnnualIncome != null && b.AnnualIncome !== "" ? parseFloat(b.AnnualIncome) : null,
      cheque: b.ChequeNo || null, chqdate: b.ChequeDate || null, tref: b.TransactionRef || null,
      notes: b.Notes || null,
    };

    if (fields.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(fields.pan.toUpperCase()))
      return res.status(400).json({ error: "PAN must be in the format ABCDE1234F (5 letters, 4 digits, 1 letter)" });
    if (fields.pan) fields.pan = fields.pan.toUpperCase();
    if (fields.aadh && !/^\d{12}$/.test(fields.aadh))
      return res.status(400).json({ error: "Aadhaar must be exactly 12 digits" });
    if (fields.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(fields.ifsc))
      return res.status(400).json({ error: "IFSC code must be in the format ABCD0123456 (4 letters, 0, 6 alphanumeric)" });
    if (fields.ifsc) fields.ifsc = fields.ifsc.toUpperCase();
    if (fields.ncon && !/^\d{10}$/.test(fields.ncon))
      return res.status(400).json({ error: "Nominee contact must be exactly 10 digits" });

    // VerifyBookingStage is only ever sent (true) by the Booking-tab "Save
    // Bank/KYC Details" button (CrmBookingDetail.tsx) — that's the one
    // explicit "I reviewed this" action, so it's the only save that should
    // set the verified-by/at columns. Every other caller of this same
    // endpoint (Application step's own save, and the Cheque/UTR-only partial
    // save on submit) omits the flag, which must CLEAR any prior
    // verification rather than leave it in place — otherwise a stale
    // verification would keep pointing at data that's since changed.
    const verify = b.VerifyBookingStage === true;

    if (existing.recordset.length) {
      await pool.request()
        .input("aid", sql.Int, aid)
        .input("bid", sql.Int, linkedBookingId)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("ub", sql.Int, actor)
        .input("verify", sql.Bit, verify)
        .query(`
          UPDATE dbo.CrmCustomerBankDetail SET
            -- Backfill BookingId if a Booking now exists but this row still
            -- predates it (createCrmBookingRecord only backfills once, at
            -- booking-creation time — this covers every save afterward, so
            -- the Booking-side "Bank Details" tab, which reads by BookingId,
            -- can actually find data saved from the Application side later).
            BookingId = ISNULL(BookingId, @bid),
            BankName = ISNULL(@bank, BankName), BranchName = ISNULL(@branch, BranchName),
            AccountNo = ISNULL(@acc, AccountNo), IfscCode = ISNULL(@ifsc, IfscCode),
            AccountHolderName = ISNULL(@holder, AccountHolderName),
            NomineeName = ISNULL(@nname, NomineeName), NomineeRelation = ISNULL(@nrel, NomineeRelation),
            NomineeDob = ISNULL(@ndob, NomineeDob), NomineeContact = ISNULL(@ncon, NomineeContact),
            NomineeAddress = ISNULL(@naddr, NomineeAddress),
            PanNo = ISNULL(@pan, PanNo), AadhaarNo = ISNULL(@aadh, AadhaarNo),
            Occupation = ISNULL(@occ, Occupation), AnnualIncome = ISNULL(@inc, AnnualIncome),
            ChequeNo = ISNULL(@cheque, ChequeNo), ChequeDate = ISNULL(@chqdate, ChequeDate),
            TransactionRef = ISNULL(@tref, TransactionRef),
            Notes = ISNULL(@notes, Notes), UpdatedBy = @ub, UpdatedAt = SYSDATETIME(),
            BookingStageVerifiedAt = CASE WHEN @verify = 1 THEN SYSDATETIME() ELSE NULL END,
            BookingStageVerifiedBy = CASE WHEN @verify = 1 THEN @ub ELSE NULL END
          WHERE ApplicationId = @aid
        `);
    } else {
      await pool.request()
        .input("aid", sql.Int, aid)
        .input("bid", sql.Int, linkedBookingId)
        .input("bank", sql.NVarChar(200), fields.bank).input("branch", sql.NVarChar(200), fields.branch)
        .input("acc", sql.NVarChar(50), fields.acc).input("ifsc", sql.NVarChar(20), fields.ifsc)
        .input("holder", sql.NVarChar(200), fields.holder).input("nname", sql.NVarChar(200), fields.nname)
        .input("nrel", sql.NVarChar(50), fields.nrel).input("ndob", sql.Date, fields.ndob)
        .input("ncon", sql.NVarChar(20), fields.ncon).input("naddr", sql.NVarChar(500), fields.naddr)
        .input("pan", sql.NVarChar(20), fields.pan).input("aadh", sql.NVarChar(20), fields.aadh)
        .input("occ", sql.NVarChar(100), fields.occ).input("inc", sql.Decimal(18,2), fields.inc)
        .input("cheque", sql.NVarChar(50), fields.cheque).input("chqdate", sql.Date, fields.chqdate)
        .input("tref", sql.NVarChar(200), fields.tref)
        .input("notes", sql.NVarChar(sql.MAX), fields.notes).input("cb", sql.Int, actor)
        .input("vat", sql.DateTime2, verify ? new Date() : null)
        .input("vby", sql.Int, verify ? actor : null)
        .query(`
          INSERT INTO dbo.CrmCustomerBankDetail
            (ApplicationId, BookingId, BankName, BranchName, AccountNo, IfscCode, AccountHolderName,
             NomineeName, NomineeRelation, NomineeDob, NomineeContact, NomineeAddress,
             PanNo, AadhaarNo, Occupation, AnnualIncome, ChequeNo, ChequeDate, TransactionRef, Notes,
             BookingStageVerifiedAt, BookingStageVerifiedBy, CreatedBy, CreatedAt)
          VALUES (@aid, @bid, @bank, @branch, @acc, @ifsc, @holder, @nname, @nrel, @ndob, @ncon, @naddr, @pan, @aadh, @occ, @inc, @cheque, @chqdate, @tref, @notes, @vat, @vby, @cb, SYSDATETIME())
        `);
    }

    // Same auto-flow the Booking-keyed PUT above fires — without this, a
    // customer whose KYC was last edited through this Application-side form
    // (post-linkage) would have complete data on file but the Agreement
    // would never auto-create, looking exactly like the data "didn't save".
    if (linkedBookingId) {
      await maybeAutoCreateAgreement(pool, linkedBookingId, actor);
    }

    // Sync KYC fields back to the centralized Customer record so the
    // data remains consistent across the ERP.
    await pool.request()
      .input("aid", sql.Int, aid)
      .input("pan", sql.NVarChar(20), fields.pan)
      .input("aadh", sql.NVarChar(20), fields.aadh)
      .input("occ", sql.NVarChar(100), fields.occ)
      .input("inc", sql.Decimal(18,2), fields.inc)
      .query(`
        UPDATE c SET
          c.PanNo = ISNULL(@pan, c.PanNo),
          c.AadhaarNo = ISNULL(@aadh, c.AadhaarNo),
          c.Occupation = ISNULL(@occ, c.Occupation),
          c.AnnualIncome = ISNULL(@inc, c.AnnualIncome)
        FROM dbo.CrmCustomer c
        JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
        WHERE a.Id = @aid
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-customer-bank-details] PUT /application error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;