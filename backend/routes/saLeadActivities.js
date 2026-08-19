const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyLeadScope, actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(apiRateLimit);

const ACTIVITY_TYPES = ["Call","WhatsApp","Email","Meeting","Note","SMS","SiteVisit"];

// GET / — recent activities across all accessible leads (latest 200)
router.get("/", requirePageRight("sa-lead-activities", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope = applyLeadScope(req0, req, "l");
    const result = await req0.query(`
      SELECT TOP 200
        a.Id, a.LeadId, a.ActivityType, a.Direction, a.DurationSeconds,
        a.Outcome, a.Summary, a.NextFollowupDate, a.CreatedAt,
        u.name AS CreatedByName,
        l.LeadUid, l.CustomerName, l.Mobile, l.Status
      FROM dbo.SaLeadActivity a
      JOIN  dbo.SaLead l ON l.Id = a.LeadId
      LEFT JOIN dbo.Users u ON u.id = a.CreatedBy
      WHERE ${scope}
      ORDER BY a.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-lead-activities] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /lead/:leadId — activity timeline for a specific lead
router.get("/lead/:leadId", requirePageRight("sa-lead-activities", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const lid = parseInt(req.params.leadId);
    // Row-level check: verify caller can see this lead
    const req0 = pool.request().input("lid", sql.Int, lid);
    const scope = applyLeadScope(req0, req, "l");
    const check = await req0.query(
      `SELECT 1 AS ok FROM dbo.SaLead l WHERE l.Id = @lid AND ${scope}`
    );
    if (!check.recordset.length)
      return res.status(403).json({ error: "Access denied" });

    const result = await pool.request().input("lid", sql.Int, lid).query(`
      SELECT a.Id, a.ActivityType, a.Direction, a.DurationSeconds,
             a.Outcome, a.Summary, a.NextFollowupDate, a.CreatedAt,
             u.name AS CreatedByName
      FROM dbo.SaLeadActivity a
      LEFT JOIN dbo.Users u ON u.id = a.CreatedBy
      WHERE a.LeadId = @lid
      ORDER BY a.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-lead-activities] GET /lead/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /pending-followups — activities with NextFollowupDate <= today for current user
router.get("/pending-followups", requirePageRight("sa-lead-activities", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req0 = pool.request();
    const scope = applyLeadScope(req0, req, "l");
    const result = await req0.query(`
      SELECT
        a.Id, a.LeadId, a.ActivityType, a.Summary, a.NextFollowupDate, a.CreatedAt,
        l.LeadUid, l.CustomerName, l.Mobile, l.Status, l.Classification
      FROM dbo.SaLeadActivity a
      JOIN dbo.SaLead l ON l.Id = a.LeadId
      WHERE a.NextFollowupDate <= CAST(SYSDATETIME() AS DATE)
        AND ${scope}
        AND l.IsActive = 1
      ORDER BY a.NextFollowupDate ASC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[sa-lead-activities] GET /pending-followups error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /lead/:leadId — log a new activity
router.post("/lead/:leadId", requirePageRight("sa-lead-activities", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const lid = parseInt(req.params.leadId);
    const b   = req.body;
    const actor = actorId(req);

    if (!ACTIVITY_TYPES.includes(b.ActivityType))
      return res.status(400).json({ error: `Invalid ActivityType. Must be one of: ${ACTIVITY_TYPES.join(", ")}` });
    if (!b.Summary?.trim())
      return res.status(400).json({ error: "Summary is required" });

    await pool.request()
      .input("lid",      sql.Int,           lid)
      .input("type",     sql.NVarChar(30),  b.ActivityType)
      .input("dir",      sql.NVarChar(10),  b.Direction || null)
      .input("dur",      sql.Int,           b.DurationSeconds ? parseInt(b.DurationSeconds) : null)
      .input("outcome",  sql.NVarChar(50),  b.Outcome || null)
      .input("summary",  sql.NVarChar(sql.MAX), b.Summary.trim())
      .input("followup", sql.Date,          b.NextFollowupDate || null)
      .input("cb",       sql.Int,           actor)
      .query(`
        INSERT INTO dbo.SaLeadActivity
          (LeadId, ActivityType, Direction, DurationSeconds, Outcome, Summary, NextFollowupDate, CreatedBy)
        VALUES (@lid, @type, @dir, @dur, @outcome, @summary, @followup, @cb)
      `);

    // Stamp LastActivityAt on the lead
    await pool.request()
      .input("lid", sql.Int, lid)
      .query("UPDATE dbo.SaLead SET LastActivityAt = SYSDATETIME() WHERE Id = @lid");

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[sa-lead-activities] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit activity summary/followup
router.put("/:id", requirePageRight("sa-lead-activities", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    await pool.request()
      .input("id",      sql.Int,           parseInt(req.params.id))
      .input("summary", sql.NVarChar(sql.MAX), b.Summary?.trim() || null)
      .input("followup",sql.Date,          b.NextFollowupDate || null)
      .input("outcome", sql.NVarChar(50),  b.Outcome || null)
      .query(`
        UPDATE dbo.SaLeadActivity
        SET Summary = ISNULL(@summary, Summary),
            NextFollowupDate = @followup,
            Outcome = ISNULL(@outcome, Outcome)
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-lead-activities] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /:id
router.delete("/:id", requirePageRight("sa-lead-activities", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .query("DELETE FROM dbo.SaLeadActivity WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[sa-lead-activities] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
