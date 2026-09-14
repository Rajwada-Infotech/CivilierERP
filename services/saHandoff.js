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

async function convertLead(pool, leadId, userId) {
  const leadResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query("SELECT Id, Status, CrmApplicationId FROM dbo.SaLead WHERE Id = @lid");
  const lead = leadResult.recordset[0];
  if (!lead) throw new Error("Lead not found");
  if (lead.Status === "Converted") {
    return { alreadyConverted: true };
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
      SET Status = 'Converted', UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
      WHERE Id = @lid
    `);

  return { success: true };
}

module.exports = { convertLead };
