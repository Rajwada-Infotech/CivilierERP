const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");
const { ensurePortalUser } = require("./crmPortalProvision");
const { emitNotification } = require("./notify");

// AnnualIncome is deliberately excluded — the source spec lists income as
// "if applicable", unlike every other field here which is a hard blocker.
const REQUIRED_CUSTOMER_DETAIL_FIELDS = [
  ["BankName", "Bank name"],
  ["AccountNo", "Account number"],
  ["IfscCode", "IFSC code"],
  ["AccountHolderName", "account holder name"],
  ["NomineeName", "nominee name"],
  ["NomineeRelation", "nominee relation"],
  ["PanNo", "PAN number"],
  ["AadhaarNo", "Aadhaar number"],
  ["Occupation", "occupation"],
];

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

// Server-side backstop for "a cancelled booking must be released from every
// workflow action, not just hidden from dropdowns" — a stale client-side
// list, a deep link, or a direct API call could otherwise still reach a
// create/action endpoint for a booking that's already Cancelled/Rejected.
// Every lifecycle POST (Legal Milestone, NOC, Sales Deed, Pre-Possession,
// Possession Notice, Brokerage, Handover, Welcome Call, Bank Details,
// Service Tickets, Payments) calls this first and 400s with the message
// below if it fails. Returns null when the booking is fine to act on.
async function requireActiveBooking(pool, bookingId) {
  const row = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Status, IsActive FROM dbo.CrmBooking WHERE Id = @bid");
  if (!row.recordset.length) return "Booking not found";
  const b = row.recordset[0];
  if (!b.IsActive) return "This booking is no longer active";
  if (["Cancelled", "Rejected"].includes(b.Status)) {
    return `This booking has been ${b.Status} — no further workflow actions are allowed on it`;
  }
  return null;
}

// Gate for Unit/Parking/Extra-Charge edits: once the booking's Agreement has
// at least one uploaded document, the numbers may already be baked into a
// document someone is reviewing/signing, so a direct edit is no longer safe
// — it needs to go through the CrmBookingAmendmentRequest approval queue
// instead (see crmExtraCharges.js / crmParking.js).
//
// Deliberately NOT keyed on CrmAgreement.Status: that column only ever
// holds 'Draft' until the very end of the approval chain (mark-executed
// flips it to 'Executed') — it stays 'Draft' through document upload,
// senior approval, and customer approval, so gating on it would never
// trigger during the actual verification window this is meant to protect.
// SeniorApprovalStatus was considered too but defaults to 'Pending' at row
// creation (before any document exists), so it can't distinguish "freshly
// auto-created, nothing uploaded yet" from "under review" either. A real
// uploaded document is the first unambiguous sign legal work has begun.
async function isLegalWorkStarted(pool, bookingId) {
  const row = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT COUNT(*) AS DocCount
    FROM dbo.CrmAgreementDocument d
    JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
    WHERE ag.BookingId = @bid
  `);
  return row.recordset[0].DocCount > 0;
}

async function getBookingWorkflowContext(pool, bookingId) {
  const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      b.Id, b.BookingNo, b.ApplicationId, b.UnitId, b.Status, b.IsActive, b.AssignedTo,
      b.FinancingType,
      a.Email, a.Mobile
    FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE b.Id = @bid
  `);

  return booking.recordset[0] || null;
}

async function validateAgreementPreparationPrerequisites(pool, bookingId) {
  const errors = [];
  const booking = await getBookingWorkflowContext(pool, bookingId);

  // Booking must actually be admin-approved (not merely "not Cancelled") —
  // a Pending or Rejected booking has no business entering agreement prep.
  if (!booking || !booking.IsActive || booking.Status !== "Approved") {
    return { ok: false, errors: [`Booking must be Approved before agreement preparation (current status: ${booking?.Status ?? "not found"})`] };
  }

  if (!booking.UnitId) {
    errors.push("Booking must be linked to a Unit Master unit");
  }
  if (!hasValue(booking.Email)) {
    errors.push("Applicant email is required for customer portal login");
  }
  if (!hasValue(booking.Mobile)) {
    errors.push("Applicant mobile number is required as the initial portal password");
  }

  const welcome = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id
    FROM dbo.CrmWelcomeCall
    WHERE BookingId = @bid AND Outcome = 'Welcomed'
    ORDER BY CallDate DESC, CreatedAt DESC
  `);
  if (!welcome.recordset.length) {
    errors.push("Welcome call must be completed with outcome Welcomed");
  }

  const detail = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 *
    FROM dbo.CrmCustomerBankDetail
    WHERE BookingId = @bid
  `);
  const customerDetails = detail.recordset[0];
  if (!customerDetails) {
    errors.push("Customer bank, nominee, PAN, and Aadhaar details are required");
  } else {
    const missing = REQUIRED_CUSTOMER_DETAIL_FIELDS
      .filter(([field]) => !hasValue(customerDetails[field]))
      .map(([, label]) => label);
    if (missing.length) {
      errors.push(`Missing customer details: ${missing.join(", ")}`);
    }
  }

  // Real money in hand, not just an auto-synced receipt that's assumed to
  // have landed — the auto-sync at booking creation (crmEntityCreation.js)
  // is best-effort and can silently fail (missing bank, DB hiccup), so this
  // is checked independently rather than trusted from booking creation alone.
  const milestone1 = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Status FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
  `);
  if (!milestone1.recordset.length || milestone1.recordset[0].Status !== "Paid") {
    errors.push("Booking Amount (Milestone 1) must be fully paid before agreement preparation");
  }

  // Financing Type must be explicitly declared (Self-funded / Loan-financed)
  // — without this, an empty CrmLoanDetail row is permanently ambiguous
  // (declared self-funded vs. simply never filled in).
  if (!hasValue(booking.FinancingType)) {
    errors.push("Financing type (self-funded or loan-financed) must be declared");
  }

  return { ok: errors.length === 0, errors, booking };
}

/**
 * Auto-advance step: the moment the last agreement-prep prerequisite lands
 * (welcome call completed AND customer bank/nominee/PAN/Aadhaar details
 * saved, in either order), automatically create the Draft agreement shell
 * and provision the customer portal login — instead of waiting for a staff
 * member to remember to click "New Agreement". Never fabricates a step: it
 * only fires once every real prerequisite is independently true, and is a
 * no-op if an agreement already exists for the booking (UNIQUE BookingId).
 * Call sites: crmWelcomeCalls.js (after Outcome='Welcomed') and
 * crmCustomerBankDetails.js (after details saved).
 */
async function maybeAutoCreateAgreement(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");
  if (existing.recordset.length) return null;

  const prereq = await validateAgreementPreparationPrerequisites(pool, bookingId);
  if (!prereq.ok) return null;

  const detail = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT PanNo, AadhaarNo FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");
  const customerDetails = detail.recordset[0] || {};

  // Legal Name was never being seeded even though the applicant's real name
  // is already on file — pulled in here the same way PAN/Aadhaar already
  // were, so a Draft agreement never opens with a blank identity a customer
  // would see reflected back at them as "—".
  const applicant = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT a.ApplicantName FROM dbo.CrmApplication a JOIN dbo.CrmBooking b ON b.ApplicationId = a.Id WHERE b.Id = @bid
  `);
  const legalName = applicant.recordset[0]?.ApplicantName || null;

  const agNo = await getNextDocNumber(pool, "AGR", "AGR");
  let result;
  try {
    result = await pool.request()
      .input("agno", sql.NVarChar(50), agNo)
      .input("bid",  sql.Int, bookingId)
      .input("lname",sql.NVarChar(200), legalName)
      .input("pan",  sql.NVarChar(20), customerDetails.PanNo || null)
      .input("aadh", sql.NVarChar(20), customerDetails.AadhaarNo || null)
      .input("cb",   sql.Int, actorUserId || null)
      .query(`
        INSERT INTO dbo.CrmAgreement
          (AgreementNo, BookingId, LegalName, PanNo, AadhaarNo, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@agno, @bid, @lname, @pan, @aadh, 'Draft', 'Auto-created — all agreement-prep prerequisites met', @cb, SYSDATETIME())
      `);
  } catch (e) {
    // Race: welcome-call logging and bank-detail saving can both complete
    // the last prerequisite at nearly the same time and both reach here.
    // The loser hits the UNIQUE(BookingId) constraint — that's expected and
    // fine (the winner already created the agreement), not a real failure
    // of whatever the caller was actually trying to save.
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) return null;
    throw e;
  }
  const agreementId = result.recordset[0].Id;

  // Standing document request: an executable agreement needs the customer's
  // own identity proof on file, not just the PAN/Aadhaar numbers typed in
  // during the welcome call. Requested here (Status='Requested', no file
  // yet) so it's waiting the moment the agreement is later shared with the
  // customer — same "->" chain the workflow spec describes between bank
  // details and agreement preparation.
  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("cb", sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmAgreementDocument
        (AgreementId, DocumentType, Label, IsMandatory, Status, UploadedByType, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
      VALUES (@agid, 'IdentityProof', 'Identity Proof (PAN / Aadhaar copy)', 1, 'Requested', 'Customer', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
    `);

  // The agreement (and its identity-proof document request) are already
  // committed above by this point — portal provisioning is a "nice to have
  // in parallel" step per the workflow spec, not a prerequisite for the
  // agreement itself. Guarded separately so a portal-provisioning hiccup
  // (e.g. a transient DB error) can't turn into a 500 on whatever unrelated
  // action actually triggered this — logging a welcome call or saving bank
  // details — when that action itself already succeeded and committed.
  let portalInfo = null;
  try {
    portalInfo = await ensurePortalUser(pool, prereq.booking.ApplicationId);
  } catch (e) {
    console.error("[maybeAutoCreateAgreement] portal provisioning failed:", e.message);
    portalInfo = { created: false, error: e.message };
  }

  if (prereq.booking.AssignedTo) {
    await emitNotification(pool, prereq.booking.AssignedTo, "crm_agreement_ready",
      "Agreement Ready for Legal Details",
      `${agNo} auto-created for booking ${prereq.booking.BookingNo} — welcome call and customer details are complete. Add legal name/address to proceed.`,
      agreementId, "crm_agreement");
  }

  return { id: agreementId, AgreementNo: agNo, portal: portalInfo };
}

/**
 * Auto-advance step: the moment an agreement is Executed AND every payment
 * milestone is Paid/Waived (in either order), automatically create the
 * sales deed shell — instead of waiting for staff to notice both conditions
 * landed. No-op if a deed already exists for the booking (UNIQUE BookingId)
 * or either prerequisite is still outstanding.
 * Call sites: crmAgreements.js (after /:id/mark-executed) and
 * crmPayments.js (after a milestone becomes Paid or is waived).
 */
async function maybeAutoCreateSalesDeed(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmSalesDeed WHERE BookingId = @bid");
  if (existing.recordset.length) return null;

  const agreement = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id, Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CreatedAt DESC
  `);
  if (!agreement.recordset.length || agreement.recordset[0].Status !== "Executed") return null;

  const pendingMilestones = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived')
  `);
  if (pendingMilestones.recordset[0]?.Cnt > 0) return null;

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT BookingNo, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
  const bookingRow = booking.recordset[0];
  if (!bookingRow) return null;

  const deedNo = await getNextDocNumber(pool, "DEED", "DEED");
  const result = await pool.request()
    .input("no",   sql.NVarChar(30), deedNo)
    .input("bid",  sql.Int, bookingId)
    .input("agid", sql.Int, agreement.recordset[0].Id)
    .input("note", sql.NVarChar(sql.MAX), "Auto-created — agreement executed and all milestones settled")
    .input("cb",   sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmSalesDeed (DeedNo, BookingId, AgreementId, Status, Notes, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, @agid, 'Draft', @note, @cb, SYSDATETIME())
    `);
  const deedId = result.recordset[0].Id;

  if (bookingRow.AssignedTo) {
    await emitNotification(pool, bookingRow.AssignedTo, "crm_sales_deed_ready",
      "Sales Deed Ready",
      `${deedNo} auto-created for booking ${bookingRow.BookingNo} — agreement is executed and all milestones are settled. Fill in deed/registration details to proceed.`,
      deedId, "crm_sales_deed");
  }

  return { id: deedId, DeedNo: deedNo };
}

/**
 * Auto-advance step: the moment every payment milestone is Paid/Waived —
 * the "ON POSSESSION (LAST PAYMENT STAGE)" point in the workflow spec —
 * automatically generate the Possession invoice, instead of waiting for
 * staff to notice and click "Generate Invoice" manually. Idempotent: no-op
 * if a Possession invoice already exists for this booking. Fires alongside
 * maybeAutoCreateSalesDeed at every call site — both share the exact same
 * trigger condition (all milestones settled).
 */
async function maybeAutoGenerateInvoice(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmInvoice WHERE BookingId = @bid AND InvoiceType = 'Possession'");
  if (existing.recordset.length) return null;

  const pendingMilestones = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived')
  `);
  if (pendingMilestones.recordset[0]?.Cnt > 0) return null;
  const hasMilestones = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid");
  if (!hasMilestones.recordset[0]?.Cnt) return null;

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT BookingNo, AssignedTo, GrandTotal, TotalValue FROM dbo.CrmBooking WHERE Id = @bid");
  const bookingRow = booking.recordset[0];
  if (!bookingRow) return null;

  const invoiceNo = await getNextDocNumber(pool, "INV", "INV");
  const amount = bookingRow.GrandTotal || bookingRow.TotalValue || 0;
  const result = await pool.request()
    .input("no",   sql.NVarChar(30),  invoiceNo)
    .input("bid",  sql.Int,           bookingId)
    .input("amt",  sql.Decimal(18,2), amount)
    .input("desc", sql.NVarChar(500), "Auto-generated — all payment milestones settled (on-possession stage)")
    .input("cb",   sql.Int,           actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, Description, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, 'Possession', @amt, @desc, @cb, SYSDATETIME())
    `);
  const invoiceId = result.recordset[0].Id;

  if (bookingRow.AssignedTo) {
    await emitNotification(pool, bookingRow.AssignedTo, "crm_invoice_generated",
      "Possession Invoice Generated",
      `${invoiceNo} auto-generated for booking ${bookingRow.BookingNo} — all payment milestones are settled.`,
      invoiceId, "crm_invoice");
  }

  return { id: invoiceId, InvoiceNo: invoiceNo };
}

/**
 * Auto-advance step: "AGREEMENT DONE -> INVOICE (receive payment for these
 * agreemental works)" — the moment an agreement reaches Executed (both
 * Senior and Customer approval already landed, per mark-executed's own
 * gate), automatically generate the Agreement-stage invoice, the same way
 * maybeAutoGenerateInvoice() does for the Possession stage. Only fires if
 * the booking's payment plan actually has a milestone named "Agreement..."
 * to invoice — if a custom plan doesn't have one, this deliberately does
 * nothing rather than guessing an amount; staff can still generate it
 * manually from the Booking Detail Invoice tab. Idempotent: no-op if an
 * Agreement-type invoice already exists for the booking.
 */
async function maybeAutoGenerateAgreementInvoice(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmInvoice WHERE BookingId = @bid AND InvoiceType = 'Agreement'");
  if (existing.recordset.length) return null;

  const milestone = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 AmountDue FROM dbo.CrmPaymentMilestone
    WHERE BookingId = @bid AND MilestoneName LIKE 'Agreement%'
    ORDER BY MilestoneNo
  `);
  if (!milestone.recordset.length) return null;

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT BookingNo, AssignedTo FROM dbo.CrmBooking WHERE Id = @bid");
  const bookingRow = booking.recordset[0];
  if (!bookingRow) return null;

  const invoiceNo = await getNextDocNumber(pool, "INV", "INV");
  const amount = milestone.recordset[0].AmountDue || 0;
  const result = await pool.request()
    .input("no",   sql.NVarChar(30),  invoiceNo)
    .input("bid",  sql.Int,           bookingId)
    .input("amt",  sql.Decimal(18,2), amount)
    .input("desc", sql.NVarChar(500), "Auto-generated — agreement executed, both sides approved")
    .input("cb",   sql.Int,           actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, Description, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, 'Agreement', @amt, @desc, @cb, SYSDATETIME())
    `);
  const invoiceId = result.recordset[0].Id;

  if (bookingRow.AssignedTo) {
    await emitNotification(pool, bookingRow.AssignedTo, "crm_invoice_generated",
      "Agreement Invoice Generated",
      `${invoiceNo} auto-generated for booking ${bookingRow.BookingNo} — agreement executed.`,
      invoiceId, "crm_invoice");
  }

  return { id: invoiceId, InvoiceNo: invoiceNo };
}

// Both sides landing on the same proposed date no longer finalizes
// AgreementDate directly — it only puts the date up for a super_admin
// sign-off (DateApprovalStatus='Pending', a second approval gate on the
// same record, independent of Senior/Customer content approval). Called
// after every point that can touch either proposed-date column (company
// propose-date, customer approve/propose-date) so the match is caught the
// instant it happens, from either side. Returns true iff this call is the
// one that just moved it into Pending (so a route can tell the caller
// "submitted for approval"); false/null otherwise. Never returns a
// confirmed date — use finalizeAgreementDate() (fired from the actual
// approve endpoint) for that.
async function maybeResolveAgreementDate(pool, agreementId) {
  const row = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT AgreementDate, DateApprovalStatus, ProposedDateByCompany, ProposedDateByCustomer
    FROM dbo.CrmAgreement WHERE Id = @id
  `);
  const ag = row.recordset[0];
  if (!ag || ag.AgreementDate) return false; // already finalized, never overwritten
  if (ag.DateApprovalStatus === "Pending") return false; // already awaiting sign-off
  if (!ag.ProposedDateByCompany || !ag.ProposedDateByCustomer) return false;

  const company = new Date(ag.ProposedDateByCompany).toDateString();
  const customer = new Date(ag.ProposedDateByCustomer).toDateString();
  if (company !== customer) return false; // still negotiating

  // Directly to 'Pending', not via approvalService.transition() — this is a
  // system event (a date match), not a user clicking "submit", and the
  // engine's own "Pending" transition expects a submitting user/role.
  await pool.request().input("id", sql.Int, agreementId)
    .query("UPDATE dbo.CrmAgreement SET DateApprovalStatus = 'Pending' WHERE Id = @id");

  await pool.request()
    .input("agid", sql.Int, agreementId)
    .query(`
      INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, CreatedAt)
      VALUES (@agid, 'AgreementDateSubmittedForApproval', 'System', SYSDATETIME())
    `);

  return true;
}

// Fired from PUT /:id/date/approve once approvalService.transition() has
// confirmed the sign-off — actually writes AgreementDate and, per the
// workflow's APPROVAL FROM BOTH END -> DATE OF AGREEMENT -> MILESTONE
// chain, gives the "Agreement" payment milestone its due date for the
// first time (it had none until an agreement date genuinely existed).
async function finalizeAgreementDate(pool, agreementId) {
  const row = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT BookingId, ProposedDateByCompany FROM dbo.CrmAgreement WHERE Id = @id
  `);
  const ag = row.recordset[0];
  if (!ag) return null;

  await pool.request()
    .input("id", sql.Int, agreementId)
    .input("adt", sql.Date, ag.ProposedDateByCompany)
    .query("UPDATE dbo.CrmAgreement SET AgreementDate = @adt WHERE Id = @id");

  await pool.request()
    .input("agid", sql.Int, agreementId)
    .query(`
      INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, CreatedAt)
      VALUES (@agid, 'AgreementDateConfirmed', 'System', SYSDATETIME())
    `);

  await pool.request()
    .input("bid", sql.Int, ag.BookingId)
    .input("adt", sql.Date, ag.ProposedDateByCompany)
    .query(`
      UPDATE dbo.CrmPaymentMilestone SET DueDate = @adt
      WHERE BookingId = @bid AND MilestoneName = 'Agreement' AND DueDate IS NULL AND Status = 'Pending'
    `);

  return ag.ProposedDateByCompany;
}

// Same 8-step whitelist as crmLegalMilestones.js's PUT /:id/:step — kept in
// sync manually (small, stable list) rather than requiring a cross-file
// import for a single array.
const LEGAL_MILESTONE_STEPS = [
  "DocCollection", "LegalReview", "Drafting", "InternalApproval",
  "DocShared", "MutualAgreement", "DirectorMeeting", "FinalExecution",
];

/**
 * Auto-tick a Legal Milestone step the instant its real-world equivalent
 * happens elsewhere in the Agreement lifecycle, instead of requiring staff
 * to separately click "Mark Complete" on the Legal Milestones page for
 * something that already just happened on the Agreement page. Only wired
 * for steps with an unambiguous single source of truth:
 *   InternalApproval -> Agreement senior-approved
 *   DocShared        -> Agreement sent to customer
 *   MutualAgreement   -> Customer approved the agreement
 *   FinalExecution    -> Agreement marked Executed
 * DocCollection/LegalReview/Drafting/DirectorMeeting have no equivalent
 * external event yet and stay manual-only (via the existing PUT /:id/:step
 * endpoint, still available for every step including these four).
 * No-op if the legal workflow hasn't been started for this booking yet, or
 * if the step is already Completed (idempotent — safe to call from
 * multiple trigger points, e.g. both /:id/approve's auto-send and
 * /:id/send-to-customer can fire DocShared).
 */
async function syncLegalMilestoneStep(pool, bookingId, step, actorUserId) {
  if (!LEGAL_MILESTONE_STEPS.includes(step)) return;

  const lm = await pool.request().input("bid", sql.Int, bookingId)
    .query(`SELECT Id, ${step}Status FROM dbo.CrmLegalMilestone WHERE BookingId = @bid`);
  if (!lm.recordset.length) return;
  const row = lm.recordset[0];
  if (row[`${step}Status`] === "Completed") return;

  const idx = LEGAL_MILESTONE_STEPS.indexOf(step);
  await pool.request()
    .input("id", sql.Int, row.Id)
    .input("ub", sql.Int, actorUserId || null)
    .query(`
      UPDATE dbo.CrmLegalMilestone SET
        ${step}Done   = ISNULL(${step}Done, CAST(SYSDATETIME() AS DATE)),
        ${step}Status = 'Completed',
        ${step}Notes  = ISNULL(${step}Notes, 'Auto-synced from Agreement workflow'),
        CurrentStep = CASE WHEN CurrentStep = ${idx + 1} THEN ${Math.min(idx + 2, LEGAL_MILESTONE_STEPS.length)} ELSE CurrentStep END,
        OverallStatus = CASE WHEN '${step}' = 'FinalExecution' THEN 'Completed' ELSE OverallStatus END,
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
}

// Redistributes the ₹ (and %) of every NOT-yet-settled milestone on a
// booking so they still sum to the booking's authoritative GrandTotal,
// while preserving each open milestone's relative weight. Two independent
// call sites feed this:
//   1. The booking's GrandTotal itself changes (rate correction, extra
//      charges, parking) — every open milestone is fair game.
//   2. Staff manually overrides one specific milestone's AmountDue — that
//      milestone is held fixed at its new value (fixedMilestoneId); only
//      the OTHER open ones get redistributed around it.
//   3. Milestone #1 (the booking amount) is fixed at whatever the customer
//      actually booked with — a real ₹ figure, not a plan percentage — right
//      when the schedule is first generated (generateMilestonesForBooking).
// Paid/Waived milestones are never touched — money already collected or
// formally waived can't retroactively change. Legacy milestones with no
// stored Percent (created before that column existed) fall back to the
// booking's actual Payment Plan Template's own percentages (matched by
// MilestoneNo) so a resync reproduces the plan's real shape (e.g.
// 10/15/20/20/15/15) instead of flattening everything into an even split.
// A genuine even split is the last-resort fallback only when no plan item
// exists either (booking has no PaymentPlanId, or it's a free-form schedule).
//
// Percent is deliberately stored as each open milestone's share of
// remainingTarget (grandTotal minus whatever's already settled), not of the
// original grandTotal — every settlement "restarts" the percentage basis
// onto what's actually still owed, so e.g. a booking amount of ₹5L against a
// ₹50L total leaves the remaining milestones' percentages summing to 100%
// of the ₹45L left, not 100% of the original ₹50L.
async function recalculateRemainingMilestones(pool, bookingId, { fixedMilestoneId } = {}) {
  const bkRes = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT GrandTotal, TotalValue, PaymentPlanId FROM dbo.CrmBooking WHERE Id = @bid");
  const booking = bkRes.recordset[0];
  const grandTotal = Number(booking?.GrandTotal || booking?.TotalValue || 0);
  if (!grandTotal) return;

  const msRes = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id, MilestoneNo, AmountDue, [Percent], Status, ExtraChargeId, ParkingAllotmentId FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
  const rows = msRes.recordset;
  if (!rows.length) return;

  let planPercentByNo = {};
  if (booking?.PaymentPlanId) {
    const planRes = await pool.request().input("pid", sql.Int, booking.PaymentPlanId)
      .query("SELECT MilestoneNo, [Percent] FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @pid");
    for (const r of planRes.recordset) planPercentByNo[r.MilestoneNo] = Number(r.Percent);
  }

  // Extra-charge/parking milestones are fixed line items (their AmountDue
  // comes straight from the charge itself), not %-based schedule steps —
  // treat them the same as Paid/Waived: excluded from the proportional pool
  // entirely, contributing their own AmountDue to settledTotal so the
  // %-based milestones redistribute onto what's actually left over.
  const isSettled = (r) =>
    ["Paid", "Waived"].includes(r.Status) || r.Id === fixedMilestoneId ||
    r.ExtraChargeId != null || r.ParkingAllotmentId != null;
  const settled = rows.filter(isSettled);
  const open = rows.filter((r) => !isSettled(r));
  if (!open.length) return; // nothing left to redistribute onto

  const settledTotal = settled.reduce((s, r) => s + Number(r.AmountDue), 0);
  const remainingTarget = Math.max(0, grandTotal - settledTotal);
  // Weight priority per milestone: its own stored Percent (preserves any
  // prior redistribution or manual override) > the Payment Plan Template's
  // percentage for that milestone number > an even share as the last resort.
  const rawWeight = (r) => {
    if (r.Percent != null && Number(r.Percent) > 0) return Number(r.Percent);
    if (planPercentByNo[r.MilestoneNo] != null) return planPercentByNo[r.MilestoneNo];
    return null;
  };
  const weights = open.map(rawWeight);
  const knownSum = weights.reduce((s, w) => s + (w || 0), 0);
  const evenShare = knownSum > 0 ? knownSum / open.length : 100 / open.length;
  const resolvedWeights = weights.map((w) => w != null ? w : evenShare);
  const openPercentSum = resolvedWeights.reduce((s, w) => s + w, 0);
  const weight = (r, idx) => (openPercentSum > 0 ? resolvedWeights[idx] / openPercentSum : 1 / open.length);

  let allocated = 0;
  for (let i = 0; i < open.length; i++) {
    const r = open[i];
    const isLast = i === open.length - 1;
    // The last open milestone absorbs whatever's left after rounding the
    // others, so the schedule always sums exactly to GrandTotal instead of
    // drifting a paisa or two off from independently-rounded shares.
    const amount = isLast
      ? Math.round((remainingTarget - allocated) * 100) / 100
      : Math.round(remainingTarget * weight(r, i) * 100) / 100;
    allocated += amount;
    const finalAmount = Math.max(0, amount);
    const percent = remainingTarget > 0 ? Math.round((finalAmount / remainingTarget) * 10000) / 100 : 0;

    await pool.request()
      .input("id", sql.Int, r.Id)
      .input("amt", sql.Decimal(18, 2), finalAmount)
      .input("pct", sql.Decimal(5, 2), percent)
      .query(`UPDATE dbo.CrmPaymentMilestone SET AmountDue = @amt, [Percent] = @pct, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  }
}

// Same 2%-under-1Cr / 1%-at-or-above-1Cr tier crmBrokerage.js's manual POST
// leaves to a human to type in — this is the auto path's own default, used
// only when the Application/Booking didn't carry an explicit override.
const BROKERAGE_TIER_THRESHOLD = 10000000; // 1 Crore
function tierBrokeragePercent(totalValue) {
  return Number(totalValue) >= BROKERAGE_TIER_THRESHOLD ? 1 : 2;
}

/**
 * Auto-advance step: the moment a booking's first payment milestone is fully
 * Paid, a broker selected at Application/Booking stage automatically gets
 * ONE CrmBrokerageMaster row PER payment milestone — the broker's payout
 * follows the exact same milestone schedule the customer's own payments do,
 * not a fixed one/two-tranche split. Each row's ComputedAmount is that
 * milestone's own share of the total brokerage (milestone.Percent% of the
 * total brokerage amount, mirroring how the milestone itself is that
 * Percent% of the booking's TotalValue). A milestone that's already Paid by
 * the time this fires (Milestone #1 itself, the trigger) is created
 * unlocked; every later milestone is created locked until
 * maybeUnlockBrokerageMilestoneTranche fires for it.
 * Idempotent: no-op if the booking has no BrokerId, or brokerage rows
 * already exist for it (still available as crmBrokerage.js POST / for
 * bookings that never had a broker picked up front).
 * Call site: createReceiptForMilestone in crmPayments.js, gated additionally
 * on this being Milestone #1 specifically — the other auto-advance guards in
 * this file react to "all milestones settled", not milestone 1 alone, so
 * this can't reuse their trigger condition.
 */
async function maybeAutoCreateBrokerage(pool, bookingId, actorUserId) {
  const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT BrokerId, BrokerageRatePercent, TotalValue, AssignedTo, BookingNo
    FROM dbo.CrmBooking WHERE Id = @bid
  `);
  const bk = booking.recordset[0];
  if (!bk || !bk.BrokerId) return null;

  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmBrokerageMaster WHERE BookingId = @bid");
  if (existing.recordset.length) return null;

  const broker = await pool.request().input("brid", sql.Int, bk.BrokerId)
    .query("SELECT LHeadId, LHeadName, LHeadPhone FROM dbo.AccountHeadMaster WHERE LHeadId = @brid AND LHeadType = 'BR'");
  if (!broker.recordset.length) return null;
  const brk = broker.recordset[0];

  const totalValue = Number(bk.TotalValue) || 0;
  const totalPercent = bk.BrokerageRatePercent != null ? Number(bk.BrokerageRatePercent) : tierBrokeragePercent(totalValue);
  // Mirrors crmBrokerage.js POST /'s own ComputedAmount formula exactly, so
  // a full-payout manually-created row and the sum of these auto-created
  // ones compute the same total.
  const totalBrokerageAmount = Math.round(totalValue * totalPercent) / 100;

  // %-based schedule steps only — an Extra-Charge/Parking milestone is a
  // fixed line item the customer negotiated directly, not part of the deal
  // value the broker actually sold, so it earns no brokerage share (same
  // exclusion recalculateRemainingMilestones already applies for the
  // customer-facing schedule).
  const milestones = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT Id, MilestoneNo, [Percent], Status
    FROM dbo.CrmPaymentMilestone
    WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL
    ORDER BY MilestoneNo
  `);
  if (!milestones.recordset.length) return null;

  const rows = milestones.recordset;
  const totalPct = rows.reduce((s, m) => s + Number(m.Percent || 0), 0);
  const share = (pct) => (totalPct > 0 ? pct / totalPct : 1 / rows.length);

  let ids;
  try {
    ids = [];
    let allocated = 0;
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      const isLast = i === rows.length - 1;
      // Last row absorbs the rounding remainder so the tranches always sum
      // exactly to totalBrokerageAmount, same pattern
      // recalculateRemainingMilestones uses for the customer schedule.
      const computedAmount = isLast
        ? Math.round((totalBrokerageAmount - allocated) * 100) / 100
        : Math.round(totalBrokerageAmount * share(Number(m.Percent || 0)) * 100) / 100;
      allocated += computedAmount;
      const ratePercent = Math.round((totalPercent * share(Number(m.Percent || 0))) * 100) / 100;
      const isLocked = m.Status !== "Paid" && m.Status !== "Waived";

      const result = await pool.request()
        .input("bid",   sql.Int,           bookingId)
        .input("brid",  sql.Int,           brk.LHeadId)
        .input("name",  sql.NVarChar(200), brk.LHeadName)
        .input("con",   sql.NVarChar(20),  brk.LHeadPhone || null)
        .input("rt",    sql.NVarChar(20),  "Percentage")
        .input("rv",    sql.Decimal(18,2), ratePercent)
        .input("camt",  sql.Decimal(18,2), computedAmount)
        .input("mid",   sql.Int,           m.Id)
        .input("mno",   sql.Int,           m.MilestoneNo)
        .input("lock",  sql.Bit,           isLocked ? 1 : 0)
        .input("notes", sql.NVarChar(sql.MAX), `Auto-created — follows Milestone #${m.MilestoneNo} of the booking's own payment schedule`)
        .input("cb",    sql.Int,           actorUserId || null)
        .query(`
          INSERT INTO dbo.CrmBrokerageMaster
            (BookingId, BrokerId, BrokerName, BrokerContact, RateType, RateValue, ComputedAmount, MilestoneId, MilestoneNo, IsLocked, Status, Notes, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@bid, @brid, @name, @con, @rt, @rv, @camt, @mid, @mno, @lock, 'Pending', @notes, @cb, SYSDATETIME())
        `);
      ids.push(result.recordset[0].Id);
    }
  } catch (e) {
    // Race with another milestone-paid trigger reaching here concurrently —
    // same UNIQUE(BookingId)-loses-the-race pattern as maybeAutoCreateAgreement.
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) return null;
    throw e;
  }

  if (bk.AssignedTo) {
    await emitNotification(pool, bk.AssignedTo, "crm_brokerage_ready",
      "Brokerage Schedule Created",
      `Brokerage schedule auto-created for booking ${bk.BookingNo} — ${ids.length} milestone-tranche(s) for broker ${brk.LHeadName}.`,
      ids[0], "crm_brokerage");
  }

  return { ids };
}

/**
 * Unlocks the brokerage tranche tied to one specific payment milestone the
 * moment that milestone becomes Paid (or Waived — waiving still resolves
 * the milestone, and the broker's cut for it shouldn't stay stuck forever
 * just because the customer's own charge was forgiven). No-op if there's no
 * such row (bookings with no broker, or a milestone excluded from the
 * brokerage schedule).
 * Call sites: every place in crmPayments.js where a milestone's Status
 * transitions to Paid/Waived — createReceiptForMilestone, the direct
 * milestone PUT /:id edit, PUT /:id/waive, and the on-account "apply to
 * milestone" route.
 */
async function maybeUnlockBrokerageMilestoneTranche(pool, bookingId, milestoneId) {
  await pool.request().input("bid", sql.Int, bookingId).input("mid", sql.Int, milestoneId).query(`
    UPDATE dbo.CrmBrokerageMaster SET IsLocked = 0
    WHERE BookingId = @bid AND MilestoneId = @mid AND IsLocked = 1
  `);
}

// Fires when staff click "Book / Send for Approval" (PUT
// /:id/ready-for-approval in crmBookings.js) — the moment a booking clears
// its own checklist and is submitted for admin approval, generate the
// Booking-stage invoice automatically instead of leaving staff to remember
// a separate manual step. Idempotent on InvoiceType = 'Booking' so re-
// notifying admins (a booking bounced back and resubmitted) never creates a
// second invoice.
async function maybeAutoGenerateBookingInvoice(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmInvoice WHERE BookingId = @bid AND InvoiceType = 'Booking'");
  if (existing.recordset.length) return null;

  const booking = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT BookingNo, AssignedTo, BookingAmount FROM dbo.CrmBooking WHERE Id = @bid");
  const bookingRow = booking.recordset[0];
  if (!bookingRow || !bookingRow.BookingAmount) return null;

  // Auto-generation is only ever meant to fire for the booking (token)
  // payment itself, once it's fully paid — not for any milestone-wise
  // payment that comes after. crmBookings.js's ready-for-approval already
  // gates on this via checkBookingApprovalReadiness before calling here,
  // but that's a call-site guarantee, not a data-layer one — re-check the
  // first milestone directly so this function stays correct even if a
  // future call site is added without that same gate.
  const firstMilestone = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 AmountDue, AmountPaid FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo
  `);
  const fm = firstMilestone.recordset[0];
  if (!fm || !(fm.AmountDue > 0) || Number(fm.AmountPaid) < Number(fm.AmountDue)) return null;

  const invoiceNo = await getNextDocNumber(pool, "INV", "INV");
  const result = await pool.request()
    .input("no",   sql.NVarChar(30),  invoiceNo)
    .input("bid",  sql.Int,           bookingId)
    .input("amt",  sql.Decimal(18,2), bookingRow.BookingAmount)
    .input("desc", sql.NVarChar(500), "Auto-generated — booking submitted for approval")
    .input("cb",   sql.Int,           actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, Description, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, 'Booking', @amt, @desc, @cb, SYSDATETIME())
    `);
  const invoiceId = result.recordset[0].Id;

  if (bookingRow.AssignedTo) {
    await emitNotification(pool, bookingRow.AssignedTo, "crm_invoice_generated",
      "Booking Invoice Generated",
      `${invoiceNo} auto-generated for booking ${bookingRow.BookingNo}.`,
      invoiceId, "crm_invoice");
  }

  return { id: invoiceId, InvoiceNo: invoiceNo };
}

module.exports = {
  validateAgreementPreparationPrerequisites,
  maybeAutoCreateAgreement,
  maybeAutoCreateSalesDeed,
  maybeAutoGenerateInvoice,
  maybeAutoGenerateBookingInvoice,
  maybeAutoGenerateAgreementInvoice,
  maybeAutoCreateBrokerage,
  maybeUnlockBrokerageMilestoneTranche,
  maybeResolveAgreementDate,
  finalizeAgreementDate,
  syncLegalMilestoneStep,
  requireActiveBooking,
  recalculateRemainingMilestones,
  isLegalWorkStarted,
};