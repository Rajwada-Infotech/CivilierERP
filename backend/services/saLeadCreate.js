/**
 * Creates one Sales Automation lead — the single path for manual entry
 * (POST /api/sa/leads) and channel partners' API (POST /api/public/partner-leads).
 * A mobile number is the key against duplicates across all active leads.
 * Resolves { id, uid } or { status, error, existingLeadId? }; the welcome message
 * to the customer is sent after creation.
 */
const crypto = require("crypto");
const { sql } = require("../db");
const { normalizeSaLeadContactFields } = require("../validation/saLeadValidation");
const { validateSourceChain } = require("./sourceChain");
const { welcomeLead } = require("./saMessaging");

function genUid() {
  return "LEAD-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function createLead(pool, input, actor) {
  try {
    const normalizedContact = normalizeSaLeadContactFields(input);
    if (normalizedContact.errors.length) {
      return { status: 400, error: normalizedContact.errors.join("; ") };
    }
    const b = normalizedContact.value;
    if (!b.Mobile) {
      return { status: 400, error: "Mobile is required" };
    }
    const uid = genUid();
    const sourceError = await validateSourceChain(pool, b);
    if (sourceError) return { status: 400, error: sourceError };

    if (b.Mobile) {
      const dup = await pool.request().input("mob", sql.NVarChar(20), b.Mobile)
        .query("SELECT TOP 1 Id, LeadUid, CustomerName, Status FROM dbo.SaLead WHERE Mobile = @mob AND IsActive = 1 ORDER BY CreatedAt DESC");
      if (dup.recordset.length) {
        return { status: 409, error: `A lead with this mobile number already exists: ${dup.recordset[0].LeadUid} (${dup.recordset[0].CustomerName || "no name"}, ${dup.recordset[0].Status})`,
          existingLeadId: dup.recordset[0].Id,
        };
      }
    }

    const created = await pool.request()
      .input("uid", sql.NVarChar(50), uid)
      .input("cn", sql.NVarChar(200), b.CustomerName || null)
      .input("mob", sql.NVarChar(20), b.Mobile || null)
      .input("alt", sql.NVarChar(20), b.AltMobile || null)
      .input("em", sql.NVarChar(200), b.Email || null)
      .input("pid", sql.Int, b.PlatformId || null)
      .input("cid", sql.Int, b.CampaignId || null)
      .input("aid", sql.Int, b.AdId || null)
      .input("dg", sql.Date, b.DateGenerated || null)
      .input("rem", sql.NVarChar(sql.MAX), b.CustomerRemarks || null)
      .input("st", sql.NVarChar(30), b.Status || "New")
      .input("cl", sql.NVarChar(30), b.Classification || null)
      .input("tl", sql.Int, b.AssignedTeamLeadId || null)
      .input("sp", sql.Int, b.AssignedSalespersonId || null)
      .input("srcType", sql.NVarChar(30), b.SourceType || null)
      .input("cpid", sql.Int, b.ChannelPartnerId || null)
      .input("bmin", sql.Decimal(18, 2), b.BudgetMin != null && b.BudgetMin !== "" ? parseFloat(b.BudgetMin) : null)
      .input("bmax", sql.Decimal(18, 2), b.BudgetMax != null && b.BudgetMax !== "" ? parseFloat(b.BudgetMax) : null)
      .input("ptype", sql.NVarChar(50), b.PropertyType || null)
      .input("bhk", sql.NVarChar(30), b.BhkPreference || null)
      .input("loc", sql.NVarChar(200), b.PreferredLocation || null)
      .input("timeline", sql.NVarChar(30), b.PurchaseTimeline || null)
      .input("externalLeadId", sql.NVarChar(200), b.ExternalLeadId || null)
      .input("leadFormName", sql.NVarChar(200), b.LeadFormName || null)
      .input("sourceCampaignName", sql.NVarChar(200), b.SourceCampaignName || null)
      .input("sourceAdName", sql.NVarChar(200), b.SourceAdName || null)
      .input("sourcePlacement", sql.NVarChar(200), b.SourcePlacement || null)
      .input("leadCaptureUrl", sql.NVarChar(2000), b.LeadCaptureUrl || null)
      .input("utmSource", sql.NVarChar(100), b.UtmSource || null)
      .input("utmMedium", sql.NVarChar(100), b.UtmMedium || null)
      .input("utmCampaign", sql.NVarChar(200), b.UtmCampaign || null)
      .input("utmContent", sql.NVarChar(200), b.UtmContent || null)
      .input("utmTerm", sql.NVarChar(200), b.UtmTerm || null)
      .input("capturedAt", sql.DateTime2(3), b.CapturedAt || null)
      .input("sourcePayload", sql.NVarChar(sql.MAX), b.SourcePayload ? JSON.stringify(b.SourcePayload) : null)
      .input("cb", sql.Int, actor)
      .query(`
        INSERT INTO dbo.SaLead
          (LeadUid, CustomerName, Mobile, AltMobile, Email, PlatformId, CampaignId, AdId,
           DateGenerated, CustomerRemarks, Status, Classification,
           AssignedTeamLeadId, AssignedSalespersonId,
           SourceType, ChannelPartnerId, BudgetMin, BudgetMax, PropertyType,
           BhkPreference, PreferredLocation, PurchaseTimeline,
           ExternalLeadId, LeadFormName, SourceCampaignName, SourceAdName,
           SourcePlacement, LeadCaptureUrl, UtmSource, UtmMedium, UtmCampaign,
           UtmContent, UtmTerm, CapturedAt, SourcePayload,
           IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@uid, @cn, @mob, @alt, @em, @pid, @cid, @aid,
           ISNULL(@dg, CAST(SYSDATETIME() AS DATE)), @rem, @st, @cl,
           @tl, @sp, @srcType, @cpid, @bmin, @bmax, @ptype, @bhk, @loc, @timeline,
           @externalLeadId, @leadFormName, @sourceCampaignName, @sourceAdName,
           @sourcePlacement, @leadCaptureUrl, @utmSource, @utmMedium, @utmCampaign,
           @utmContent, @utmTerm, @capturedAt, @sourcePayload,
           1, @cb, SYSDATETIME())
      `);
    const id = created.recordset[0].Id;
    welcomeLead(pool, id, actor);
    return { id, uid };
  } catch (e) {
    if (e.number === 2601 || e.number === 2627) return { status: 409, error: "A lead with this mobile number already exists." };
    throw e;
  }
}

module.exports = { createLead, genUid };
