const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { resolveDistributionForLead } = require("../services/saDistributionEngine");

router.use(authMiddleware);

// GET all rules with their members
router.get("/", requirePageRight("sa-lead-distribution", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const rules = await pool.request().query(`
      SELECT r.Id, r.Level, r.ScopeType, r.ScopeId, r.Method, r.IsActive, r.CreatedAt,
        c.Name AS ScopeCampaignName, c.CampaignCode AS ScopeCampaignCode,
        tl.name AS ScopeTeamLeadName
      FROM dbo.SaDistributionRule r
      LEFT JOIN dbo.SaCampaign c ON r.ScopeType = 'Campaign' AND r.ScopeId = c.Id
      LEFT JOIN dbo.Users tl ON r.ScopeType = 'TeamLead' AND r.ScopeId = tl.id
      ORDER BY r.Level, r.ScopeType, r.CreatedAt DESC
    `);
    const members = await pool.request().query(`
      SELECT m.Id, m.RuleId, m.UserId, m.Weight, m.IsActive, m.SortOrder, u.name AS UserName
      FROM dbo.SaDistributionRuleMember m
      LEFT JOIN dbo.Users u ON m.UserId = u.id
      WHERE m.IsActive = 1
      ORDER BY m.RuleId, m.SortOrder
    `);
    const byRule = {};
    members.recordset.forEach((m) => {
      if (!byRule[m.RuleId]) byRule[m.RuleId] = [];
      byRule[m.RuleId].push(m);
    });
    const result = rules.recordset.map((r) => ({ ...r, members: byRule[r.Id] || [] }));
    res.json(result);
  } catch (err) {
    console.error("[sa-distribution-rules] GET error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST create a rule with members
router.post("/", requirePageRight("sa-lead-distribution", "create"), async (req, res) => {
  const { Level, ScopeType, ScopeId, Method, members } = req.body;
  if (!Level || !ScopeType || !Method || !Array.isArray(members) || !members.length)
    return res.status(400).json({ error: "Level, ScopeType, Method, and at least one member are required" });
  if (["Campaign", "TeamLead"].includes(ScopeType) && !ScopeId)
    return res.status(400).json({ error: `ScopeId is required when ScopeType is '${ScopeType}'` });
  const createdBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const insertRule = await tx.request()
        .input("level", sql.Int, Level)
        .input("scopeType", sql.NVarChar(20), ScopeType)
        .input("scopeId", sql.Int, ScopeId || null)
        .input("method", sql.NVarChar(20), Method)
        .input("createdBy", sql.Int, createdBy)
        .query(`
          INSERT INTO dbo.SaDistributionRule (Level, ScopeType, ScopeId, Method, IsActive, CreatedBy, CreatedAt)
          VALUES (@level, @scopeType, @scopeId, @method, 1, @createdBy, SYSDATETIME());
          SELECT SCOPE_IDENTITY() AS Id;
        `);
      const ruleId = insertRule.recordset[0].Id;

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        await tx.request()
          .input("ruleId", sql.Int, ruleId)
          .input("userId", sql.Int, m.UserId)
          .input("weight", sql.Decimal(7, 2), m.Weight)
          .input("sortOrder", sql.Int, i)
          .query(`
            INSERT INTO dbo.SaDistributionRuleMember (RuleId, UserId, Weight, IsActive, SortOrder)
            VALUES (@ruleId, @userId, @weight, 1, @sortOrder)
          `);
      }
      await tx.commit();
      res.json({ message: "Distribution rule created", ruleId });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    console.error("[sa-distribution-rules] POST error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT update a rule's active state or method
router.put("/:id", requirePageRight("sa-lead-distribution", "edit"), async (req, res) => {
  const { Method, IsActive } = req.body;
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .input("method", sql.NVarChar(20), Method || null)
      .input("isActive", sql.Bit, IsActive !== false ? 1 : 0)
      .query(`
        UPDATE dbo.SaDistributionRule SET
          Method = ISNULL(@method, Method),
          IsActive = @isActive,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ message: "Rule updated" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT update a rule's members (replace the set)
router.put("/:id/members", requirePageRight("sa-lead-distribution", "edit"), async (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members) || !members.length)
    return res.status(400).json({ error: "At least one member is required" });
  try {
    const pool = getPool();
    const ruleId = parseInt(req.params.id);
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input("rid", sql.Int, ruleId)
        .query("UPDATE dbo.SaDistributionRuleMember SET IsActive = 0 WHERE RuleId = @rid");
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        await tx.request()
          .input("ruleId", sql.Int, ruleId)
          .input("userId", sql.Int, m.UserId)
          .input("weight", sql.Decimal(7, 2), m.Weight)
          .input("sortOrder", sql.Int, i)
          .query(`
            INSERT INTO dbo.SaDistributionRuleMember (RuleId, UserId, Weight, IsActive, SortOrder)
            VALUES (@ruleId, @userId, @weight, 1, @sortOrder)
          `);
      }
      await tx.commit();
      res.json({ message: "Members updated" });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE deactivate a rule
router.delete("/:id", requirePageRight("sa-lead-distribution", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    await pool.request()
      .input("id", sql.Int, parseInt(req.params.id))
      .query("UPDATE dbo.SaDistributionRule SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    res.json({ message: "Rule deactivated" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /run-now/:level — auto-distribute all eligible pending leads at a given level
router.post("/run-now/:level", requirePageRight("sa-lead-distribution", "create"), async (req, res) => {
  const level = parseInt(req.params.level);
  if (level !== 1 && level !== 2) return res.status(400).json({ error: "level must be 1 or 2" });
  const distributedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const pendingResult = await pool.request().query(
      level === 1
        ? `SELECT Id, CampaignId, AssignedTeamLeadId FROM dbo.SaLead WHERE IsActive = 1 AND Status = 'New'`
        : `SELECT Id, CampaignId, AssignedTeamLeadId FROM dbo.SaLead WHERE IsActive = 1 AND Status = 'Assigned' AND AssignedTeamLeadId IS NOT NULL AND AssignedSalespersonId IS NULL`
    );
    const pending = pendingResult.recordset;
    let distributedCount = 0;
    for (const lead of pending) {
      const result = await resolveDistributionForLead(pool, lead, level);
      if (!result) continue;

      // Wrap the distribution log INSERT and lead UPDATE atomically so a crash
      // between them can't leave an orphaned distribution row with a stale lead status.
      const tx = pool.transaction();
      await tx.begin();
      try {
        await tx.request()
          .input("lid", sql.Int, lead.Id)
          .input("fuid", sql.Int, distributedBy)
          .input("tuid", sql.Int, result.userId)
          .input("lvl", sql.Int, level)
          .input("dby", sql.Int, distributedBy)
          .query(`
            INSERT INTO dbo.SaLeadDistribution (LeadId, FromUserId, ToUserId, Level, Method, DistributedAt, DistributedBy)
            VALUES (@lid, @fuid, @tuid, @lvl, 'Auto', SYSDATETIME(), @dby)
          `);

        if (level === 1) {
          await tx.request()
            .input("lid", sql.Int, lead.Id)
            .input("tuid", sql.Int, result.userId)
            .query(`UPDATE dbo.SaLead SET AssignedTeamLeadId = @tuid, Status = 'Assigned', UpdatedAt = SYSDATETIME() WHERE Id = @lid`);
        } else {
          await tx.request()
            .input("lid", sql.Int, lead.Id)
            .input("tuid", sql.Int, result.userId)
            .query(`UPDATE dbo.SaLead SET AssignedSalespersonId = @tuid, UpdatedAt = SYSDATETIME() WHERE Id = @lid`);
        }
        await tx.commit();
        distributedCount++;
      } catch (txErr) {
        await tx.rollback();
        console.error(`[sa-distribution-rules] run-now tx failed for lead ${lead.Id}:`, txErr.message);
      }
    }
    res.json({ message: `Auto-distributed ${distributedCount} of ${pending.length} eligible leads`, distributedCount, eligibleCount: pending.length });
  } catch (err) {
    console.error("[sa-distribution-rules] run-now error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;