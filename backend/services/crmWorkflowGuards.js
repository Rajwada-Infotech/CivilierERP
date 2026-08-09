const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");
const { ensurePortalUser } = require("./crmPortalProvision");
const { emitNotification } = require("./notify");
const { generateInvoicePdf } = require("./invoicePdf");

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

  // Standing document request: a customer's own identity proof is useful KYC
  // paperwork to have on file, not just the PAN/Aadhaar numbers typed in
  // during the welcome call. Requested here (Status='Requested', no file
  // yet), open for upload immediately (see GET /agreement/documents' own
  // early-access carve-out in crmPortal.js) — no need to wait for the
  // agreement to be shared. Deliberately NOT mandatory: the real gate on
  // Agreement Followup / Senior Approval is the actual legal Sale Agreement
  // paper the Legal Executive prepares and uploads, not this KYC document.
  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("cb", sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmAgreementDocument
        (AgreementId, DocumentType, Label, IsMandatory, Status, UploadedByType, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
      VALUES (@agid, 'IdentityProof', 'Identity Proof (PAN / Aadhaar copy)', 0, 'Requested', 'Customer', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
    `);

  // The actual legal paperwork — the real Sale Agreement document the
  // Legal Executive drafts outside this software (law/legal paperwork) and
  // then uploads here — was never being requested at all, only the
  // customer's KYC identity proof above. That made "Agreement Followup"
  // track the wrong thing entirely: a booking's KYC status, not whether the
  // actual legal contract exists. UploadedByType is left NULL (not
  // 'Customer') since this one is staff/Legal-Executive-uploaded, not
  // requested from the customer.
  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("cb", sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmAgreementDocument
        (AgreementId, DocumentType, Label, IsMandatory, Status, RequestedBy, RequestedAt, VersionNo, CreatedBy, CreatedAt)
      VALUES (@agid, 'SaleAgreement', 'Sale Agreement (Legal Paperwork)', 1, 'Requested', @cb, SYSDATETIME(), 1, @cb, SYSDATETIME())
    `);

  // Legal Milestone tracking used to require a staff member to remember to
  // click "Start Workflow" for every booking after its agreement appeared —
  // easy to forget, and the 8-step legal process (drafting, internal
  // approval, etc.) is really just internal follow-up on the agreement that
  // was just auto-created above, not a separate decision anyone needs to
  // make. Auto-started here, right alongside the agreement itself, the same
  // way the SaleAgreement document request is. Guarded separately (like
  // portal provisioning below) so a failure here can't turn into a 500 on
  // whatever action actually triggered agreement creation.
  try {
    await maybeAutoCreateLegalMilestone(pool, bookingId, actorUserId);
  } catch (e) {
    console.error("[maybeAutoCreateAgreement] legal milestone auto-start failed:", e.message);
  }

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
 * Auto-start the Legal Milestone tracker for a booking the instant it has
 * an agreement — mirrors POST /api/crm/legal-milestones' own rule (an
 * agreement must exist first) and its MilestoneNo scheme. No-op if a
 * tracker already exists for this booking (UNIQUE BookingId) or the
 * booking has no agreement yet. Idempotent/race-safe like the sibling
 * maybeAutoCreate* helpers — safe to call from multiple trigger points.
 */
async function maybeAutoCreateLegalMilestone(pool, bookingId, actorUserId) {
  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmLegalMilestone WHERE BookingId = @bid");
  if (existing.recordset.length) return null;

  const agr = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT Id FROM dbo.CrmAgreement WHERE BookingId = @bid");
  if (!agr.recordset.length) return null;

  const milestoneNo = "LGL-" + Date.now().toString(36).toUpperCase().slice(-7);
  try {
    const result = await pool.request()
      .input("no",  sql.NVarChar(30), milestoneNo)
      .input("bid", sql.Int, bookingId)
      .input("cb",  sql.Int, actorUserId || null)
      .query(`
        INSERT INTO dbo.CrmLegalMilestone (MilestoneNo, BookingId, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @cb, SYSDATETIME())
      `);
    return { id: result.recordset[0].Id, MilestoneNo: milestoneNo };
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) return null;
    throw e;
  }
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
    .input("desc", sql.NVarChar(500), "Final settlement — possession of unit")
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
    .input("desc", sql.NVarChar(500), "Agreement execution charges")
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

// --- Single-field agreement-date negotiation loop -------------------------
// Replaces the old two-column (ProposedDateByCompany / ProposedDateByCustomer)
// design. One live field, ProposedDate, plus ProposedDateStatus tracking
// whose turn it is:
//   null                  -> nothing proposed yet, either side may open
//   PendingCustomerReview -> company just acted, waiting on customer
//   PendingCompanyReview  -> customer just acted, waiting on company
//   Matched               -> both sides landed on the same date
// Matched still does NOT write AgreementDate directly — same as the old
// design, it only opens the independent super_admin sign-off gate
// (DateApprovalStatus='Pending'). Only finalizeAgreementDate(), fired from
// the actual PUT /:id/date/approve endpoint once that sign-off completes,
// ever writes AgreementDate.

function agreementDateError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Propose a brand-new date, or revise the currently-pending one, from one
// side. `proposedBy` is 'Company' or 'Customer' — whichever side is taking
// this action right now. Enforces turn-taking: a side may act when nothing
// is pending yet (opening move) or when the status shows it's waiting on
// THEM to respond — never while waiting on the other side. Writes
// CrmAgreementDateHistory exactly as before (unchanged shape/consumers).
async function proposeAgreementDate(pool, agreementId, proposedBy, proposedDate, actorUserId) {
  const row = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT AgreementDate, DateApprovalStatus, ProposedDateStatus
    FROM dbo.CrmAgreement WHERE Id = @id
  `);
  const ag = row.recordset[0];
  if (!ag) throw agreementDateError("Agreement not found", 404);
  if (ag.AgreementDate) throw agreementDateError("The agreement date is already confirmed", 400);
  if (ag.DateApprovalStatus === "Pending") throw agreementDateError("A proposed date is already awaiting approval", 400);

  const myTurnStatus = proposedBy === "Company" ? "PendingCompanyReview" : "PendingCustomerReview";
  if (ag.ProposedDateStatus && ag.ProposedDateStatus !== myTurnStatus) {
    throw agreementDateError("Waiting on the other side to respond to the current proposal", 400);
  }

  await pool.request()
    .input("agid", sql.Int, agreementId)
    .input("by",   sql.NVarChar(20), proposedBy)
    .input("pd",   sql.Date, proposedDate)
    .input("cb",   sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmAgreementDateHistory (AgreementId, ProposedBy, ProposedDate, CreatedBy, CreatedAt)
      VALUES (@agid, @by, @pd, @cb, SYSDATETIME())
    `);

  const nextStatus = proposedBy === "Company" ? "PendingCustomerReview" : "PendingCompanyReview";
  await pool.request()
    .input("id", sql.Int, agreementId)
    .input("pd", sql.Date, proposedDate)
    .input("st", sql.NVarChar(30), nextStatus)
    .query(`
      UPDATE dbo.CrmAgreement SET ProposedDate = @pd, ProposedDateStatus = @st
      WHERE Id = @id
    `);

  return { status: nextStatus };
}

// The side it's currently waiting on accepts ProposedDate as-is (no
// re-typing the same date to force a "match"). Moves straight to 'Matched'
// and opens the super_admin sign-off gate, same as a same-date match did
// under the old two-column design. Returns true if this call is the one
// that just opened that gate.
async function acceptAgreementDate(pool, agreementId, acceptedBy) {
  const row = await pool.request().input("id", sql.Int, agreementId).query(`
    SELECT AgreementDate, DateApprovalStatus, ProposedDate, ProposedDateStatus
    FROM dbo.CrmAgreement WHERE Id = @id
  `);
  const ag = row.recordset[0];
  if (!ag) throw agreementDateError("Agreement not found", 404);
  if (ag.AgreementDate) throw agreementDateError("The agreement date is already confirmed", 400);
  if (ag.DateApprovalStatus === "Pending") throw agreementDateError("A proposed date is already awaiting approval", 400);
  if (!ag.ProposedDate) throw agreementDateError("No proposed date to accept", 400);

  const myTurnStatus = acceptedBy === "Company" ? "PendingCompanyReview" : "PendingCustomerReview";
  if (ag.ProposedDateStatus !== myTurnStatus) {
    throw agreementDateError("It's not your turn to accept — the other side hasn't reviewed the current proposal yet", 400);
  }

  // Directly to 'Pending', not via approvalService.transition() — this is a
  // system event (an accept), not a user clicking "submit", and the
  // engine's own "Pending" transition expects a submitting user/role.
  await pool.request().input("id", sql.Int, agreementId)
    .query("UPDATE dbo.CrmAgreement SET ProposedDateStatus = 'Matched', DateApprovalStatus = 'Pending' WHERE Id = @id");

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
    SELECT BookingId, ProposedDate FROM dbo.CrmAgreement WHERE Id = @id
  `);
  const ag = row.recordset[0];
  if (!ag) return null;

  await pool.request()
    .input("id", sql.Int, agreementId)
    .input("adt", sql.Date, ag.ProposedDate)
    .query("UPDATE dbo.CrmAgreement SET AgreementDate = @adt WHERE Id = @id");

  await pool.request()
    .input("agid", sql.Int, agreementId)
    .query(`
      INSERT INTO dbo.CrmAgreementApprovalLog (AgreementId, Action, ActorType, CreatedAt)
      VALUES (@agid, 'AgreementDateConfirmed', 'System', SYSDATETIME())
    `);

  await pool.request()
    .input("bid", sql.Int, ag.BookingId)
    .input("adt", sql.Date, ag.ProposedDate)
    .query(`
      UPDATE dbo.CrmPaymentMilestone SET DueDate = @adt
      WHERE BookingId = @bid AND MilestoneName = 'Agreement' AND DueDate IS NULL AND Status = 'Pending'
    `);

  return ag.ProposedDate;
}

// PUT /:id/date/reject hard-resets the whole negotiation to NULL/NULL —
// confirmed behavior, matching what the old two-column design did.
async function resetAgreementDateNegotiation(pool, agreementId) {
  await pool.request().input("id", sql.Int, agreementId).query(`
    UPDATE dbo.CrmAgreement SET
      DateApprovalStatus = 'NotRequired', ProposedDate = NULL, ProposedDateStatus = NULL
    WHERE Id = @id
  `);
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
 * something that already just happened on the Agreement page. Every step
 * but one is wired to an unambiguous single source of truth:
 *   DocCollection     -> customer's Identity Proof document Verified
 *   LegalReview       -> Legal Executive assigned to the agreement (this
 *                        step is labeled "Legal Executive Assigned" in the
 *                        UI now — "Legal Review" never had a real trigger
 *                        of its own; assignment is the closest real event
 *                        and is the thing that actually gates the rest of
 *                        the workflow)
 *   Drafting          -> the Sale Agreement document itself uploaded
 *   InternalApproval  -> Agreement senior-approved
 *   DocShared         -> Agreement sent to customer
 *   MutualAgreement   -> Customer approved the agreement
 *   FinalExecution    -> Agreement marked Executed
 * DirectorMeeting has no digital equivalent — an in-person meeting leaves
 * no trace in this system — and stays manual-only (via the existing PUT
 * /:id/:step endpoint, still available for every step including this one).
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

  await pool.request()
    .input("id", sql.Int, row.Id)
    .input("ub", sql.Int, actorUserId || null)
    .query(`
      UPDATE dbo.CrmLegalMilestone SET
        ${step}Done   = ISNULL(${step}Done, CAST(SYSDATETIME() AS DATE)),
        ${step}Status = 'Completed',
        ${step}Notes  = ISNULL(${step}Notes, 'Auto-synced from Agreement workflow'),
        UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
  await recomputeLegalMilestoneCurrentStep(pool, row.Id);
}

/**
 * CurrentStep used to be advanced incrementally — "if CurrentStep equals
 * this step's own position, bump it by one" — which silently assumed every
 * step completes strictly in LEGAL_MILESTONE_STEPS order. In reality each
 * step is triggered by its own independent real-world event (Legal
 * Executive assignment, document upload, senior approval, customer
 * approval, execution...), and DocCollection specifically depends on the
 * customer's Identity Proof being verified — a non-mandatory document that
 * often never happens. The result: steps 2-8 could all show Completed while
 * CurrentStep stayed stuck at 1 forever, because the increment logic only
 * ever fires relative to whatever CurrentStep already was, and out-of-order
 * completion breaks that chain permanently.
 *
 * Recomputing CurrentStep from scratch — the position of the first
 * still-incomplete step — is correct regardless of completion order, and
 * is idempotent/safe to call after every single step update (manual or
 * auto-synced).
 */
async function recomputeLegalMilestoneCurrentStep(pool, legalMilestoneId) {
  const caseWhens = LEGAL_MILESTONE_STEPS
    .map((step, i) => `WHEN ${step}Status <> 'Completed' THEN ${i + 1}`)
    .join("\n        ");
  await pool.request().input("id", sql.Int, legalMilestoneId).query(`
    UPDATE dbo.CrmLegalMilestone SET
      CurrentStep = CASE
        ${caseWhens}
        ELSE ${LEGAL_MILESTONE_STEPS.length + 1}
      END,
      OverallStatus = CASE WHEN FinalExecutionStatus = 'Completed' THEN 'Completed' ELSE OverallStatus END
    WHERE Id = @id
  `);
}

/**
 * DocCollection and Drafting are both triggered by a CrmAgreementDocument
 * change (Verified / Uploaded respectively), and every document-touching
 * route already has the docId in hand but not always the BookingId — this
 * looks both up in one join and fires the right step, so call sites don't
 * each have to duplicate the DocumentType/Status matching logic. Safe to
 * call after ANY document status change; it's a no-op for document types
 * or statuses that don't map to a milestone step.
 */
async function syncLegalMilestoneFromDocument(pool, docId, actorUserId) {
  const row = await pool.request().input("id", sql.Int, docId).query(`
    SELECT d.DocumentType, d.Status, ag.BookingId
    FROM dbo.CrmAgreementDocument d
    JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
    WHERE d.Id = @id
  `);
  if (!row.recordset.length) return;
  const { DocumentType, Status, BookingId } = row.recordset[0];
  if (DocumentType === "IdentityProof" && Status === "Verified") {
    await syncLegalMilestoneStep(pool, BookingId, "DocCollection", actorUserId);
  } else if (DocumentType === "SaleAgreement" && ["Uploaded", "Submitted", "Verified"].includes(Status)) {
    await syncLegalMilestoneStep(pool, BookingId, "Drafting", actorUserId);
  }
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
    .query("SELECT Id, MilestoneNo, AmountDue, AmountPaid, [Percent], Status, ExtraChargeId, ParkingAllotmentId FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
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
  // Any milestone with real money already recorded against it (AmountPaid >
  // 0) must never have its AmountDue moved by a later redistribution, even
  // if its Status hasn't reached "Paid" yet.
  //
  // MilestoneNo 1 (the real ₹ Booking Amount) is ALWAYS excluded, not just
  // when Paid/AmountPaid>0 — this used to rely solely on the transient
  // fixedMilestoneId argument, which only protects it for the ONE call site
  // that passes it (generateMilestonesForBooking at creation, resync-
  // schedule on demand). Every OTHER trigger of this function — adding/
  // editing/releasing Parking or an Extra Charge, which now fold their value
  // into this same proportional pool instead of getting their own dedicated
  // milestone — calls it with no fixedMilestoneId at all. A freshly created,
  // still-unpaid Milestone 1 doesn't match any of the other isSettled
  // conditions either, so it was getting silently swept into the %-based
  // pool and reproportioned the moment Parking was added during booking
  // creation — a real, reproduced bug (₹20,000 became ₹20,386.14 the instant
  // a parking slot was attached, before the customer had paid anything).
  // Milestone 1 is a deliberate flat figure the customer agreed to, never a
  // percentage-of-total step the way Milestones 2+ are, so it must stay
  // fixed unconditionally — the only path allowed to change it is resync-
  // schedule's own explicit UPDATE, which runs before this function anyway.
  const isSettled = (r) =>
    ["Paid", "Waived"].includes(r.Status) || r.Id === fixedMilestoneId ||
    r.ExtraChargeId != null || r.ParkingAllotmentId != null ||
    Number(r.AmountPaid || 0) > 0 || Number(r.MilestoneNo) === 1;
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

// Parking/Extra Charges added to a booking now fold their ₹ value straight
// into the shared %-based milestones (via recalculateRemainingMilestones)
// instead of getting a dedicated milestone of their own — see crmParking.js/
// crmExtraCharges.js. Once blended that way, a payment against e.g.
// "Foundation" is part-unit/part-parking/part-extra-charge; there's no way
// to isolate "which rupee paid for the parking slot specifically". The only
// honest, unambiguous answer is booking-wide: nothing riding on the shared
// total can be considered settled until the WHOLE total is — so this is the
// single source of truth for "has this charge been paid" wherever a charge
// has no dedicated milestone of its own (edit-lock, release-lock, matrix
// display). Bookings that still have a legacy dedicated milestone (created
// before this change) keep using that milestone's own Status instead — see
// the ParkingAllotmentId/ExtraChargeId lookup each caller does first.
async function isBookingFullySettled(pool, bookingId) {
  const r = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      (SELECT ISNULL(SUM(AmountPaid), 0) FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid) AS TotalPaid,
      (SELECT GrandTotal FROM dbo.CrmBooking WHERE Id = @bid) AS GrandTotal
  `);
  const row = r.recordset[0];
  if (!row || !row.GrandTotal) return false;
  return Number(row.TotalPaid) + 0.01 >= Number(row.GrandTotal);
}

// Keeps CrmParkingAllotment.PaymentStatus (the column the Parking Matrix /
// Parking Booking pages actually read) in sync with the derived booking-wide
// settled state above. Only touches BookingId-linked rows — standalone
// parking sales (BookingId IS NULL) manage their own PaymentStatus via a
// direct mark-paid action and have no milestone/blended-total concept at
// all, see migration 219.
async function syncParkingPaymentStatus(pool, bookingId) {
  const settled = await isBookingFullySettled(pool, bookingId);
  await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("st", sql.NVarChar(20), settled ? "Paid" : "Pending")
    .query(`UPDATE dbo.CrmParkingAllotment SET PaymentStatus = @st WHERE BookingId = @bid AND IsActive = 1`);
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
 * not a fixed one/two-tranche split. Each row's ComputedAmount is calculated
 * from the milestone's real AmountDue and the broker's actual commission
 * rate. Do not multiply the deal rate by the milestone percent and store
 * that as RateValue: a 1% brokerage on a 1% booking milestone is still a
 * 1% brokerage rate, not 0.01%. A milestone that's already Paid by
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
// BrokeragePaymentPlan on CrmBooking decides how the commission is split
// into payable tranches — replaces the old always-one-tranche-per-milestone
// behavior, which both mis-scoped the total (see totalBrokerageAmount
// below) and paid brokers on a schedule nobody actually asked for.
//   'OneTime'       - single tranche, unlocked immediately (same trigger
//                      point as always: Milestone #1 / booking amount paid).
//   'TwoPart'       - half unlocked immediately (booking amount paid),
//                      other half locked until the Agreement is Executed.
//   'AgreementOnly' - single tranche, locked until the Agreement is
//                      Executed (created now so it's visible/tracked, but
//                      not payable until then).
function buildBrokerageTranches(plan, totalAmount, agreementExecuted) {
  const round2 = (n) => Math.round(n * 100) / 100;
  if (plan === "TwoPart") {
    const first = round2(totalAmount / 2);
    const second = round2(totalAmount - first);
    return [
      { label: "Booking", amount: first, gate: "Booking", locked: false },
      { label: "Agreement", amount: second, gate: "Agreement", locked: !agreementExecuted },
    ];
  }
  if (plan === "AgreementOnly") {
    return [{ label: "Agreement", amount: round2(totalAmount), gate: "Agreement", locked: !agreementExecuted }];
  }
  // OneTime (default, and fallback for any unrecognized value)
  return [{ label: "Full", amount: round2(totalAmount), gate: "Booking", locked: false }];
}

async function maybeAutoCreateBrokerage(pool, bookingId, actorUserId) {
  const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT BrokerId, BrokerageRatePercent, BrokeragePaymentPlan, TotalValue,
           ParkingTotal, ExtraChargesTotal, AssignedTo, BookingNo
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

  // Commission is rate% of the whole deal the broker actually closed —
  // unit price + parking + extras — but NOT GrandTotal, because GrandTotal
  // also folds in GST, and GST is a statutory pass-through the seller
  // collects on the government's behalf, not revenue the broker should be
  // cut in on. (TotalValue alone previously under-counted the deal by
  // leaving parking/extras out entirely — see booking 41, where the old
  // per-milestone schedule's real total was TotalValue + ParkingTotal,
  // confirmed against CrmPaymentMilestone.AmountDue sums.)
  const dealValue = Number(bk.TotalValue || 0) + Number(bk.ParkingTotal || 0) + Number(bk.ExtraChargesTotal || 0);
  const totalPercent = bk.BrokerageRatePercent != null ? Number(bk.BrokerageRatePercent) : tierBrokeragePercent(dealValue);
  const totalBrokerageAmount = Math.round(dealValue * totalPercent) / 100;
  if (totalBrokerageAmount <= 0) return null;

  const plan = ["OneTime", "TwoPart", "AgreementOnly"].includes(bk.BrokeragePaymentPlan)
    ? bk.BrokeragePaymentPlan : "OneTime";

  // Only relevant for TwoPart's second half / AgreementOnly — a booking
  // that's fast-tracked and already has an Executed/Registered agreement by
  // the time Milestone #1 clears shouldn't sit needlessly locked.
  const agr = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT TOP 1 Status FROM dbo.CrmAgreement WHERE BookingId = @bid");
  const agreementExecuted = ["Executed", "Registered"].includes(agr.recordset[0]?.Status);

  const tranches = buildBrokerageTranches(plan, totalBrokerageAmount, agreementExecuted);

  // All-or-nothing: a failure partway through used to leave whatever
  // tranches had already been inserted sitting in the DB as a permanent,
  // incomplete (and confusing) partial schedule — exactly the kind of
  // silent data corruption a broker-payout calculation can never tolerate.
  // A single transaction makes a mid-loop failure roll back cleanly instead.
  let ids;
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    ids = [];
    for (const t of tranches) {
      const result = await new sql.Request(tx)
        .input("bid",   sql.Int,           bookingId)
        .input("brid",  sql.Int,           brk.LHeadId)
        .input("name",  sql.NVarChar(200), brk.LHeadName)
        .input("con",   sql.NVarChar(20),  brk.LHeadPhone || null)
        .input("rt",    sql.NVarChar(20),  "Percentage")
        .input("rv",    sql.Decimal(18,2), totalPercent)
        .input("camt",  sql.Decimal(18,2), t.amount)
        .input("tranche", sql.NVarChar(30), t.label)
        .input("gate",  sql.NVarChar(20),  t.gate)
        .input("lock",  sql.Bit,           t.locked ? 1 : 0)
        .input("notes", sql.NVarChar(sql.MAX), `Auto-created — ${plan} plan, ${t.label} tranche`)
        .input("cb",    sql.Int,           actorUserId || null)
        .query(`
          INSERT INTO dbo.CrmBrokerageMaster
            (BookingId, BrokerId, BrokerName, BrokerContact, RateType, RateValue, ComputedAmount, TrancheLabel, UnlockGate, IsLocked, Status, Notes, CreatedBy, CreatedAt)
          OUTPUT INSERTED.Id
          VALUES (@bid, @brid, @name, @con, @rt, @rv, @camt, @tranche, @gate, @lock, 'Pending', @notes, @cb, SYSDATETIME())
        `);
      ids.push(result.recordset[0].Id);
    }
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* transaction may already be aborted */ }
    // Race with another milestone-paid trigger reaching here concurrently —
    // same UNIQUE(BookingId)-loses-the-race pattern as maybeAutoCreateAgreement.
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) return null;
    throw e;
  }

  if (bk.AssignedTo) {
    await emitNotification(pool, bk.AssignedTo, "crm_brokerage_ready",
      "Brokerage Schedule Created",
      `Brokerage (${plan}) auto-created for booking ${bk.BookingNo} — ${ids.length} tranche(s) for broker ${brk.LHeadName}.`,
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

/**
 * Unlocks the Agreement-gated brokerage tranche(s) — TwoPart's second half,
 * or AgreementOnly's single tranche — the moment a booking's Agreement is
 * marked Executed. No-op if there's no such row (OneTime plan, no broker,
 * or the tranche is already unlocked).
 * Call site: wherever CrmAgreement.Status transitions to 'Executed'
 * (mark-executed route in crmAgreement.js).
 */
async function maybeUnlockBrokerageOnAgreementExecuted(pool, bookingId) {
  await pool.request().input("bid", sql.Int, bookingId).query(`
    UPDATE dbo.CrmBrokerageMaster SET IsLocked = 0
    WHERE BookingId = @bid AND UnlockGate = 'Agreement' AND IsLocked = 1
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
    .input("desc", sql.NVarChar(500), "Booking amount received against unit booking")
    .input("cb",   sql.Int,           actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmInvoice (InvoiceNo, BookingId, InvoiceType, Amount, Description, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, 'Booking', @amt, @desc, @cb, SYSDATETIME())
    `);
  const invoiceId = result.recordset[0].Id;

  // Same best-effort rule as the manual invoice route — a PDF-rendering
  // problem must never block the booking's own approval submission, which
  // is what this function runs inside of.
  try {
    await generateInvoicePdf(pool, invoiceId);
  } catch (pdfErr) {
    console.error("[crmWorkflowGuards] booking invoice PDF generation failed:", pdfErr.message);
  }

  if (bookingRow.AssignedTo) {
    await emitNotification(pool, bookingRow.AssignedTo, "crm_invoice_generated",
      "Booking Invoice Generated",
      `${invoiceNo} auto-generated for booking ${bookingRow.BookingNo}.`,
      invoiceId, "crm_invoice");
  }

  return { id: invoiceId, InvoiceNo: invoiceNo };
}

/**
 * Loan Processing gate — this stage only exists at all for a booking that
 * has actually been marked Loan-Financed. Self-funded bookings, and
 * bookings where financing type hasn't been declared yet, never had a loan
 * to process in the first place, so they clear immediately — declaring
 * financing type is not itself a prerequisite for the Deed. Only once a
 * booking is explicitly Loan-Financed does it need the loan to actually be
 * Sanctioned or Disbursed before the Deed (and everything after it: Query
 * Payment, Registry) can proceed. Returns null when cleared, or a
 * human-readable reason string when not.
 */
async function checkLoanProcessingCleared(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT b.FinancingType, l.SanctionStatus
    FROM dbo.CrmBooking b
    LEFT JOIN dbo.CrmLoanDetail l ON l.BookingId = b.Id
    WHERE b.Id = @bid
  `);
  const row = result.recordset[0];
  if (!row) return "Booking not found";
  if (row.FinancingType !== "LoanFinanced") return null;
  if (!["Sanctioned", "Disbursed"].includes(row.SanctionStatus)) {
    return `Loan must be Sanctioned or Disbursed before this stage can proceed (currently '${row.SanctionStatus || "Not Applied"}') — update it on the Loan Tracking page.`;
  }
  return null;
}

module.exports = {
  validateAgreementPreparationPrerequisites,
  maybeAutoCreateAgreement,
  maybeAutoCreateLegalMilestone,
  maybeAutoCreateSalesDeed,
  maybeAutoGenerateInvoice,
  maybeAutoGenerateBookingInvoice,
  maybeAutoGenerateAgreementInvoice,
  maybeAutoCreateBrokerage,
  maybeUnlockBrokerageMilestoneTranche,
  maybeUnlockBrokerageOnAgreementExecuted,
  proposeAgreementDate,
  acceptAgreementDate,
  finalizeAgreementDate,
  resetAgreementDateNegotiation,
  syncLegalMilestoneStep,
  syncLegalMilestoneFromDocument,
  recomputeLegalMilestoneCurrentStep,
  checkLoanProcessingCleared,
  requireActiveBooking,
  recalculateRemainingMilestones,
  isLegalWorkStarted,
  isBookingFullySettled,
  syncParkingPaymentStatus,
};