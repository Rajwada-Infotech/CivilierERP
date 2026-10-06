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

const { assertVillaBuyerOwnsLand, VillaLandError } = require("./villaLand");

// A villa built on plots can only be bought by the plot's current owner
// (see services/villaLand.js); surfaced as the caller's own error type.
async function assertVillaBuyer(pool, unitIds, customerId) {
  try {
    await assertVillaBuyerOwnsLand(pool, unitIds, customerId);
  } catch (e) {
    if (e instanceof VillaLandError) throw new CrmCreationError(e.message, e.status);
    throw e;
  }
}

class CrmCreationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// A commercial unit can't be applied for or booked until its GST rule exists
// (services/crmGst.js assertCommercialGstReady); surfaced as a creation error.
async function assertCommercialGst(pool, unitIds) {
  const { assertCommercialGstReady, GstSetupError } = require("./crmGst");
  try {
    await assertCommercialGstReady(pool, unitIds);
  } catch (e) {
    if (e instanceof GstSetupError) throw new CrmCreationError(e.message, 400);
    throw e;
  }
}

async function assertConnectedPlotGroup(pool, plotIds) {
  if (plotIds.length < 2) return;
  const pairs = await pool.request().query(`
    SELECT PlotId, AdjacentPlotId FROM dbo.PlotAdjacency
    WHERE PlotId IN (${plotIds.join(",")}) AND AdjacentPlotId IN (${plotIds.join(",")})
  `);
  const neighbours = new Map(plotIds.map((id) => [id, new Set()]));
  pairs.recordset.forEach(({ PlotId, AdjacentPlotId }) => {
    neighbours.get(PlotId)?.add(AdjacentPlotId);
    neighbours.get(AdjacentPlotId)?.add(PlotId);
  });
  const reached = new Set([plotIds[0]]);
  const queue = [plotIds[0]];
  while (queue.length) {
    const id = queue.shift();
    for (const next of neighbours.get(id) || []) {
      if (!reached.has(next)) { reached.add(next); queue.push(next); }
    }
  }
  if (reached.size !== plotIds.length) {
    throw new CrmCreationError("Selected plots must form one connected adjacent group", 409);
  }
}

async function validatePlotSelection(pool, plotIds, { projectId = null, applicationId = null, requireAdjacent = true } = {}) {
  if (!plotIds.length) return [];
  const requestedProjectId = projectId != null && projectId !== "" ? Number(projectId) : null;
  const result = await pool.request()
    .input("applicationId", sql.Int, applicationId)
    .query(`
      SELECT p.Id, p.PlotName, p.ProjectId, p.BlockId
      FROM dbo.PlotMaster p
      WHERE p.Id IN (${plotIds.join(",")}) AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmBookingPlot bp
          JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
          WHERE bp.PlotId = p.Id AND bp.Status = N'Active'
            AND b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
        )
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmApplicationPlot ap
          JOIN dbo.CrmApplication a ON a.Id = ap.ApplicationId
          WHERE ap.PlotId = p.Id AND ap.Status = N'Active'
            AND (@applicationId IS NULL OR ap.ApplicationId <> @applicationId)
            AND a.IsActive = 1 AND a.Status NOT IN (N'Rejected', N'Cancelled', N'Expired', N'Converted')
        )
    `);
  if (result.recordset.length !== plotIds.length) {
    throw new CrmCreationError("One or more selected plots are unavailable", 409);
  }
  const first = result.recordset[0];
  if (!result.recordset.every((plot) => plot.ProjectId === first.ProjectId && plot.BlockId === first.BlockId)) {
    throw new CrmCreationError("Selected plots must belong to the same project and block", 400);
  }
  if (requestedProjectId != null && first.ProjectId !== requestedProjectId) {
    throw new CrmCreationError("Selected plots do not belong to the application project", 400);
  }
  if (requireAdjacent) await assertConnectedPlotGroup(pool, plotIds);
  return result.recordset;
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
  // Mobile is optional now (business decision) — without one there's simply
  // no phone number to dedupe against, so this just skips straight to
  // creating a new Customer instead of returning null and leaving the
  // caller's Application unlinked from any Customer record at all.
  if (mobile) {
    const existing = await pool.request().input("mob", sql.NVarChar(20), mobile)
      .query("SELECT Id FROM dbo.CrmCustomer WHERE Mobile = @mob AND IsActive = 1");
    if (existing.recordset.length) return existing.recordset[0].Id;
  }

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
  // Mobile is no longer mandatory (business decision) — a raw walk-in
  // creation (no CustomerId, no LeadId) still needs SOME way to identify
  // who the applicant is, so ApplicantName alone is the minimum.
  if (!b.CustomerId && !b.LeadId && !b.ApplicantName?.trim())
    throw new CrmCreationError("Either CustomerId, LeadId, or ApplicantName is required");
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
  let customerId = b.CustomerId !== undefined && b.CustomerId !== null && b.CustomerId !== "" ? parseInt(b.CustomerId) : null;
  let customerRow = null;
  if (customerId != null) {
    const cr = await pool.request().input("cid", sql.Int, customerId)
      .query("SELECT CustomerNo, CustomerName, Mobile, AltMobile, Email FROM dbo.CrmCustomer WHERE Id = @cid AND IsActive = 1");
    if (!cr.recordset.length) throw new CrmCreationError("Selected customer does not exist");
    customerRow = cr.recordset[0];
    // CrmApplication.ApplicantName is NOT NULL, and Customer Name is still
    // mandatory on the Customers form — so a customer missing it can only
    // mean a pre-existing legacy/corrupted record. Mobile is deliberately
    // NOT checked here any more: it's an optional field end-to-end now
    // (CrmCustomer.Mobile and CrmApplication.Mobile are both nullable —
    // see migration 445), so a customer with no mobile is normal, expected
    // data, not something to block on.
    if (!customerRow.CustomerName?.trim() && !b.ApplicantName?.trim() && !prefill.CustomerName?.trim()) {
      throw new CrmCreationError(
        `Customer ${customerRow.CustomerNo || customerId} has no name on file — add one on the Customers page before creating an application.`
      );
    }
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

  const platformId = b.PlatformId !== undefined && b.PlatformId !== null && b.PlatformId !== "" ? parseInt(b.PlatformId) : (prefill.PlatformId != null ? prefill.PlatformId : null);
  const campaignId = b.CampaignId !== undefined && b.CampaignId !== null && b.CampaignId !== "" ? parseInt(b.CampaignId) : (prefill.CampaignId != null ? prefill.CampaignId : null);
  const adId       = b.AdId       !== undefined && b.AdId       !== null && b.AdId       !== "" ? parseInt(b.AdId)       : (prefill.AdId       != null ? prefill.AdId       : null);
  const channelPartnerId = b.ChannelPartnerId !== undefined && b.ChannelPartnerId !== null && b.ChannelPartnerId !== "" ? parseInt(b.ChannelPartnerId) : (prefill.ChannelPartnerId != null ? prefill.ChannelPartnerId : null);
  const bridge = (b.BrokerId === undefined || b.BrokerId === null || b.BrokerId === "") && channelPartnerId != null
    ? await ensureBrokerForChannelPartner(pool, channelPartnerId, actorUserId)
    : null;
  const brokerId = b.BrokerId !== undefined && b.BrokerId !== null && b.BrokerId !== "" ? parseInt(b.BrokerId) : (bridge?.brokerId != null ? bridge.brokerId : null);
  const brokerageRatePercent = b.BrokerageRatePercent != null && b.BrokerageRatePercent !== ""
    ? parseFloat(b.BrokerageRatePercent)
    : (bridge?.commissionRate ?? null);

  const sourceError = await validateSourceChain(pool, { PlatformId: platformId, CampaignId: campaignId, AdId: adId });
  if (sourceError) throw new CrmCreationError(sourceError);

  let projectName = b.InterestedProject || null;
  let companyId = b.CompanyId !== undefined && b.CompanyId !== null && b.CompanyId !== "" ? parseInt(b.CompanyId) : null;
  if (b.ProjectId !== undefined && b.ProjectId !== null && b.ProjectId !== "") {
    const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
      .query("SELECT name, company_id FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
    if (!proj.recordset.length) throw new CrmCreationError("Selected project does not exist");
    projectName = proj.recordset[0].name;
    companyId = companyId != null ? companyId : (proj.recordset[0].company_id != null ? proj.recordset[0].company_id : null);
  }
  const hasValue = (v) => v !== undefined && v !== null && v !== "";
  const rawAppPlotIds = Array.isArray(b.PreferredPlotIds) ? b.PreferredPlotIds.map(Number).filter(Number.isInteger) : [];
  const rawAppUnitIds = Array.isArray(b.PreferredUnitIds) && b.PreferredUnitIds.length > 0 ? b.PreferredUnitIds : (hasValue(b.PreferredUnitId) ? [b.PreferredUnitId] : []);
  const preferredUnitId = rawAppUnitIds.length > 0 ? rawAppUnitIds[0] : null;
  if (rawAppUnitIds.length > 0) {
    await assertVillaBuyer(pool, rawAppUnitIds, customerId);
    await assertCommercialGst(pool, rawAppUnitIds);
  }
  let unitName = b.InterestedUnit || null;
  if (rawAppPlotIds.length > 0) {
    const plots = await validatePlotSelection(pool, rawAppPlotIds, { projectId: b.ProjectId });
    unitName = rawAppPlotIds.map((id) => plots.find((p) => p.Id === id)?.PlotName).filter(Boolean).join(", ");
  }
  if (preferredUnitId !== undefined && preferredUnitId !== null && preferredUnitId !== "") {
    const unit = await pool.request().input("uid", sql.Int, parseInt(preferredUnitId))
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
      await assertEntityNotTaken(pool, "Unit", parseInt(preferredUnitId));
    } catch (takenErr) {
      throw new CrmCreationError(takenErr.message, takenErr.status || 409);
    }
    const existingHold = await findActiveHold(pool, "Unit", parseInt(preferredUnitId));
    if (existingHold) {
      throw new CrmCreationError("This unit already has an active hold from another application", 409);
    }
  }
  // A plot sale has no payment plan: land is paid as booking amount + balance
  // (see landSaleSchedule), not in construction stages.
  const effectivePaymentPlanId = rawAppPlotIds.length > 0
    ? null
    : await resolveApplicationPaymentPlan(pool, {
    preferredUnitId: preferredUnitId !== undefined && preferredUnitId !== null && preferredUnitId !== "" ? parseInt(preferredUnitId) : null,
    paymentPlanId: b.PaymentPlanId !== undefined && b.PaymentPlanId !== null && b.PaymentPlanId !== "" ? b.PaymentPlanId : null,
  });

  // Last-line defense: CrmApplication.ApplicantName is NOT NULL, but every
  // upstream source (an existing Customer, a Lead's own prefill, or the raw
  // request body) can independently end up blank — the branch above already
  // guards the "existing Customer selected" case with a specific message,
  // but the Lead-only path (no CustomerId, a Lead whose own name is
  // somehow blank) reaches here unguarded. Checking the actual final value
  // right before the INSERT, once, covers every path instead of duplicating
  // the same check per branch. Mobile is deliberately NOT checked here —
  // it's optional end-to-end now (see migration 445).
  const finalName = customerRow?.CustomerName || b.ApplicantName?.trim() || prefill.CustomerName;
  const finalMobile = customerRow?.Mobile || b.Mobile?.trim() || prefill.Mobile || null;
  if (!finalName?.trim()) throw new CrmCreationError("Applicant name is required — this booking's customer/lead record has no name on file");

  const appNo = await getNextDocNumber(pool, "APP", "APP");
  let result;
  try {
    result = await pool.request()
      .input("no",   sql.NVarChar(30),  appNo)
      .input("lid",  sql.Int,           b.LeadId !== undefined && b.LeadId !== null && b.LeadId !== "" ? parseInt(b.LeadId)   : null)
      .input("custid", sql.Int,         customerId)
      .input("name", sql.NVarChar(200), finalName)
      .input("mob",  sql.NVarChar(20),  finalMobile)
      .input("alt",  sql.NVarChar(20),  customerRow?.AltMobile || b.AltMobile || prefill.AltMobile || null)
      .input("em",   sql.NVarChar(200), customerRow?.Email     || b.Email     || prefill.Email     || null)
      .input("pid",  sql.Int,           b.ProjectId !== undefined && b.ProjectId !== null && b.ProjectId !== "" ? parseInt(b.ProjectId) : null)
      .input("uid",  sql.Int,           preferredUnitId !== undefined && preferredUnitId !== null && preferredUnitId !== "" ? parseInt(preferredUnitId) : null)
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
      .input("rate", sql.Decimal(18,2), b.RatePerSqFt != null && b.RatePerSqFt !== "" ? parseFloat(b.RatePerSqFt) : null)
      .input("doa",  sql.Date,          b.DateOfApply || null)
      .input("ppid", sql.Int,           effectivePaymentPlanId != null ? effectivePaymentPlanId : null)
      .input("ttype",sql.NVarChar(20),  b.TokenType || null)
      .input("tval", sql.Decimal(18,2), b.TokenValue != null && b.TokenValue !== "" ? parseFloat(b.TokenValue) : null)
      .input("bamt", sql.Decimal(18,2), b.BookingAmount != null && b.BookingAmount !== "" ? parseFloat(b.BookingAmount) : null)
      .input("pmode",sql.NVarChar(50),  b.PaymentMode || null)
      // AssignedTo respects an explicit caller value (saHandoff.js passes
      // the lead's already-routed salesperson) or falls back to whoever
      // created the record. crmApplications.js's own POST route enforces
      // the stricter "self-assign, no client override" rule for the human-
      // filed Application form specifically — this shared function stays
      // permissive so the SA->CRM handoff's existing assignment logic keeps
      // working unchanged.
      .input("asgn", sql.Int,           b.AssignedTo !== undefined && b.AssignedTo !== null && b.AssignedTo !== "" ? parseInt(b.AssignedTo) : actorUserId)
      .input("asgnby", sql.Int,         b.AssignedBy !== undefined && b.AssignedBy !== null && b.AssignedBy !== "" ? parseInt(b.AssignedBy) : actorUserId)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("refApp", sql.Int,         b.ReferredByApplicationId !== undefined && b.ReferredByApplicationId !== null && b.ReferredByApplicationId !== "" ? parseInt(b.ReferredByApplicationId) : null)
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
  if (rawAppUnitIds.length > 0) {
    for (const uid of rawAppUnitIds) {
      await pool.request()
        .input('aid', sql.Int, applicationId)
        .input('uid', sql.Int, parseInt(uid))
        .input('pri', sql.Bit, uid === preferredUnitId ? 1 : 0)
        .query("INSERT INTO dbo.CrmApplicationUnit (ApplicationId, UnitId, Status, IsPrimary, CreatedAt) VALUES (@aid, @uid, 'Active', @pri, SYSDATETIME())");
    }
  }
  if (rawAppPlotIds.length > 0) {
    for (let i = 0; i < rawAppPlotIds.length; i++) {
      await pool.request()
        .input("aid", sql.Int, applicationId).input("pid", sql.Int, rawAppPlotIds[i])
        .input("pri", sql.Bit, i === 0 ? 1 : 0)
        .query("INSERT INTO dbo.CrmApplicationPlot (ApplicationId, PlotId, Status, IsPrimary, CreatedAt) VALUES (@aid, @pid, 'Active', @pri, SYSDATETIME())");
    }
  }
  if (preferredUnitId) {
    try {
      await placeHoldIfNeeded(pool, {
        entityType: "Unit", entityId: parseInt(preferredUnitId), applicationId, holdDays: 3,
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
// A plot sale's schedule. No payment plan applies to land: the customer pays
// the Booking Amount (if one was taken) and then the balance. Every rupee is
// due from the start, unlike a plan schedule that waits for a Booking Amount.
function landSaleSchedule(totalValue, bookingAmount) {
  const total = Math.round(Number(totalValue) * 100) / 100;
  const booking = Math.min(total, Math.max(0, Math.round(Number(bookingAmount || 0) * 100) / 100));
  if (booking <= 0 || booking >= total) return [{ no: 1, name: "Full Payment", amount: total, dept: "Sales" }];
  return [
    { no: 1, name: "Booking", amount: booking, dept: "Sales", docs: "Booking Receipt" },
    { no: 2, name: "Balance", amount: Math.round((total - booking) * 100) / 100, dept: "Sales" },
  ];
}

// Re-shares a booking's TotalValue across its active lines (plots or units)
// pro-rata by area — the same allocation booking creation uses. Called
// whenever TotalValue changes after creation; without it the line values
// keep the old total, and everything that reads them (the land / built
// split behind GST and the sale ledger) disagrees with the booking.
async function reallocateBookingLines(poolOrTx, bookingId, totalValue) {
  for (const table of ["CrmBookingPlot", "CrmBookingUnit"]) {
    const lines = (await poolOrTx.request().input("bid", sql.Int, bookingId).query(
      `SELECT Id, AreaSqFt FROM dbo.${table} WHERE BookingId = @bid AND Status = N'Active' ORDER BY Id`)).recordset;
    if (!lines.length) continue;
    const parts = allocateConsideration({
      lines: lines.map((l) => ({ unitId: l.Id, areaSqFt: l.AreaSqFt })),
      totalConsideration: Number(totalValue),
    });
    for (const part of parts) {
      await poolOrTx.request().input("id", sql.Int, part.unitId).input("v", sql.Decimal(18, 2), part.allocatedValue)
        .query(`UPDATE dbo.${table} SET AllocatedValue = @v WHERE Id = @id`);
    }
  }
}

// A plot sale's schedule is always derived, never hand-shaped: Booking
// Amount + Balance (or one Full Payment) of the booking's current TotalValue.
// So whenever the value or the Booking Amount changes, the schedule is
// rebuilt from those two figures — as long as no money has been recorded
// against it. Returns { rebuilt, reason }. Parking / extra-charge rows are
// separate line items and are never touched.
async function rebuildLandSchedule(poolOrTx, bookingId, actorUserId = null) {
  const bk = (await poolOrTx.request().input("bid", sql.Int, bookingId).query(`
    SELECT b.TotalValue, b.BookingAmount, b.BookingDate,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id) THEN 1 ELSE 0 END AS IsPlotSale
    FROM dbo.CrmBooking b WHERE b.Id = @bid`)).recordset[0];
  if (!bk || !bk.IsPlotSale) return { rebuilt: false, reason: "not a plot sale" };
  const touched = (await poolOrTx.request().input("bid", sql.Int, bookingId).query(`
    SELECT COUNT(*) AS n FROM dbo.CrmPaymentMilestone
    WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL
      AND (ISNULL(AmountPaid, 0) > 0 OR Status IN (N'Paid', N'Waived'))`)).recordset[0].n;
  if (touched) return { rebuilt: false, reason: "money is already recorded against the schedule" };
  await poolOrTx.request().input("bid", sql.Int, bookingId).query(`
    DELETE FROM dbo.CrmPaymentMilestone
    WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL`);
  await generateMilestonesForBooking(poolOrTx, bookingId, Number(bk.TotalValue), null, bk.BookingDate, actorUserId, Number(bk.BookingAmount || 0));
  return { rebuilt: true };
}

async function generateMilestonesForBooking(poolOrTx, bookingId, totalValue, paymentPlanId, bookingDate, actorUserId, bookingAmount = 0) {
  if (!totalValue || totalValue <= 0) return;
  const plotLine = await poolOrTx.request().input("bid", sql.Int, bookingId)
    .query("SELECT TOP 1 1 AS x FROM dbo.CrmBookingPlot WHERE BookingId = @bid");
  if (plotLine.recordset.length) {
    const due = bookingDate ? new Date(bookingDate) : new Date();
    for (const m of landSaleSchedule(totalValue, bookingAmount)) {
      await poolOrTx.request()
        .input("bid",  sql.Int,           bookingId)
        .input("mno",  sql.Int,           m.no)
        .input("mname",sql.NVarChar(200), m.name)
        .input("amt",  sql.Decimal(18,2), m.amount)
        .input("pct",  sql.Decimal(5,2),  Math.round((m.amount / totalValue) * 10000) / 100)
        .input("due",  sql.Date,          due)
        .input("rdocs",sql.NVarChar(sql.MAX), m.docs || null)
        .input("dept", sql.NVarChar(100), m.dept || null)
        .input("cb",   sql.Int,           actorUserId)
        .query(`
          INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, [Percent], DueDate, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
          VALUES (@bid, @mno, @mname, @amt, @pct, @due, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
        `);
    }
    return;
  }
  let milestones;
  // Booking Amount is now set on the Payment Plan itself (at plan-creation
  // time), not typed fresh per booking — see CrmPaymentPlans.tsx. When the
  // booking is tagged to a plan, that plan's BookingAmount is authoritative
  // and overrides whatever the Booking/Application form happened to send;
  // the `bookingAmount` parameter only still matters as a fallback for
  // bookings with no tagged plan (DEFAULT_MILESTONES) or a legacy plan saved
  // before this field existed (BookingAmount IS NULL).
  if (paymentPlanId !== null && paymentPlanId !== undefined) {
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
  // preferredUnitId/paymentPlanId are real IDENTITY values, which are never
  // guaranteed to start at 1 — this codebase has already hit rows sitting at
  // Id 0 once (CrmCustomer, migrations 441-443), and CrmPaymentPlanTemplate
  // has one too. A plain `!x`/`x || y` check treats 0 the same as
  // null/undefined/"" in JS, which silently discarded a genuinely-selected
  // plan and is exactly what caused bookings to fail with "must be tagged"
  // even though the plan was correctly chosen and tagged. Every check here
  // uses an explicit null/undefined/"" test so 0 survives as a real id.
  const hasId = (v) => v !== null && v !== undefined && v !== "";
  if (!hasId(preferredUnitId)) return null;

  const unitRow = await pool.request().input("uid", sql.Int, preferredUnitId)
    .query("SELECT BlockId, ProjectId FROM dbo.UnitMaster WHERE Id = @uid");
  const { BlockId, ProjectId } = unitRow.recordset[0] || {};

  const applicable = await getApplicablePaymentPlans(pool, { unitId: preferredUnitId, blockId: BlockId, projectId: ProjectId });
  const applicableIds = applicable.map((r) => r.Id);

  if (!hasId(paymentPlanId)) {
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

const { priceBooking, allocateConsideration } = require("./bookingUnits");

async function createCrmBookingRecord(pool, b, actorUserId) {
  if (!b.ApplicationId) throw new CrmCreationError("ApplicationId is required");
  const rawPlotIds = Array.isArray(b.PlotIds) && b.PlotIds.length > 0 ? b.PlotIds : [];
  const rawUnitIds = Array.isArray(b.UnitIds) && b.UnitIds.length > 0 ? b.UnitIds : (b.UnitId ? [b.UnitId] : []);
  const isPlotBooking = rawPlotIds.length > 0;
  if (!isPlotBooking && rawUnitIds.length === 0) throw new CrmCreationError("UnitId or UnitIds is required — at least one unit must be selected");
  const unitIds = (isPlotBooking ? rawPlotIds : rawUnitIds).map((id) => parseInt(id));
  if (!unitIds.every(Number.isInteger) || new Set(unitIds).size !== unitIds.length) {
    throw new CrmCreationError("Select one or more distinct valid plots or units");
  }

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
    .query("SELECT Status, IsActive, PaymentPlanId, BrokerId, BrokerageRatePercent, BrokeragePaymentPlan, ChannelPartnerId, CustomerId FROM dbo.CrmApplication WHERE Id = @aid");
  if (!appRow.recordset.length) throw new CrmCreationError("Application not found");
  const deadApplicationStatuses = ["Rejected", "Cancelled", "Expired"];
  if (appRow.recordset[0].IsActive === false || deadApplicationStatuses.includes(appRow.recordset[0].Status)) {
    throw new CrmCreationError(
      `A Booking can't be created for an application that is ${appRow.recordset[0].Status}`, 400);
  }

  if (isPlotBooking) {
    await validatePlotSelection(pool, unitIds, { applicationId: parseInt(b.ApplicationId) });
  } else {
    await assertVillaBuyer(pool, unitIds, appRow.recordset[0].CustomerId);
    await assertCommercialGst(pool, unitIds);
  }

  // Fetch all selected units
  const unitsRes = await pool.request().query(isPlotBooking ? `
    SELECT p.Id, p.PlotName AS UnitName, p.ProjectId, p.BlockId, CAST(NULL AS NVARCHAR(50)) AS UnitType,
           p.AreaSqFt, p.RatePerSqFt, proj.name AS ProjectName, proj.company_id AS CompanyId, blk.BlockName
    FROM dbo.PlotMaster p
    LEFT JOIN dbo.enterprise proj ON proj.id = p.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = p.BlockId
    WHERE p.Id IN (${unitIds.join(",")}) AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
  ` : `
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.UnitKind, u.AreaSqFt,
           u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
           proj.name AS ProjectName, proj.company_id AS CompanyId,
           blk.BlockName
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
    WHERE u.Id IN (${unitIds.join(",")}) AND u.IsActive = 1
  `);
  if (unitsRes.recordset.length !== unitIds.length) {
    throw new CrmCreationError("One or more selected units do not exist or are inactive");
  }
  // Order to match input array (primary is first)
  const unitRows = unitIds.map((id) => unitsRes.recordset.find((u) => u.Id === id));
  const unitRow = unitRows[0]; // Primary unit provides the descriptive fields

  // The project / block type decides what may be sold and whether several
  // units can share one booking (Project Type Master flags).
  {
    const { bookingTypeViolation, loadLandKinds, loadCommercialKinds } = require("./projectType");
    const why = await bookingTypeViolation(pool, unitRows, {
      isPlotBooking,
      landKinds: await loadLandKinds(pool),
      commercialKinds: await loadCommercialKinds(pool),
    });
    if (why) throw new CrmCreationError(why);
  }

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
  const bookingBridge = (b.BrokerId === undefined || b.BrokerId === null || b.BrokerId === "") && application.BrokerId == null && application.ChannelPartnerId != null
    ? await ensureBrokerForChannelPartner(pool, application.ChannelPartnerId, actorUserId)
    : null;
  const bookingBrokerId = b.BrokerId !== undefined && b.BrokerId !== null && b.BrokerId !== "" ? parseInt(b.BrokerId) : (application.BrokerId != null ? application.BrokerId : (bookingBridge?.brokerId != null ? bookingBridge.brokerId : null));
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
  for (const uid of (isPlotBooking ? [] : unitIds)) {
    await guardAndConvertHold(pool, "Unit", uid, parseInt(b.ApplicationId));
  }

  // The Application already went through the mandatory-plan-selection gate
  // (see resolveApplicationPaymentPlan in createCrmApplicationRecord / the
  // PUT /:id route) — its own PaymentPlanId is the real, staff-confirmed
  // choice, so that's the fallback here rather than re-deriving one. An
  // explicit b.PaymentPlanId still wins if the caller is deliberately
  // changing it at booking time.
  const hasId = (v) => v !== null && v !== undefined && v !== "";
  const effectivePaymentPlanId = isPlotBooking
    ? null
    : await resolveApplicationPaymentPlan(pool, {
    preferredUnitId: unitRow.Id,
    paymentPlanId: hasId(b.PaymentPlanId) ? b.PaymentPlanId : (hasId(appRow.recordset[0].PaymentPlanId) ? appRow.recordset[0].PaymentPlanId : null),
  });

  // Calculate pricing using the combined multi-unit apportionment logic.
  // Rate: request body wins (editable at booking time); falls back to primary unit's defined rate.
  const userRate = b.RatePerSqFt != null && b.RatePerSqFt !== "" ? parseFloat(b.RatePerSqFt)
                 : unitRow.RatePerSqFt != null ? Number(unitRow.RatePerSqFt) : null;

  const linesInput = unitRows.map((u) => ({
    unitId: u.Id,
    areaSqFt: u.AreaSqFt,
  }));
  const pricing = priceBooking({ lines: linesInput, ratePerSqFt: userRate });

  // If a manual TotalValue was typed, it overrides the computed sum, but we
  // still use the combined area.
  const area  = b.AreaSqFt != null && b.AreaSqFt !== "" ? parseFloat(b.AreaSqFt) : pricing.combinedArea;
  const rate  = userRate;
  const total = b.TotalValue != null && b.TotalValue !== "" ? parseFloat(b.TotalValue) : pricing.total;
  
  const tokenType = b.TokenType === "Amount" ? "Amount" : "Percentage";
  const tokenValue = b.TokenValue != null && b.TokenValue !== "" ? parseFloat(b.TokenValue) : null;
  // Booking Amount is ALWAYS the fixed ₹ figure set on the tagged Payment
  // Plan itself (see CrmPaymentPlans.tsx) — never derived from a % of
  // TotalValue, and never taken from the Booking form's own Token%/manual
  // field. TokenType/TokenValue are still recorded below purely as a
  // historical/display record of what was originally quoted — they no
  // longer feed into the actual ₹ figure that gets deducted. A plan
  // without a fixed BookingAmount set (e.g. an old plan saved before this
  // field existed) can no longer produce a booking via a silent %
  // fallback — staff must open the plan and set one first.
  // A plot sale has no payment plan — its Booking Amount is the figure
  // entered on the application, and the balance is one further milestone.
  let bookingAmount;
  if (isPlotBooking) {
    // The application form records it as the Token (Booking) Amount in ₹.
    const typed = hasId(b.BookingAmount) ? Number(b.BookingAmount) : (hasId(b.TokenValue) ? Number(b.TokenValue) : 0);
    if (!Number.isFinite(typed) || typed < 0) throw new CrmCreationError("Booking Amount must be zero or more");
    if (typed > total) throw new CrmCreationError("Booking Amount cannot be more than the plot value");
    bookingAmount = typed;
  } else {
    if (effectivePaymentPlanId === null || effectivePaymentPlanId === undefined) {
      throw new CrmCreationError("A Payment Plan must be tagged to this unit before a Booking can be created — Booking Amount can only come from the plan.");
    }
    const planRes = await pool.request().input("pid", sql.Int, parseInt(effectivePaymentPlanId))
      .query("SELECT PlanName, BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid");
    const planRow = planRes.recordset[0];
    if (!planRow || planRow.BookingAmount == null) {
      throw new CrmCreationError(`Payment Plan "${planRow?.PlanName || effectivePaymentPlanId}" has no fixed Booking Amount set — open it in Payment Plan Master and set one before booking this unit.`);
    }
    bookingAmount = Number(planRow.BookingAmount);
  }

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
      .query(`SELECT Id FROM dbo.${isPlotBooking ? "CrmBookingPlot" : "CrmBookingUnit"} WITH (UPDLOCK, ROWLOCK) WHERE ${isPlotBooking ? "PlotId" : "UnitId"} IN (${unitIds.join(",")}) AND Status = N'Active'`);
    if (taken.recordset.length) throw new CrmCreationError("One or more units are already booked", 409);

    const result = await tx.request()
      .input("no",    sql.NVarChar(30),  bookingNo)
      .input("appId", sql.Int,           parseInt(b.ApplicationId))
      .input("uid",   sql.Int,           isPlotBooking ? null : unitRow.Id)
      .input("pid",   sql.Int,           unitRow.ProjectId != null ? unitRow.ProjectId : null)
      .input("pname", sql.NVarChar(200), unitRow.ProjectName || b.ProjectName || null)
      .input("cid",   sql.Int,           unitRow.CompanyId != null ? unitRow.CompanyId : null)
      // Name concatenates multiple unit names if there are several
      .input("unit",  sql.NVarChar(100), unitRows.map(u => u.UnitName).join(", "))
      .input("blk",   sql.NVarChar(100), unitRow.BlockName || b.BlockName || null)
      .input("blkid", sql.Int,           unitRow.BlockId != null ? unitRow.BlockId : null)
      .input("flr",   sql.NVarChar(100), b.FloorName   || null)
      .input("utype", sql.NVarChar(100), unitRow.UnitType || b.UnitType || null)
      .input("area",  sql.Decimal(18,2), area)
      .input("carpetArea",      sql.Decimal(18,2), unitRow.CarpetAreaSqFt != null ? Number(unitRow.CarpetAreaSqFt) : null)
      .input("builtUpArea",     sql.Decimal(18,2), unitRow.BuiltUpAreaSqFt != null ? Number(unitRow.BuiltUpAreaSqFt) : null)
      .input("superBuiltUpArea", sql.Decimal(18,2), unitRow.SuperBuiltUpAreaSqFt != null ? Number(unitRow.SuperBuiltUpAreaSqFt) : null)
      .input("openTerraceArea", sql.Decimal(18,2), unitRow.OpenTerraceAreaSqFt != null ? Number(unitRow.OpenTerraceAreaSqFt) : null)
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
          (BookingNo, ApplicationId, UnitId, ProjectId, ProjectName, CompanyId, UnitNo, BlockName, BlockId, FloorName, UnitType,
           AreaSqFt, CarpetAreaSqFt, BuiltUpAreaSqFt, SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt,
           RatePerSqFt, TotalValue, BookingAmount, TokenType, TokenValue, PaymentPlanId,
           BookingDate, PaymentMode, AssignedTo, Status, Notes, IsActive,
           ParkingTotal, ExtraChargesTotal, GrandTotal, CreatedBy, CreatedAt,
           BrokerId, BrokerageRatePercent, BrokeragePaymentPlan, ConfirmDeadline)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @appId, @uid, @pid, @pname, @cid, @unit, @blk, @blkid, @flr, @utype,
           @area, @carpetArea, @builtUpArea, @superBuiltUpArea, @openTerraceArea,
           @rate, @tot, @bamt, @ttype, @tval, @ppid,
           ISNULL(@bdate, CAST(SYSDATETIME() AS DATE)), @pmode,
           @asgn, 'Pending', @note, 1,
           0, 0, ISNULL(@tot, 0), @cb, SYSDATETIME(),
           @brkid, @brkpct, @brkplan, @cdl)
      `);

    bookingId = result.recordset[0].Id;

    // Insert unit lines (Migration 505 support for multi-plot sales)
    // Primary flag set on the first unit in the array.
    //
    // When staff type a negotiated lump sum, the booking stores THAT total
    // (see `total` above) — so the per-line values must be apportioned from it,
    // not left at what rate x area would have produced. Otherwise each plot's
    // AllocatedValue — the figure its own conveyance deed and stamp duty are
    // drawn from — no longer sums to the agreement value a sub-registrar will
    // compare it against, and with no rate entered at all every line was 0.
    // allocateConsideration splits pro-rata by area and reconciles to the paisa.
    const manualTotal = b.TotalValue != null && b.TotalValue !== "";
    const lineValues = manualTotal
      ? allocateConsideration({ lines: linesInput, totalConsideration: total }).map((l) => l.allocatedValue)
      : pricing.lines.map((l) => l.allocatedValue);
    for (let i = 0; i < pricing.lines.length; i++) {
      const line = { ...pricing.lines[i], allocatedValue: lineValues[i] };
      await tx.request()
        .input("bid", sql.Int, bookingId)
        .input("uid", sql.Int, line.unitId)
        .input("area", sql.Decimal(18,2), line.areaSqFt)
        .input("rate", sql.Decimal(18,2), line.ratePerSqFt)
        .input("premium", sql.Decimal(18,2), line.premiumAmount)
        .input("alloc", sql.Decimal(18,2), line.allocatedValue)
        .input("cb", sql.Int, actorUserId)
        .input("isp", sql.Bit, i === 0 ? 1 : 0)
        .query(`
          INSERT INTO dbo.${isPlotBooking ? "CrmBookingPlot" : "CrmBookingUnit"}
            (BookingId, ${isPlotBooking ? "PlotId" : "UnitId"}, AreaSqFt, RatePerSqFt, PremiumAmount, AllocatedValue, Status, IsPrimary, CreatedBy, CreatedAt)
          VALUES
            (@bid, @uid, @area, @rate, @premium, @alloc, N'Active', @isp, @cb, SYSDATETIME())
        `);
    }


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
    WHERE h.EntityType = 'Parking' AND h.ApplicationId = @aid AND h.Status = 'Active'
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
      if (rate.recordset.length) {
        await applyAddParking(pool, bookingId, {
          ParkingMasterId: rate.recordset[0].Id, ParkingSlotId: hold.ParkingSlotId, Quantity: 1,
          RateOverride: hold.RateOverride,
        }, actorUserId);
      } else if (hold.RateOverride != null) {
        // Unrated type — no ParkingMaster row; use the price staff entered in the wizard.
        await applyAddParking(pool, bookingId, {
          ParkingType, ParkingSlotId: hold.ParkingSlotId, Quantity: 1,
          Charge: hold.RateOverride, GstRate: 0,
        }, actorUserId);
      }
      // No rate AND no override: hold can't be converted — log and skip.
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
  generateMilestonesForBooking, landSaleSchedule, reallocateBookingLines, rebuildLandSchedule, resolveApplicationPaymentPlan, getApplicablePaymentPlans, validatePlotSelection,
};

