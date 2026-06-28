/**
 * Sales Automation — auto-distribution engine.
 *
 * resolveDistributionForLead(pool, lead, level)
 *   Finds the applicable SaDistributionRule for this lead at the given
 *   level (1 = Admin->TeamLead, 2 = TeamLead->Salesperson), then picks
 *   the next recipient using a deficit-based weighted round-robin so
 *   the running distribution converges to each member's target ratio
 *   over time (NOT a per-batch reset).
 *
 * Resolution order (Level 1): Campaign-scoped rule > Global rule > none.
 * Resolution order (Level 2): TeamLead-scoped rule > none.
 *   (No "global" L2 rule — each team lead's split is their own team.)
 *
 * Returns { ruleId, userId } or null if no active rule applies
 * (caller should leave the lead for manual distribution in that case).
 */
const { sql } = require("../db");

async function findApplicableRule(pool, level, campaignId, teamLeadUserId) {
  if (level === 1) {
    if (campaignId) {
      const campaignRule = await pool.request()
        .input("lvl", sql.Int, 1)
        .input("cid", sql.Int, campaignId)
        .query(`
          SELECT TOP 1 Id, Method FROM dbo.SaDistributionRule
          WHERE Level = @lvl AND ScopeType = 'Campaign' AND ScopeId = @cid AND IsActive = 1
        `);
      if (campaignRule.recordset.length) return campaignRule.recordset[0];
    }
    const globalRule = await pool.request()
      .input("lvl", sql.Int, 1)
      .query(`
        SELECT TOP 1 Id, Method FROM dbo.SaDistributionRule
        WHERE Level = @lvl AND ScopeType = 'Global' AND IsActive = 1
      `);
    return globalRule.recordset[0] || null;
  }

  if (level === 2) {
    if (!teamLeadUserId) return null;
    const tlRule = await pool.request()
      .input("lvl", sql.Int, 2)
      .input("tlid", sql.Int, teamLeadUserId)
      .query(`
        SELECT TOP 1 Id, Method FROM dbo.SaDistributionRule
        WHERE Level = @lvl AND ScopeType = 'TeamLead' AND ScopeId = @tlid AND IsActive = 1
      `);
    return tlRule.recordset[0] || null;
  }

  return null;
}

async function pickNextRecipient(pool, ruleId, level, campaignId, teamLeadUserId) {
  const membersResult = await pool.request()
    .input("rid", sql.Int, ruleId)
    .query(`
      SELECT Id, UserId, Weight, SortOrder
      FROM dbo.SaDistributionRuleMember
      WHERE RuleId = @rid AND IsActive = 1
      ORDER BY SortOrder ASC
    `);
  const members = membersResult.recordset;
  if (!members.length) return null;

  // RunningCount derived from history, not a stored counter (avoids drift).
  // For L1: count by ToUserId + Level=1, scoped to the same rule's scope
  //         (campaign-scoped rules only count distributions for that campaign;
  //          global rules count all L1 distributions that had no campaign-specific
  //          rule override -- approximated here by counting all L1 distributions
  //          to that user, which is correct for the common single-active-rule case).
  // For L2: count by ToUserId + Level=2 + FromUserId=teamLeadUserId.
  const counts = {};
  for (const m of members) {
    let countResult;
    if (level === 1) {
      countResult = await pool.request()
        .input("uid", sql.Int, m.UserId)
        .query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLeadDistribution WHERE ToUserId = @uid AND Level = 1`);
    } else {
      countResult = await pool.request()
        .input("uid", sql.Int, m.UserId)
        .input("fuid", sql.Int, teamLeadUserId)
        .query(`SELECT COUNT(*) AS Cnt FROM dbo.SaLeadDistribution WHERE ToUserId = @uid AND Level = 2 AND FromUserId = @fuid`);
    }
    counts[m.UserId] = countResult.recordset[0].Cnt;
  }

  const totalAssigned = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalWeight = members.reduce((a, m) => a + Number(m.Weight), 0);
  if (totalWeight <= 0) return null;

  let best = null;
  let bestDeficit = -Infinity;
  for (const m of members) {
    const targetCount = (Number(m.Weight) / totalWeight) * (totalAssigned + 1);
    const deficit = targetCount - counts[m.UserId];
    if (
      deficit > bestDeficit ||
      (deficit === bestDeficit && best && counts[m.UserId] < counts[best.UserId])
    ) {
      bestDeficit = deficit;
      best = m;
    }
  }
  return best ? best.UserId : null;
}

async function resolveDistributionForLead(pool, lead, level) {
  const teamLeadUserId = level === 2 ? lead.AssignedTeamLeadId : null;
  const rule = await findApplicableRule(pool, level, lead.CampaignId, teamLeadUserId);
  if (!rule) return null;

  const userId = await pickNextRecipient(pool, rule.Id, level, lead.CampaignId, teamLeadUserId);
  if (!userId) return null;

  return { ruleId: rule.Id, userId };
}

module.exports = { resolveDistributionForLead };