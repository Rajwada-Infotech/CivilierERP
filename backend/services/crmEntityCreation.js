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

async function createCrmApplicationRecord(pool, b, actorUserId) {
  if (!b.ApplicantName?.trim() || !b.Mobile?.trim())
    throw new CrmCreationError("ApplicantName and Mobile are required");
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
      .input("name", sql.NVarChar(200), b.ApplicantName.trim() || prefill.CustomerName)
      .input("mob",  sql.NVarChar(20),  b.Mobile.trim()  || prefill.Mobile)
      .input("alt",  sql.NVarChar(20),  b.AltMobile || prefill.AltMobile || null)
      .input("em",   sql.NVarChar(200), b.Email     || prefill.Email     || null)
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
          (ApplicationNo, LeadId, ApplicantName, Mobile, AltMobile, Email,
           ProjectId, PreferredUnitId, CompanyId, InterestedProject, InterestedUnit,
           PropertyType, BhkPreference, BudgetMin, BudgetMax,
           Source, PlatformId, CampaignId, AdId, ChannelPartnerId,
           AssignedTo, Status, Notes, ReferredByApplicationId, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@no, @lid, @name, @mob, @alt, @em,
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

  if (total && total > 0) {
    let milestones;
    if (b.PaymentPlanId) {
      const planItems = await pool.request().input("pid", sql.Int, parseInt(b.PaymentPlanId))
        .query("SELECT MilestoneNo, MilestoneName, [Percent] FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @pid ORDER BY MilestoneNo");
      milestones = planItems.recordset.map((r) => ({ no: r.MilestoneNo, name: r.MilestoneName, pct: r.Percent }));
    }
    if (!milestones?.length) {
      milestones = [
        { no: 1, name: "Booking",          pct: 5,  dept: "Sales",        docs: "Booking Receipt" },
        { no: 2, name: "Agreement",        pct: 10, dept: "Legal",        docs: "Executed Agreement" },
        { no: 3, name: "Foundation",       pct: 15, dept: "Construction", docs: "Foundation Completion Certificate" },
        { no: 4, name: "Superstructure",   pct: 20, dept: "Construction", docs: "Superstructure Progress Photos" },
        { no: 5, name: "Slab Casting",     pct: 20, dept: "Construction", docs: "Slab Casting Progress Photos" },
        { no: 6, name: "Plastering",       pct: 15, dept: "Construction", docs: "Plastering Completion Photos" },
        { no: 7, name: "Handover",         pct: 15, dept: "Sales",        docs: "Possession Letter, Handover Checklist" },
      ];
    }
    for (const m of milestones) {
      await pool.request()
        .input("bid",  sql.Int,           bookingId)
        .input("mno",  sql.Int,           m.no)
        .input("mname",sql.NVarChar(200), m.name)
        .input("amt",  sql.Decimal(18,2), Math.round(total * m.pct) / 100)
        .input("due",  sql.Date,          m.no === 1 ? (b.BookingDate || new Date()) : null)
        .input("rdocs",sql.NVarChar(sql.MAX), m.docs || null)
        .input("dept", sql.NVarChar(100), m.dept || null)
        .input("cb",   sql.Int,           actorUserId)
        .query(`
          INSERT INTO dbo.CrmPaymentMilestone (BookingId, MilestoneNo, MilestoneName, AmountDue, DueDate, RequiredDocuments, ResponsibleDepartment, Status, CreatedBy, CreatedAt)
          VALUES (@bid, @mno, @mname, @amt, @due, @rdocs, @dept, 'Pending', @cb, SYSDATETIME())
        `);
    }
  }

  await advanceApplicationStatus(pool, parseInt(b.ApplicationId), "Approved", "AutoBooking",
    `Auto-approved: booking ${bookingNo} created`, actorUserId, { force: true });

  return { id: bookingId, BookingNo: bookingNo };
}

module.exports = { createCrmApplicationRecord, createCrmBookingRecord, CrmCreationError, SOURCE_TYPES };
