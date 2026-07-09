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

async function getBookingWorkflowContext(pool, bookingId) {
  const booking = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      b.Id, b.BookingNo, b.ApplicationId, b.UnitId, b.Status, b.IsActive, b.AssignedTo,
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

  const agNo = await getNextDocNumber(pool, "AGR", "AGR");
  const result = await pool.request()
    .input("agno", sql.NVarChar(50), agNo)
    .input("bid",  sql.Int, bookingId)
    .input("pan",  sql.NVarChar(20), customerDetails.PanNo || null)
    .input("aadh", sql.NVarChar(20), customerDetails.AadhaarNo || null)
    .input("cb",   sql.Int, actorUserId || null)
    .query(`
      INSERT INTO dbo.CrmAgreement
        (AgreementNo, BookingId, PanNo, AadhaarNo, Status, Notes, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@agno, @bid, @pan, @aadh, 'Draft', 'Auto-created — all agreement-prep prerequisites met', @cb, SYSDATETIME())
    `);
  const agreementId = result.recordset[0].Id;

  const portalInfo = await ensurePortalUser(pool, prereq.booking.ApplicationId);

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

module.exports = {
  validateAgreementPreparationPrerequisites,
  maybeAutoCreateAgreement,
  maybeAutoCreateSalesDeed,
};
