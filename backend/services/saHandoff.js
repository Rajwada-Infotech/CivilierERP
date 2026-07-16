/**
 * Sales Automation → CRM handoff services.
 *
 * promoteLeadToFollowup(pool, leadId, userId)
 *   Creates a real dbo.CrmApplication from the SaLead (via the same
 *   createCrmApplicationRecord() the /api/crm/applications route itself
 *   uses), stamps SaLead.CrmApplicationId, sets Status to "InFollowup".
 *
 * That is now the ONLY handoff step SA is responsible for. There used to
 * also be a promoteLeadToBooking() here that created a dbo.CrmBooking
 * directly — a self-service action gated only by "sa-leads" edit, meaning
 * any salesperson could instantly create a real booking with zero admin
 * approval. That completely bypassed the exact self-approval gate the CRM
 * Applications/Bookings redesign was built to close (see crmApplications.js
 * PUT /:id/approve — approve/reject is admin/super_admin/dba-only via the
 * shared approvalTransition() engine on purpose). Removed rather than left
 * as a parallel shortcut: once a lead is promoted to an Application here,
 * it's a normal dbo.CrmApplication indistinguishable from one filed
 * directly — same 4-step capture wizard, same admin approval gate, same
 * auto-booking-on-approval. The Sales Automation UI now links straight
 * into that Application instead of offering its own booking dialog.
 *
 * Idempotent: if CrmApplicationId is already set, returns early without
 * duplicating (backstopped by a real UNIQUE index on
 * CrmApplication.LeadId — see migration 180 — so even a race between two
 * concurrent promote clicks can't create two applications for one lead).
 *
 * This previously wrote into dbo.FollowupApplications — a legacy module the
 * rest of the CRM pipeline (Agreement, Payments, Sale Deed, Handover,
 * Customer Portal) never reads from, meaning every lead promoted from the
 * Sales Automation screen dead-ended and never actually entered the real,
 * wired-up workflow. Fixed to call the same creation logic the CRM routes
 * themselves use, so a lead promoted here is indistinguishable from one
 * entered directly on the Applications page — same validation, same
 * downstream behavior, same portal sync.
 */
const { sql } = require("../db");
const { createCrmApplicationRecord, CrmCreationError } = require("./crmEntityCreation");

async function promoteLeadToFollowup(pool, leadId, userId) {
  const leadResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query("SELECT * FROM dbo.SaLead WHERE Id = @lid");
  const lead = leadResult.recordset[0];
  if (!lead) throw new Error("Lead not found");
  if (lead.CrmApplicationId) {
    return { alreadyPromoted: true, applicantId: lead.CrmApplicationId };
  }

  // Call history + site visits get folded into the application's Notes so
  // the context a salesperson already built up isn't lost on handoff.
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

  const compiledNotes = [
    lead.CustomerRemarks ? `Customer Remarks: ${lead.CustomerRemarks}` : "",
    callNotes ? `\n--- Call History ---\n${callNotes}` : "",
    visitNotes ? `\n--- Site Visits ---\n${visitNotes}` : "",
    `\nLead ID: ${lead.LeadUid} | Classification: ${lead.Classification || "N/A"}`,
  ].filter(Boolean).join("\n");

  let applicantId;
  try {
    // createCrmApplicationRecord already prefills from SaLead when LeadId is
    // given (name/mobile/email/budget/source chain/assigned salesperson) —
    // only the compiled call/visit notes need passing explicitly here.
    const created = await createCrmApplicationRecord(pool, {
      LeadId: leadId,
      ApplicantName: lead.CustomerName,
      Mobile: lead.Mobile,
      Notes: compiledNotes,
    }, userId);
    applicantId = created.id;
  } catch (e) {
    if (e instanceof CrmCreationError && e.status === 409) {
      // Lost a race to another promote click — re-read what actually landed.
      const recheck = await pool.request().input("lid", sql.Int, leadId)
        .query("SELECT CrmApplicationId FROM dbo.SaLead WHERE Id = @lid");
      if (recheck.recordset[0]?.CrmApplicationId) {
        return { alreadyPromoted: true, applicantId: recheck.recordset[0].CrmApplicationId };
      }
    }
    throw e;
  }

  await pool.request()
    .input("lid", sql.Int, leadId)
    .input("aid", sql.Int, applicantId)
    .query(`
      UPDATE dbo.SaLead
      SET CrmApplicationId = @aid, Status = 'InFollowup', UpdatedAt = SYSDATETIME()
      WHERE Id = @lid
    `);

  return { success: true, applicantId };
}

module.exports = { promoteLeadToFollowup };
