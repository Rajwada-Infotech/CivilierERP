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
const { distributableStatus } = require("../constants/saStatuses");

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
  let members = membersResult.recordset;
  if (!members.length) return null;

  // For Level 2 (TL → SP), restrict candidates to the team lead's SaSalesTeam
  // so a misconfigured rule cannot route leads outside the actual team.
  if (level === 2 && teamLeadUserId) {
    const teamResult = await pool.request()
      .input("tlid", sql.Int, teamLeadUserId)
      .query(`SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @tlid AND IsActive = 1`);
    const teamMemberIds = new Set(teamResult.recordset.map((r) => r.MemberUserId));
    members = members.filter((m) => teamMemberIds.has(m.UserId));
    if (!members.length) return null;
  }

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


/**
 * Hands out the leads waiting at a level by the standing distribution rules — level 1 to team
 * leads (New leads), level 2 to salespeople (Assigned, no salesperson yet). With leadIds, only
 * those of them. Each lead is written in its own transaction and re-checked under a lock, so two
 * runs at once can't hand the same lead out twice. Resolves { distributedCount, eligibleCount, assigned }.
 */
async function autoDistribute(pool, level, distributedBy, leadIds = null) {
  const pendingResult = await pool.request().query(
    level === 1
      ? `SELECT Id, CampaignId, AssignedTeamLeadId FROM dbo.SaLead WHERE IsActive = 1 AND Status = 'New'`
      : `SELECT Id, CampaignId, AssignedTeamLeadId FROM dbo.SaLead WHERE IsActive = 1 AND Status = 'Assigned' AND AssignedTeamLeadId IS NOT NULL AND AssignedSalespersonId IS NULL`
  );
  const only = leadIds ? new Set(leadIds.map(Number)) : null;
  const pending = only ? pendingResult.recordset.filter((l) => only.has(l.Id)) : pendingResult.recordset;
  let distributedCount = 0;
  const assigned = [];
  for (const lead of pending) {
    const result = await resolveDistributionForLead(pool, lead, level);
    if (!result) continue;

    // Wrap the distribution log INSERT and lead UPDATE atomically so a crash
    // between them can't leave an orphaned distribution row with a stale lead status.
    //
    // The pending list above was fetched once, up front, outside any
    // transaction - two concurrent /run-now calls (double-click, or a
    // scheduled job racing a manual trigger) could both see the same lead
    // as pending before either writes it, producing the exact duplicate
    // SaLeadDistribution row / fairness-skew bug already fixed for the
    // manual /distribute route (see saLeadDistribution.js). Re-check the
    // lead's eligibility under an UPDLOCK/HOLDLOCK inside this per-lead
    // transaction, same pattern, so a second concurrent run sees the
    // already-updated row and skips it.
    const tx = pool.transaction();
    await tx.begin();
    try {
      const assignedCol = level === 1 ? "AssignedTeamLeadId" : "AssignedSalespersonId";
      const cur = await tx.request().input("lid", sql.Int, lead.Id).input("st", sql.NVarChar(30), distributableStatus(level)).query(
        `SELECT ${assignedCol} AS assignedTo FROM dbo.SaLead WITH (UPDLOCK, HOLDLOCK) WHERE Id = @lid AND IsActive = 1 AND Status = @st`,
      );
      if (!cur.recordset.length || cur.recordset[0].assignedTo != null) {
        await tx.commit();
        continue;
      }

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
      assigned.push({ leadId: lead.Id, userId: result.userId });
    } catch (txErr) {
      await tx.rollback();
      console.error(`[sa-distribution-rules] run-now tx failed for lead ${lead.Id}:`, txErr.message);
    }
  }
  return { distributedCount, eligibleCount: pending.length, assigned };
}

module.exports = { resolveDistributionForLead, autoDistribute };