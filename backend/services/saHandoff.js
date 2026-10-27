/**
 * Sales Automation → CRM handoff services.
 *
 * convertLead(pool, leadId, userId)
 *   Marks a lead as Converted — the ONLY thing SA does. This deliberately
 *   does NOT create a dbo.CrmApplication anymore: converting a lead just
 *   puts it in the CRM Leads pool (src/pages/CRM/CrmLeads.tsx / GET
 *   /api/sa/leads?status=Converted). A real Application only gets created
 *   when CRM staff explicitly pick a converted, not-yet-used lead from that
 *   pool in the "New Application" flow (crmApplications.js POST / ->
 *   createCrmApplicationRecord in crmEntityCreation.js, which enforces the
 *   Status='Converted' + CrmApplicationId IS NULL gate and stamps
 *   CrmApplicationId back onto the lead once used).
 *
 * This function used to call createCrmApplicationRecord itself and hand
 * back a ready-made Application — the direct SA -> Application flow the
 * "converted leads will not directly flow to the application, put a gate"
 * instruction explicitly asked to remove. The call/visit-history notes that
 * used to get compiled here at conversion time now get compiled at
 * Application-creation time instead (appendLeadHandoffNotes in
 * crmEntityCreation.js) — creation can happen well after conversion, so
 * compiling at conversion time would miss anything that happened in
 * between.
 *
 * Idempotent: converting an already-Converted lead is a no-op.
 */
const { sql } = require("../db");
const { QUALIFIED_FOR_CONVERSION, SA_LEAD_BOOKED, SA_LEAD_CONVERTED } = require("../constants/saStatuses");

async function convertLead(pool, leadId, userId) {
  const leadResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query("SELECT Id, Status, CrmApplicationId, IsActive FROM dbo.SaLead WHERE Id = @lid");
  const lead = leadResult.recordset[0];
  if (!lead || lead.IsActive === false || lead.IsActive === 0) throw new Error("Lead not found");
  // "Lost" is final in the lead lifecycle (routes/saLeads.js STATUS_TRANSITIONS
  // allows nothing out of it), so it can't be pushed into the CRM pool either.
  if (lead.Status === "Lost") {
    const e = new Error("This lead is marked Lost — it can't be converted.");
    e.status = 409;
    throw e;
  }
  if (lead.Status === SA_LEAD_CONVERTED) {
    return { alreadyConverted: true };
  }
  // Every other status change is forced through STATUS_TRANSITIONS' forward
  // progression - this was the one bypass of it, letting a brand-new lead
  // (never contacted, never visited) convert straight to a CRM Application.
  // Require the same qualification bar a human would expect before handing
  // a lead to CRM.
  if (!QUALIFIED_FOR_CONVERSION.includes(lead.Status)) {
    const e = new Error(`This lead hasn't reached Visited yet (currently ${lead.Status}) — it can't be converted to CRM until a site visit is completed.`);
    e.status = 409;
    throw e;
  }
  if (lead.CrmApplicationId) {
    // Shouldn't be reachable under the current flow (CrmApplicationId is
    // only ever set once a lead is Converted), but if it somehow is, the
    // lead is already spent — converting it again would just reopen a slot
    // that's actually used.
    return { alreadyConverted: true };
  }

  await pool.request()
    .input("lid", sql.Int, leadId)
    .input("ub", sql.Int, userId || null)
    .query(`
      UPDATE dbo.SaLead
      SET Status = '${SA_LEAD_CONVERTED}', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @lid
    `);

  return { success: true };
}

// A cancelled or deleted CRM booking sends its SA lead back to the CRM Leads
// pool (Converted) and unlinks it. Only a lead still at Booking moves —
// anything else was changed on purpose since. Pass the open transaction.
async function returnLeadToPool(tx, bookingId) {
  await tx.request().input("bid", sql.Int, bookingId).query(`
    UPDATE dbo.SaLead
    SET Status = CASE WHEN Status = '${SA_LEAD_BOOKED}' THEN '${SA_LEAD_CONVERTED}' ELSE Status END,
        CrmBookingId = NULL, UpdatedAt = SYSDATETIME()
    WHERE CrmBookingId = @bid
  `);
}

module.exports = { convertLead, returnLeadToPool };
