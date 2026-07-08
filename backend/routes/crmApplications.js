const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCrmAudit } = require("../services/crmAudit");
const { validateSourceChain } = require("../services/sourceChain");
const { logStatusChange, advanceApplicationStatus } = require("../services/crmApplicationWorkflow");
// The generic multi-module approval engine — Submit/Approve/Reject go through
// this so approve/reject is gated to admin/super_admin/dba only (the same
// engine BOQ, Purchase Orders, etc. use), instead of any editor self-approving.
const { transition: approvalTransition } = require("../services/approvalService");

router.use(authMiddleware);

// Mirrors SaLead.SourceType so source values stay consistent across the
// whole system, not just this module.
const SOURCE_TYPES = ["Ad", "WalkIn", "Referral", "PortalInquiry", "ColdCall", "Website", "EventLead", "Other"];

const APP_SELECT = `
  SELECT
    a.Id, a.ApplicationNo, a.LeadId, a.ApplicantName, a.Mobile, a.AltMobile, a.Email,
    a.ProjectId, a.PreferredUnitId, a.CompanyId,
    a.InterestedProject, a.InterestedUnit, a.PropertyType, a.BhkPreference,
    a.BudgetMin, a.BudgetMax, a.Source, a.PlatformId, a.CampaignId, a.AdId, a.ChannelPartnerId,
    a.AssignedTo, a.Status, a.Notes,
    a.ReferredByApplicationId, a.IsActive, a.CreatedAt, a.UpdatedAt,
    u.name  AS AssigneeName,
    cu.name AS CreatedByName,
    l.LeadUid, l.Classification AS LeadClassification,
    plat.Name AS PlatformName, camp.Name AS CampaignName, ad.Name AS AdName,
    cp.Name AS ChannelPartnerName,
    ref.ApplicationNo AS ReferredByApplicationNo, ref.ApplicantName AS ReferredByName,
    proj.name AS ProjectMasterName, comp.name AS CompanyName, um.UnitName AS PreferredUnitName
  FROM dbo.CrmApplication a
  LEFT JOIN dbo.Users u   ON u.id  = a.AssignedTo
  LEFT JOIN dbo.Users cu  ON cu.id = a.CreatedBy
  LEFT JOIN dbo.SaLead l  ON l.Id  = a.LeadId
  LEFT JOIN dbo.SaSocialMediaPlatform plat ON plat.Id = a.PlatformId
  LEFT JOIN dbo.SaCampaign camp ON camp.Id = a.CampaignId
  LEFT JOIN dbo.SaAd ad ON ad.Id = a.AdId
  LEFT JOIN dbo.SaChannelPartner cp ON cp.Id = a.ChannelPartnerId
  LEFT JOIN dbo.CrmApplication ref ON ref.Id = a.ReferredByApplicationId
  LEFT JOIN dbo.enterprise proj ON proj.id = a.ProjectId AND proj.business_type = 'P'
  LEFT JOIN dbo.enterprise comp ON comp.id = a.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.UnitMaster um   ON um.Id  = a.PreferredUnitId
`;

// GET / — all applications
router.get("/", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status, search } = req.query;
    const req0 = pool.request();
    const conds = ["a.IsActive = 1"];
    if (status) { req0.input("st", sql.NVarChar(30), status); conds.push("a.Status = @st"); }
    if (search) {
      req0.input("srch", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @srch OR a.Mobile LIKE @srch OR a.ApplicationNo LIKE @srch)");
    }
    const where = "WHERE " + conds.join(" AND ");
    const result = await req0.query(`${APP_SELECT} ${where} ORDER BY a.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-applications] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — single application with booking summary + status trail
router.get("/:id", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [appRes, bookRes, logRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${APP_SELECT} WHERE a.Id = @id`),
      pool.request().input("id", sql.Int, id).query(`
        SELECT b.Id, b.BookingNo, b.UnitNo, b.ProjectName, b.TotalValue, b.Status, b.BookingDate
        FROM dbo.CrmBooking b WHERE b.ApplicationId = @id AND b.IsActive = 1
      `),
      pool.request().input("id", sql.Int, id).query(`
        SELECT s.*, u.name AS ActorName
        FROM dbo.CrmApplicationStatusLog s
        LEFT JOIN dbo.Users u ON u.id = s.ActorId
        WHERE s.ApplicationId = @id ORDER BY s.CreatedAt DESC
      `),
    ]);
    if (!appRes.recordset[0]) return res.status(404).json({ error: "Application not found" });
    res.json({ application: appRes.recordset[0], bookings: bookRes.recordset, statusLog: logRes.recordset });
  } catch (e) {
    console.error("[crm-applications] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create application (optionally from a lead, always starts Draft)
router.post("/", requirePageRight("crm-applications", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.ApplicantName?.trim() || !b.Mobile?.trim())
      return res.status(400).json({ error: "ApplicantName and Mobile are required" });
    if (b.Source && !SOURCE_TYPES.includes(b.Source))
      return res.status(400).json({ error: `Invalid Source. Must be one of: ${SOURCE_TYPES.join(", ")}` });

    // If from a lead, prefill from lead record if caller didn't supply values —
    // including its own source chain, so the application inherits exactly
    // where the customer actually came from instead of losing that context.
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
    if (sourceError) return res.status(400).json({ error: sourceError });

    // Resolve Project -> Company link (a Project row's company_id) and the
    // real project/unit display names, so the app doesn't rely on hand-typed
    // text for either.
    let projectName = b.InterestedProject || null;
    let companyId = b.CompanyId ? parseInt(b.CompanyId) : null;
    if (b.ProjectId) {
      const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
        .query("SELECT name, company_id FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
      if (!proj.recordset.length) return res.status(400).json({ error: "Selected project does not exist" });
      projectName = proj.recordset[0].name;
      companyId = companyId || proj.recordset[0].company_id || null;
    }
    let unitName = b.InterestedUnit || null;
    if (b.PreferredUnitId) {
      const unit = await pool.request().input("uid", sql.Int, parseInt(b.PreferredUnitId))
        .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1");
      if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
      unitName = unit.recordset[0].UnitName;
    }

    const appNo = await getNextDocNumber(pool, "APP", "APP");
    const actor = actorId(req);
    const result = await pool.request()
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
      .input("cb",   sql.Int,           actor)
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
    const applicationId = result.recordset[0].Id;
    // Lands directly in Pending — same "auto-submitted on creation" convention
    // every other module wired into the Approval Inbox uses (see
    // ApprovalActions.tsx). Only admin/super_admin/dba can move it forward
    // from here, from the Admin Approval Inbox.
    await logStatusChange(pool, applicationId, null, "Pending", "Manual", "Application created", actor);

    res.status(201).json({ success: true, id: applicationId, ApplicationNo: appNo });
  } catch (e) {
    console.error("[crm-applications] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — update application details. Status is never editable here —
// it only ever moves through /submit, /approve, /reject below (or the
// automated AutoBooking transition), so it can't be silently overwritten.
router.put("/:id", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    const actor = actorId(req);

    const old = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status, AssignedTo FROM dbo.CrmApplication WHERE Id = @id AND IsActive = 1");
    if (!old.recordset.length) return res.status(404).json({ error: "Application not found" });

    if (b.Source && !SOURCE_TYPES.includes(b.Source))
      return res.status(400).json({ error: `Invalid Source. Must be one of: ${SOURCE_TYPES.join(", ")}` });

    const platformId = b.PlatformId !== undefined ? (b.PlatformId ? parseInt(b.PlatformId) : null) : undefined;
    const campaignId = b.CampaignId !== undefined ? (b.CampaignId ? parseInt(b.CampaignId) : null) : undefined;
    const adId       = b.AdId       !== undefined ? (b.AdId       ? parseInt(b.AdId)       : null) : undefined;
    if (platformId !== undefined || campaignId !== undefined || adId !== undefined) {
      const sourceError = await validateSourceChain(pool, { PlatformId: platformId, CampaignId: campaignId, AdId: adId });
      if (sourceError) return res.status(400).json({ error: sourceError });
    }

    let projectName = b.InterestedProject || null;
    let companyId = b.CompanyId ? parseInt(b.CompanyId) : null;
    if (b.ProjectId) {
      const proj = await pool.request().input("pid", sql.Int, parseInt(b.ProjectId))
        .query("SELECT name, company_id FROM dbo.enterprise WHERE id = @pid AND business_type = 'P'");
      if (!proj.recordset.length) return res.status(400).json({ error: "Selected project does not exist" });
      projectName = proj.recordset[0].name;
      companyId = companyId || proj.recordset[0].company_id || null;
    }
    let unitName = b.InterestedUnit || null;
    if (b.PreferredUnitId) {
      const unit = await pool.request().input("uid", sql.Int, parseInt(b.PreferredUnitId))
        .query("SELECT UnitName FROM dbo.UnitMaster WHERE Id = @uid AND IsActive = 1");
      if (!unit.recordset.length) return res.status(400).json({ error: "Selected unit does not exist or is inactive" });
      unitName = unit.recordset[0].UnitName;
    }

    await pool.request()
      .input("id",   sql.Int,           id)
      .input("name", sql.NVarChar(200), b.ApplicantName || null)
      .input("mob",  sql.NVarChar(20),  b.Mobile || null)
      .input("alt",  sql.NVarChar(20),  b.AltMobile || null)
      .input("em",   sql.NVarChar(200), b.Email || null)
      .input("pid",  sql.Int,           b.ProjectId ? parseInt(b.ProjectId) : null)
      .input("uid",  sql.Int,           b.PreferredUnitId ? parseInt(b.PreferredUnitId) : null)
      .input("cid",  sql.Int,           companyId)
      .input("proj", sql.NVarChar(200), projectName)
      .input("unit", sql.NVarChar(100), unitName)
      .input("pt",   sql.NVarChar(50),  b.PropertyType || null)
      .input("bhk",  sql.NVarChar(30),  b.BhkPreference || null)
      .input("bmin", sql.Decimal(18,2), b.BudgetMin != null ? parseFloat(b.BudgetMin) : null)
      .input("bmax", sql.Decimal(18,2), b.BudgetMax != null ? parseFloat(b.BudgetMax) : null)
      .input("src",  sql.NVarChar(200), b.Source || null)
      .input("platid", sql.Int, platformId ?? null)
      .input("campid", sql.Int, campaignId ?? null)
      .input("adid",   sql.Int, adId ?? null)
      .input("cpid",   sql.Int, b.ChannelPartnerId ? parseInt(b.ChannelPartnerId) : null)
      .input("asgn", sql.Int,           b.AssignedTo ? parseInt(b.AssignedTo) : null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int,           actor)
      .query(`
        UPDATE dbo.CrmApplication SET
          ApplicantName = ISNULL(@name, ApplicantName),
          Mobile = ISNULL(@mob, Mobile), AltMobile = @alt, Email = @em,
          ProjectId = ISNULL(@pid, ProjectId), PreferredUnitId = ISNULL(@uid, PreferredUnitId),
          CompanyId = ISNULL(@cid, CompanyId),
          InterestedProject = ISNULL(@proj, InterestedProject), InterestedUnit = ISNULL(@unit, InterestedUnit),
          PropertyType = @pt, BhkPreference = @bhk, BudgetMin = @bmin, BudgetMax = @bmax,
          Source = ISNULL(@src, Source),
          PlatformId = ISNULL(@platid, PlatformId), CampaignId = ISNULL(@campid, CampaignId),
          AdId = ISNULL(@adid, AdId), ChannelPartnerId = ISNULL(@cpid, ChannelPartnerId),
          AssignedTo = ISNULL(@asgn, AssignedTo),
          Notes = @note,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id AND IsActive = 1
      `);

    await logCrmAudit(pool, "Application", id, actor, [
      { field: "AssignedTo", oldVal: old.recordset[0].AssignedTo, newVal: b.AssignedTo },
    ]);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-applications] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/submit — Draft/Rejected -> Pending. Any editor can submit; this is
// not an approval action, just moving the record into the approval queue.
router.put("/:id/submit", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-applications", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-applications] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/dba only, enforced inside
// approvalTransition(). This is the fix for the self-approval bug: approve
// and reject no longer live on this page at all — they only happen from the
// Admin Approval Inbox (src/pages/admin/ApprovalInbox.tsx), same as every
// other approval-driven module in the system.
router.put("/:id/approve", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-applications", id, "Approved", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-applications] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/dba only (Remarks recommended)
router.put("/:id/reject", requirePageRight("crm-applications", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-applications", id, "Rejected", userEmail, req.user?.role, req.body?.Remarks || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-applications] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/cancel — a business action, not an approval — any editor can
// cancel a Draft/Pending/Rejected/Approved application.
router.put("/:id/cancel", requirePageRight("crm-applications", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const remarks = req.body?.Remarks || null;
    const result = await advanceApplicationStatus(pool, id, "Cancelled", "Manual", remarks, actorId(req));
    if (!result.ok) return res.status(result.error === "Application not found" ? 404 : 400).json({ error: result.error });
    res.json({ success: true, status: result.to });
  } catch (e) {
    console.error("[crm-applications] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
