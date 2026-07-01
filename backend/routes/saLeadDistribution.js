const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { applyLeadScope, actorId } = require("../services/saAccess");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
router.use(authMiddleware);

// GET / — distribution history scoped by role
router.get("/", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const req2 = pool.request();
    const scope = applyLeadScope(req2, req, "l");
    const r = await req2.query(`
      SELECT
        d.Id, d.LeadId, d.FromUserId, d.ToUserId, d.Level, d.Method,
        d.DistributedAt, d.DistributedBy,
        l.LeadUid, l.CustomerName, l.Mobile,
        fu.name AS FromUserName,
        tu.name AS ToUserName
      FROM dbo.SaLeadDistribution d
      JOIN  dbo.SaLead l ON d.LeadId = l.Id
      LEFT JOIN dbo.Users fu ON d.FromUserId = fu.id
      LEFT JOIN dbo.Users tu ON d.ToUserId = tu.id
      WHERE ${scope}
      ORDER BY d.DistributedAt DESC
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-lead-distribution] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /pending — leads waiting to be distributed at the given level
router.get("/pending", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const level = parseInt(req.query.level) || 1;
    const req2 = pool.request().input("level", sql.Int, level);
    const scope2 = applyLeadScope(req2, req, "l");
    const r = await req2.query(`
      SELECT
        l.Id, l.LeadUid, l.CustomerName, l.Mobile, l.Status, l.DateGenerated,
        l.PlatformId, l.CampaignId,
        p.Name AS PlatformName,
        c.Name AS CampaignName
      FROM dbo.SaLead l
      LEFT JOIN dbo.SaSocialMediaPlatform p ON l.PlatformId = p.Id
      LEFT JOIN dbo.SaCampaign c ON l.CampaignId = c.Id
      WHERE l.IsActive = 1
        AND (${scope2})
        AND (
          (@level = 1 AND l.Status = 'New')
          OR (@level = 2 AND l.Status = 'Assigned' AND l.AssignedTeamLeadId IS NOT NULL AND l.AssignedSalespersonId IS NULL)
        )
      ORDER BY l.DateGenerated ASC
    `);
    res.json(r.recordset);
  } catch (e) {
    console.error("[sa-lead-distribution] GET /pending error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /distribute — manually distribute a set of leads
router.post("/distribute", requirePageRight("sa-lead-distribution", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const { leadIds, assignments, method, level } = req.body;
    const distributedBy = actorId(req);

    if (!Array.isArray(leadIds) || !Array.isArray(assignments) || !leadIds.length || !assignments.length) {
      return res.status(400).json({ error: "leadIds and assignments required" });
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      for (const asgn of assignments) {
        const { userId, leadIdList } = asgn;
        for (const lid of leadIdList) {
          await tx.request()
            .input("lid", sql.Int, lid)
            .input("fuid", sql.Int, distributedBy || null)
            .input("tuid", sql.Int, userId)
            .input("lvl", sql.Int, level || 1)
            .input("mth", sql.NVarChar(20), method || "Equal")
            .input("dby", sql.Int, distributedBy || null)
            .query(`
              INSERT INTO dbo.SaLeadDistribution
                (LeadId, FromUserId, ToUserId, Level, Method, DistributedAt, DistributedBy)
              VALUES (@lid, @fuid, @tuid, @lvl, @mth, SYSDATETIME(), @dby)
            `);

          if (level === 1) {
            await tx.request()
              .input("lid", sql.Int, lid)
              .input("tuid", sql.Int, userId)
              .query("UPDATE dbo.SaLead SET AssignedTeamLeadId = @tuid, Status = 'Assigned', UpdatedAt = SYSDATETIME() WHERE Id = @lid");
          } else {
            await tx.request()
              .input("lid", sql.Int, lid)
              .input("tuid", sql.Int, userId)
              .query("UPDATE dbo.SaLead SET AssignedSalespersonId = @tuid, Status = 'Assigned', UpdatedAt = SYSDATETIME() WHERE Id = @lid");
          }
        }
      }
      await tx.commit();
      res.json({ success: true, distributed: leadIds.length });
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } catch (e) {
    console.error("[sa-lead-distribution] POST /distribute error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
