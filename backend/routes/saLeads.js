const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { promoteLeadToFollowup, promoteLeadToBooking } = require("../services/saHandoff");
const { applyLeadScope, actorId, isSaAdmin } = require("../services/saAccess");
const { getIo } = require("../socket");
const crypto = require("crypto");

// Insert notification row and emit to the user's personal socket room.
async function emitNotification(pool, userId, type, title, body, refId) {
  try {
    const result = await pool.request()
      .input("UserId",  sql.Int,           userId)
      .input("Type",    sql.NVarChar(50),  type)
      .input("Title",   sql.NVarChar(200), title)
      .input("Body",    sql.NVarChar(500), body || null)
      .input("RefId",   sql.Int,           refId || null)
      .input("RefType", sql.NVarChar(50),  refId ? "lead" : null)
      .query(`
        INSERT INTO dbo.SaNotification (UserId, Type, Title, Body, RefId, RefType)
        OUTPUT INSERTED.Id, INSERTED.UserId, INSERTED.Type, INSERTED.Title,
               INSERTED.Body, INSERTED.RefId, INSERTED.RefType, INSERTED.IsRead, INSERTED.CreatedAt
        VALUES (@UserId, @Type, @Title, @Body, @RefId, @RefType)
      `);
    const notif = result.recordset[0];
    try {
      getIo().to(`user:${userId}`).emit("sa:notification", {
        id: notif.Id,
        userId: notif.UserId,
        type: notif.Type,
        title: notif.Title,
        body: notif.Body,
        refId: notif.RefId,
        refType: notif.RefType,
        isRead: false,
        createdAt: notif.CreatedAt,
      });
    } catch { /* socket may not be initialised in tests */ }
  } catch (e) {
    console.error("[sa-leads] emitNotification error:", e.message);
  }
}

const rateLimit = require("express-rate-limit");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));

function genUid() {
  return "LEAD-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// GET / — list all leads (row-level scoped)
router.get("/", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope = applyLeadScope(req0, req, "l");
    const result = await req0.query(`
      SELECT
        l.Id, l.LeadUid, l.CustomerName, l.Mobile, l.AltMobile, l.Email,
        l.DateGenerated, l.Status, l.Classification, l.CustomerRemarks,
        l.AssignedTeamLeadId, l.AssignedSalespersonId,
        l.FollowupCustomerId, l.BookingId, l.IsActive, l.CreatedAt,
        l.PlatformId, l.CampaignId, l.AdId,
        p.Name AS PlatformName,
        c.Name AS CampaignName,
        a.Name AS AdName,
        tl.name AS TeamLeadName,
        sp.name AS SalespersonName
      FROM dbo.SaLead l
      LEFT JOIN dbo.SaSocialMediaPlatform p ON l.PlatformId = p.Id
      LEFT JOIN dbo.SaCampaign c ON l.CampaignId = c.Id
      LEFT JOIN dbo.SaAd a ON l.AdId = a.Id
      LEFT JOIN dbo.Users tl ON l.AssignedTeamLeadId = tl.id
      LEFT JOIN dbo.Users sp ON l.AssignedSalespersonId = sp.id
      WHERE l.IsActive = 1 AND ${scope}
      ORDER BY l.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-leads] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /users — dropdown for assigning leads (SA roles only)
router.get("/users", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT u.id AS Id, u.name AS Name, u.role
      FROM dbo.Users u
      JOIN dbo.Role ro ON ro.RId = u.RoleId
      WHERE u.discontinue = 0
        AND ro.RName IN ('super_admin','admin','dba','marketing_head','sales_team_lead','sales_person')
      ORDER BY u.name
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-leads] GET /users error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create lead
router.post("/", requirePageRight("sa-leads", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const uid = genUid();
    await pool.request()
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
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.SaLead
          (LeadUid, CustomerName, Mobile, AltMobile, Email, PlatformId, CampaignId, AdId,
           DateGenerated, CustomerRemarks, Status, Classification,
           AssignedTeamLeadId, AssignedSalespersonId, IsActive, CreatedBy, CreatedAt)
        VALUES
          (@uid, @cn, @mob, @alt, @em, @pid, @cid, @aid,
           ISNULL(@dg, CAST(SYSDATETIME() AS DATE)), @rem, @st, @cl,
           @tl, @sp, 1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, LeadUid: uid });
  } catch (e) {
    console.error("[sa-leads] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Allowed forward transitions per status
const STATUS_TRANSITIONS = {
  New: ["New", "Assigned", "Contacted", "Lost"],
  Assigned: ["Assigned", "Contacted", "Lost"],
  Contacted: ["Contacted", "VisitScheduled", "Lost"],
  VisitScheduled: ["VisitScheduled", "Visited", "Lost"],
  Visited: ["Visited", "InFollowup", "Booked", "Lost"],
  InFollowup: ["InFollowup", "Booked", "Lost"],
  Booked: ["Booked"],
  Lost: ["Lost"],
};

// PUT /:id — update lead (with audit trail + notifications)
router.put("/:id", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const leadId = parseInt(req.params.id);
    const actor = actorId(req);

    // Fetch current state for transition validation + audit comparison
    const currentResult = await pool.request()
      .input("id", sql.Int, leadId)
      .query(`
        SELECT LeadUid, Status, Classification,
               AssignedTeamLeadId, AssignedSalespersonId, CustomerRemarks
        FROM dbo.SaLead WHERE Id = @id AND IsActive = 1
      `);
    if (!currentResult.recordset.length) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const old = currentResult.recordset[0];

    // Scope check — non-admins can only edit leads within their own scope
    if (!isSaAdmin(req)) {
      const scopeReq = pool.request();
      const scope = applyLeadScope(scopeReq, req, "l");
      const scopeCheck = await scopeReq.input("lid", sql.Int, leadId)
        .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
      if (!scopeCheck.recordset.length) return res.status(403).json({ error: "Access denied" });
    }

    // Validate status transition
    if (b.Status && b.Status !== old.Status) {
      const allowed = STATUS_TRANSITIONS[old.Status] || [];
      if (!allowed.includes(b.Status)) {
        return res.status(400).json({ error: `Cannot transition lead from '${old.Status}' to '${b.Status}'` });
      }
    }

    await pool.request()
      .input("id",  sql.Int,           leadId)
      .input("cn",  sql.NVarChar(200), b.CustomerName || null)
      .input("mob", sql.NVarChar(20),  b.Mobile || null)
      .input("alt", sql.NVarChar(20),  b.AltMobile || null)
      .input("em",  sql.NVarChar(200), b.Email || null)
      .input("pid", sql.Int,           b.PlatformId || null)
      .input("cid", sql.Int,           b.CampaignId || null)
      .input("aid", sql.Int,           b.AdId || null)
      .input("dg",  sql.Date,          b.DateGenerated || null)
      .input("rem", sql.NVarChar(sql.MAX), b.CustomerRemarks || null)
      .input("st",  sql.NVarChar(30),  b.Status !== undefined ? b.Status : old.Status)
      .input("cl",  sql.NVarChar(30),  b.Classification || null)
      .input("tl",  sql.Int,           b.AssignedTeamLeadId || null)
      .input("sp",  sql.Int,           b.AssignedSalespersonId || null)
      .input("ub",  sql.Int,           actor)
      .query(`
        UPDATE dbo.SaLead SET
          CustomerName = @cn, Mobile = @mob, AltMobile = @alt, Email = @em,
          PlatformId = @pid, CampaignId = @cid, AdId = @aid,
          DateGenerated = ISNULL(@dg, DateGenerated),
          CustomerRemarks = @rem, Status = @st, Classification = @cl,
          AssignedTeamLeadId = @tl, AssignedSalespersonId = @sp,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Audit: compare old vs new for tracked fields
    const auditFields = [
      { field: "Status",               oldVal: old.Status,               newVal: b.Status },
      { field: "Classification",       oldVal: old.Classification,       newVal: b.Classification },
      { field: "AssignedTeamLeadId",   oldVal: old.AssignedTeamLeadId,   newVal: b.AssignedTeamLeadId },
      { field: "AssignedSalespersonId",oldVal: old.AssignedSalespersonId,newVal: b.AssignedSalespersonId },
      { field: "CustomerRemarks",      oldVal: old.CustomerRemarks,      newVal: b.CustomerRemarks },
    ];
    for (const af of auditFields) {
      const o = af.oldVal == null ? "" : String(af.oldVal);
      const n = af.newVal == null ? "" : String(af.newVal);
      if (o !== n) {
        await pool.request()
          .input("LeadId",   sql.Int,           leadId)
          .input("Field",    sql.NVarChar(50),  af.field)
          .input("OldValue", sql.NVarChar(500), o || null)
          .input("NewValue", sql.NVarChar(500), n || null)
          .input("ChangedBy",sql.Int,           actor)
          .query(`
            INSERT INTO dbo.SaLeadAudit (LeadId, Field, OldValue, NewValue, ChangedBy)
            VALUES (@LeadId, @Field, @OldValue, @NewValue, @ChangedBy)
          `);
      }
    }

    // Notify new TL when AssignedTeamLeadId changes
    const newTl = b.AssignedTeamLeadId ? parseInt(b.AssignedTeamLeadId) : null;
    if (newTl && String(newTl) !== String(old.AssignedTeamLeadId ?? "")) {
      await emitNotification(pool, newTl, "lead_assigned",
        "Lead Assigned to Your Team",
        `Lead ${old.LeadUid} has been assigned to your team.`,
        leadId);
    }

    // Notify new SP when AssignedSalespersonId changes
    const newSp = b.AssignedSalespersonId ? parseInt(b.AssignedSalespersonId) : null;
    if (newSp && String(newSp) !== String(old.AssignedSalespersonId ?? "")) {
      await emitNotification(pool, newSp, "lead_assigned",
        "Lead Assigned to You",
        `Lead ${old.LeadUid} has been assigned to you for follow-up.`,
        leadId);
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[sa-leads] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id/audit — audit trail for a lead
router.get("/:id/audit", requirePageRight("sa-leads", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const leadId = parseInt(req.params.id, 10);
    // Verify caller has scope access to this lead before returning its audit trail
    if (!isSaAdmin(req)) {
      const scopeReq = pool.request();
      const scope = applyLeadScope(scopeReq, req, "l");
      const check = await scopeReq.input("lid", sql.Int, leadId)
        .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
      if (!check.recordset.length) return res.status(403).json({ error: "Access denied" });
    }
    const result = await pool.request()
      .input("id", sql.Int, leadId)
      .query(`
        SELECT a.Id, a.LeadId, a.Field, a.OldValue, a.NewValue,
               a.ChangedAt, u.name AS ChangedByName
        FROM dbo.SaLeadAudit a
        LEFT JOIN dbo.Users u ON u.id = a.ChangedBy
        WHERE a.LeadId = @id
        ORDER BY a.ChangedAt DESC
      `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-leads] GET audit error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id — soft delete
router.delete("/:id", requirePageRight("sa-leads", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const leadId = parseInt(req.params.id, 10);
    if (!isSaAdmin(req)) {
      const scopeReq = pool.request();
      const scope = applyLeadScope(scopeReq, req, "l");
      const check = await scopeReq.input("lid", sql.Int, leadId)
        .query(`SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND l.IsActive = 1 AND ${scope}`);
      if (!check.recordset.length) return res.status(403).json({ error: "Access denied" });
    }
    await pool.request()
      .input("id", sql.Int, leadId)
      .query("UPDATE dbo.SaLead SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-leads] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/promote-followup
router.post("/:id/promote-followup", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await promoteLeadToFollowup(pool, parseInt(req.params.id), actorId(req));
    if (result.alreadyPromoted) return res.json({ message: "Already promoted", applicantId: result.applicantId });
    res.json({ success: true, applicantId: result.applicantId });
  } catch (e) {
    console.error("[sa-leads] promote-followup error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/promote-booking
router.post("/:id/promote-booking", requirePageRight("sa-leads", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await promoteLeadToBooking(pool, parseInt(req.params.id), req.body, actorId(req));
    if (result.alreadyBooked) return res.json({ message: "Already booked", bookingId: result.bookingId });
    res.json({ success: true, bookingId: result.bookingId });
  } catch (e) {
    console.error("[sa-leads] promote-booking error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
