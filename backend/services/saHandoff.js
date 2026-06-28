/**
 * Sales Automation → Follow-up / Booking handoff services.
 *
 * promoteLeadToFollowup(pool, leadId, userId)
 *   Creates a FollowupApplications record from the SaLead,
 *   stamps SaLead.FollowupCustomerId, sets status to "Visited".
 *
 * promoteLeadToBooking(pool, leadId, bookingData, userId)
 *   Creates a FollowupBookings record linked to the applicant,
 *   stamps SaLead.BookingId, sets status to "Booking".
 *
 * Both are wrapped in transactions so the lead + target table
 * stay consistent. Idempotent: if FollowupCustomerId/BookingId
 * is already set, returns early without duplicating.
 */
const { sql } = require("../db");

async function promoteLeadToFollowup(pool, leadId, userId) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    // 1. Fetch the lead
    const leadResult = await tx.request()
      .input("lid", sql.Int, leadId)
      .query(`
        SELECT l.*, p.Name AS PlatformName, c.Name AS CampaignName, a.Name AS AdName
        FROM dbo.SaLead l
        LEFT JOIN dbo.SaSocialMediaPlatform p ON l.PlatformId = p.Id
        LEFT JOIN dbo.SaCampaign c ON l.CampaignId = c.Id
        LEFT JOIN dbo.SaAd a ON l.AdId = a.Id
        WHERE l.Id = @lid
      `);
    const lead = leadResult.recordset[0];
    if (!lead) throw new Error("Lead not found");
    if (lead.FollowupCustomerId) {
      await tx.rollback();
      return { alreadyPromoted: true, applicantId: lead.FollowupCustomerId };
    }

    // 2. Gather call history as notes
    const callsResult = await tx.request()
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

    // 3. Gather site visit info
    const visitResult = await tx.request()
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

    const source = [lead.PlatformName, lead.CampaignName, lead.AdName].filter(Boolean).join(" > ") || "Sales Automation";
    const compiledNotes = [
      lead.CustomerRemarks ? `Customer Remarks: ${lead.CustomerRemarks}` : "",
      callNotes ? `\n--- Call History ---\n${callNotes}` : "",
      visitNotes ? `\n--- Site Visits ---\n${visitNotes}` : "",
      `\nLead ID: ${lead.LeadUid} | Classification: ${lead.Classification || "N/A"}`,
    ].filter(Boolean).join("\n");

    // 4. Insert into FollowupApplications
    const insertResult = await tx.request()
      .input("name", sql.NVarChar(200), lead.CustomerName)
      .input("mobile", sql.NVarChar(20), lead.Mobile)
      .input("email", sql.NVarChar(200), lead.Email || null)
      .input("source", sql.NVarChar(255), source)
      .input("assignedTo", sql.Int, lead.AssignedSalespersonId || null)
      .input("notes", sql.NVarChar(sql.MAX), compiledNotes)
      .input("createdBy", sql.NVarChar(100), userId ? String(userId) : "sa-handoff")
      .query(`
        INSERT INTO dbo.FollowupApplications
          (ApplicantName, PrimaryMobile, Email, Source, AssignedTo,
           Status, Notes, CreatedBy, CreatedAt, IsDeleted, ApplicationDate)
        VALUES
          (@name, @mobile, @email, @source, @assignedTo,
           'New', @notes, @createdBy, SYSDATETIME(), 0, CAST(SYSDATETIME() AS DATE));
        SELECT SCOPE_IDENTITY() AS Id;
      `);
    const applicantId = insertResult.recordset[0].Id;

    // 5. Stamp the lead
    await tx.request()
      .input("lid", sql.Int, leadId)
      .input("aid", sql.Int, applicantId)
      .query(`
        UPDATE dbo.SaLead
        SET FollowupCustomerId = @aid, Status = 'Visited', UpdatedAt = SYSDATETIME()
        WHERE Id = @lid
      `);

    await tx.commit();
    return { success: true, applicantId };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function promoteLeadToBooking(pool, leadId, bookingData, userId) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    // 1. Fetch the lead (must have FollowupCustomerId)
    const leadResult = await tx.request()
      .input("lid", sql.Int, leadId)
      .query("SELECT * FROM dbo.SaLead WHERE Id = @lid");
    const lead = leadResult.recordset[0];
    if (!lead) throw new Error("Lead not found");
    if (lead.BookingId) {
      await tx.rollback();
      return { alreadyBooked: true, bookingId: lead.BookingId };
    }
    if (!lead.FollowupCustomerId) {
      throw new Error("Lead must be promoted to Follow-up first (no FollowupCustomerId)");
    }

    // 2. Insert into FollowupBookings
    const b = bookingData || {};
    const insertResult = await tx.request()
      .input("applicantId", sql.Int, lead.FollowupCustomerId)
      .input("unitNo", sql.NVarChar(100), b.UnitNo || "TBD")
      .input("blockName", sql.NVarChar(100), b.BlockName || null)
      .input("floorName", sql.NVarChar(100), b.FloorName || null)
      .input("unitType", sql.NVarChar(100), b.UnitType || null)
      .input("areaSqFt", sql.Decimal(18, 2), b.AreaSqFt || null)
      .input("ratePerSqFt", sql.Decimal(18, 2), b.RatePerSqFt || null)
      .input("totalValue", sql.Decimal(18, 2), b.TotalValue || null)
      .input("bookingAmount", sql.Decimal(18, 2), b.BookingAmount || 0)
      .input("bookingDate", sql.Date, b.BookingDate || new Date())
      .input("paymentMode", sql.NVarChar(50), b.PaymentMode || null)
      .input("projectId", sql.Int, b.ProjectId || null)
      .input("companyId", sql.Int, b.CompanyId || null)
      .input("assignedTo", sql.Int, lead.AssignedSalespersonId || null)
      .input("notes", sql.NVarChar(sql.MAX), `Promoted from SA Lead ${lead.LeadUid}`)
      .input("createdBy", sql.NVarChar(100), userId ? String(userId) : "sa-handoff")
      .query(`
        INSERT INTO dbo.FollowupBookings
          (ApplicantId, UnitNo, BlockName, FloorName, UnitType,
           AreaSqFt, RatePerSqFt, TotalValue, BookingAmount, BookingDate,
           PaymentMode, ProjectId, CompanyId, AssignedTo,
           Status, Notes, CreatedBy, CreatedAt, IsDeleted)
        VALUES
          (@applicantId, @unitNo, @blockName, @floorName, @unitType,
           @areaSqFt, @ratePerSqFt, @totalValue, @bookingAmount, @bookingDate,
           @paymentMode, @projectId, @companyId, @assignedTo,
           'Confirmed', @notes, @createdBy, SYSDATETIME(), 0);
        SELECT SCOPE_IDENTITY() AS Id;
      `);
    const bookingId = insertResult.recordset[0].Id;

    // 3. Stamp the lead
    await tx.request()
      .input("lid", sql.Int, leadId)
      .input("bid", sql.Int, bookingId)
      .query(`
        UPDATE dbo.SaLead
        SET BookingId = @bid, Status = 'Booking', UpdatedAt = SYSDATETIME()
        WHERE Id = @lid
      `);

    await tx.commit();
    return { success: true, bookingId };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

module.exports = { promoteLeadToFollowup, promoteLeadToBooking };