// Shared creation logic for CrmApplication and CrmBooking — extracted out of
// crmApplications.js/crmBookings.js's POST / handlers so there is exactly
// ONE place that knows how to validly create either record (source-chain
// validation, Unit Master enforcement, milestone auto-generation, hold
// conversion, application auto-approval). Both the HTTP routes AND
// saHandoff.js (the Sales Automation -> CRM handoff) call these same
// functions, instead of the handoff re-implementing a second, drifting copy
// of this logic against a free-text schema that never actually matched
// CrmApplication/CrmBooking's real constraints (Unit Master mandatory,
// milestones required, etc.).
const { sql } = require("../db");
const { getNextDocNumber } = require("./docNumber");
const { validateSourceChain } = require("./sourceChain");
const { logStatusChange, advanceApplicationStatus } = require("./crmApplicationWorkflow");
const { guardAndConvertHold } = require("./crmHoldService");

const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

class CrmCreationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Every Application must resolve to a Customer — either an existing one the
// caller explicitly selected, or one auto-found-by-Mobile/auto-created from
// whatever raw name/mobile fields the caller has (the SA Leads handoff path
// in saHandoff.js never went through an interactive "pick a customer" step,
// so it still supplies raw fields; this makes that keep working while every
// Application still ends up linked to a real Customer row). No-ops to a
// lookup when a live Customer already exists for that Mobile — never
// creates a second identity for the same phone number.
async function findOrCreateCustomer(pool, { name, mobile, altMobile, email, leadId }, actorUserId) {
  if (!mobile) return null;
  const existing = await pool.request().input("mob", sql.NVarChar(20), mobile)
    .query("SELECT Id FROM dbo.CrmCustomer WHERE Mobile = @mob AND IsActive = 1");
  if (existing.recordset.length) return existing.recordset[0].Id;

  const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
  try {
    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  customerNo)
      .input("lid",   sql.Int,           leadId ? parseInt(leadId) : null)
      .input("name",  sql.NVarChar(200), name || "Unknown")
      .input("mob",   sql.NVarChar(20),  mobile)
      .input("alt",   sql.NVarChar(20),  altMobile || null)
      .input("email", sql.NVarChar(200), email || null)
      .input("cb",    sql.Int,           actorUserId)
      .query(`
        INSERT INTO dbo.CrmCustomer (CustomerNo, LeadId, CustomerName, Mobile, AltMobile, Email, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @lid, @name, @mob, @alt, @email, @cb, SYSDATETIME())
      `);
    return result.recordset[0].Id;
  } catch (e) {
    // Race: two near-simultaneous creations for the same mobile — the loser
    // just looks the winner up instead of failing the whole caller's flow.
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      const retry = await pool.request().input("mob", sql.NVarChar(20), mobile)
        .query("SELECT Id FROM dbo.CrmCustomer WHERE Mobile = @mob AND IsActive = 1");
      return retry.recordset[0]?.Id || null;
    }
    throw e;
  }
}

async function createCrmApplicationRecord(pool, b, actorUserId) {
  if (!b.CustomerId && (!b.ApplicantName?.trim() || !b.Mobile?.trim()))
    throw new CrmCreationError("Either CustomerId or ApplicantName and Mobile are required");
  if (b.Source && !SOURCE_TYPES.includes(b.Source))
    throw new CrmCreationError(`Invalid Source. Must be one of: ${SOURCE_TYPES.join(", ")}`);

  let prefill = {};
  if (b.LeadId) {
    const lr = await pool.request()
      .input("lid", sql.Int, parseInt(b.LeadId))
      .query(`
        SELECT CustomerName, Mobile, AltMobile, Email, BudgetMin, BudgetMax,
               PropertyType, BhkPreference, PreferredLocation, AssignedSalespersonId,
               SourceType, PlatformId, CampaignId, AdId, ChannelPartnerId
        FROM dbo.SaLead WHERE Id = @lid
      `);
    prefill = lr.recordset[0] || {};
  }

  // Resolve the Customer this application belongs to: an explicit selection
  // wins outright (its own name/mobile/email become authoritative, even if
  // the request also carries stale raw fields); otherwise fall back to
  // finding/creating one from whatever raw identity the caller supplied.
  let customerId = b.CustomerId ? parseInt(b.CustomerId) : null;
  let customerRow = null;
  if (customerId) {
    const cr = await pool.request().input("cid", sql.Int, customerId)
      .query("SELECT CustomerName, Mobile, AltMobile, Email FROM dbo.CrmCustomer WHERE Id = @cid AND IsActive = 1");
    if (!cr.recordset.length) throw new CrmCreationError("Selected customer does not exist");
    customerRow = cr.recordset[0];
  } else {
    const name = b.ApplicantName?.trim() || prefill.CustomerName;
    const mobile = b.Mobile?.trim() || prefill.Mobile;
    customerId = await findOrCreateCustomer(pool, {
      name, mobile,
      altMobile: b.AltMobile || prefill.AltMobile,
      email: b.Email || prefill.Email,
      leadId: b.LeadId,
    }, actorUserId);
  }

  const platformId = b.PlatformId ? parseInt(b.PlatformId) : (prefill.PlatformId || null);
  const campaignId = b.CampaignId ? parseInt(b.CampaignId) : (prefill.CampaignId || null);
  const adId       = b.AdId       ? parseInt(b.AdId)       : (prefill.AdId       || null);
  const channelPartnerId = b.ChannelPartnerId ? parseInt(b.ChannelPartnerId) : (prefill.ChannelPartnerId || null);

  const sourceError = await validateSourceChain(pool, { PlatformId: platformId, CampaignId: campaignId, AdId: adId });
  if (sourceError) throw new CrmCreationError(sourceError);

  let projectName = b.InterestedProject || null;
  let companyId = b.CompanyId ? parseInt(b.CompanyId) : null;
  if (b.ProjectId) {
    const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
      .query("SELECT name, company_id FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
    if (!proj.recordset.length) throw new CrmCreationError("Selected project does not exist");
    projectName = proj.recordset[0].name;
    companyId = companyId || proj.recordset[0].company_id || null;
  }
  let unitName = b.InterestedUnit || null;
  if (b.PreferredUnitId) {
    const unit = await pool.request().input("uid", sql.Int, parseInt(b.PreferredUnitId))
      .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1");
    if (!unit.recordset.length) throw new CrmCreationError("Selected unit does not exist or is inactive");
    unitName = unit.recordset[0].UnitName;
  }

  const appNo = await getNextDocNumber(pool, "APP", "APP");
  let result;
  try {
    result = await pool.request()
      .input("no",   sql.NVarChar(30),  appNo)
      .input("lid",  sql.Int,           b.LeadId   ? parseInt(b.LeadId)   : null)
      .input("custid", sql.Int,         customerId)
      .input("name", sql.NVarChar(200), customerRow?.CustomerName || b.ApplicantName?.trim() || prefill.CustomerName)
      .input("mob",  sql.NVarChar(20),  customerRow?.Mobile || b.Mobile?.trim() || prefill.Mobile)
      .input("alt",  sql.NVarChar(20),  customerRow?.AltMobile || b.AltMobile || prefill.AltMobile || null)
      .input("em",   sql.NVarChar(200), customerRow?.Email     || b.Email     || prefill.Email     || null)
      .input("pid",  sql.Int,           b.ProjectId ? parseInt(b.ProjectId) : null)
      .input("uid",  sql.Int,           b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null)
      .input("cid",  sql.Int,           companyId)
      .input("proj", sql.NVarChar(200), projectName)
      .input("unit", sql.NVarChar(100), unitName)
      .input("pt",   sql.NVarChar(50),  b.PropertyType  || prefill.PropertyType  || null)
      .input("bhk",  sql.NVarChar(30),  b.BhkPreference || prefill.BhkPreference || null)
      .input("bmin", sql.Decimal(18,2), b.BudgetMin != null ? parseFloat(b.BudgetMin) : (prefill.BudgetMin || null))
      .input("bmax", sql.Decimal(18,2), b.BudgetMax != null ? parseFloat(b.BudgetMax) : (prefill.BudgetMax || null))
      .input("src",  sql.NVarChar(200), b.Source || prefill.SourceType || null)
      .input("platid", sql.Int, platformId)
      .input("campid", sql.Int, campaignId)
      .input("adid",   sql.Int, adId)
      .input("cpid",   sql.Int, channelPartnerId)
      .input("asgn", sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : (prefill.AssignedSalespersonId || null))
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("refApp", sql.Int,         b.ReferredByApplicationId ? parseInt(b.ReferredByApplicationId) : null)
      .input("cb",   sql.Int,           actorUserId)
      .query(`
        INSERT INTO dbo.CrmApplication
          (ApplicationNo, LeadId, CustomerId, ApplicantName, Mobile, AltMobile, Email,
           ProjectId, PreferredUnitId, CompanyId, InterestedProject, InterestedUnit,
           PropertyType, BhkPreference, BudgetMin, BudgetMax,
           Source, PlatformId, CampaignId, AdId, ChannelPartnerId,
           AssignedTo, Status, Notes, ReferredByApplicationId, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @lid, @custid, @name, @mob, @alt, @em,
           @pid, @uid, @cid, @proj, @unit,
           @pt, @bhk, @bmin, @bmax,
           @src, @platid, @campid, @adid, @cpid,
           @asgn, 'Pending', @note, @refApp, 1, @cb, SYSDATETIME())
      `);
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      throw new CrmCreationError("This lead has already been promoted to a CRM application", 409);
    throw e;
  }
  const applicationId = result.recordset[0].Id;
  await logStatusChange(pool, applicationId, null, "Pending", "Manual", "Application created", actorUserId);

  return { id: applicationId, ApplicationNo: appNo };
}

const DEFAULT_MILESTONES = [
  { no: 1, name: "Booking",          pct: 5,  dept: "Sales",        docs: "Booking Receipt" },
  { no: 2, name: "Agreement",        pct: 10, dept: "Legal",        docs: "Executed Agreement" },
  { no: 3, name: "Foundation",       pct: 15, dept: "Construction", docs: "Foundation Completion Certificate" },
  { no: 4, name: "Superstructure",   pct: 20, dept: "Construction", docs: "Superstructure Progress Photos" },
  { no: 5, name: "Slab Casting",     pct: 20, dept: "Construction", docs: "Slab Casting Progress Photos" },
  { no: 6, name: "Plastering",       pct: 15, dept: "Construction", docs: "Plastering Completion Photos" },
  { no: 7, name: "Handover",         pct: 15, dept: "Sales",        docs: "Possession Letter, Handover Checklist" },
];

// Shared by booking creation AND payment-plan changes on an existing
// booking (see crmBookings.js PUT /:id) — one place that knows how to turn
// a plan (or the 7-stage default, when none is selected) into real
// CrmPaymentMilestone rows, so a plan switch produces an identical shape
// to what creation would have produced.
async function generateMilestonesForBooking(pool, bookingId, totalValue, paymentPlanId, bookingDate, actorUserId) {
  if (!totalValue || totalValue <= 0) return;
  let milestones;
  if (paymentPlanId) {
    const planItems = await pool.request().input("pid", sql.Int, parseInt(paymentPlanId))
      .query("SELECT MilestoneNo, MilestoneName, [Percent] FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @pid ORDER BY MilestoneNo");
    milestones = planItems.recordset.map((r) => ({ no: r.MilestoneNo, name: r.MilestoneName, pct: r.Percent }));
  }
  if (!milestones?.length) milestones = DEFAULT_MILESTONES;

  // Milestone #1 gets a real DueDate (the booking date). Every milestone
  // after that used to be inserted with DueDate = NULL and nothing else in
  // the codebase ever back-filled it (except a one-off for a milestone
  // literally named 'Agreement', in finalizeAgreementDate()) — meaning the
  // overdue/SLA detectors in crmSlaEngine.js and crmDashboard.js, which key
  // off `DueDate < today`, could structurally never flag anything past
  // Booking/Agreement as overdue, for any booking, ever. A construction
  // milestone (Foundation, Slab Casting, ...) doesn't have a real calendar
  // trigger yet in this system (that would come from crmConstructionUpdates.js
  // events, which aren't wired to milestones), so there's no principled date
  // to compute here — but leaving it permanently NULL is strictly worse than
  // a placeholder default, since staff can already edit any milestone's
  // DueDate by hand (crmPayments.js PUT /:id). Default: 30 days after the
  // previous milestone's due date, chained forward from the booking date.
  const MILESTONE_DEFAULT_INTERVAL_DAYS = 30;
  let runningDue = bookingDate ? new Date(bookingDate) : new Date();

  for (const m of milestones) {
    let dueDate;
    if (m.no === 1) {
      dueDate = runningDue;
    } else {
      runningDue = new Date(runningDue);
      runningDue.setDate(runningDue.getDate() + MILESTONE_DEFAULT_INTERVAL_DAYS);
      dueDate = runningDue;
    }
    await pool.request()
      .input("bid",  sql.Int,           bookingId)
      .input("mno",  sql.Int,           m.no)
      .input("mname",sql.NVarChar(200), m.name)
      .input("amt",  sql.Decimal(18,2), Math.round(totalValue * m.pct) / 100)
      .input("due",  sql.Date,          dueDate)
      .input("rdocs",sql.NVarChar(sql.MAX), m.docs || null)
      .input("dept", sql.NVarChar(100), m.dept || null)
      .input("cb",   sql.Int,           actorUserId)
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, DueDate, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
        VALUES (@bid, @mno, @mname, @amt, @due, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
      `);
  }
}

// A payment plan scoped to a specific Company/Project/Block must actually
// match the booking it's being attached to — otherwise the scoping built
// into the Payment Plan Master (see migration 182) is purely cosmetic, only
// ever enforced by which options happen to be in a dropdown. NULL scope
// columns on the plan mean "applies everywhere" and always pass.
async function validatePaymentPlanScope(pool, planId, { companyId, projectId, blockId }) {
  const plan = await pool.request().input("pid", sql.Int, planId)
    .query("SELECT PlanName, CompanyId, ProjectId, BlockId FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid");
  if (!plan.recordset.length) throw new CrmCreationError("Selected payment plan does not exist");
  const p = plan.recordset[0];
  if (p.CompanyId && companyId && p.CompanyId !== companyId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different company`);
  }
  if (p.ProjectId && projectId && p.ProjectId !== projectId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different project`);
  }
  if (p.BlockId && blockId && p.BlockId !== blockId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different block`);
  }
}

// CrmCustomer's inline CoApplicantName/Mobile/PanNo/Relation fields are an
// intake-time convenience capture (there's no booking yet at Customer/
// Application stage). Once a booking exists, dbo.CrmCoApplicant — a proper
// multi-row per-booking table — is the single source of truth (Welcome
// Call's checklist and Booking Details both read from it). This seeds one
// CrmCoApplicant row from the customer's intake data so that data isn't
// silently lost, without making CrmCustomer's fields independently
// authoritative going forward. Idempotent: skipped if the booking already
// has any co-applicant rows, or if the customer never entered one.
async function seedPrimaryCoApplicantFromCustomer(pool, bookingId, applicationId, actorUserId) {
  const cust = await pool.request().input("appId", sql.Int, applicationId).query(`
    SELECT c.CoApplicantName, c.CoApplicantMobile, c.CoApplicantPanNo, c.CoApplicantRelation
    FROM dbo.CrmCustomer c
    JOIN dbo.CrmApplication a ON a.CustomerId = c.Id
    WHERE a.Id = @appId
  `);
  const row = cust.recordset[0];
  if (!row?.CoApplicantName?.trim()) return;

  const existing = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT TOP 1 Id FROM dbo.CrmCoApplicant WHERE BookingId = @bid AND IsActive = 1");
  if (existing.recordset.length) return;

  await pool.request()
    .input("bid",  sql.Int, bookingId)
    .input("name", sql.NVarChar(200), row.CoApplicantName.trim())
    .input("rel",  sql.NVarChar(50), row.CoApplicantRelation || null)
    .input("mob",  sql.NVarChar(20), row.CoApplicantMobile || null)
    .input("pan",  sql.NVarChar(20), row.CoApplicantPanNo || null)
    .input("note", sql.NVarChar(sql.MAX), "Auto-seeded from customer intake")
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, Mobile, PanNo, Notes, CreatedBy, CreatedAt)
      VALUES (@bid, @name, @rel, @mob, @pan, @note, @cb, SYSDATETIME())
    `);
}

async function createCrmBookingRecord(pool, b, actorUserId) {
  if (!b.ApplicationId) throw new CrmCreationError("ApplicationId is required");
  if (!b.UnitId) throw new CrmCreationError("UnitId is required — a unit must be selected from Unit Master");

  const unit = await pool.request().input("uid", sql.Int, parseInt(b.UnitId)).query(`
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt,
           proj.name AS ProjectName, proj.company_id AS CompanyId,
           blk.BlockName
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
    WHERE u.Id = @uid AND u.IsActive = 1
  `);
  if (!unit.recordset.length) throw new CrmCreationError("Selected unit does not exist or is inactive");
  const unitRow = unit.recordset[0];

  const taken = await pool.request().input("uid", sql.Int, parseInt(b.UnitId))
    .query("SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
  if (taken.recordset.length) throw new CrmCreationError("This unit is already booked", 409);

  await guardAndConvertHold(pool, "Unit", parseInt(b.UnitId), parseInt(b.ApplicationId));

  if (b.PaymentPlanId) {
    await validatePaymentPlanScope(pool, parseInt(b.PaymentPlanId), {
      companyId: unitRow.CompanyId || null, projectId: unitRow.ProjectId || null, blockId: unitRow.BlockId || null,
    });
  }

  const area  = unitRow.AreaSqFt != null ? unitRow.AreaSqFt : (b.AreaSqFt != null ? parseFloat(b.AreaSqFt) : null);
  const rate  = b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null;
  const total = b.TotalValue  != null ? parseFloat(b.TotalValue)
              : (area && rate ? Math.round(area * rate) : null);

  const tokenType = b.TokenType === "Amount" ? "Amount" : "Percentage";
  const tokenValue = b.TokenValue != null ? parseFloat(b.TokenValue) : null;
  let bookingAmount = b.BookingAmount != null ? parseFloat(b.BookingAmount) : 0;
  if (tokenValue != null) {
    bookingAmount = tokenType === "Percentage" && total
      ? Math.round(total * tokenValue) / 100
      : tokenValue;
  }

  const bookingNo = await getNextDocNumber(pool, "BKG", "BKG");
  const result = await pool.request()
    .input("no",    sql.NVarChar(30),  bookingNo)
    .input("appId", sql.Int,           parseInt(b.ApplicationId))
    .input("uid",   sql.Int,           parseInt(b.UnitId))
    .input("pid",   sql.Int,           unitRow.ProjectId || null)
    .input("pname", sql.NVarChar(200), unitRow.ProjectName || b.ProjectName || null)
    .input("cid",   sql.Int,           unitRow.CompanyId || null)
    .input("unit",  sql.NVarChar(100), unitRow.UnitName)
    .input("blk",   sql.NVarChar(100), unitRow.BlockName || b.BlockName || null)
    .input("flr",   sql.NVarChar(100), b.FloorName   || null)
    .input("utype", sql.NVarChar(100), unitRow.UnitType || b.UnitType || null)
    .input("area",  sql.Decimal(18,2), area)
    .input("rate",  sql.Decimal(18,2), rate)
    .input("tot",   sql.Decimal(18,2), total)
    .input("bamt",  sql.Decimal(18,2), bookingAmount)
    .input("ttype", sql.NVarChar(20),  tokenType)
    .input("tval",  sql.Decimal(18,2), tokenValue)
    .input("ppid",  sql.Int,           b.PaymentPlanId ? parseInt(b.PaymentPlanId) : null)
    .input("bdate", sql.Date,          b.BookingDate || null)
    .input("pmode", sql.NVarChar(50),  b.PaymentMode  || null)
    .input("asgn",  sql.Int,           b.AssignedTo   ? parseInt(b.AssignedTo) : null)
    .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
    .input("cb",    sql.Int,           actorUserId)
    .query(`
      INSERT INTO dbo.CrmBooking
        (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, UnitNo, BlockName, FloorName, UnitType,
         AreaSqFt, RatePerSqFt, TotalValue, BookingAmount, TokenType, TokenValue, PaymentPlanId,
         BookingDate, PaymentMode, AssignedTo, Status, Notes, IsActive,
         ParkingTotal, ExtraChargesTotal, GrandTotal, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES
        (@no, @appId, @uid, @pid, @pname, @cid, @unit, @blk, @flr, @utype,
         @area, @rate, @tot, @bamt, @ttype, @tval, @ppid,
         ISNULL(@bdate, CAST(SYSDATETIME() AS DATE)), @pmode,
         @asgn, 'Pending', @note, 1,
         0, 0, ISNULL(@tot, 0), @cb, SYSDATETIME())
    `);

  const bookingId = result.recordset[0].Id;

  await seedPrimaryCoApplicantFromCustomer(pool, bookingId, parseInt(b.ApplicationId), actorUserId);

  await generateMilestonesForBooking(pool, bookingId, total, b.PaymentPlanId, b.BookingDate, actorUserId);

  await advanceApplicationStatus(pool, parseInt(b.ApplicationId), "Approved", "AutoBooking",
    `Auto-approved: booking ${bookingNo} created`, actorUserId, { force: true });

  const tokenWarning = await checkTokenVsFirstMilestone(pool, bookingId, bookingAmount);

  return { id: bookingId, BookingNo: bookingNo, tokenWarning };
}

// The Booking form's own TokenType/TokenValue (-> BookingAmount) and the
// attached payment plan's own milestone #1 are computed completely
// independently — a salesperson can record a 5% token while the plan bills
// 10% "at booking," and nothing previously flagged the mismatch. Same
// resolution as the broker-payment finding: a soft, non-blocking warning
// rather than a hard gate, since real negotiated deals can legitimately
// differ from a plan's default first-stage amount.
async function checkTokenVsFirstMilestone(pool, bookingId, bookingAmount) {
  if (!bookingAmount) return null;
  const m1 = await pool.request().input("bid", sql.Int, bookingId)
    .query("SELECT TOP 1 AmountDue FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
  const firstMilestoneAmount = m1.recordset[0]?.AmountDue;
  if (firstMilestoneAmount == null) return null;
  if (Math.abs(Number(firstMilestoneAmount) - Number(bookingAmount)) < 1) return null;
  return `Booking token amount (₹${Number(bookingAmount).toLocaleString("en-IN")}) doesn't match the payment plan's first milestone (₹${Number(firstMilestoneAmount).toLocaleString("en-IN")}) — the milestone amount is what invoicing/payments will actually track.`;
}

module.exports = {
  createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError, SOURCE_TYPES,
  generateMilestonesForBooking, validatePaymentPlanScope,
};
