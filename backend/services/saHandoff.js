/**
 * Sales Automation → CRM handoff services.
 *
 * promoteLeadToFollowup(pool, leadId, userId)
 *   Creates a real dbo.CrmApplication from the SaLead (via the same
 *   createCrmApplicationRecord() the /api/crm/applications route itself
 *   uses), stamps SaLead.CrmApplicationId, sets Status to "InFollowup".
 *
 * promoteLeadToBooking(pool, leadId, bookingData, userId)
 *   Creates a real dbo.CrmBooking (via createCrmBookingRecord() — same
 *   Unit Master validation, milestone auto-generation, and hold conversion
 *   the /api/crm/bookings route uses). bookingData.UnitId is REQUIRED — a
 *   real Unit Master selection, not a free-text unit number, matching the
 *   workflow spec's "Unit Master involvement is mandatory" requirement.
 *   Stamps SaLead.CrmBookingId, sets Status to "Booked".
 *
 * Idempotent: if CrmApplicationId/CrmBookingId is already set, returns
 * early without duplicating (backstopped by a real UNIQUE index on
 * CrmApplication.LeadId — see migration 180 — so even a race between two
 * concurrent promote clicks can't create two applications for one lead).
 *
 * Deliberately NOT wrapped in an outer pool.transaction(): the shared
 * creation functions call getNextDocNumber(), which opens its own internal
 * transaction on the real ConnectionPool (pool.transaction()) — a method
 * that doesn't exist on a Transaction object, so nesting one here would
 * break it. The SaLead stamp is a separate, immediately-following query
 * instead; if a crash lands between the two, the lead simply appears
 * un-promoted and a retry is caught cleanly by the unique index/idempotency
 * check above rather than silently duplicating.
 *
 * These previously wrote into dbo.FollowupApplications/FollowupBookings —
 * a legacy module the rest of the CRM pipeline (Agreement, Payments, Sale
 * Deed, Handover, Customer Portal) never reads from, meaning every lead
 * promoted from the Sales Automation screen dead-ended and never actually
 * entered the real, wired-up workflow. Fixed to call the same creation
 * logic the CRM routes themselves use, so a lead promoted here is
 * indistinguishable from one entered directly on the Applications/Bookings
 * pages — same validation, same downstream behavior, same portal sync.
 */
const { sql } = require("../db");
const { createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError } = require("./crmEntityCreation");

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

async function promoteLeadToBooking(pool, leadId, bookingData, userId) {
  const leadResult = await pool.request()
    .input("lid", sql.Int, leadId)
    .query("SELECT * FROM dbo.SaLead WHERE Id = @lid");
  const lead = leadResult.recordset[0];
  if (!lead) throw new Error("Lead not found");
  if (lead.CrmBookingId) {
    return { alreadyBooked: true, bookingId: lead.CrmBookingId };
  }
  if (!lead.CrmApplicationId) {
    throw new Error("Lead must be promoted to an application first (no CrmApplicationId)");
  }

  const b = bookingData || {};
  if (!b.UnitId) {
    const err = new Error("UnitId is required — pick a real unit from Unit Master before booking (spec: Unit Master involvement is mandatory)");
    err.status = 400;
    throw err;
  }

  const { id: bookingId } = await createCrmBookingRecord(pool, {
    ApplicationId: lead.CrmApplicationId,
    UnitId: b.UnitId,
    TokenType: b.TokenType,
    TokenValue: b.TokenValue,
    TotalValue: b.TotalValue,
    BookingAmount: b.BookingAmount,
    BookingDate: b.BookingDate || new Date(),
    PaymentMode: b.PaymentMode,
    PaymentPlanId: b.PaymentPlanId,
    AssignedTo: lead.AssignedSalespersonId || null,
    Notes: `Promoted from SA Lead ${lead.LeadUid}`,
  }, userId);

  await pool.request()
    .input("lid", sql.Int, leadId)
    .input("bid", sql.Int, bookingId)
    .query(`
      UPDATE dbo.SaLead
      SET CrmBookingId = @bid, Status = 'Booked', UpdatedAt = SYSDATETIME()
      WHERE Id = @lid
    `);

  return { success: true, bookingId };
}

module.exports = { promoteLeadToFollowup, promoteLeadToBooking };
