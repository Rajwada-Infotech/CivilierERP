const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyLeadScope, actorId } = require("../services/saAccess");

router.use(authMiddleware);

// GET / — all inquiry calls (row-level scoped via the joined lead)
router.get("/", requirePageRight("sa-inquiry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope0 = applyLeadScope(req0, req, "l");
    const r = await req0.query(`
      SELECT
        c.Id, c.LeadId, c.SalespersonId, c.CallTime, c.DurationSeconds,
        c.RecordingUrl, c.Outcome, c.Remarks, c.Classification, c.CreatedAt,
        l.LeadUid, l.CustomerName, l.Mobile, l.AltMobile, l.Email,
        l.Status AS LeadStatus, l.CampaignId, l.AdId, l.PlatformId,
        l.DateGenerated, l.CustomerRemarks AS PreviousRemarks,
        sp.name AS SalespersonName,
        p.Name AS PlatformName,
        cam.Name AS CampaignName
      FROM dbo.SaInquiryCall c
      JOIN  dbo.SaLead l ON c.LeadId = l.Id
      LEFT JOIN dbo.Users sp ON c.SalespersonId = sp.id
      LEFT JOIN dbo.SaSocialMediaPlatform p ON l.PlatformId = p.Id
      LEFT JOIN dbo.SaCampaign cam ON l.CampaignId = cam.Id
      WHERE ${scope0}
      ORDER BY c.CallTime DESC
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-inquiry] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /lead/:leadId — full detail for a single lead (info + call history, row-level scoped)
router.get("/lead/:leadId", requirePageRight("sa-inquiry", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const lid = parseInt(req.params.leadId);
    const req0 = pool.request().input("lid", sql.Int, lid);
    const scope = applyLeadScope(req0, req, "l");
    const lead = await req0.query(`
        SELECT
          l.*,
          p.Name AS PlatformName,
          cam.Name AS CampaignName,
          a.Name AS AdName,
          tl.name AS TeamLeadName,
          sp.name AS SalespersonName
        FROM dbo.SaLead l
        LEFT JOIN dbo.SaSocialMediaPlatform p ON l.PlatformId = p.Id
        LEFT JOIN dbo.SaCampaign cam ON l.CampaignId = cam.Id
        LEFT JOIN dbo.SaAd a ON l.AdId = a.Id
        LEFT JOIN dbo.Users tl ON l.AssignedTeamLeadId = tl.id
        LEFT JOIN dbo.Users sp ON l.AssignedSalespersonId = sp.id
        WHERE l.Id = @lid AND ${scope}
      `);
    const calls = await pool.request()
      .input("lid", sql.Int, lid)
      .query(`
        SELECT c.*, u.name AS SalespersonName
        FROM dbo.SaInquiryCall c
        LEFT JOIN dbo.Users u ON c.SalespersonId = u.id
        WHERE c.LeadId = @lid
        ORDER BY c.CallTime DESC
      `);
    if (!lead.recordset[0]) return res.status(404).json({ error: "Lead not found or access denied" });
    res.json({ lead: lead.recordset[0], calls: calls.recordset });
  } catch (e) {
    console.error("[sa-inquiry] GET /lead/:leadId error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /:leadId/call — log a call and update lead status/classification
router.post("/:leadId/call", requirePageRight("sa-inquiry", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const lid = parseInt(req.params.leadId);
    const b = req.body;

    await pool.request()
      .input("lid", sql.Int, lid)
      .input("spid", sql.Int, b.SalespersonId || actorId(req) || null)
      .input("ct", sql.DateTime2(3), b.CallTime || null)
      .input("dur", sql.Int, b.DurationSeconds || null)
      .input("rec", sql.NVarChar(500), b.RecordingUrl || null)
      .input("out", sql.NVarChar(50), b.Outcome || null)
      .input("rem", sql.NVarChar(sql.MAX), b.Remarks || null)
      .input("cl", sql.NVarChar(30), b.Classification || null)
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.SaInquiryCall
          (LeadId, SalespersonId, CallTime, DurationSeconds, RecordingUrl,
           Outcome, Remarks, Classification, CreatedBy, CreatedAt)
        VALUES
          (@lid, @spid, ISNULL(@ct, SYSDATETIME()), @dur, @rec,
           @out, @rem, @cl, @cb, SYSDATETIME())
      `);

    if (b.Classification) {
      await pool.request()
        .input("lid", sql.Int, lid)
        .input("cl", sql.NVarChar(30), b.Classification)
        .query(`
          UPDATE dbo.SaLead SET
            Classification = @cl,
            Status = CASE
              WHEN @cl = 'Hot' AND Status = 'Contacted' THEN 'FollowUp'
              ELSE Status
            END,
            UpdatedAt = SYSDATETIME()
          WHERE Id = @lid
        `);
    } else {
      await pool.request()
        .input("lid", sql.Int, lid)
        .query(`
          UPDATE dbo.SaLead SET
            Status = CASE WHEN Status = 'Assigned' THEN 'Contacted' ELSE Status END,
            UpdatedAt = SYSDATETIME()
          WHERE Id = @lid
        `);
    }

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[sa-inquiry] POST /:leadId/call error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
