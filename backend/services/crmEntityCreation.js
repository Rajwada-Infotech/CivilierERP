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
const { CrmStatus, REFUND_CLOSED_SQL, PROPERTY_CHANGE_CLOSED_SQL, UnitChangeStatus } = require("../constants/crmStatuses");
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
  const req = pool.request();
  plotIds.forEach((id, i) => req.input(`cpid${i}`, sql.Int, id));
  const inList = plotIds.map((_, i) => `@cpid${i}`).join(",");
  const pairs = await req.query(`
    SELECT PlotId, AdjacentPlotId FROM dbo.PlotAdjacency
    WHERE PlotId IN (${inList}) AND AdjacentPlotId IN (${inList})
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
  const pReq = pool.request().input("applicationId", sql.Int, applicationId);
  plotIds.forEach((id, i) => pReq.input(`ppid${i}`, sql.Int, id));
  const plotInList = plotIds.map((_, i) => `@ppid${i}`).join(",");
  const result = await pReq.query(`
      SELECT p.Id, p.PlotName, p.ProjectId, p.BlockId
      FROM dbo.PlotMaster p
      WHERE p.Id IN (${plotInList}) AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM dbo.CrmBookingPlot bp
          JOIN dbo.CrmBooking b ON b.Id = bp.BookingId
          WHERE bp.PlotId = p.Id AND bp.Status = N'Active'
            AND b.IsActive = 1 AND b.Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}
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
      .query(`SELECT UnitName,
                CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmConstructedAssetKind k WHERE k.Code = UnitKind AND k.IsLand = 1) THEN 1 ELSE 0 END AS IsLand
              FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1`);
    if (!unit.recordset.length) throw new CrmCreationError("Selected unit does not exist or is inactive");
    // Land is sold through the plot list (CrmApplicationPlot), never as a unit.
    if (unit.recordset[0].IsLand) throw new CrmCreationError("This is land — choose it from the plot list, not as a unit.");
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
      .input("rate", rateSqlType(), b.RatePerSqFt != null && b.RatePerSqFt !== "" ? parseFloat(b.RatePerSqFt) : null)
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
  // The plot's owner applying for the villa on it brings the plot's co-owners along.
  if (rawAppUnitIds.length > 0) {
    await require("./villaLand").copyLandCoOwners(pool, applicationId, rawAppUnitIds, actorUserId);
  }
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
        entityType: "Unit", entityId: parseInt(preferredUnitId), applicationId,
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

/**
 * The schedule a payment plan gives at a Grand Total: Milestone 1 is the plan's
 * fixed Booking Amount, the other steps share what's left by their %. It is
 * exactly what booking creation stores (generateMilestonesForBooking, then
 * recalculateRemainingMilestones, which split with the same apportion) — the
 * application form shows this so its preview and the real schedule agree.
 * A plot sale's schedule is landSaleSchedule's instead.
 */
function planSchedule(grandTotal, bookingAmount, items) {
  const { apportion, round2 } = require("./bookingUnits");
  const list = (items && items.length ? items : DEFAULT_MILESTONES).slice().sort((x, y) => x.no - y.no);
  const booking = Math.max(0, round2(Number(bookingAmount || 0)));
  const rest = list.filter((m) => m.no !== 1);
  const shares = apportion(Math.max(0, round2(Number(grandTotal || 0) - booking)), rest.map((m) => Number(m.pct)));
  let i = 0;
  return list.map((m) => ({ no: m.no, name: m.name, pct: m.no === 1 ? null : Number(m.pct), amount: m.no === 1 ? booking : shares[i++] }));
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
    // Milestone 1 is the plan's fixed Booking Amount. A zero Booking Amount
    // means that step is already satisfied with no payment; later milestones
    // still need real due amounts or the schedule would be all zero and block
    // every subsequent payment forever.
    const amt = isFirst ? bookingAmt : Math.round(totalValue * m.pct) / 100;
    const pct = isFirst ? (totalValue > 0 ? Math.round((bookingAmt / totalValue) * 10000) / 100 : 0) : m.pct;
    const zeroBookingStep = isFirst && bookingAmt === 0;

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
      .input("status", sql.NVarChar(30), zeroBookingStep ? CrmStatus.PAID : CrmStatus.PENDING)
      .input("demandStatus", sql.NVarChar(30), zeroBookingStep ? CrmStatus.PAID : CrmStatus.PENDING)
      .input("paidDate", sql.Date, null)
      .query(`
        INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, [Percent], DueDate, RequiredDocuments, ResponsibleDepartment, Status, DemandStatus, PaidDate, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @mno, @mname, @amt, @pct, @due, @rdocs, @dept, @status, @demandStatus, @paidDate, @cb, SYSDATETIME())
      `);
    if (isFirst) milestone1Id = ins.recordset[0].Id;
  }

  if (milestone1Id && milestones.length > 1) {
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

const { priceBooking, allocateConsideration, rateSqlType, unitPrice } = require("./bookingUnits");

// The one-booking-per-application check in createCrmBookingRecord first runs
// unlocked, so two submits at once both pass it. Inside the booking's
// transaction it is re-checked under the application's lock: the second
// waits for the first and then finds its booking.
async function assertNoBookingForApplicationLocked(tx, applicationId) {
  const appLocked = (await tx.request().input("aid", sql.Int, applicationId).query(`
    SELECT a.Id, (SELECT TOP 1 x.BookingNo FROM dbo.CrmBooking x WHERE x.ApplicationId = a.Id AND x.IsActive = 1) AS BookingNo
    FROM dbo.CrmApplication a WITH (UPDLOCK, HOLDLOCK) WHERE a.Id = @aid`)).recordset[0];
  if (appLocked?.BookingNo) {
    throw new CrmCreationError(`This application already has a booking (${appLocked.BookingNo}) — an application can only have one`, 409);
  }
}

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

  // Fetch all selected units — parameterized IN list to avoid SQL injection
  const uReq = pool.request();
  unitIds.forEach((id, i) => uReq.input(`ubid${i}`, sql.Int, id));
  const unitInList = unitIds.map((_, i) => `@ubid${i}`).join(",");
  const unitsRes = await uReq.query(isPlotBooking ? `
    SELECT p.Id, p.PlotName AS UnitName, p.ProjectId, p.BlockId, CAST(NULL AS NVARCHAR(50)) AS UnitType,
           p.AreaSqFt, p.RatePerSqFt, proj.name AS ProjectName, proj.company_id AS CompanyId, blk.BlockName
    FROM dbo.PlotMaster p
    LEFT JOIN dbo.enterprise proj ON proj.id = p.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = p.BlockId
    WHERE p.Id IN (${unitInList}) AND p.IsActive = 1 AND p.ConvertedUnitId IS NULL
  ` : `
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitType, u.UnitKind, u.AreaSqFt,
           u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
           proj.name AS ProjectName, proj.company_id AS CompanyId,
           blk.BlockName
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
    WHERE u.Id IN (${unitInList}) AND u.IsActive = 1
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

  // No auto-expiry — a Booking stays "to be confirmed" (Pending, not yet
  // Approved + Milestone #1 Paid) indefinitely until staff acts on it or
  // cancels it. Every "is this unit/parking taken" query already treats a
  // NULL ConfirmDeadline as not-yet-expired, so leaving it unset here is
  // all that's needed — no sentinel required, unlike CrmInventoryHold's
  // NOT NULL HoldUntil column.
  const confirmDeadline = null;
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
  if (!Number.isFinite(bookingAmount) || bookingAmount < 0) {
    throw new CrmCreationError("Booking Amount must be a valid non-negative number");
  }
  if (bookingAmount > total) {
    throw new CrmCreationError("Booking Amount cannot be more than the booking value");
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

    await assertNoBookingForApplicationLocked(tx, parseInt(b.ApplicationId));

    // Re-check villa land ownership inside this same transaction, right
    // before the insert — the first assertVillaBuyer check above ran on the
    // plain pool, well before this lock, so a concurrent resale/transfer of
    // the underlying plot could complete in between and leave this booking
    // going through for a buyer who no longer owns the land.
    if (!isPlotBooking) {
      await assertVillaBuyer(tx, unitIds, appRow.recordset[0].CustomerId);
    }

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
      .input("rate",  rateSqlType(), rate)
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

    // A villa sold directly on plots nobody bought carries its land in its one
    // villa price: that land part (Plot Master area x rate, at most the price)
    // is recorded so GST and the ledger keep it out of construction (552).
    if (!isPlotBooking) {
      const land = await require("./villaLand").directSaleLandValue(tx, unitIds);
      if (land > 0) {
        await tx.request().input("bid", sql.Int, bookingId)
          .input("land", sql.Decimal(18, 2), Math.min(land, Number(total) || 0))
          .query("IF COL_LENGTH('dbo.CrmBooking', 'LandValue') IS NOT NULL EXEC sp_executesql N'UPDATE dbo.CrmBooking SET LandValue = @land WHERE Id = @bid', N'@land DECIMAL(18,2), @bid INT', @land = @land, @bid = @bid");
      }
    }

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
        .input("rate", rateSqlType(), line.ratePerSqFt)
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
    // Two bookings of the same free unit / plot at the same moment: the lock
    // above can't hold rows that don't exist yet, so the second one is
    // stopped by the database's one-active-line rule instead — say so plainly.
    if ((e.number === 2601 || e.number === 2627) && /UX_CrmBooking(Unit_ActiveUnit|Plot_Active)/.test(e.message || "")) {
      // A double click on Submit lands here too — the unit is taken by this
      // same application's own booking, not by someone else.
      const own = (await pool.request().input("aid", sql.Int, parseInt(b.ApplicationId, 10))
        .query("SELECT TOP 1 BookingNo FROM dbo.CrmBooking WHERE ApplicationId = @aid AND IsActive = 1 ORDER BY Id DESC").catch(() => ({ recordset: [] }))).recordset[0];
      if (own) throw new CrmCreationError(`This application already has its booking (${own.BookingNo})`, 409);
      throw new CrmCreationError(`This ${isPlotBooking ? "plot" : "unit"} was just booked by someone else — refresh and choose another`, 409);
    }
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
    .query("SELECT TOP 1 AmountDue FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND MilestoneNo = 1 AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL ORDER BY Id");
  const firstMilestoneAmount = m1.recordset[0]?.AmountDue;
  if (firstMilestoneAmount == null) return null;
  if (Math.abs(Number(firstMilestoneAmount) - Number(bookingAmount)) < 1) return null;
  return `Booking token amount (₹${Number(bookingAmount).toLocaleString("en-IN")}) doesn't match the payment plan's first milestone (₹${Number(firstMilestoneAmount).toLocaleString("en-IN")}) — the milestone amount is what invoicing/payments will actually track.`;
}

// ── Moving a booking onto a different unit ─────────────────────────────────
// One implementation, used by the booking's own Change Unit
// (PUT /api/crm-bookings/:id/change-unit) and by an application corrected
// before its booking is verified ("Submit Edits", crmApplications.js), so a
// unit change from either side passes the same rules and re-prices the same way.
const unitChangeError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Whether an application may still change its unit / payment plan / rate with
 * a booking already made from it: yes until that booking's data is verified
 * and sent for approval. After that the approvers are looking at these
 * figures; the booking is rejected back to Review to change them.
 * Returns null when open, else the reason to show.
 */
async function applicationEditsClosedReason(pool, bookingId) {
  const b = (await pool.request().input("id", sql.Int, bookingId).query(
    "SELECT BookingNo, WorkflowStage, ReadyForApprovalAt, IsFrozen FROM dbo.CrmBooking WHERE Id = @id")).recordset[0];
  if (!b) return null;
  if (b.IsFrozen) return `Booking ${b.BookingNo} is frozen — an admin must unfreeze it before its unit, plan or rate change.`;
  if ((b.WorkflowStage || require("./crmBookingStageService").STAGE_REVIEW) !== require("./crmBookingStageService").STAGE_REVIEW || b.ReadyForApprovalAt != null) {
    return `Booking ${b.BookingNo} is verified and sent for approval — its unit, plan and rate are locked. Reject it back to Review to change them.`;
  }
  return null;
}

/**
 * Re-point a booking at another unit, re-priced from the new unit's area at the
 * booking's rate. Throws { status, message } when a rule refuses it.
 *
 * @param {object} o
 *   newUnitId      the unit to move to
 *   reason         recorded in the unit change log
 *   actor          user id
 *   paymentPlanId  the plan to use; omitted, the new unit's single tagged plan
 *                  (if exactly one) when nothing is paid yet
 *   checkOnly      run every check, change nothing
 */
// The rate a booking takes when it moves to another unit (decided 2026-11-12): the rate typed in for the change, else
// the new unit's own rate, else the booking's rate (a unit with no rate). Used by the preview, the same-project change
// and the linked move to another project, so all three price alike.
function unitChangeRate({ typedRate = null, unitRate = null, bookingRate = null }) {
  if (typedRate != null && typedRate !== "") {
    const r = Number(typedRate);
    if (!(r > 0)) throw unitChangeError(400, "Rate per sq ft must be more than 0");
    return r;
  }
  if (unitRate != null && Number(unitRate) > 0) return Number(unitRate);
  return bookingRate != null ? Number(bookingRate) : null;
}

async function changeBookingUnit(pool, bookingId, { newUnitId, reason, actor = null, actorEmail = null, paymentPlanId, ratePerSqFt = null, checkOnly = false }) {
  const { requireActiveBooking, recalculateRemainingMilestones, isLegalWorkStarted, isSaleDeedRegistered } = require("./crmWorkflowGuards");
  const { recalculateBookingGst, assertCommercialGstReady, GstSetupError } = require("./crmGst");
  const id = bookingId;
  newUnitId = parseInt(newUnitId, 10);

  // Re-pointing a land sale at a built unit would leave its plot lines
  // attached to a unit booking. Plots are changed by cancelling and
  // re-booking, never by swapping the line type underneath.
  if ((await pool.request().input("id", sql.Int, id).query("SELECT TOP 1 1 AS x FROM dbo.CrmBookingPlot WHERE BookingId = @id")).recordset.length) {
    throw unitChangeError(400, "This is a plot sale — its plots can't be swapped for a unit. Cancel the booking and book the new plots instead.");
  }
  const activeErr = await requireActiveBooking(pool, id);
  if (activeErr) throw unitChangeError(400, activeErr);

  const booking = (await pool.request().input("id", sql.Int, id)
    .query("SELECT UnitId, ProjectId, CompanyId, AreaSqFt, Status, WorkflowStage, RatePerSqFt, TotalValue, GrandTotal, ParkingTotal, ExtraChargesTotal, BookingAmount, PaymentPlanId, ApplicationId FROM dbo.CrmBooking WHERE Id = @id AND IsActive = 1")).recordset[0];
  if (!booking) throw unitChangeError(404, "Booking not found");
  const activeUnitCount = (await pool.request().input("id", sql.Int, id)
    .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmBookingUnit WHERE BookingId = @id AND Status = N'Active'")).recordset[0]?.Cnt || 0;
  if (activeUnitCount > 1) {
    throw unitChangeError(409, "This booking contains multiple active units. Change-unit is available for single-unit bookings; use a split transfer for multi-unit bookings.");
  }
  // Once the Agreement for Sale is signed (or the deed registered) the unit is
  // named in a legal document — the ERP can't quietly swap it.
  if (await isSaleDeedRegistered(pool, id)) {
    throw unitChangeError(400, "The Sale Deed is registered — the unit can't be changed in the ERP. A Deed of Rectification at the Sub-Registrar is required.");
  }
  if (await isLegalWorkStarted(pool, id)) {
    throw unitChangeError(400, "The Agreement for Sale is already signed and names this unit — cancel the agreement before changing the unit.");
  }
  // A new unit re-prices the booking — not while approvers are looking at the old price.
  if (["MarketingHeadApproval", "DirectorApproval"].includes(booking.WorkflowStage)) {
    throw unitChangeError(400, `This booking is in ${booking.WorkflowStage} — reject it back to Review before changing its unit, so the new price is approved.`);
  }
  const oldUnitId = booking.UnitId;
  if (newUnitId === oldUnitId) throw unitChangeError(400, "New unit is the same as the current unit");

  // Same lookup + availability checks as booking creation.
  const unitRow = (await pool.request().input("uid", sql.Int, newUnitId).query(`
    SELECT u.Id, u.UnitName, u.ProjectId, u.BlockId, u.UnitKind, COALESCE(u.UnitType, (SELECT TOP 1 k.Name FROM dbo.CrmConstructedAssetKind k WHERE k.Code = u.UnitKind)) AS UnitType, u.AreaSqFt,
           u.CarpetAreaSqFt, u.BuiltUpAreaSqFt, u.SuperBuiltUpAreaSqFt, u.OpenTerraceAreaSqFt, u.RatePerSqFt,
           proj.name AS ProjectName, proj.company_id AS CompanyId, blk.BlockName
    FROM dbo.UnitMaster u
    LEFT JOIN dbo.enterprise proj ON proj.id = u.ProjectId AND proj.business_type = 'P'
    LEFT JOIN dbo.BlockMaster blk ON blk.Id = u.BlockId
    WHERE u.Id = @uid AND u.IsActive = 1`)).recordset[0];
  if (!unitRow) throw unitChangeError(400, "Selected unit does not exist or is inactive");

  // The same rules a new booking must pass (crmEntityCreation.js).
  const ctx = (await pool.request().input("id", sql.Int, id).query(`
    SELECT b.ProjectId, a.CustomerId FROM dbo.CrmBooking b LEFT JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId WHERE b.Id = @id`)).recordset[0] || {};
  if (ctx.ProjectId != null && unitRow.ProjectId !== ctx.ProjectId) {
    throw unitChangeError(400, "A booking stays in its own project — pick a unit from the same project, or cancel and book afresh.");
  }
  {
    const { bookingTypeViolation, loadLandKinds, loadCommercialKinds } = require("./projectType");
    const why = await bookingTypeViolation(pool, [unitRow], {
      isPlotBooking: false, landKinds: await loadLandKinds(pool), commercialKinds: await loadCommercialKinds(pool),
    });
    if (why) throw unitChangeError(400, why);
  }
  try {
    await require("./villaLand").assertVillaBuyerOwnsLand(pool, [newUnitId], ctx.CustomerId);
    await assertCommercialGstReady(pool, [newUnitId]);
  } catch (e) {
    if (e.status) throw e;
    if (e instanceof GstSetupError) throw unitChangeError(400, e.message);
    throw e;
  }
  // Priced from the new unit's saleable area — without one the booking would
  // silently keep the old unit's price.
  if (!(Number(unitRow.AreaSqFt) > 0)) {
    throw unitChangeError(400, `${unitRow.UnitName} has no saleable area — set it in Unit Master first, so the booking can be re-priced.`);
  }
  const taken = await pool.request().input("uid", sql.Int, newUnitId).input("id", sql.Int, id)
    .query(`SELECT Id FROM dbo.CrmBooking WHERE UnitId = @uid AND Id <> @id AND IsActive = 1 AND Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL} AND (Status = 'Approved' OR ConfirmDeadline IS NULL OR ConfirmDeadline >= SYSDATETIME())
            UNION SELECT BookingId FROM dbo.CrmBookingUnit WHERE UnitId = @uid AND BookingId <> @id AND Status = N'Active'`);
  if (taken.recordset.length) throw unitChangeError(409, "This unit is already booked");
  if (checkOnly) return { unitNo: unitRow.UnitName };

  // The schedule is built afresh only when nothing points at its milestones (no money ever settled on one, none
  // waived, no receipt, payment or invoice on one): deleting a milestone a payment waiting for Finance points at would
  // leave that payment nowhere to land. Otherwise the unpaid milestones follow the new price and keep their ids.
  // An issued invoice on an open milestone stops the change: its amount would move under the invoice.
  const canRegenerateSchedule = !(await scheduleHasLinks(pool, id));
  await assertNoOpenMilestoneInvoice(pool, id);
  let newPlanId = null;
  if (canRegenerateSchedule) {
    try {
      // Given a plan, it is checked against the new unit's plans; without one,
      // only a unit with exactly one tagged plan resolves (no guessing).
      newPlanId = await resolveApplicationPaymentPlan(pool, { preferredUnitId: unitRow.Id, paymentPlanId: paymentPlanId ?? null });
    } catch (e) {
      throw unitChangeError(409, `Choose a payment plan for the new unit before changing it: ${e.message}`);
    }
  }
  const rate = unitChangeRate({ typedRate: ratePerSqFt, unitRate: unitRow.RatePerSqFt, bookingRate: booking.RatePerSqFt });
  const area = unitRow.AreaSqFt != null ? Number(unitRow.AreaSqFt) : null;
  const total = area && rate ? unitPrice(area, rate) : booking.TotalValue;
  const replacementBookingAmount = newPlanId != null
    ? (await pool.request().input("pid", sql.Int, newPlanId).query("SELECT BookingAmount FROM dbo.CrmPaymentPlanTemplate WHERE Id = @pid")).recordset[0]?.BookingAmount
    : booking.BookingAmount;
  if (newPlanId != null && !(Number(replacementBookingAmount) >= 0)) {
    throw unitChangeError(409, "The selected payment plan has no valid booking amount. Update the plan before changing this unit.");
  }
  if (newPlanId != null && Number(replacementBookingAmount) > Number(total)) {
    throw unitChangeError(409, "The selected plan's booking amount exceeds the new unit price. Update the plan or choose another one.");
  }

  // Unit, price, GST, schedule, change log and audit are one event.
  let backOnAccount = 0;
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Serialize changes and receipt creation against this booking, then recheck
    // target availability under the transaction before moving its reservation.
    await tx.request().input("id", sql.Int, id).query("SELECT Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id");
    const txPropertyChange = (await tx.request().input("bid", sql.Int, id).query(`
      SELECT TOP 1 Id FROM dbo.CrmPropertyChangeRequest WITH (UPDLOCK, HOLDLOCK)
      WHERE (SourceBookingId = @bid OR TargetBookingId = @bid)
        AND Status NOT IN ${PROPERTY_CHANGE_CLOSED_SQL}
    `)).recordset[0];
    if (txPropertyChange) throw unitChangeError(409, `Linked property change #${txPropertyChange.Id} is already in progress for this booking. Complete or cancel it before changing this unit.`);
    // Rechecked under the booking lock: a link that appeared since stops the rebuild, an invoice stops the change.
    if (newPlanId != null && (await scheduleHasLinks(tx, id))) {
      throw unitChangeError(409, "A payment or invoice was linked to this booking's schedule while the change was being prepared. Refresh and try again.");
    }
    await assertNoOpenMilestoneInvoice(tx, id);
    const financialSnapshot = (await tx.request().input("bid", sql.Int, id).query(`
      SELECT
        ISNULL((SELECT SUM(m.AmountPaid) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @bid), 0) AS Cleared,
        ISNULL((SELECT SUM(m.AmountDue) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @bid
          AND (m.Status IN ('${CrmStatus.PAID}', 'Waived') OR ISNULL(m.AmountPaid, 0) > 0 OR m.ExtraChargeId IS NOT NULL OR m.ParkingAllotmentId IS NOT NULL)), 0) AS FixedScheduleAmount,
        ISNULL((SELECT SUM(CASE WHEN m.Status IN ('${CrmStatus.PAID}', 'Waived') THEN 0
          WHEN m.AmountDue > ISNULL(m.AmountPaid, 0) THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END)
          FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @bid), 0) AS ContractualDue,
        ISNULL((SELECT SUM(oa.AvailableAmount) FROM ${require("./crmPaymentFunding").onAccountWithAvailableSql("oa")} WHERE oa.BookingId = @bid), 0) AS AvailableCredit,
        ISNULL((SELECT SUM(rp.RPAmount) FROM dbo.ReceivedPayment rp WHERE rp.CrmBookingId = @bid AND rp.RPStatus = 'Pending'), 0) AS PendingFinance,
        ISNULL((SELECT SUM(mr.Amount) FROM dbo.CrmMoneyReceipt mr WHERE mr.BookingId = @bid AND mr.Status = N'Pending' AND mr.ReceivedPaymentId IS NULL), 0) AS PendingCrmReceipt,
        ${require("./crmPaymentFunding").heldCreditAvailableSql("@bid")} AS HeldCredit`)).recordset[0] || {};
    // Money settled on the old price goes back on account (the full-booking hold: nothing stays settled unless the whole
    // price is in). It settles again on the new price after the change (the usual full-payment sweep below), and what
    // the new price doesn't need stays on account as the customer's credit (decided 2026-11-12: never block on it).
    const changeNo = Number((await tx.request().input("bid", sql.Int, id)
      .query("SELECT COUNT(*) + 1 AS n FROM dbo.CrmUnitChangeLog WHERE BookingId = @bid")).recordset[0].n);
    const backNote = `Back on account: unit changed to ${unitRow.UnitName}`;
    const unwound = await require("./crmOnAccountCoverage").unapplyBookingAllocations(tx, id, {
      actorUserId: actor, note: backNote, receiptNo: (a) => `UC-${id}-${changeNo}-${a.OnAccountPaymentId}-${a.MilestoneId}`,
    });
    for (const oaId of new Set(unwound.allocs.map((a) => a.OnAccountPaymentId))) {
      await require("./crmLedger").syncCrmOnAccountLedger(tx, oaId, actorEmail || "system", backNote, { onlyDown: false });
    }
    // Waived milestones, parking and extra charges keep their amounts; the new price must at least cover them.
    const fixedNow = Number((await tx.request().input("bid", sql.Int, id).query(`
      SELECT ISNULL(SUM(AmountDue), 0) AS a FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND (Status = 'Waived' OR ExtraChargeId IS NOT NULL OR ParkingAllotmentId IS NOT NULL)`)).recordset[0].a) || 0;
    const targetGrandTotal = Number(total || 0) + Number(booking.ParkingTotal || 0) + Number(booking.ExtraChargesTotal || 0);
    if (fixedNow > targetGrandTotal + 0.009) {
      throw unitChangeError(409, "The new unit's price is less than the waived milestones, parking and extra charges on this booking. Reverse the waiver or release the parking or charge first.");
    }
    const txTaken = await tx.request().input("uid", sql.Int, newUnitId).input("id", sql.Int, id).query(`
      SELECT TOP 1 Id FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK)
      WHERE UnitId = @uid AND Id <> @id AND IsActive = 1 AND Status NOT IN ${require("../constants/crmStatuses").DEAD_BOOKING_SQL}
        AND (Status = 'Approved' OR ConfirmDeadline IS NULL OR ConfirmDeadline >= SYSDATETIME())
      UNION SELECT TOP 1 BookingId FROM dbo.CrmBookingUnit WITH (UPDLOCK, HOLDLOCK) WHERE UnitId = @uid AND BookingId <> @id AND Status = N'Active'`);
    if (txTaken.recordset.length) throw unitChangeError(409, "This unit is already booked");
    await require("./crmHoldService").guardAndConvertHold(tx, "Unit", newUnitId, booking.ApplicationId);
    await tx.request()
      .input("id", sql.Int, id).input("uid", sql.Int, newUnitId)
      .input("pid", sql.Int, unitRow.ProjectId != null ? unitRow.ProjectId : null)
      .input("pname", sql.NVarChar(200), unitRow.ProjectName || null)
      .input("cid", sql.Int, unitRow.CompanyId != null ? unitRow.CompanyId : null)
      .input("unit", sql.NVarChar(100), unitRow.UnitName)
      .input("blk", sql.NVarChar(100), unitRow.BlockName || null)
      .input("utype", sql.NVarChar(100), unitRow.UnitType || null)
      .input("area", sql.Decimal(18, 2), area)
      .input("carpetArea", sql.Decimal(18, 2), unitRow.CarpetAreaSqFt != null ? Number(unitRow.CarpetAreaSqFt) : null)
      .input("builtUpArea", sql.Decimal(18, 2), unitRow.BuiltUpAreaSqFt != null ? Number(unitRow.BuiltUpAreaSqFt) : null)
      .input("superBuiltUpArea", sql.Decimal(18, 2), unitRow.SuperBuiltUpAreaSqFt != null ? Number(unitRow.SuperBuiltUpAreaSqFt) : null)
      .input("openTerraceArea", sql.Decimal(18, 2), unitRow.OpenTerraceAreaSqFt != null ? Number(unitRow.OpenTerraceAreaSqFt) : null)
      .input("rate", rateSqlType(), rate)
      .input("tot", sql.Decimal(18, 2), total)
      .input("bookingAmount", sql.Decimal(18, 2), replacementBookingAmount)
      .input("ppid", sql.Int, newPlanId)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBooking SET
          UnitId = @uid, ProjectId = @pid, ProjectName = ISNULL(@pname, ProjectName),
          CompanyId = @cid, UnitNo = @unit, BlockName = @blk, UnitType = @utype, AreaSqFt = @area,
          CarpetAreaSqFt = @carpetArea, BuiltUpAreaSqFt = @builtUpArea, SuperBuiltUpAreaSqFt = @superBuiltUpArea, OpenTerraceAreaSqFt = @openTerraceArea,
          RatePerSqFt = ISNULL(@rate, RatePerSqFt),
          TotalValue = @tot,
          BookingAmount = @bookingAmount,
          PaymentPlanId = ISNULL(@ppid, PaymentPlanId),
          GrandTotal = @tot + ParkingTotal + ExtraChargesTotal,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id`);

    // The allocation line is what reserves a unit — it moves with the booking,
    // or the old unit stays locked and the new one unprotected.
    const moved = await tx.request()
      .input("id", sql.Int, id).input("old", sql.Int, oldUnitId).input("uid", sql.Int, newUnitId)
      .input("area", sql.Decimal(18, 2), area).input("rate", rateSqlType(), rate).input("tot", sql.Decimal(18, 2), total)
      .input("ub", sql.Int, actor)
      .query(`
        UPDATE dbo.CrmBookingUnit SET UnitId = @uid, AreaSqFt = @area, RatePerSqFt = ISNULL(@rate, RatePerSqFt),
               AllocatedValue = @tot, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE BookingId = @id AND Status = N'Active' AND UnitId = @old`);
    if (!moved.rowsAffected[0]) {
      await tx.request().input("id", sql.Int, id).input("uid", sql.Int, newUnitId)
        .input("area", sql.Decimal(18, 2), area).input("rate", rateSqlType(), rate).input("tot", sql.Decimal(18, 2), total).input("ub", sql.Int, actor)
        .query(`INSERT INTO dbo.CrmBookingUnit (BookingId, UnitId, AreaSqFt, RatePerSqFt, AllocatedValue, Status, IsPrimary, CreatedBy, CreatedAt)
                VALUES (@id, @uid, @area, @rate, @tot, N'Active', 1, @ub, SYSDATETIME())`);
    }

    // A new price can cross a GST band.
    await recalculateBookingGst(tx, id);

    if (newPlanId != null) {
      // Only the %-based plan steps are rebuilt — parking / extra-charge steps
      // belong to their own rows.
      await tx.request().input("bid", sql.Int, id).query(`
        DELETE FROM dbo.CrmPaymentMilestone WHERE BookingId = @bid AND ExtraChargeId IS NULL AND ParkingAllotmentId IS NULL`);
      await generateMilestonesForBooking(tx, id, total, newPlanId, null, actor, replacementBookingAmount);
    } else {
      // Same plan, new price: the unpaid steps follow it.
      await recalculateRemainingMilestones(tx, id);
    }

    await tx.request()
      .input("bid", sql.Int, id).input("oldUid", sql.Int, oldUnitId != null ? oldUnitId : null).input("newUid", sql.Int, newUnitId)
      .input("reason", sql.NVarChar(sql.MAX), String(reason || "").trim()).input("cb", sql.Int, actor)
      .input("oldProject", sql.Int, booking.ProjectId).input("newProject", sql.Int, unitRow.ProjectId)
      .input("oldCompany", sql.Int, booking.CompanyId).input("newCompany", sql.Int, unitRow.CompanyId)
      .input("oldArea", sql.Decimal(18, 2), booking.AreaSqFt).input("newArea", sql.Decimal(18, 2), area)
      .input("oldRate", rateSqlType(), booking.RatePerSqFt).input("newRate", rateSqlType(), rate)
      .input("oldTotal", sql.Decimal(18, 2), booking.TotalValue).input("newTotal", sql.Decimal(18, 2), total)
      .input("oldGrand", sql.Decimal(18, 2), booking.GrandTotal).input("newGrand", sql.Decimal(18, 2), Number(total || 0) + Number(booking.ParkingTotal || 0) + Number(booking.ExtraChargesTotal || 0))
      .input("oldBookingAmount", sql.Decimal(18, 2), booking.BookingAmount).input("newBookingAmount", sql.Decimal(18, 2), replacementBookingAmount)
      .input("oldPlan", sql.Int, booking.PaymentPlanId).input("newPlan", sql.Int, newPlanId != null ? newPlanId : booking.PaymentPlanId)
      .input("cleared", sql.Decimal(18, 2), financialSnapshot.Cleared || 0)
      .input("availableCredit", sql.Decimal(18, 2), financialSnapshot.AvailableCredit || 0)
      .input("heldCredit", sql.Decimal(18, 2), financialSnapshot.HeldCredit || 0)
      .input("pendingFinance", sql.Decimal(18, 2), financialSnapshot.PendingFinance || 0)
      .input("pendingCrm", sql.Decimal(18, 2), financialSnapshot.PendingCrmReceipt || 0)
      .input("contractualDue", sql.Decimal(18, 2), financialSnapshot.ContractualDue || 0)
      .query(`INSERT INTO dbo.CrmUnitChangeLog
                (BookingId, OldUnitId, NewUnitId, Reason, ChangedBy, ChangedAt,
                 OldProjectId, NewProjectId, OldCompanyId, NewCompanyId, OldTotalValue, NewTotalValue,
                 OldAreaSqFt, NewAreaSqFt, OldRatePerSqFt, NewRatePerSqFt,
                 OldGrandTotal, NewGrandTotal, OldBookingAmount, NewBookingAmount, OldPaymentPlanId, NewPaymentPlanId,
                 ClearedAtChange, AvailableCreditAtChange, HeldCreditAtChange, PendingFinanceAtChange, PendingCrmReceiptAtChange, ContractualDueAtChange)
              VALUES
                (@bid, @oldUid, @newUid, @reason, @cb, SYSDATETIME(),
                 @oldProject, @newProject, @oldCompany, @newCompany, @oldTotal, @newTotal,
                 @oldArea, @newArea, @oldRate, @newRate,
                 @oldGrand, @newGrand, @oldBookingAmount, @newBookingAmount, @oldPlan, @newPlan,
                 @cleared, @availableCredit, @heldCredit, @pendingFinance, @pendingCrm, @contractualDue)`);
    await require("./crmAudit").logCrmAudit(tx, "Booking", id, actor, [{ field: "UnitId", oldVal: oldUnitId, newVal: newUnitId }]);
    await tx.commit();
    backOnAccount = unwound.amount;
  } catch (txErr) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw txErr;
  }
  // The money on account settles on the new price when it covers it; what is left over stays as the customer's credit.
  await require("../routes/crmPayments").autoApplyOnAccountIfFullyFunded(pool, id, actor, actorEmail || "system");
  const funding = await require("./crmPaymentFunding").getBookingFunding(pool, id);
  return {
    unitNo: unitRow.UnitName, paymentPlanUpdated: newPlanId != null, ratePerSqFt: rate, backOnAccount,
    due: funding.shortfall, credit: Math.max(0, Math.round((funding.totalFunded - funding.requiredAmount) * 100) / 100),
    parkingWarning: await parkingOutsideUnitBlock(pool, { bookingId: id, applicationId: booking.ApplicationId, unitId: newUnitId }),
  };
}

// Anything that points at a booking's schedule milestones (not parking or extra-charge rows): money settled or waived
// on one, a receipt row, a payment entered against one, a waiver or an invoice. With any of these the schedule is kept
// (and only re-spread over a new price), never deleted and rebuilt.
async function scheduleHasLinks(q, bookingId) {
  const r = await q.request().input("bid", sql.Int, bookingId).query(`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM dbo.CrmPaymentMilestone m
      WHERE m.BookingId = @bid AND m.ExtraChargeId IS NULL AND m.ParkingAllotmentId IS NULL
        AND (ISNULL(m.AmountPaid, 0) > 0 OR m.Status IN ('${CrmStatus.PAID}', 'Waived')
          OR EXISTS (SELECT 1 FROM dbo.CrmPaymentReceipt r WHERE r.MilestoneId = m.Id)
          OR EXISTS (SELECT 1 FROM dbo.ReceivedPayment rp WHERE rp.CrmMilestoneId = m.Id)
          OR EXISTS (SELECT 1 FROM dbo.CrmMilestoneWaiver w WHERE w.MilestoneId = m.Id)
          OR EXISTS (SELECT 1 FROM dbo.CrmInvoice i WHERE i.MilestoneId = m.Id AND i.Status <> 'Void'))
    ) THEN 1 ELSE 0 END AS Linked`);
  return Boolean(r.recordset[0]?.Linked);
}

// An issued (not void) invoice on a milestone that is not yet paid: the change would move that milestone's amount
// under the invoice, so the invoice is voided first (CRM Invoice Void).
async function openMilestoneInvoiceNos(q, bookingId) {
  return (await q.request().input("bid", sql.Int, bookingId).query(`
    SELECT i.InvoiceNo FROM dbo.CrmInvoice i JOIN dbo.CrmPaymentMilestone m ON m.Id = i.MilestoneId
    WHERE m.BookingId = @bid AND i.Status <> 'Void' AND m.Status NOT IN ('${CrmStatus.PAID}', 'Waived')
      AND m.ExtraChargeId IS NULL AND m.ParkingAllotmentId IS NULL`)).recordset.map((x) => x.InvoiceNo);
}
async function assertNoOpenMilestoneInvoice(q, bookingId) {
  const nos = await openMilestoneInvoiceNos(q, bookingId);
  if (nos.length) throw unitChangeError(409, `Invoice ${nos.join(", ")} is issued on a milestone whose amount would change. Void it first, then change the unit.`);
}


/**
 * Parking picked for an application (holds) or its booking (allotments) that
 * sits in a different block from the unit — after the unit is changed, so the
 * user is told to re-check the parking instead of finding it later. Returns a
 * sentence to show, or null.
 */
async function parkingOutsideUnitBlock(pool, { applicationId = null, bookingId = null, unitId }) {
  if (!unitId) return null;
  const rows = (await pool.request().input("aid", sql.Int, applicationId).input("bid", sql.Int, bookingId).input("uid", sql.Int, unitId).query(`
    SELECT DISTINCT s.SlotNo, sb.BlockName AS SlotBlock, ub.BlockName AS UnitBlock
    FROM (
      SELECT h.EntityId AS SlotId FROM dbo.CrmInventoryHold h
      WHERE h.EntityType = 'Parking' AND h.Status = 'Active' AND @aid IS NOT NULL AND h.ApplicationId = @aid
      UNION
      SELECT pa.ParkingSlotId FROM dbo.CrmParkingAllotment pa
      WHERE pa.IsActive = 1 AND pa.ParkingSlotId IS NOT NULL
        AND ((@aid IS NOT NULL AND pa.ApplicationId = @aid) OR (@bid IS NOT NULL AND pa.BookingId = @bid))
    ) x
    JOIN dbo.ParkingSlot s ON s.Id = x.SlotId
    JOIN dbo.UnitMaster u ON u.Id = @uid
    LEFT JOIN dbo.BlockMaster sb ON sb.Id = s.BlockId
    LEFT JOIN dbo.BlockMaster ub ON ub.Id = u.BlockId
    WHERE s.BlockId IS NOT NULL AND u.BlockId IS NOT NULL AND s.BlockId <> u.BlockId`)).recordset;
  if (!rows.length) return null;
  const slots = rows.map((r) => `${r.SlotNo} (Block ${r.SlotBlock})`).join(", ");
  return `Parking ${slots} is in another block than the new unit (Block ${rows[0].UnitBlock}) — check the parking and change it if needed.`;
}

// ── Unit Change ─────────────────────────────────────────────────────────────────────────────────────────────────────
// A buyer moves from a booking's unit to another unit, in this project or another one (decided 2026-11-12). One flow:
// a request (dbo.CrmPropertyChangeRequest: the new unit, its rate and plan, and for each parking slot and extra charge
// whether it stays the same or is changed) → approval in Approval Setup ("CRM Unit Change", module crm-unit-change;
// super admin always) → executeUnitChange: the old booking closes as UnitChanged, a new booking opens on the new unit
// for the same buyer (confirmed by this approval), the add-ons kept move to it, and every rupee received moves to it in
// full with no charge. Between companies the money goes through a Fund Transfer that Finance approves (MovingMoney).
// Every step can run again: a request whose approval stopped part-way (Failed) is retried and picks up where it was.

// The open request on a booking, as its old (source) or its new (target) booking.
async function openUnitChangeOn(q, bookingId) {
  return (await q.request().input("bid", sql.Int, bookingId).query(`
    SELECT TOP 1 Id, RequestNo, Status, SourceBookingId, TargetBookingId FROM dbo.CrmPropertyChangeRequest
    WHERE (SourceBookingId = @bid OR TargetBookingId = @bid) AND Status NOT IN ${PROPERTY_CHANGE_CLOSED_SQL}
    ORDER BY Id DESC`)).recordset[0] || null;
}

// What is left of a unit change's held credit to move: the held amount less what reached the new booking already and
// what a transfer on its way (a Fund Transfer awaiting approval) has reserved.
async function unitChangeCreditToMove(q, requestId) {
  return (await q.request().input("rid", sql.Int, requestId).query(`
    SELECT TOP 1 oa.Id AS HeldId,
      oa.Amount - ISNULL(oa.AppliedAmount, 0)
        - ISNULL((SELECT SUM(t.Amount) FROM dbo.CrmRebookingTransfer t WHERE t.HeldOnAccountId = oa.Id AND t.Status NOT IN ('Rejected', 'Applied')), 0) AS ToMove
    FROM dbo.CrmOnAccountPayment oa
    WHERE oa.HeldSourceType = N'UnitChange' AND oa.HeldSourceRefId = @rid AND oa.Status = 'Held'
    ORDER BY oa.Id`)).recordset[0] || null;
}

// Adds money to a unit change's held credit (one Held row per request, created on first use). No GL: the receipts
// already carry the liability; the ledgers move when the credit is applied to the new booking.
async function holdUnitChangeCredit(tx, { requestId, requestNo, bookingId, amount, actorUserId }) {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(amt > 0)) return null;
  const held = (await tx.request().input("rid", sql.Int, requestId).query(`
    SELECT TOP 1 Id FROM dbo.CrmOnAccountPayment WITH (UPDLOCK, HOLDLOCK)
    WHERE HeldSourceType = N'UnitChange' AND HeldSourceRefId = @rid ORDER BY Id`)).recordset[0];
  if (held) {
    await tx.request().input("id", sql.Int, held.Id).input("amt", sql.Decimal(18, 2), amt)
      .query("UPDATE dbo.CrmOnAccountPayment SET Amount = Amount + @amt, Status = 'Held' WHERE Id = @id");
    return held.Id;
  }
  return (await tx.request()
    .input("no", sql.NVarChar(30), `${requestNo}-HOLD`.slice(0, 30)).input("bid", sql.Int, bookingId)
    .input("amt", sql.Decimal(18, 2), amt).input("rid", sql.Int, requestId).input("cb", sql.Int, actorUserId ?? null)
    .query(`
      INSERT INTO dbo.CrmOnAccountPayment
        (ReceiptNo, BookingId, Amount, AppliedAmount, Status, ReceivedDate, PaymentMode,
         Notes, HeldFromBookingId, HeldSourceType, HeldSourceRefId, HeldAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.Id
      VALUES (@no, @bid, @amt, 0, 'Held', CAST(SYSDATETIME() AS DATE), 'HeldCredit',
              'Moving to the new booking of an approved unit change.', @bid, N'UnitChange', @rid, SYSDATETIME(), @cb, SYSDATETIME())`)).recordset[0].Id;
}

// Every free rupee of a booking (verified money on account, after taking settled money back off its milestones) rolled
// into the unit change's held credit, ready to move. Returns the amount rolled.
async function rollBookingMoneyIntoUnitChange(tx, { requestId, requestNo, bookingId, actorUserId, actorEmail }) {
  const note = `Moved with unit change ${requestNo}`;
  const unwound = await require("./crmOnAccountCoverage").unapplyBookingAllocations(tx, bookingId, {
    actorUserId, note, receiptNo: (a) => `UC-${requestId}-${a.OnAccountPaymentId}-${a.MilestoneId}`,
  });
  const { syncCrmOnAccountLedger } = require("./crmLedger");
  for (const oaId of new Set(unwound.allocs.map((a) => a.OnAccountPaymentId))) {
    await syncCrmOnAccountLedger(tx, oaId, actorEmail || "system", note, { onlyDown: false });
  }
  const rolled = (await tx.request().input("bid", sql.Int, bookingId).input("n", sql.NVarChar(300), note).query(`
    UPDATE dbo.CrmOnAccountPayment
    SET AppliedAmount = Amount, Status = 'Applied', Notes = ISNULL(Notes, '') + CHAR(10) + @n
    OUTPUT INSERTED.Id, INSERTED.Amount - ISNULL(DELETED.AppliedAmount, 0) AS Freed
    WHERE BookingId = @bid AND ISNULL(Status, '') IN ('Unapplied', 'PartiallyApplied') AND Amount > ISNULL(AppliedAmount, 0)`)).recordset;
  let total = 0;
  for (const r of rolled) {
    await syncCrmOnAccountLedger(tx, r.Id, actorEmail || "system", note);
    total += Number(r.Freed) || 0;
  }
  total = Math.round(total * 100) / 100;
  await holdUnitChangeCredit(tx, { requestId, requestNo, bookingId, amount: total, actorUserId });
  return total;
}

// Sends what is left of a unit change's held credit to its new booking. Same company: applied there at once (the
// request completes in applyRebookingTransferToBooking). Another company: a Fund Transfer goes for approval and the
// request waits as MovingMoney. Returns the transfer outcome, or null when nothing is left to move.
async function moveUnitChangeCredit(pool, requestId, { actorUserId = null, userEmail = "system", userRole = null } = {}) {
  const r = (await pool.request().input("rid", sql.Int, requestId)
    .query("SELECT Id, TargetBookingId, Status FROM dbo.CrmPropertyChangeRequest WHERE Id = @rid")).recordset[0];
  if (!r?.TargetBookingId) return null;
  const left = await unitChangeCreditToMove(pool, requestId);
  const amount = Math.round((Number(left?.ToMove) || 0) * 100) / 100;
  if (!(amount > 0.009)) {
    // Nothing (left) to move: done, unless a Fund Transfer is still on its way.
    await pool.request().input("rid", sql.Int, requestId).query(`
      UPDATE dbo.CrmPropertyChangeRequest SET Status = N'${UnitChangeStatus.COMPLETED}', CompletedAt = ISNULL(CompletedAt, SYSDATETIME()), UpdatedAt = SYSDATETIME()
      WHERE Id = @rid AND Status IN (N'${UnitChangeStatus.APPROVED}', N'${UnitChangeStatus.FAILED}', N'${UnitChangeStatus.MOVING_MONEY}')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmRebookingTransfer t JOIN dbo.CrmOnAccountPayment oa ON oa.Id = t.HeldOnAccountId
                        WHERE oa.HeldSourceType = N'UnitChange' AND oa.HeldSourceRefId = @rid AND t.Status NOT IN ('Rejected', 'Applied'))`);
    return null;
  }
  await pool.request().input("rid", sql.Int, requestId)
    .query(`UPDATE dbo.CrmPropertyChangeRequest SET Status = N'${UnitChangeStatus.MOVING_MONEY}', UpdatedAt = SYSDATETIME() WHERE Id = @rid`);
  const out = await require("../routes/crmRefunds").startRebookingTransfer(pool, {
    heldId: left.HeldId, toBookingId: r.TargetBookingId, amount, actorUserId, userEmail, userRole,
  });
  if (out.crossCompany) {
    await pool.request().input("rid", sql.Int, requestId).input("n", sql.NVarChar(1000), out.message || null)
      .query("UPDATE dbo.CrmPropertyChangeRequest SET Note = @n, UpdatedAt = SYSDATETIME() WHERE Id = @rid");
  }
  return out;
}

// Carries out an approved Unit Change. Runs again safely: each step checks whether it is already done.
async function executeUnitChange(pool, requestId, { actorUserId = null, userEmail = "system", userRole = null } = {}) {
  const load = async () => (await pool.request().input("rid", sql.Int, requestId).query(`
    SELECT r.*, sb.BookingNo AS SourceBookingNo, sb.Status AS SourceBookingStatus, sb.AssignedTo AS SourceAssignedTo,
           ta.Status AS TargetApplicationStatus
    FROM dbo.CrmPropertyChangeRequest r
    JOIN dbo.CrmBooking sb ON sb.Id = r.SourceBookingId
    LEFT JOIN dbo.CrmApplication ta ON ta.Id = r.TargetApplicationId
    WHERE r.Id = @rid`)).recordset[0];
  let r = await load();
  if (!r) throw unitChangeError(404, "Unit change not found");
  if (![UnitChangeStatus.APPROVED, UnitChangeStatus.FAILED].includes(r.Status)) {
    throw unitChangeError(409, `This unit change is ${r.Status}; only an approved one is carried out.`);
  }
  try {
    const { requireActiveBooking, isLegalWorkStarted, isSaleDeedRegistered } = require("./crmWorkflowGuards");
    const sourceClosed = r.SourceBookingStatus === CrmStatus.UNIT_CHANGED;
    if (!sourceClosed) {
      const activeErr = await requireActiveBooking(pool, r.SourceBookingId);
      if (activeErr) throw unitChangeError(409, activeErr);
      if (await isSaleDeedRegistered(pool, r.SourceBookingId)) throw unitChangeError(409, "The Sale Deed is registered: the unit can't be changed in the ERP.");
      if (await isLegalWorkStarted(pool, r.SourceBookingId)) throw unitChangeError(409, "The Agreement for Sale is signed and names this unit: cancel the agreement first.");
    }

    // 1. The new booking, for the same buyer, confirmed by this approval (no separate booking approval, and no
    //    booking-amount receipt: the buyer's money comes across from the old booking).
    if (!r.TargetBookingId) {
      if (r.TargetApplicationStatus === CrmStatus.DRAFT) {
        await require("./approvalService").transition("crm-applications", r.TargetApplicationId, CrmStatus.PENDING, userEmail, userRole);
      }
      const bk = await createCrmBookingRecord(pool, {
        ApplicationId: r.TargetApplicationId, UnitIds: [r.TargetUnitId], RatePerSqFt: r.RatePerSqFt,
        PaymentPlanId: r.PaymentPlanId, AssignedTo: r.SourceAssignedTo, TokenType: "Amount", TokenValue: 0,
        Notes: `Unit change ${r.RequestNo} from booking ${r.SourceBookingNo}. ${r.Reason}`,
      }, actorUserId);
      await pool.request().input("rid", sql.Int, requestId).input("bid", sql.Int, bk.id).input("u", sql.Int, actorUserId)
        .query(`UPDATE dbo.CrmPropertyChangeRequest SET TargetBookingId = @bid, UpdatedBy = @u, UpdatedAt = SYSDATETIME() WHERE Id = @rid;
                UPDATE dbo.CrmBooking SET Status = '${CrmStatus.APPROVED}', WorkflowStage = 'Confirmed',
                  ConfirmedAt = ISNULL(ConfirmedAt, SYSDATETIME()), ConfirmedBy = ISNULL(ConfirmedBy, @u), UpdatedAt = SYSDATETIME()
                WHERE Id = @bid`);
      const stage = require("./crmBookingStageService");
      await stage.logStageAction(pool, bk.id, stage.STAGE_CONFIRMED, "Confirmed", `Confirmed by unit change ${r.RequestNo}`, actorUserId);
      try { await require("./crmPortalProvision").ensurePortalUser(pool, r.TargetApplicationId); } catch (e) { console.error("[unit-change] portal:", e.message); }
      r = await load();
    }

    // 1b. The same buyer on the new booking: co-applicants, KYC documents, bank and nominee details, home loan and
    //     bank preferences are copied over (the old booking keeps its own as history); the sales lead follows.
    await copyBuyerDetails(pool, { fromBookingId: r.SourceBookingId, toBookingId: r.TargetBookingId, toApplicationId: r.TargetApplicationId });

    // 2. The old booking closes as UnitChanged: its settled money back on account and rolled into the held credit,
    //    its money receipts not yet with Finance moved to the new booking, its unit, parking and open items released.
    if (r.SourceBookingStatus !== CrmStatus.UNIT_CHANGED) {
      const tx = pool.transaction();
      await tx.begin();
      let amendments = [];
      try {
        const locked = (await tx.request().input("bid", sql.Int, r.SourceBookingId)
          .query("SELECT Status, ApplicationId FROM dbo.CrmBooking WITH (UPDLOCK, HOLDLOCK) WHERE Id = @bid")).recordset[0];
        if (locked.Status !== CrmStatus.UNIT_CHANGED) {
          const moved = await rollBookingMoneyIntoUnitChange(tx, { requestId, requestNo: r.RequestNo, bookingId: r.SourceBookingId, actorUserId, actorEmail: userEmail });
          await tx.request().input("old", sql.Int, r.SourceBookingId).input("new", sql.Int, r.TargetBookingId).query(`
            UPDATE dbo.CrmMoneyReceipt SET BookingId = @new, UpdatedAt = SYSDATETIME()
            WHERE BookingId = @old AND Status = 'Pending' AND ReceivedPaymentId IS NULL`);
          await tx.request().input("bid", sql.Int, r.SourceBookingId).input("rid", sql.Int, requestId)
            .query(`UPDATE dbo.CrmBooking SET Status = '${CrmStatus.UNIT_CHANGED}', ClosedByUnitChangeId = @rid, UpdatedAt = SYSDATETIME() WHERE Id = @bid`);
          const { releaseBookingInventoryLines } = require("./crmWorkflowGuards");
          await releaseBookingInventoryLines(tx, r.SourceBookingId);
          const target = (await tx.request().input("bid", sql.Int, r.TargetBookingId).query("SELECT BookingNo FROM dbo.CrmBooking WHERE Id = @bid")).recordset[0];
          await require("./crmApplicationWorkflow").advanceApplicationStatus(tx, locked.ApplicationId, CrmStatus.CANCELLED, "BookingCancelled",
            `Unit changed: the sale moved to booking ${target?.BookingNo || r.TargetBookingId} (${r.RequestNo})`, actorUserId, { force: true });
          ({ amendments } = await require("../routes/crmCancellations").releaseClosedBookingSideEffects(tx, r.SourceBookingId, { actorUserId, why: "moved to another unit" }));
          // The sale carries on, so its brokerage moves with it as it stands: what is paid stays closed, what is unpaid
          // carries on, and the new booking never raises brokerage again (maybeAutoCreateBrokerage finds these rows).
          await tx.request().input("old", sql.Int, r.SourceBookingId).input("new", sql.Int, r.TargetBookingId)
            .input("n", sql.NVarChar(300), `Moved with unit change ${r.RequestNo}`).query(`
            UPDATE dbo.CrmBrokerageMaster SET BookingId = @new, UpdatedAt = SYSDATETIME(), Notes = ISNULL(Notes, '') + CHAR(10) + @n
            WHERE BookingId = @old AND Status <> '${CrmStatus.VOIDED}'`);
          await tx.request().input("rid", sql.Int, requestId).input("m", sql.Decimal(18, 2), moved)
            .query("UPDATE dbo.CrmPropertyChangeRequest SET MovedAmount = MovedAmount + @m, UpdatedAt = SYSDATETIME() WHERE Id = @rid");
        }
        await tx.commit();
      } catch (e) {
        try { await tx.rollback(); } catch { /* already rolled back */ }
        throw e;
      }
      for (const a of amendments) {
        if (!a.RequestedBy) continue;
        try {
          await require("./notify").emitNotification(pool, a.RequestedBy, "crm_booking_amendment_rejected", "Amendment Request Auto-Rejected",
            "Your requested change was auto-rejected because the booking moved to another unit.", a.Id, "crm_booking_amendment");
        } catch (e) { console.error("[unit-change] amendment notification failed:", e.message); }
      }
      r = await load();
    }

    // 2b. The old booking's invoices are credited in full: its sale moved to the new booking, which invoices its own.
    {
      const tb = (await pool.request().input("bid", sql.Int, r.TargetBookingId).query("SELECT BookingNo FROM dbo.CrmBooking WHERE Id = @bid")).recordset[0];
      await require("./crmGstNotes").creditForUnitChange(pool, { bookingId: r.SourceBookingId, requestNo: r.RequestNo, newBookingNo: tb?.BookingNo || String(r.TargetBookingId), userEmail });
    }

    // 3. Parking and extra charges the request keeps: allotted again on the new booking, at the same price.
    const addOns = (() => { try { return JSON.parse(r.AddOnsJson || "[]"); } catch { return []; } })();
    for (const a of addOns) {
      if (!a.keep || a.done) continue;
      if (a.kind === "Parking") {
        const p = (await pool.request().input("id", sql.Int, a.id).query(
          "SELECT ParkingMasterId, ParkingSlotId, Quantity, RateSnapshot, Notes FROM dbo.CrmParkingAllotment WHERE Id = @id")).recordset[0];
        if (p) await require("../routes/crmParking").applyAddParking(pool, r.TargetBookingId, {
          ParkingMasterId: p.ParkingMasterId, ParkingSlotId: p.ParkingSlotId, Quantity: p.Quantity, RateOverride: p.RateSnapshot,
          Notes: [p.Notes, `Kept from booking ${r.SourceBookingNo} (${r.RequestNo})`].filter(Boolean).join(" · "),
        }, actorUserId);
      } else if (a.kind === "ExtraCharge") {
        const c = (await pool.request().input("id", sql.Int, a.id).query(
          "SELECT ExtraChargeMasterId, Description, Amount FROM dbo.CrmExtraCharge WHERE Id = @id")).recordset[0];
        if (c) {
          const tx = pool.transaction();
          await tx.begin();
          try {
            await require("../routes/crmExtraCharges").applyAddExtraCharge(tx, r.TargetBookingId, {
              ExtraChargeMasterId: c.ExtraChargeMasterId, Description: c.Description, Amount: c.Amount,
            }, actorUserId);
            await tx.commit();
          } catch (e) { try { await tx.rollback(); } catch { /* already rolled back */ } throw e; }
        }
      }
      a.done = true;
      await pool.request().input("rid", sql.Int, requestId).input("j", sql.NVarChar(sql.MAX), JSON.stringify(addOns))
        .query("UPDATE dbo.CrmPropertyChangeRequest SET AddOnsJson = @j, UpdatedAt = SYSDATETIME() WHERE Id = @rid");
    }

    // 4. The money: every rupee to the new booking.
    await pool.request().input("rid", sql.Int, requestId)
      .query(`UPDATE dbo.CrmPropertyChangeRequest SET Note = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @rid AND Status = N'${UnitChangeStatus.FAILED}'`);
    await moveUnitChangeCredit(pool, requestId, { actorUserId, userEmail, userRole });
    for (const k of ["crm-bookings", "crm-applications", "unit-master", "crm-refunds"]) await bumpCacheVersion(k).catch(() => {});
    return await load();
  } catch (e) {
    await pool.request().input("rid", sql.Int, requestId).input("n", sql.NVarChar(1000), String(e.message || "Stopped").slice(0, 1000))
      .query(`UPDATE dbo.CrmPropertyChangeRequest SET Status = N'${UnitChangeStatus.FAILED}', Note = @n, UpdatedAt = SYSDATETIME()
              WHERE Id = @rid AND Status <> N'${UnitChangeStatus.COMPLETED}'`).catch(() => {});
    throw e;
  }
}

// The tables that describe the buyer of a booking (not the unit): copied to the new booking of a Unit Change. Each is
// copied once (skipped when the new booking already has rows of it), every column as it is, with the new booking's ids.
const BUYER_TABLES = ["CrmCoApplicant", "CrmBookingDocument", "CrmCustomerBankDetail", "CrmLoanDetail", "CrmWelcomeCallBankPreference"];
async function copyBuyerDetails(pool, { fromBookingId, toBookingId, toApplicationId }) {
  for (const table of BUYER_TABLES) {
    const cols = (await pool.request().input("t", sql.NVarChar(128), table).query(`
      SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.' + @t) AND c.is_identity = 0 AND c.is_computed = 0
      ORDER BY c.column_id`)).recordset.map((c) => c.name);
    if (!cols.includes("BookingId")) continue;
    const pick = (c) => (c === "BookingId" ? "@to" : c === "ApplicationId" ? "@app" : `[${c}]`);
    const live = cols.includes("IsActive") ? " AND ISNULL(IsActive, 1) = 1" : "";
    await pool.request().input("from", sql.Int, fromBookingId).input("to", sql.Int, toBookingId).input("app", sql.Int, toApplicationId).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.[${table}] WHERE BookingId = @to)
        INSERT INTO dbo.[${table}] (${cols.map((c) => `[${c}]`).join(", ")})
        SELECT ${cols.map(pick).join(", ")} FROM dbo.[${table}] WHERE BookingId = @from${live}`);
  }
  await pool.request().input("from", sql.Int, fromBookingId).input("to", sql.Int, toBookingId).input("app", sql.Int, toApplicationId)
    .query("UPDATE dbo.SaLead SET CrmBookingId = @to, CrmApplicationId = @app WHERE CrmBookingId = @from");
}

// A payment bounces after its booking's unit was changed: the money had moved to the new booking, so it comes off
// there — first what has not moved yet (the held credit), then the credit that reached the new booking (its settled
// money goes back on account first, the full-booking hold). Runs inside the bounce's transaction (crmBouncedPayment).
async function bounceAfterUnitChange(tx, { bookingId, amount, note, actorUserId = null, actorEmail = "system" }) {
  const r = (await tx.request().input("bid", sql.Int, bookingId).query(`
    SELECT r.Id, r.RequestNo, r.TargetBookingId FROM dbo.CrmBooking b JOIN dbo.CrmPropertyChangeRequest r ON r.Id = b.ClosedByUnitChangeId
    WHERE b.Id = @bid AND b.Status = '${CrmStatus.UNIT_CHANGED}'`)).recordset[0];
  if (!r) return null;
  let left = Math.round((Number(amount) || 0) * 100) / 100;
  const { syncCrmOnAccountLedger } = require("./crmLedger");
  // Not moved yet: off the held credit.
  const held = await unitChangeCreditToMove(tx, r.Id);
  if (held && Number(held.ToMove) > 0.009 && left > 0) {
    const cut = Math.min(left, Number(held.ToMove));
    await tx.request().input("id", sql.Int, held.HeldId).input("c", sql.Decimal(18, 2), cut)
      .query("UPDATE dbo.CrmOnAccountPayment SET Amount = Amount - @c, Status = CASE WHEN ISNULL(AppliedAmount, 0) >= Amount - @c - 0.009 THEN 'Applied' ELSE Status END WHERE Id = @id");
    left = Math.round((left - cut) * 100) / 100;
  }
  let takenOffNew = 0;
  if (left > 0.009 && r.TargetBookingId) {
    const unwound = await require("./crmOnAccountCoverage").unapplyBookingAllocations(tx, r.TargetBookingId, {
      actorUserId, note, receiptNo: (a) => `UCB-${r.Id}-${a.OnAccountPaymentId}-${a.MilestoneId}`,
    });
    for (const oaId of new Set(unwound.allocs.map((a) => a.OnAccountPaymentId))) await syncCrmOnAccountLedger(tx, oaId, actorEmail, note, { onlyDown: false });
    // The credit that came across with this change, newest first.
    const moved = (await tx.request().input("rid", sql.Int, r.Id).query(`
      SELECT n.Id, n.Amount - ISNULL(n.AppliedAmount, 0) AS Free FROM dbo.CrmRebookingTransfer t
      JOIN dbo.CrmOnAccountPayment h ON h.Id = t.HeldOnAccountId AND h.HeldSourceType = N'UnitChange' AND h.HeldSourceRefId = @rid
      JOIN dbo.CrmOnAccountPayment n ON n.Id = t.NewOnAccountId
      WHERE t.Status = 'Applied' ORDER BY n.Id DESC`)).recordset;
    for (const m of moved) {
      if (left <= 0.009) break;
      const cut = Math.min(left, Number(m.Free));
      if (!(cut > 0)) continue;
      await tx.request().input("id", sql.Int, m.Id).input("c", sql.Decimal(18, 2), cut).input("n", sql.NVarChar(300), note)
        .query("UPDATE dbo.CrmOnAccountPayment SET Amount = Amount - @c, Notes = ISNULL(Notes, '') + CHAR(10) + @n WHERE Id = @id");
      await syncCrmOnAccountLedger(tx, m.Id, actorEmail, note, { onlyDown: false });
      left = Math.round((left - cut) * 100) / 100;
      takenOffNew = Math.round((takenOffNew + cut) * 100) / 100;
    }
  }
  await tx.request().input("rid", sql.Int, r.Id).input("a", sql.Decimal(18, 2), Number(amount)).input("c", sql.Decimal(18, 2), takenOffNew)
    .input("n", sql.NVarChar(1000), note)
    .query(`UPDATE dbo.CrmPropertyChangeRequest SET MovedAmount = MovedAmount - @a, CreditCarriedAmount = CreditCarriedAmount - @c,
              Note = LEFT(ISNULL(Note + CHAR(10), '') + @n, 1000), UpdatedAt = SYSDATETIME() WHERE Id = @rid`);
  return { targetBookingId: r.TargetBookingId, notTakenBack: left };
}

// A payment Finance verifies after its booking's unit was changed (it was still with Finance then): the money is real,
// so it is recorded as any receipt, then rolled into the unit change's held credit and sent on to the new booking.
// Returns true when it did that.
async function forwardIfUnitChanged(pool, bookingId, onAccountId, actorUserId, actorEmail) {
  const r = (await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT r.Id, r.RequestNo FROM dbo.CrmBooking b JOIN dbo.CrmPropertyChangeRequest r ON r.Id = b.ClosedByUnitChangeId
    WHERE b.Id = @bid AND b.Status = '${CrmStatus.UNIT_CHANGED}'`)).recordset[0];
  if (!r) return false;
  const tx = pool.transaction();
  await tx.begin();
  try {
    const rolled = await tx.request().input("id", sql.Int, onAccountId).input("n", sql.NVarChar(300), `Verified after unit change ${r.RequestNo}: moved to the new booking`).query(`
      UPDATE dbo.CrmOnAccountPayment SET AppliedAmount = Amount, Status = 'Applied', Notes = ISNULL(Notes, '') + CHAR(10) + @n
      OUTPUT INSERTED.Amount
      WHERE Id = @id AND ISNULL(Status, 'Unapplied') = 'Unapplied' AND ISNULL(AppliedAmount, 0) = 0`);
    if (rolled.recordset.length) {
      await require("./crmLedger").syncCrmOnAccountLedger(tx, onAccountId, actorEmail || "system", `Moved with unit change ${r.RequestNo}`);
      const amt = Number(rolled.recordset[0].Amount);
      await holdUnitChangeCredit(tx, { requestId: r.Id, requestNo: r.RequestNo, bookingId, amount: amt, actorUserId });
      await tx.request().input("rid", sql.Int, r.Id).input("m", sql.Decimal(18, 2), amt)
        .query(`UPDATE dbo.CrmPropertyChangeRequest SET MovedAmount = MovedAmount + @m, CompletedAt = NULL, UpdatedAt = SYSDATETIME() WHERE Id = @rid`);
    }
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
  await moveUnitChangeCredit(pool, r.Id, { actorUserId, userEmail: actorEmail || "system" });
  return true;
}

module.exports = {
  createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError, SOURCE_TYPES,
  changeBookingUnit, unitChangeRate, openMilestoneInvoiceNos, openUnitChangeOn, executeUnitChange, moveUnitChangeCredit, forwardIfUnitChanged, bounceAfterUnitChange, copyBuyerDetails, applicationEditsClosedReason, parkingOutsideUnitBlock, assertNoBookingForApplicationLocked,
  generateMilestonesForBooking, planSchedule, landSaleSchedule, reallocateBookingLines, rebuildLandSchedule, resolveApplicationPaymentPlan, getApplicablePaymentPlans, validatePlotSelection,
};

