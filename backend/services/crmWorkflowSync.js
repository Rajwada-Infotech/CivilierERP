// Single shared source of truth for the Customer -> Application -> Booking
// -> Bank/KYC/Co-Applicant workflow chain.
//
// Why this file exists: this logic used to live only inside
// crmCustomerBankDetails.js as private functions. That meant the Bank/KYC
// page self-healed (materialized a missing row from Customer data on every
// GET) but every OTHER page reading the same chain — Booking Details
// (crmBookings.js GET /:id), the Application detail view
// (crmApplications.js GET /:id) — did not, because they had no access to
// the functions that do it. A booking's Co-Applicants panel could
// permanently show "No co-applicant on record" even when the customer's
// co-applicant data existed, purely because staff happened to view the
// Booking Details page before ever opening the Bank/KYC page for that
// booking. Same class of bug for Bank/KYC fields on any future read path.
//
// The fix is not "add another fallback" — it's "there is exactly one
// place that knows how to resolve/heal this chain, and every route that
// touches it calls that place." Import from here, don't reimplement.
const { sql } = require("../db");

// Merge a CrmCustomerBankDetail row (may be null/partial) with the live
// Customer/Application/Booking context. Detail-row values win when present;
// Customer Master fills every gap. This is what makes "type it once in
// Customer Master" actually flow through, instead of only working once the
// KYC row itself has been separately filled in.
function mergeCustomerDefaults(detail, customer) {
  if (!customer) return detail || null;
  return {
    ...(detail || {}),
    ApplicationId: detail?.ApplicationId ?? customer.ApplicationId ?? null,
    BookingId: detail?.BookingId ?? customer.BookingId ?? null,
    CustomerId: customer.CustomerId ?? null,
    CustomerNo: customer.CustomerNo ?? null,
    ApplicantName: customer.CustomerName ?? detail?.ApplicantName ?? null,
    Mobile: customer.Mobile ?? detail?.Mobile ?? null,
    Email: customer.Email ?? detail?.Email ?? null,
    PanNo: detail?.PanNo || customer.PanNo || null,
    AadhaarNo: detail?.AadhaarNo || customer.AadhaarNo || null,
    Occupation: detail?.Occupation || customer.Occupation || null,
    AnnualIncome: detail?.AnnualIncome ?? customer.AnnualIncome ?? null,
    AccountHolderName: detail?.AccountHolderName || customer.CustomerName || null,
    NomineeName: detail?.NomineeName || customer.CoApplicantName || null,
    NomineeRelation: detail?.NomineeRelation || customer.CoApplicantRelation || null,
    NomineeContact: detail?.NomineeContact || customer.CoApplicantMobile || null,
    NomineeAddress: detail?.NomineeAddress || customer.Address || null,
    CustomerAddress: customer.Address ?? null,
    CustomerCity: customer.City ?? null,
    CustomerState: customer.State ?? null,
    CustomerPincode: customer.Pincode ?? null,
    CoApplicantName: customer.CoApplicantName ?? null,
    CoApplicantMobile: customer.CoApplicantMobile ?? null,
    CoApplicantPanNo: customer.CoApplicantPanNo ?? null,
    CoApplicantRelation: customer.CoApplicantRelation ?? null,
  };
}

async function getApplicationCustomerContext(pool, applicationId) {
  const result = await pool.request().input("aid", sql.Int, applicationId).query(`
    SELECT
      a.Id AS ApplicationId, b.Id AS BookingId,
      c.Id AS CustomerId, c.CustomerNo, c.CustomerName, c.Mobile, c.Email,
      c.PanNo, c.AadhaarNo, c.Occupation, c.AnnualIncome, c.Address, c.City, c.State, c.Pincode,
      c.CoApplicantName, c.CoApplicantMobile, c.CoApplicantPanNo, c.CoApplicantRelation
    FROM dbo.CrmApplication a
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    OUTER APPLY (
      SELECT TOP 1 Id
      FROM dbo.CrmBooking
      WHERE ApplicationId = a.Id AND IsActive = 1
      ORDER BY CreatedAt DESC
    ) b
    WHERE a.Id = @aid
  `);
  return result.recordset[0] || null;
}

async function getBookingCustomerContext(pool, bookingId) {
  const result = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT
      a.Id AS ApplicationId, b.Id AS BookingId,
      c.Id AS CustomerId, c.CustomerNo, c.CustomerName, c.Mobile, c.Email,
      c.PanNo, c.AadhaarNo, c.Occupation, c.AnnualIncome, c.Address, c.City, c.State, c.Pincode,
      c.CoApplicantName, c.CoApplicantMobile, c.CoApplicantPanNo, c.CoApplicantRelation
    FROM dbo.CrmBooking b
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
    WHERE b.Id = @bid
  `);
  return result.recordset[0] || null;
}

async function getBankDetailByWorkflow(pool, { bookingId, applicationId }) {
  const result = await pool.request()
    .input("bid", sql.Int, bookingId || null)
    .input("aid", sql.Int, applicationId || null)
    .query(`
      SELECT TOP 1 *
      FROM dbo.CrmCustomerBankDetail
      WHERE (@bid IS NOT NULL AND BookingId = @bid)
         OR (@aid IS NOT NULL AND ApplicationId = @aid)
      ORDER BY
        CASE WHEN @bid IS NOT NULL AND BookingId = @bid THEN 0 ELSE 1 END,
        UpdatedAt DESC, CreatedAt DESC
    `);
  return result.recordset[0] || null;
}

async function linkBankDetailWorkflowKeys(pool, detailId, { bookingId, applicationId }) {
  if (!detailId) return;
  await pool.request()
    .input("id", sql.Int, detailId)
    .input("bid", sql.Int, bookingId || null)
    .input("aid", sql.Int, applicationId || null)
    .query(`
      UPDATE dbo.CrmCustomerBankDetail SET
        BookingId = COALESCE(BookingId, @bid),
        ApplicationId = COALESCE(ApplicationId, @aid),
        UpdatedAt = COALESCE(UpdatedAt, SYSDATETIME())
      WHERE Id = @id
    `);
}

// Idempotent: no-op if the booking already has any active co-applicant row,
// or if the customer never entered one. Called from every read path that
// touches a booking's workflow context, not just the Bank/KYC page — so
// "No co-applicant on record" never depends on which page staff happened
// to open first.
async function ensureCoApplicantFromCustomer(pool, customer, actorUserId = null) {
  if (!customer?.BookingId || !customer?.CoApplicantName?.trim()) return;
  const existing = await pool.request().input("bid", sql.Int, customer.BookingId)
    .query("SELECT TOP 1 Id FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1");
  if (existing.recordset.length) return;

  await pool.request()
    .input("bid",  sql.Int, customer.BookingId)
    .input("name", sql.NVarChar(200), customer.CoApplicantName.trim())
    .input("rel",  sql.NVarChar(50), customer.CoApplicantRelation || null)
    .input("mob",  sql.NVarChar(20), customer.CoApplicantMobile || null)
    .input("pan",  sql.NVarChar(20), customer.CoApplicantPanNo || null)
    .input("note", sql.NVarChar(sql.MAX), "Auto-seeded from customer intake")
    .input("src",  sql.NVarChar(20), "CustomerIntake")
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, Mobile, PanNo, Notes, SourceType, CreatedBy, CreatedAt)
      VALUES (@bid, @name, @rel, @mob, @pan, @note, @src, @cb, SYSDATETIME())
    `);
}

// Idempotent: returns the existing row (re-linking its workflow keys, and
// backfilling any still-empty fields from Customer Master, if a Booking has
// since been created or the customer's KYC master data has since been
// filled in) if one exists; otherwise creates one seeded from Customer
// Master. Called from every read path that touches the Bank/KYC chain —
// Bank/KYC page, Booking Details, Application detail — so a row that was
// never explicitly saved still shows real Customer data instead of blanks,
// no matter which page got there first.
//
// Backfilling into the real row (not just merging at read time) matters:
// validateAgreementPreparationPrerequisites() and anything else that reads
// dbo.CrmCustomerBankDetail directly (not through this service) needs the
// actual stored columns to be complete, not just what a merged API response
// happens to show. Without this, Agreement auto-creation could stay
// permanently blocked even after Customer Master had everything required —
// exactly the kind of stale-mismatch bug this service exists to prevent.
async function materializeBankDetailFromCustomer(pool, context, actorUserId = null) {
  if (!context?.ApplicationId && !context?.BookingId) return null;
  const existing = await getBankDetailByWorkflow(pool, { bookingId: context.BookingId, applicationId: context.ApplicationId });
  if (existing) {
    await linkBankDetailWorkflowKeys(pool, existing.Id, { bookingId: context.BookingId, applicationId: context.ApplicationId });
    await pool.request()
      .input("id", sql.Int, existing.Id)
      .input("holder", sql.NVarChar(200), context.CustomerName || null)
      .input("pan", sql.NVarChar(20), context.PanNo || null)
      .input("aadh", sql.NVarChar(20), context.AadhaarNo || null)
      .input("occ", sql.NVarChar(100), context.Occupation || null)
      .input("inc", sql.Decimal(18, 2), context.AnnualIncome != null ? Number(context.AnnualIncome) : null)
      .input("nname", sql.NVarChar(200), context.CoApplicantName || null)
      .input("nrel", sql.NVarChar(50), context.CoApplicantRelation || null)
      .input("ncon", sql.NVarChar(20), context.CoApplicantMobile || null)
      .query(`
        UPDATE dbo.CrmCustomerBankDetail SET
          AccountHolderName = COALESCE(NULLIF(LTRIM(RTRIM(AccountHolderName)), ''), @holder),
          PanNo = COALESCE(NULLIF(LTRIM(RTRIM(PanNo)), ''), @pan),
          AadhaarNo = COALESCE(NULLIF(LTRIM(RTRIM(AadhaarNo)), ''), @aadh),
          Occupation = COALESCE(NULLIF(LTRIM(RTRIM(Occupation)), ''), @occ),
          AnnualIncome = COALESCE(AnnualIncome, @inc),
          NomineeName = COALESCE(NULLIF(LTRIM(RTRIM(NomineeName)), ''), @nname),
          NomineeRelation = COALESCE(NULLIF(LTRIM(RTRIM(NomineeRelation)), ''), @nrel),
          NomineeContact = COALESCE(NULLIF(LTRIM(RTRIM(NomineeContact)), ''), @ncon),
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    const refreshed = await pool.request().input("id", sql.Int, existing.Id).query("SELECT * FROM dbo.CrmCustomerBankDetail WHERE Id = @id");
    return mergeCustomerDefaults(refreshed.recordset[0], context);
  }

  const result = await pool.request()
    .input("bid", sql.Int, context.BookingId || null)
    .input("aid", sql.Int, context.ApplicationId || null)
    .input("holder", sql.NVarChar(200), context.CustomerName || null)
    .input("nname", sql.NVarChar(200), context.CoApplicantName || null)
    .input("nrel", sql.NVarChar(50), context.CoApplicantRelation || null)
    .input("ncon", sql.NVarChar(20), context.CoApplicantMobile || null)
    .input("naddr", sql.NVarChar(500), context.Address || null)
    .input("pan", sql.NVarChar(20), context.PanNo || null)
    .input("aadh", sql.NVarChar(20), context.AadhaarNo || null)
    .input("occ", sql.NVarChar(100), context.Occupation || null)
    .input("inc", sql.Decimal(18, 2), context.AnnualIncome != null ? Number(context.AnnualIncome) : null)
    .input("cb", sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCustomerBankDetail
        (BookingId, ApplicationId, AccountHolderName, NomineeName, NomineeRelation, NomineeContact, NomineeAddress,
         PanNo, AadhaarNo, Occupation, AnnualIncome, CreatedBy, CreatedAt)
      OUTPUT INSERTED.*
      VALUES (@bid, @aid, @holder, @nname, @nrel, @ncon, @naddr, @pan, @aadh, @occ, @inc, @cb, SYSDATETIME())
    `);
  return result.recordset[0] || null;
}

// Convenience wrapper for read routes that just need "make sure this
// booking's downstream rows exist and are linked, then give me the
// customer context to merge into whatever I'm returning." Runs both healers
// and returns the context (callers that also need the bank detail row
// itself should call materializeBankDetailFromCustomer directly to get it).
async function healBookingWorkflow(pool, bookingId, actorUserId = null) {
  const context = await getBookingCustomerContext(pool, bookingId);
  if (!context) return null;
  await ensureCoApplicantFromCustomer(pool, context, actorUserId);
  await materializeBankDetailFromCustomer(pool, context, actorUserId);
  return context;
}

async function healApplicationWorkflow(pool, applicationId, actorUserId = null) {
  const context = await getApplicationCustomerContext(pool, applicationId);
  if (!context) return null;
  await ensureCoApplicantFromCustomer(pool, context, actorUserId);
  await materializeBankDetailFromCustomer(pool, context, actorUserId);
  return context;
}

module.exports = {
  mergeCustomerDefaults,
  getApplicationCustomerContext,
  getBookingCustomerContext,
  getBankDetailByWorkflow,
  linkBankDetailWorkflowKeys,
  ensureCoApplicantFromCustomer,
  materializeBankDetailFromCustomer,
  healBookingWorkflow,
  healApplicationWorkflow,
};