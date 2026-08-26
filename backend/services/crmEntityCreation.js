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
const { bumpCacheVersion } = require("../redis");
const { getNextDocNumber } = require("./docNumber");
const { validateSourceChain } = require("./sourceChain");
const { logStatusChange } = require("./crmApplicationWorkflow");
const { getIo } = require("../socket");
const { guardAndConvertHold, assertEntityNotTaken, findActiveHold, placeHoldIfNeeded } = require("./crmHoldService");
const { rollupBookingTotals, applyAddParking } = require("../routes/crmParking");
const { recalculateRemainingMilestones } = require("./crmWorkflowGuards");
const { ensureBrokerForChannelPartner } = require("./channelPartnerBrokerBridge");

const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

function normalizeEmail(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  return trimmed || null;
}

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

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    const byEmail = await pool.request().input("email", sql.NVarChar(200), normalizedEmail)
      .query(`
        SELECT TOP 1 CustomerNo, CustomerName
        FROM dbo.CrmCustomer
        WHERE IsActive = 1 AND LOWER(LTRIM(RTRIM(Email))) = @email
      `);
    if (byEmail.recordset.length) {
      const row = byEmail.recordset[0];
      throw new CrmCreationError(`A customer with this email already exists - ${row.CustomerNo} (${row.CustomerName})`, 409);
    }
  }

  const customerNo = await getNextDocNumber(pool, "CUST", "CUST");
  try {
    const result = await pool.request()
      .input("no",    sql.NVarChar(30),  customerNo)
      .input("lid",   sql.Int,           leadId ? parseInt(leadId) : null)
      .input("name",  sql.NVarChar(200), name || "Unknown")
      .input("mob",   sql.NVarChar(20),  mobile)
      .input("alt",   sql.NVarChar(20),  altMobile || null)
      .input("email", sql.NVarChar(200), normalizedEmail)
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
      if (retry.recordset[0]?.Id) return retry.recordset[0].Id;
      throw new CrmCreationError("A customer with this email already exists", 409);
    }
    throw e;
  }
}

// Compiles a lead's call history + site visits into the new Application's
// Notes — moved here from saHandoff.js now that Application creation from a
// lead happens whenever staff pick one from the CRM Leads pool, not only at
// the moment of conversion, so this has to run at creation time to reflect
// whatever history has accumulated since. Prepends to any Notes text staff
// already typed on the New Application form, rather than overwriting it.
async function appendLeadHandoffNotes(pool, leadId, lead, existingNotes) {
  const callsResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query(`
      SELECT Outcome, Remarks, Classification, CallTime, DurationSeconds
      FROM dbo.SaInquiryCall
      WHERE LeadId = @lid
      ORDER BY CallTime ASC
    `);
  const callNotes = callsResult.recordset.map((c, i) =>
    `[Call ${i + 1}] ${c.CallTime ? String(c.CallTime).slice(0, 16) : ""} | ${c.Outcome || ""} | ${c.Classification || ""} | ${c.DurationSeconds || 0}s\n${c.Remarks || ""}`
  ).join("\n---\n");

  const visitResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query(`
      SELECT ProjectName, PreferredDate, Status, CustomerNotes
      FROM dbo.SaSiteVisit
      WHERE LeadId = @lid AND IsActive = 1
      ORDER BY CreatedAt DESC
    `);
  const visitNotes = visitResult.recordset.map((v) =>
    `[Visit] ${v.ProjectName || ""} | ${v.PreferredDate ? String(v.PreferredDate).slice(0, 10) : ""} | ${v.Status}\n${v.CustomerNotes || ""}`
  ).join("\n");

  const leadHistory = [
    lead.CustomerRemarks ? `Customer Remarks: ${lead.CustomerRemarks}` : "",
    callNotes ? `\n--- Call History ---\n${callNotes}` : "",
    visitNotes ? `\n--- Site Visits ---\n${visitNotes}` : "",
  ].filter(Boolean).join("\n");

  return [existingNotes?.trim(), leadHistory].filter(Boolean).join("\n\n") || null;
}

// Sales Automation leads never flow straight into a CrmApplication anymore —
// converting a lead (SaLead.Status -> 'Converted', see saHandoff.js) only
// puts it in the CRM Leads pool (src/pages/CRM/CrmLeads.tsx). An Application
// is only ever created from a lead when staff explicitly pick one here, and
// only a lead that's actually Converted and not already used by another
// Application is eligible — the real gate the "no direct flow" instruction
// asked for. Enforced here rather than only in the frontend dropdown's
// filtering, since this is the single shared creation path both the human-
// filed form and any future caller go through.
async function createCrmApplicationRecord(pool, b, actorUserId) {
  if (!b.CustomerId && !b.LeadId && (!b.ApplicantName?.trim() || !b.Mobile?.trim()))
    throw new CrmCreationError("Either CustomerId, LeadId, or ApplicantName and Mobile are required");
  if (b.Source && !SOURCE_TYPES.includes(b.Source))
    throw new CrmCreationError(`Invalid Source. Must be one of: ${SOURCE_TYPES.join(", ")}`);

  let prefill = {};
  if (b.LeadId) {
    const lr = await pool.request()
      .input("lid", sql.Int, parseInt(b.LeadId))
      .query(`
        SELECT CustomerName, Mobile, AltMobile, Email,
               PropertyType, BhkPreference, PreferredLocation,
               SourceType, PlatformId, CampaignId, AdId, ChannelPartnerId,
               Status, CrmApplicationId
        FROM dbo.SaLead WHERE Id = @lid
      `);
    prefill = lr.recordset[0] || {};
    if (!lr.recordset.length) throw new CrmCreationError("Selected lead does not exist");
    if (prefill.CrmApplicationId) throw new CrmCreationError("This lead has already been used for another application", 409);
    if (prefill.Status !== "Converted") {
      throw new CrmCreationError(`This lead isn't converted yet (status: ${prefill.Status}) — only converted leads can be used to start an application`);
    }
    b.Notes = await appendLeadHandoffNotes(pool, parseInt(b.LeadId), prefill, b.Notes);
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
  const bridge = !b.BrokerId && channelPartnerId
    ? await ensureBrokerForChannelPartner(pool, channelPartnerId, actorUserId)
    : null;
  const brokerId = b.BrokerId ? parseInt(b.BrokerId) : (bridge?.brokerId || null);
  const brokerageRatePercent = b.BrokerageRatePercent != null && b.BrokerageRatePercent !== ""
    ? parseFloat(b.BrokerageRatePercent)
    : (bridge?.commissionRate ?? null);

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

    // Reject the pick up front if the unit is already spoken for — before any
    // Application row exists to be rolled back. This is the actual fix for
    // "a unit can be applied for multiple times": previously nothing here
    // checked availability at all, and the real hold (crmHoldService.js) only
    // ever got placed at the wizard's final submit step — leaving the entire
    // creation-to-submit window (which can be hours or days, not a race) with
    // no protection whatsoever, so the dropdown kept offering an already-
    // picked unit to every other salesperson. Reuses the exact same checks
    // placeHold() itself uses (assertEntityNotTaken + findActiveHold), so
    // "available" can never mean something different here than it does
    // anywhere else in the system. assertEntityNotTaken throws a plain Error
    // (with .status set) rather than CrmCreationError — re-wrapped here so
    // the POST / route's `instanceof CrmCreationError` check (which is what
    // actually picks the right HTTP status) still fires correctly instead of
    // silently falling through to a 500.
    try {
      await assertEntityNotTaken(pool, "Unit", parseInt(b.PreferredUnitId));
    } catch (takenErr) {
      throw new CrmCreationError(takenErr.message, takenErr.status || 409);
    }
    const existingHold = await findActiveHold(pool, "Unit", parseInt(b.PreferredUnitId));
    if (existingHold) {
      throw new CrmCreationError("This unit already has an active hold from another application", 409);
    }
  }
  const effectivePaymentPlanId = await resolveApplicationPaymentPlan(pool, {
    preferredUnitId: b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null,
    paymentPlanId: b.PaymentPlanId || null,
  });

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
      .input("brkid", sql.Int,          brokerId)
      .input("brkpct", sql.Decimal(5,2), brokerageRatePercent)
      .input("brkplan", sql.NVarChar(20), ["OneTime", "TwoPart", "AgreementOnly"].includes(b.BrokeragePaymentPlan) ? b.BrokeragePaymentPlan : "OneTime")
      .query(`
        INSERT INTO dbo.CrmApplication
          (ApplicationNo, LeadId, CustomerId, ApplicantName, Mobile, AltMobile, Email,
           ProjectId, PreferredUnitId, CompanyId, InterestedProject, InterestedUnit,
           PropertyType, BhkPreference,
           Source, PlatformId, CampaignId, AdId, ChannelPartnerId,
           RatePerSqFt, DateOfApply, PaymentPlanId, TokenType, TokenValue, BookingAmount, PaymentMode,
           AssignedTo, AssignedBy, Status, Notes, ReferredByApplicationId, IsActive, CreatedBy, CreatedAt,
           BrokerId, BrokerageRatePercent, BrokeragePaymentPlan)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @lid, @custid, @name, @mob, @alt, @em,
           @pid, @uid, @cid, @proj, @unit,
           @pt, @bhk,
           @src, @platid, @campid, @adid, @cpid,
           @rate, @doa, @ppid, @ttype, @tval, @bamt, @pmode,
           @asgn, @asgnby, 'Draft', @note, @refApp, 1, @cb, SYSDATETIME(),
           @brkid, @brkpct, @brkplan)
      `);
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      throw new CrmCreationError("This lead has already been promoted to a CRM application", 409);
    throw e;
  }
  const applicationId = result.recordset[0].Id;
  // Starts Draft, not Pending — the wizard's own PUT /:id/submit (see
  // crmApplications.js) is the real Draft->Pending gate (approvalTransition
  // only allows that transition from Draft/Rejected). Inserting straight as
  // Pending here used to skip that gate entirely: every fresh application —
  // even a one-field stub with no unit, no payment plan, nothing past Step 1
  // — was immediately eligible for "Create Booking" (POST /:id/create-booking
  // only checks Status==='Pending' + PreferredUnitId), producing a real
  // Booking against a customer who was never actually verified or asked to
  // submit anything. The frontend's own Applications list already expected
  // Draft to exist here (isResumable/"Not submitted yet" caption, the
  // Create-Booking button's own comment) — this was the missing half.
  await logStatusChange(pool, applicationId, null, "Draft", "Manual", "Application created", actorUserId);

  // Stamp the reverse FK so this lead drops out of the "available" pool —
  // CrmApplicationId being set is the sole "already used" signal (Status
  // stays 'Converted' permanently, it doesn't change again here).
  if (b.LeadId) {
    await pool.request()
      .input("lid", sql.Int, parseInt(b.LeadId))
      .input("aid", sql.Int, applicationId)
      .query("UPDATE dbo.SaLead SET CrmApplicationId = @aid, UpdatedAt = SYSDATETIME() WHERE Id = @lid");
  }

  // Place the actual hold now that the Application (and its Id) exists —
  // placeHold() itself re-does the availability + same-project checks
  // authoritatively (it's the single source of truth every caller goes
  // through), so this isn't just trusting the pre-check above blindly.
  // A conflict here means a genuine last-moment race — another application's
  // hold landed in the few milliseconds between the pre-check and this
  // insert — the same order of magnitude as the mobile-number race
  // findOrCreateCustomer already tolerates above. There's no transaction
  // wrapping this function to roll the Application row back into, so this
  // doesn't fail the whole creation; crmApplications.js's own submit-time
  // placeHoldIfNeeded call remains the backstop that catches it if it's
  // still unresolved by the time this application is submitted.
  if (b.PreferredUnitId) {
    try {
      await placeHoldIfNeeded(pool, {
        entityType: "Unit", entityId: parseInt(b.PreferredUnitId), applicationId, holdDays: 3,
        reason: "Application created — auto-hold", userId: actorUserId,
      });
    } catch (holdErr) {
      console.error("[crm-entity-creation] auto-hold on application creation failed:", holdErr.message);
    }
  }

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
async function generateMilestonesForBooking(poolOrTx, bookingId, totalValue, paymentPlanId, bookingDate, actorUserId, bookingAmount = 0) {
  if (!totalValue || totalValue <= 0) return;
  let milestones;
  // Booking Amount is now set on the Payment Plan itself (at plan-creation
  // time), not typed fresh per booking — see CrmPaymentPlans.tsx. When the
  // booking is tagged to a plan, that plan's BookingAmount is authoritative
  // and overrides whatever the Booking/Application form happened to send;
  // the `bookingAmount` parameter only still matters as a fallback for
  // bookings with no tagged plan (DEFAULT_MILESTONES) or a legacy plan saved
  // before this field existed (BookingAmount IS NULL).
  if (paymentPlanId) {
    const planRes = await poolOrTx.request().input("pid", sql.Int, parseInt(paymentPlanId))
      .query("SELECT BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid");
    const planBookingAmount = planRes.recordset[0]?.BookingAmount;
    if (planBookingAmount != null) bookingAmount = Number(planBookingAmount);

    const planItems = await poolOrTx.request().input("pid", sql.Int, parseInt(paymentPlanId))
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

  // Milestone #1 ("booking amount") is a real ₹ figure — now resolved above
  // from the tagged plan's own BookingAmount (or the fallback param, for
  // untagged/legacy plans). The plan's other milestones are inserted at
  // their normal plan-relative amounts below and then redistributed (after
  // the loop) across whatever's actually left — (totalValue - bookingAmount)
  // — preserving their relative weighting to each other, via the same
  // machinery that handles a later total/override change
  // (recalculateRemainingMilestones).
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

    const ins = await poolOrTx.request()
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
    await recalculateRemainingMilestones(poolOrTx, bookingId, { fixedMilestoneId: milestone1Id });
  }
}


// Which plans "apply" to a given Unit is a 4-tier cascade, stopping at the
// first non-empty tier: the Unit's own tags (dbo.CrmUnitPaymentPlan) -> its
// Block's tags (dbo.CrmBlockPaymentPlan) -> its Project's tags
// (dbo.CrmPaymentPlanProject) -> every active plan (the original, still-live
// last resort — Project/Block tagging is optional, so an untagged plan
// never disappears entirely). This is the single source of truth both
// resolveApplicationPaymentPlan below and every "which plans can I pick
// from" dropdown (Unit Master's own chip-picker, the Application wizard)
// call, so the UI and the actual save-time validation can never disagree.
async function getApplicablePaymentPlans(pool, { unitId, blockId, projectId }) {
  const queryTags = async (table, column, id) => {
    const r = await pool.request().input("id", sql.Int, id).query(`
      SELECT pp.Id, pp.PlanName, pp.BookingAmount
      FROM dbo.${table} t
      JOIN dbo.CrmPaymentPlanTemplate pp ON pp.Id = t.PlanId AND pp.IsActive = 1
      WHERE t.${column} = @id AND t.IsActive = 1
      ORDER BY pp.PlanName
    `);
    return r.recordset;
  };

  if (unitId) {
    const t = await queryTags("CrmUnitPaymentPlan", "UnitId", unitId);
    if (t.length) return t;
  }
  if (blockId) {
    const t = await queryTags("CrmBlockPaymentPlan", "BlockId", blockId);
    if (t.length) return t;
  }
  if (projectId) {
    const t = await queryTags("CrmPaymentPlanProject", "ProjectId", projectId);
    if (t.length) return t;
  }
  const all = await pool.request().query(`
    SELECT Id, PlanName, BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE IsActive = 1 ORDER BY PlanName
  `);
  return all.recordset;
}

// This is the single place that turns (unit, requested plan) into the
// actual plan to save, used by both Application creation/edit and Booking
// creation so the same rule always applies:
//   - No unit yet -> no plan question yet (returns null).
//   - Exactly one applicable plan (see getApplicablePaymentPlans's cascade)
//     and none was explicitly picked -> that plan is the obvious default.
//   - 0 or 2+ applicable plans and none was explicitly picked -> a plan is
//     mandatory now, so this throws rather than silently picking.
//   - 1+ applicable plans -> an explicit pick must be one of them.
//   - Nothing tagged anywhere in the Unit's hierarchy -> any active plan is
//     acceptable (the cascade's own final fallback already covers this).
async function resolveApplicationPaymentPlan(pool, { preferredUnitId, paymentPlanId }) {
  if (!preferredUnitId) return null;

  const unitRow = await pool.request().input("uid", sql.Int, preferredUnitId)
    .query("SELECT BlockId, ProjectId FROM dbo.UnitMaster WHERE Id = @uid");
  const { BlockId, ProjectId } = unitRow.recordset[0] || {};

  const applicable = await getApplicablePaymentPlans(pool, { unitId: preferredUnitId, blockId: BlockId, projectId: ProjectId });
  const applicableIds = applicable.map((r) => r.Id);

  if (!paymentPlanId) {
    if (applicableIds.length === 1) return applicableIds[0];
    throw new CrmCreationError(
      applicableIds.length > 1
        ? "This unit has multiple applicable payment plans — select one."
        : "A Payment Plan is required for this unit."
    );
  }

  const planId = parseInt(paymentPlanId);
  if (!applicableIds.includes(planId)) {
    throw new CrmCreationError("Selected Payment Plan is not applicable to this unit.");
  }
  return planId;
}

// Co-Applicant capture now happens directly on the Application wizard's own
// "Co-Applicant" tab (see crmCoApplicant.js's ApplicationId-keyed routes),
// writing straight into dbo.CrmCoApplicant with BookingId left NULL until a
// Booking exists -- CrmCustomer no longer holds or feeds this data at all.
// So the only thing left to do here, once a Booking is created, is the same
// ApplicationId -> BookingId backfill every other Application-stage capture
// (bank/KYC, documents, parking) already gets a few lines below.

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

  // Applications no longer have their own separate approval cycle — the
  // moment one is Submitted (Status='Pending'), a Booking is created
  // straight away (see crmApplications.js PUT /:id/submit), and all real
  // review/approval (Level-1 data review, then Marketing Head, then
  // Director) happens on the Booking itself from there
  // (crmBookingStageService.js). So the only Applications a Booking can
  // never exist for are the genuinely dead ones — the same "not dead"
  // exclusion this used before Approved briefly became a real gate.
  const appRow = await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId))
    .query("SELECT Status, IsActive, PaymentPlanId, BrokerId, BrokerageRatePercent, BrokeragePaymentPlan, ChannelPartnerId FROM dbo.CrmApplication WHERE Id = @aid");
  if (!appRow.recordset.length) throw new CrmCreationError("Application not found");
  const deadApplicationStatuses = ["Rejected", "Cancelled", "Expired"];
  if (appRow.recordset[0].IsActive === false || deadApplicationStatuses.includes(appRow.recordset[0].Status)) {
    throw new CrmCreationError(
      `A Booking can't be created for an application that is ${appRow.recordset[0].Status}`, 400);
  }

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

  // A customer can't actually get their Booking approved/paid against an
  // unapproved Application, so the real "confirm within N days" clock only
  // makes sense starting now — a fresh 3 days from Booking creation, not
  // whatever was left on the original pick-time hold (which may have
  // already burned most of its window sitting in the admin approval
  // queue). This Booking still isn't a confirmed sale (Status stays
  // 'Pending' until Approved AND Milestone #1 is Paid — see
  // unitMatrix.js/parkingMatrix.js's Status derivation), so the deadline
  // below is what the Matrix keeps counting down against in the meantime.
  const confirmDeadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const application = appRow.recordset[0];
  const bookingBridge = !b.BrokerId && !application.BrokerId && application.ChannelPartnerId
    ? await ensureBrokerForChannelPartner(pool, application.ChannelPartnerId, actorUserId)
    : null;
  const bookingBrokerId = b.BrokerId ? parseInt(b.BrokerId) : (application.BrokerId || bookingBridge?.brokerId || null);
  const bookingBrokerageRatePercent = b.BrokerageRatePercent != null && b.BrokerageRatePercent !== ""
    ? parseFloat(b.BrokerageRatePercent)
    : (application.BrokerageRatePercent ?? bookingBridge?.commissionRate ?? null);
  const bookingBrokeragePaymentPlan = ["OneTime", "TwoPart", "AgreementOnly"].includes(b.BrokeragePaymentPlan)
    ? b.BrokeragePaymentPlan
    : (["OneTime", "TwoPart", "AgreementOnly"].includes(application.BrokeragePaymentPlan) ? application.BrokeragePaymentPlan : "OneTime");

  // guardAndConvertHold is advisory — it converts any pre-existing hold on
  // this unit for this application. Kept outside the transaction because it
  // uses its own internal locking and has partial-failure tolerance; the real
  // double-booking prevention is the UPDLOCK re-check inside the transaction
  // below.
  await guardAndConvertHold(pool, "Unit", parseInt(b.UnitId), parseInt(b.ApplicationId));

  // The Application already went through the mandatory-plan-selection gate
  // (see resolveApplicationPaymentPlan in createCrmApplicationRecord / the
  // PUT /:id route) — its own PaymentPlanId is the real, staff-confirmed
  // choice, so that's the fallback here rather than re-deriving one. An
  // explicit b.PaymentPlanId still wins if the caller is deliberately
  // changing it at booking time.
  const effectivePaymentPlanId = await resolveApplicationPaymentPlan(pool, {
    preferredUnitId: unitRow.Id,
    paymentPlanId: b.PaymentPlanId || appRow.recordset[0].PaymentPlanId || null,
  });

  const area  = unitRow.AreaSqFt != null ? unitRow.AreaSqFt : (b.AreaSqFt != null ? parseFloat(b.AreaSqFt) : null);
  const rate  = b.RatePerSqFt != null ? parseFloat(b.RatePerSqFt) : null;
  const total = b.TotalValue  != null ? parseFloat(b.TotalValue)
              : (area && rate ? Math.round(area * rate) : null);

  const tokenType = b.TokenType === "Amount" ? "Amount" : "Percentage";
  const tokenValue = b.TokenValue != null ? parseFloat(b.TokenValue) : null;
  // Booking Amount is ALWAYS the fixed ₹ figure set on the tagged Payment
  // Plan itself (see CrmPaymentPlans.tsx) — never derived from a % of
  // TotalValue, and never taken from the Booking form's own Token%/manual
  // field. TokenType/TokenValue are still recorded below purely as a
  // historical/display record of what was originally quoted — they no
  // longer feed into the actual ₹ figure that gets deducted. A plan
  // without a fixed BookingAmount set (e.g. an old plan saved before this
  // field existed) can no longer produce a booking via a silent %
  // fallback — staff must open the plan and set one first.
  if (!effectivePaymentPlanId) {
    throw new CrmCreationError("A Payment Plan must be tagged to this unit before a Booking can be created — Booking Amount can only come from the plan.");
  }
  const planRes = await pool.request().input("pid", sql.Int, parseInt(effectivePaymentPlanId))
    .query("SELECT PlanName, BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid");
  const planRow = planRes.recordset[0];
  if (!planRow || planRow.BookingAmount == null) {
    throw new CrmCreationError(`Payment Plan "${planRow?.PlanName || effectivePaymentPlanId}" has no fixed Booking Amount set — open it in Payment Plan Master and set one before booking this unit.`);
  }
  const bookingAmount = Number(planRow.BookingAmount);

  // getNextDocNumber uses its own internal sp_getapplock transaction and must
  // always run on pool (not on tx) — see crmPayments.js comment at line ~121.
  const bookingNo = await getNextDocNumber(pool, "BKG", "BKG");

  // ── BEGIN ATOMIC SECTION ────────────────────────────────────────────────────
  // Everything from here through generateMilestonesForBooking runs inside a
  // single SERIALIZABLE transaction.
  //
  // The unit availability re-check uses WITH (UPDLOCK, ROWLOCK) so the first
  // request that reaches this point acquires an exclusive lock on whatever
  // CrmBooking rows match for this unit. A concurrent second request for the
  // same unit blocks here until the first commits, then re-reads — at that
  // point taken.recordset.length > 0 and it correctly rejects with 409.
  // Without this lock the window between "checked available" and "inserted
  // booking" is open for a race that results in two confirmed bookings for
  // the same unit.
  const tx = pool.transaction();
  await tx.begin();
  let bookingId;
  try {
    const taken = await tx.request()
      .input("uid", sql.Int, parseInt(b.UnitId))
      .query("SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, ROWLOCK) WHERE UnitId = @uid AND IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')");
    if (taken.recordset.length) throw new CrmCreationError("This unit is already booked", 409);

    const result = await tx.request()
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
      .input("brkid", sql.Int,           bookingBrokerId)
      .input("brkpct", sql.Decimal(5,2), bookingBrokerageRatePercent)
      .input("brkplan", sql.NVarChar(20), bookingBrokeragePaymentPlan)
      .input("cdl",   sql.DateTime2(3),  confirmDeadline)
      .query(`
        INSERT INTO dbo.CrmBooking
          (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, UnitNo, BlockName, FloorName, UnitType,
           AreaSqFt, RatePerSqFt, TotalValue, BookingAmount, TokenType, TokenValue, PaymentPlanId,
           BookingDate, PaymentMode, AssignedTo, Status, Notes, IsActive,
           ParkingTotal, ExtraChargesTotal, GrandTotal, CreatedBy, CreatedAt,
           BrokerId, BrokerageRatePercent, BrokeragePaymentPlan, ConfirmDeadline)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @appId, @uid, @pid, @pname, @cid, @unit, @blk, @flr, @utype,
           @area, @rate, @tot, @bamt, @ttype, @tval, @ppid,
           ISNULL(@bdate, CAST(SYSDATETIME() AS DATE)), @pmode,
           @asgn, 'Pending', @note, 1,
           0, 0, ISNULL(@tot, 0), @cb, SYSDATETIME(),
           @brkid, @brkpct, @brkplan, @cdl)
      `);

    bookingId = result.recordset[0].Id;

    // The Application-stage capture (bank/KYC, documents, parking) was saved
    // keyed by ApplicationId with BookingId left NULL, since no Booking existed
    // yet at that point (see crmCustomerBankDetails.js/crmBookingDocuments.js/
    // crmParking.js's ApplicationId-keyed routes). Backfill BookingId onto those
    // rows now so the Booking review page — which reads by BookingId — actually
    // shows the customer's data instead of appearing empty right after approval.
    await tx.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("UPDATE dbo.CrmCustomerBankDetail SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL");
    await tx.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("UPDATE dbo.CrmBookingDocument SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL");
    await tx.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("UPDATE dbo.CrmParkingAllotment SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL AND IsActive = 1");
    // Co-Applicant is captured on the Application wizard's own tab (ApplicationId
    // set, BookingId NULL) -- backfill BookingId now the same way the three
    // backfills above just did, so Welcome Call/Booking Details (which read
    // CrmCoApplicant by BookingId) actually find it.
    await tx.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("UPDATE dbo.CrmCoApplicant SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL AND IsActive = 1");
    // Extra Work captured on the Application wizard's own tab (ApplicationId
    // set, BookingId NULL, no hold/conversion needed — unlike Parking, there's
    // no scarce slot to reserve) — same backfill as Parking above, so
    // rollupBookingTotals below picks it up into ExtraChargesTotal/GrandTotal
    // and the Booking tab's Parking & Extra Work list actually shows it.
    await tx.request().input("bid", sql.Int, bookingId).input("aid", sql.Int, parseInt(b.ApplicationId))
      .query("UPDATE dbo.CrmExtraCharge SET BookingId = @bid WHERE ApplicationId = @aid AND BookingId IS NULL AND IsActive = 1");

    // The real % payment schedule must exist BEFORE any parking allotment is
    // converted below. applyAddParking numbers its own milestone via
    // `MAX(MilestoneNo)+1` against whatever already exists for the booking —
    // called on a booking with zero milestones yet (as it used to be here),
    // that resolves to 1 and collides with the schedule's own Milestone #1
    // ("Booking"), leaving two distinct rows both claiming MilestoneNo=1. Any
    // code that looks up "the first milestone" by number (e.g.
    // CrmBookingDetail.tsx's Record Payment section) then nondeterministically
    // picks whichever row the query happens to return first — sometimes the
    // real, already-paid Booking Amount, sometimes the unrelated, unpaid
    // parking charge — making an already-settled Booking Amount look
    // outstanding again. generateMilestonesForBooking's own `total` parameter
    // is the unit price alone (parking is always bolted on as its own fixed
    // line item, never part of the % base), so moving this earlier changes
    // nothing about the actual amounts — it only guarantees parking's
    // MAX(MilestoneNo)+1 resolves against the real schedule instead of an
    // empty table.
    await generateMilestonesForBooking(tx, bookingId, total, effectivePaymentPlanId, b.BookingDate, actorUserId, bookingAmount);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  // ── END ATOMIC SECTION ──────────────────────────────────────────────────────

  // Unconditional, not just via guardAndConvertHold's own bump above — a
  // CrmBooking row now exists against this unit regardless of whether a hold
  // was there to convert (e.g. it expired in the seconds before this ran), and
  // unit-master's GET / joins CrmBooking directly, so this is the one place
  // that's guaranteed to run whenever that join's answer actually changes.
  bumpCacheVersion("unit-master").catch(() => {});

  // Application-stage slot picks are now only a temporary hold, not a real
  // allotment (see crmParking.js POST /standalone) — convert each one into a
  // real CrmParkingAllotment against this Booking now that it exists, the
  // same way the Unit itself goes from a soft PreferredUnitId + hold into
  // this real Booking. applyAddParking does the hold-conversion
  // (guardAndConvertHold), the insert, and the matching payment milestone in
  // one call — reusing it here keeps this path byte-for-byte identical to a
  // parking sale added any other way. Never blocks Booking creation if one
  // slot's conversion fails (e.g. it expired in the seconds between wizard
  // submit and admin approval) — same partial-failure tolerance as the rest
  // of this function; the slot just goes back to Available and staff can
  // re-add it manually from the Booking's own Parking tab.
  const parkingHolds = await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId)).query(`
    SELECT h.Id, h.EntityId AS ParkingSlotId, h.RateOverride
    FROM dbo.CrmInventoryHold h
    WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
  `);
  for (const hold of parkingHolds.recordset) {
    try {
      const slot = await pool.request().input("sid", sql.Int, hold.ParkingSlotId)
        .query("SELECT ProjectId, BlockId, ParkingType FROM dbo.ParkingSlot WHERE Id = @sid AND IsActive = 1");
      if (!slot.recordset.length) continue;
      const { ProjectId, BlockId, ParkingType } = slot.recordset[0];
      const rate = await pool.request()
        .input("pid", sql.Int, ProjectId).input("bid2", sql.Int, BlockId).input("pt", sql.NVarChar(50), ParkingType)
        .query(`
          SELECT TOP 1 Id FROM dbo.ParkingMaster
          WHERE ProjectId = @pid AND ParkingType = @pt AND IsActive = 1 AND (BlockId = @bid2 OR BlockId IS NULL)
          ORDER BY CASE WHEN BlockId = @bid2 THEN 0 ELSE 1 END
        `);
      if (!rate.recordset.length) continue;
      await applyAddParking(pool, bookingId, {
        ParkingMasterId: rate.recordset[0].Id, ParkingSlotId: hold.ParkingSlotId, Quantity: 1,
        RateOverride: hold.RateOverride,
      }, actorUserId);
    } catch (parkErr) {
      console.error("[crm-entity-creation] parking hold conversion failed:", parkErr.message);
    }
  }

  // ParkingTotal/GrandTotal were computed above with ParkingTotal = 0 since no
  // parking allotment had BookingId set yet — recompute now that the backfill
  // and hold-conversion above have linked any Application-stage parking
  // selections to this Booking.
  await rollupBookingTotals(pool, bookingId);

  // Booking Amount payment is no longer auto-submitted here. Data Review
  // completion creates the independent Money Receipt, and Money Receipt
  // approval creates the pending Finance ReceivedPayment row.

  // No status force-advance here anymore — the Application was already
  // Approved (registered) before this function would even let it through
  // the gate above. Booking creation is now a downstream consequence of
  // that approval, not the thing that causes it.

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
  generateMilestonesForBooking, resolveApplicationPaymentPlan, getApplicablePaymentPlans,
};

