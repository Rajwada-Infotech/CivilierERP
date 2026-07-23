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
const { rollupBookingTotals } = require("../routes/crmParking");
const { createReceiptForMilestone } = require("../routes/crmPayments");
const { recalculateRemainingMilestones } = require("./crmWorkflowGuards");

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
        SELECT CustomerName, Mobile, AltMobile, Email,
               PropertyType, BhkPreference, PreferredLocation,
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
  let unitDefaultPaymentPlanId = null;
  let unitBlockId = null;
  if (b.PreferredUnitId) {
    const unit = await pool.request().input("uid", sql.Int, parseInt(b.PreferredUnitId))
      .query("SELECT UnitName, BlockId, DefaultPaymentPlanId FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1");
    if (!unit.recordset.length) throw new CrmCreationError("Selected unit does not exist or is inactive");
    const unitRow = unit.recordset[0];
    unitName = unitRow.UnitName;
    unitBlockId = unitRow.BlockId || null;
    unitDefaultPaymentPlanId = unitRow.DefaultPaymentPlanId || null;
  }
  const effectivePaymentPlanId = b.PaymentPlanId ? parseInt(b.PaymentPlanId) : unitDefaultPaymentPlanId;
  if (effectivePaymentPlanId) {
    await validatePaymentPlanScope(pool, effectivePaymentPlanId, {
      companyId: companyId || null,
      projectId: b.ProjectId ? parseInt(b.ProjectId) : null,
      blockId: unitBlockId,
      unitId: b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null,
    });
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
      .input("src",  sql.NVarChar(200), b.Source || prefill.SourceType || null)
      .input("platid", sql.Int, platformId)
      .input("campid", sql.Int, campaignId)
      .input("adid",   sql.Int, adId)
      .input("cpid",   sql.Int, channelPartnerId)
      .input("rate", sql.Decimal(18,2), b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null)
      .input("doa",  sql.Date,          b.DateOfApply || null)
      .input("ppid", sql.Int,           effectivePaymentPlanId || null)
      .input("ttype",sql.NVarChar(20),  b.TokenType || null)
      .input("tval", sql.Decimal(18,2), b.TokenValue != null ? parseFloat(b.TokenValue) : null)
      .input("bamt", sql.Decimal(18,2), b.BookingAmount != null ? parseFloat(b.BookingAmount) : null)
      .input("pmode",sql.NVarChar(50),  b.PaymentMode || null)
      // AssignedTo respects an explicit caller value (saHandoff.js passes
      // the lead's already-routed salesperson) or falls back to whoever
      // created the record. crmApplications.js's own POST route enforces
      // the stricter "self-assign, no client override" rule for the human-
      // filed Application form specifically — this shared function stays
      // permissive so the SA->CRM handoff's existing assignment logic keeps
      // working unchanged.
      .input("asgn", sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : actorUserId)
      .input("asgnby", sql.Int,         b.AssignedBy ? parseInt(b.AssignedBy) : actorUserId)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("refApp", sql.Int,         b.ReferredByApplicationId ? parseInt(b.ReferredByApplicationId) : null)
      .input("cb",   sql.Int,           actorUserId)
      .input("brkid", sql.Int,          b.BrokerId ? parseInt(b.BrokerId) : null)
      .input("brkpct", sql.Decimal(5,2), b.BrokerageRatePercent != null && b.BrokerageRatePercent !== "" ? parseFloat(b.BrokerageRatePercent) : null)
      .input("brksplit", sql.Bit,       b.BrokerageSplitEnabled ? 1 : 0)
      .query(`
        INSERT INTO dbo.CrmApplication
          (ApplicationNo, LeadId, CustomerId, ApplicantName, Mobile, AltMobile, Email,
           ProjectId, PreferredUnitId, CompanyId, InterestedProject, InterestedUnit,
           PropertyType, BhkPreference,
           Source, PlatformId, CampaignId, AdId, ChannelPartnerId,
           RatePerSqFt, DateOfApply, PaymentPlanId, TokenType, TokenValue, BookingAmount, PaymentMode,
           AssignedTo, AssignedBy, Status, Notes, ReferredByApplicationId, IsActive, CreatedBy, CreatedAt,
           BrokerId, BrokerageRatePercent, BrokerageSplitEnabled)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @lid, @custid, @name, @mob, @alt, @em,
           @pid, @uid, @cid, @proj, @unit,
           @pt, @bhk,
           @src, @platid, @campid, @adid, @cpid,
           @rate, @doa, @ppid, @ttype, @tval, @bamt, @pmode,
           @asgn, @asgnby, 'Pending', @note, @refApp, 1, @cb, SYSDATETIME(),
           @brkid, @brkpct, @brksplit)
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
async function generateMilestonesForBooking(pool, bookingId, totalValue, paymentPlanId, bookingDate, actorUserId, bookingAmount = 0) {
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

  // Milestone #1 ("booking amount") is a real ₹ figure the customer actually
  // booked with — it can be any amount, not a fixed plan percentage. When one
  // is known, it overrides the plan's own milestone-1 %/₹; the plan's other
  // milestones are inserted at their normal plan-relative amounts below and
  // then redistributed (after the loop) across whatever's actually left —
  // (totalValue - bookingAmount) — preserving their relative weighting to
  // each other, via the same machinery that handles a later total/override
  // change (recalculateRemainingMilestones).
  const bookingAmt = Number(bookingAmount) > 0 ? Number(bookingAmount) : 0;
  let milestone1Id = null;

  for (const m of milestones) {
    let dueDate;
    if (m.no === 1) {
      dueDate = runningDue;
    } else {
      runningDue = new Date(runningDue);
      runningDue.setDate(runningDue.getDate() + MILESTONE_DEFAULT_INTERVAL_DAYS);
      dueDate = runningDue;
    }
    const isFirst = m.no === 1;
    // Nothing is due by default. Until a real Booking Amount is entered
    // (bookingAmt > 0), every milestone — including #1 — is inserted at 0,
    // not the plan's fixed percentage of TotalValue; staff would otherwise
    // see a scary pre-filled "Due" figure the customer never agreed to.
    // Once the Booking Amount is actually set (via the Payment tab's
    // resync-schedule call), Milestone #1 takes that real amount and every
    // other milestone gets redistributed across what's left, preserving the
    // plan's relative weighting (recalculateRemainingMilestones falls back to
    // the plan's own %s whenever a milestone's stored Percent is 0/unset).
    const amt = bookingAmt > 0 ? (isFirst ? bookingAmt : Math.round(totalValue * m.pct) / 100) : 0;
    const pct = bookingAmt > 0 ? (isFirst ? Math.round((bookingAmt / totalValue) * 10000) / 100 : m.pct) : 0;

    const ins = await pool.request()
      .input("bid",  sql.Int,           bookingId)
      .input("mno",  sql.Int,           m.no)
      .input("mname",sql.NVarChar(200), m.name)
      .input("amt",  sql.Decimal(18,2), amt)
      .input("pct",  sql.Decimal(5,2),  pct)
      .input("due",  sql.Date,          dueDate)
      .input("rdocs",sql.NVarChar(sql.MAX), m.docs || null)
      .input("dept", sql.NVarChar(100), m.dept || null)
      .input("cb",   sql.Int,           actorUserId)
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, [Percent], DueDate, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @mno, @mname, @amt, @pct, @due, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
      `);
    if (isFirst) milestone1Id = ins.recordset[0].Id;
  }

  if (bookingAmt > 0 && milestone1Id && milestones.length > 1) {
    await recalculateRemainingMilestones(pool, bookingId, { fixedMilestoneId: milestone1Id });
  }
}

// A payment plan scoped to a specific Company/Project/Block/Unit must
// actually match the booking it's being attached to — otherwise the scoping
// built into the Payment Plan Master (see migration 182, extended with
// UnitId for per-unit plans) is purely cosmetic, only ever enforced by which
// options happen to be in a dropdown. NULL scope columns on the plan mean
// "applies everywhere" and always pass. Project scope is many-to-many
// (dbo.CrmPaymentPlanProject, migration 248) — a plan with zero linked
// projects applies everywhere, one with 1+ links must include the booking's
// project.
async function validatePaymentPlanScope(pool, planId, { companyId, projectId, blockId, unitId }) {
  const plan = await pool.request().input("pid", sql.Int, planId)
    .query("SELECT PlanName, CompanyId, BlockId, UnitId FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid");
  if (!plan.recordset.length) throw new CrmCreationError("Selected payment plan does not exist");
  const p = plan.recordset[0];
  if (p.CompanyId && p.CompanyId !== companyId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different company`);
  }
  const links = await pool.request().input("pid", sql.Int, planId)
    .query("SELECT ProjectId FROM dbo.CrmPaymentPlanProject WHERE PlanId = @pid AND IsActive = 1");
  if (links.recordset.length && !links.recordset.some(r => r.ProjectId === projectId)) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different project`);
  }
  if (p.BlockId && p.BlockId !== blockId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different block`);
  }
  if (p.UnitId && p.UnitId !== unitId) {
    throw new CrmCreationError(`Payment plan "${p.PlanName}" is scoped to a different unit`);
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
    .input("src",  sql.NVarChar(20), "CustomerIntake")
    .input("cb",   sql.Int, actorUserId)
    .query(`
      INSERT INTO dbo.CrmCoApplicant (BookingId, Name, Relation, Mobile, PanNo, Notes, SourceType, CreatedBy, CreatedAt)
      VALUES (@bid, @name, @rel, @mob, @pan, @note, @src, @cb, SYSDATETIME())
    `);
}

// The seed above only fires once, at booking creation — if staff correct a
// typo in the customer's co-applicant name/relation/mobile/PAN afterward
// (CrmCustomers.tsx edit form), that edit silently never reached the
// CrmCoApplicant row Welcome Call/Booking Details actually display, leaving
// two now-mismatched copies of the same person's details. SourceType marks
// exactly which row was auto-seeded (never a manually-added co-applicant),
// so this can re-sync it without ever touching rows staff entered themselves.
// Called from crmCustomers.js PUT /:id, alongside its other lockstep syncs.
async function syncCoApplicantFromCustomerEdit(pool, customerId, updates) {
  if (!updates.CoApplicantName?.trim()) return;
  await pool.request()
    .input("cid",  sql.Int, customerId)
    .input("name", sql.NVarChar(200), updates.CoApplicantName.trim())
    .input("rel",  sql.NVarChar(50), updates.CoApplicantRelation || null)
    .input("mob",  sql.NVarChar(20), updates.CoApplicantMobile || null)
    .input("pan",  sql.NVarChar(20), updates.CoApplicantPanNo || null)
    .query(`
      UPDATE ca SET
        ca.Name = @name, ca.Relation = @rel, ca.Mobile = @mob, ca.PanNo = @pan,
        ca.UpdatedAt = SYSDATETIME()
      FROM dbo.CrmCoApplicant ca
      JOIN dbo.CrmBooking b ON b.Id = ca.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE a.CustomerId = @cid AND ca.SourceType = 'CustomerIntake' AND ca.IsActive = 1
    `);
}

async function createCrmBookingRecord(pool, b, actorUserId) {
  if (!b.ApplicationId) throw new CrmCreationError("ApplicationId is required");
  if (!b.UnitId) throw new CrmCreationError("UnitId is required — a unit must be selected from Unit Master");

  // One Application, one Booking — enforced here (not just at the
  // Application-approval call site) so the manual/fallback creation path
  // can never create a second Booking against an Application that already
  // has an active one, no matter which caller reaches this function.
  const existingForApp = await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId))
    .query("SELECT Id, BookingNo FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1");
  if (existingForApp.recordset.length) {
    throw new CrmCreationError(`This application already has a booking (${existingForApp.recordset[0].BookingNo}) — an application can only have one`, 409);
  }

  const unit = await pool.request().input("uid", sql.Int, parseInt(b.UnitId)).query(`
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.AreaSqFt,
           u.DefaultPaymentPlanId,
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

  const effectivePaymentPlanId = b.PaymentPlanId ? parseInt(b.PaymentPlanId) : (unitRow.DefaultPaymentPlanId || null);

  if (effectivePaymentPlanId) {
    await validatePaymentPlanScope(pool, effectivePaymentPlanId, {
      companyId: unitRow.CompanyId || null, projectId: unitRow.ProjectId || null, blockId: unitRow.BlockId || null,
      unitId: unitRow.Id || null,
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
    .input("ppid",  sql.Int,           effectivePaymentPlanId)
    .input("bdate", sql.Date,          b.BookingDate || null)
    .input("pmode", sql.NVarChar(50),  b.PaymentMode  || null)
    .input("asgn",  sql.Int,           b.AssignedTo   ? parseInt(b.AssignedTo) : null)
    .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
    .input("cb",    sql.Int,           actorUserId)
    .input("brkid", sql.Int,           b.BrokerId ? parseInt(b.BrokerId) : null)
    .input("brkpct", sql.Decimal(5,2), b.BrokerageRatePercent != null && b.BrokerageRatePercent !== "" ? parseFloat(b.BrokerageRatePercent) : null)
    .input("brksplit", sql.Bit,        b.BrokerageSplitEnabled ? 1 : 0)
    .query(`
      INSERT INTO dbo.CrmBooking
        (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, UnitNo, BlockName, FloorName, UnitType,
         AreaSqFt, RatePerSqFt, TotalValue, BookingAmount, TokenType, TokenValue, PaymentPlanId,
         BookingDate, PaymentMode, AssignedTo, Status, Notes, IsActive,
         ParkingTotal, ExtraChargesTotal, GrandTotal, CreatedBy, CreatedAt,
         BrokerId, BrokerageRatePercent, BrokerageSplitEnabled)
      OUTPUT INSERTED.Id
      VALUES
        (@no, @appId, @uid, @pid, @pname, @cid, @unit, @blk, @flr, @utype,
         @area, @rate, @tot, @bamt, @ttype, @tval, @ppid,
         ISNULL(@bdate, CAST(SYSDATETIME() AS DATE)), @pmode,
         @asgn, 'Pending', @note, 1,
         0, 0, ISNULL(@tot, 0), @cb, SYSDATETIME(),
         @brkid, @brkpct, @brksplit)
    `);

  const bookingId = result.recordset[0].Id;

  // The Application-stage capture (bank/KYC, documents, parking) was saved
  // keyed by ApplicationId with BookingId left NULL, since no Booking existed
  // yet at that point (see crmCustomerBankDetails.js/crmBookingDocuments.js/
  // crmParking.js's ApplicationId-keyed routes). Backfill BookingId onto those
  // rows now so the Booking review page — which reads by BookingId — actually
  // shows the customer's data instead of appearing empty right after approval.
  await pool.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
    .query("UPDATE dbo.CrmCustomerBankDetail SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL");
  await pool.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
    .query("UPDATE dbo.CrmBookingDocument SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL");
  await pool.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
    .query("UPDATE dbo.CrmParkingAllotment SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL AND IsActive = 1");
  // ParkingTotal/GrandTotal were computed above with ParkingTotal = 0 since no
  // parking allotment had BookingId set yet — recompute now that the backfill
  // above has linked any Application-stage parking selections to this Booking.
  await rollupBookingTotals(pool, bookingId);

  await seedPrimaryCoApplicantFromCustomer(pool, bookingId, parseInt(b.ApplicationId), actorUserId);

  await generateMilestonesForBooking(pool, bookingId, total, effectivePaymentPlanId, b.BookingDate, actorUserId, bookingAmount);

  // The Application's Payment Details step already captured the token
  // amount as "paid" (PaymentMode + a cheque/transaction reference, see
  // CrmApplication.tsx) — that is real money Finance needs to know about,
  // not just descriptive text sitting on the Application. Sync it into a
  // real, GL-posted receipt against Milestone #1 the moment the booking
  // (and its milestone schedule) exists, through the exact same accounting
  // path a manually-entered receipt goes through (crmPayments.js). Never
  // allowed to block booking creation — same partial-failure tolerance as
  // every other best-effort step in this function.
  if (bookingAmount > 0) {
    try {
      const m1 = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT TOP 1 Id FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid ORDER BY MilestoneNo");
      const instrument = await pool.request().input("bid", sql.Int, bookingId)
        .query("SELECT ChequeNo, ChequeDate, TransactionRef, BankName FROM dbo.CrmCustomerBankDetail WHERE BookingId = @bid");
      const actorRow = await pool.request().input("uid", sql.Int, actorUserId)
        .query("SELECT email, name FROM dbo.users WHERE id = @uid");
      if (m1.recordset.length) {
        const inst = instrument.recordset[0] || {};
        const actorEmail = actorRow.recordset[0]?.email || actorRow.recordset[0]?.name || null;
        await createReceiptForMilestone(pool, m1.recordset[0].Id, {
          Amount: bookingAmount,
          ReceivedDate: b.BookingDate,
          PaymentMode: b.PaymentMode || null,
          TransactionRef: b.PaymentMode === "Cheque" ? (inst.ChequeNo || null) : (inst.TransactionRef || null),
          ChequeDate: b.PaymentMode === "Cheque" ? (inst.ChequeDate || null) : null,
          DepositBankName: inst.BankName || null,
          Notes: "Auto-synced from Application token payment capture",
        }, actorUserId, actorEmail);
      }
    } catch (receiptErr) {
      console.error("[crmEntityCreation] auto-receipt sync failed:", receiptErr.message);
    }
  }

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
  generateMilestonesForBooking, validatePaymentPlanScope, syncCoApplicantFromCustomerEdit,
};
