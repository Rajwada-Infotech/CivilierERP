/**
 * dependencyBulkAssign.js — set Engineers, Quality Check reviewers and the
 * Approval Setup on EVERY activity of a project (optionally one block of it).
 *
 *   POST /api/dependency-bulk-assign/preview   (counts only — writes nothing)
 *   POST /api/dependency-bulk-assign/apply
 *   body: { projectId, towerId?, engineerIds?, qcUserIds?, approvalLevels? }
 *
 * "Fill empty only": a field that an activity already has (any engineers, any QC
 * reviewers, any approval levels) is NEVER overwritten, so nobody's existing
 * allocation changes. Cancelled and Approved activities are skipped.
 *
 * Performance: everything is set-based. Preview is ONE aggregate query that
 * returns counts only; apply is ONE batch of a few INSERT/UPDATE ... SELECT
 * statements inside a single transaction, so the number of round trips and the
 * cost per activity do not grow with the project size (the first version issued
 * several statements PER activity, which took minutes on a large project).
 * Each write still carries its own "only if empty" condition, so it also holds
 * if someone edits the same activity while a run is in progress.
 *
 * Mirrors what the single-activity save (POST /api/dependency-activity-assignment
 * /:rungId) does for these three fields: creates the assignment row if the
 * activity has none, and moves PENDING -> ALLOCATED once engineers are added.
 */
"use strict";

const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { assertProjectAllowed } = require("../services/projectScope");
const { requireAnyPageRight } = require("../middleware/requirePageRight");
const { invalidateAllThreads } = require("../services/activityThread");

const MAX_ACTIVITIES = 150000;

const toIntList = (v) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];

/** Same shape the single save stores: levels with no people are dropped. */
function normalizeLevels(levels) {
  return (Array.isArray(levels) ? levels : [])
    .map((lvl, i) => ({
      id: lvl?.id || `level-${i + 1}`,
      label: String(lvl?.label || `Level ${i + 1}`).slice(0, 200),
      userIds: toIntList(lvl?.userIds),
      mode: lvl?.mode === "any" ? "any" : "all",
    }))
    .filter((lvl) => lvl.userIds.length > 0);
}

function parseRequest(body) {
  const projectId = parseInt(body?.projectId, 10);
  if (!Number.isInteger(projectId)) return { error: "projectId is required." };
  let towerId = null;
  if (body?.towerId != null && body.towerId !== "") {
    towerId = parseInt(body.towerId, 10);
    if (!Number.isInteger(towerId)) return { error: "towerId must be a number." };
  }
  const engineerIds = toIntList(body?.engineerIds);
  const qcUserIds = toIntList(body?.qcUserIds);
  const approvalLevels = normalizeLevels(body?.approvalLevels);
  if (!engineerIds.length && !qcUserIds.length && !approvalLevels.length) {
    return { error: "Choose at least one of Engineers, Quality Check or Approval Setup to apply." };
  }
  return { projectId, towerId, engineerIds, qcUserIds, approvalLevels };
}

// Activities (rungs) of the chosen project / block. Only active chains.
const scopeWhere = (p) =>
  `dm.ProjectId = @projectId AND ISNULL(dm.IsActive, 1) = 1${p.towerId != null ? " AND dm.TowerId = @towerId" : ""}`;

const SKIPPED = `ISNULL(d.Status, '') IN ('CANCELLED', 'APPROVED')`;
const NO_LEVELS = `LTRIM(RTRIM(ISNULL(d.ApprovalLevelsJson, ''))) IN ('', '[]')`;

/** One aggregate query: counts per field, nothing materialised in Node. */
function buildPreviewSql(p) {
  const wantEng = p.engineerIds.length > 0 ? 1 : 0;
  const wantQc = p.qcUserIds.length > 0 ? 1 : 0;
  const wantAppr = p.approvalLevels.length > 0 ? 1 : 0;
  return `
    SELECT
      COUNT(*)                                              AS total,
      SUM(f.Skipped)                                        AS skipped,
      SUM(1 - f.Skipped)                                    AS eligible,
      SUM(CASE WHEN f.Skipped = 0 AND ((${wantEng} = 1 AND f.NoEng = 1) OR (${wantQc} = 1 AND f.NoQc = 1) OR (${wantAppr} = 1 AND f.NoAppr = 1)) THEN 1 ELSE 0 END) AS willChange,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantEng} = 1 AND f.NoEng = 1 THEN 1 ELSE 0 END)  AS engFill,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantEng} = 1 AND f.NoEng = 0 THEN 1 ELSE 0 END)  AS engSet,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantQc} = 1 AND f.NoQc = 1 THEN 1 ELSE 0 END)    AS qcFill,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantQc} = 1 AND f.NoQc = 0 THEN 1 ELSE 0 END)    AS qcSet,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantAppr} = 1 AND f.NoAppr = 1 THEN 1 ELSE 0 END) AS apprFill,
      SUM(CASE WHEN f.Skipped = 0 AND ${wantAppr} = 1 AND f.NoAppr = 0 THEN 1 ELSE 0 END) AS apprSet
    FROM (
      SELECT
        CASE WHEN ${SKIPPED} THEN 1 ELSE 0 END AS Skipped,
        CASE WHEN d.Id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer e WHERE e.AssignmentId = d.Id) THEN 1 ELSE 0 END AS NoEng,
        CASE WHEN d.Id IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityQcAssignee q WHERE q.AssignmentId = d.Id) THEN 1 ELSE 0 END AS NoQc,
        CASE WHEN d.Id IS NULL OR ${NO_LEVELS} THEN 1 ELSE 0 END AS NoAppr
      FROM dbo.DependencyMasterActivity dma
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      LEFT JOIN dbo.DependencyActivityAssignment d
             ON d.DependencyMasterActivityId = dma.Id AND d.IsCurrent = 1
      WHERE ${scopeWhere(p)}
    ) f`;
}

function summaryFrom(p, row) {
  const n = (v) => Number(v || 0);
  return {
    totalActivities: n(row.total),
    skippedCancelledOrApproved: n(row.skipped),
    eligible: n(row.eligible),
    willChange: n(row.willChange),
    engineers: { requested: p.engineerIds.length > 0, willFill: n(row.engFill), alreadySet: n(row.engSet) },
    qc: { requested: p.qcUserIds.length > 0, willFill: n(row.qcFill), alreadySet: n(row.qcSet) },
    approval: { requested: p.approvalLevels.length > 0, willFill: n(row.apprFill), alreadySet: n(row.apprSet) },
  };
}

/**
 * The whole write as ONE batch (ids are validated integers, so inlining the
 * VALUES lists is injection-safe; text goes through parameters).
 *
 * Shape, to keep the work per row as small as possible:
 *   1. #scope - the activities in scope (PK, built once; optionally a rung-id range)
 *   2. #t     - ONE pass over the existing live assignments: which of the three fields
 *               does each still lack? Only rows that need something are kept.
 *   3. create the missing assignments, writing their flags straight into #t
 *               (they start empty, so they need whatever was asked) and, when
 *               engineers are being added, starting them as ALLOCATED
 *   4. ONE UPDATE over the existing assignments for approval levels + PENDING->ALLOCATED
 *   5. engineers, then QC, inserted from #t (PK joins), counted with @@ROWCOUNT
 * No per-row OUTPUT tracking and no id list sent back to Node: the result is one
 * row of counts.
 */
function buildApplyBatch(p) {
  const wantEng = p.engineerIds.length > 0;
  const wantQc = p.qcUserIds.length > 0;
  const wantAppr = p.approvalLevels.length > 0;
  const live = `d.IsCurrent = 1 AND ISNULL(d.Status, '') NOT IN ('CANCELLED', 'APPROVED')`;
  const parts = [];

  parts.push(`
    SET NOCOUNT ON;
    CREATE TABLE #scope (RungId INT NOT NULL PRIMARY KEY);
    INSERT INTO #scope (RungId)
    SELECT dma.Id
    FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    WHERE ${scopeWhere(p)};
    CREATE TABLE #t (AssignmentId INT NOT NULL PRIMARY KEY, NeedEng BIT NOT NULL, NeedQc BIT NOT NULL, NeedAppr BIT NOT NULL, IsNew BIT NOT NULL);
    DECLARE @created INT = 0, @eng INT = 0, @qc INT = 0, @appr INT = 0;`);

  // Existing live assignments: which fields do they still lack?
  parts.push(`
    INSERT INTO #t (AssignmentId, NeedEng, NeedQc, NeedAppr, IsNew)
    SELECT x.AssignmentId, x.NeedEng, x.NeedQc, x.NeedAppr, 0
    FROM (
      SELECT d.Id AS AssignmentId,
        ${wantEng ? "CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer e WHERE e.AssignmentId = d.Id) THEN 1 ELSE 0 END" : "0"} AS NeedEng,
        ${wantQc ? "CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityQcAssignee q WHERE q.AssignmentId = d.Id) THEN 1 ELSE 0 END" : "0"} AS NeedQc,
        ${wantAppr ? `CASE WHEN ${NO_LEVELS} THEN 1 ELSE 0 END` : "0"} AS NeedAppr
      FROM dbo.DependencyActivityAssignment d
      JOIN #scope s ON s.RungId = d.DependencyMasterActivityId
      WHERE ${live}
    ) x
    WHERE x.NeedEng = 1 OR x.NeedQc = 1 OR x.NeedAppr = 1;`);

  // Activities with no assignment yet get one (the single save does the same).
  // New rows get their approval levels at creation and, if engineers are being
  // added, start as ALLOCATED (they receive their engineers just below).
  parts.push(`
    INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, ApprovalLevelsJson, CreatedBy${wantEng ? ", Status" : ""})
    OUTPUT INSERTED.Id, ${wantEng ? 1 : 0}, ${wantQc ? 1 : 0}, 0, 1 INTO #t (AssignmentId, NeedEng, NeedQc, NeedAppr, IsNew)
    SELECT s.RungId, ${wantAppr ? "@levels" : "'[]'"}, @by${wantEng ? ", 'ALLOCATED'" : ""}
    FROM #scope s
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.DependencyActivityAssignment x
      WHERE x.DependencyMasterActivityId = s.RungId AND x.IsCurrent = 1
    );
    SET @created = @@ROWCOUNT;`);

  // ONE pass over the existing assignments: approval levels and PENDING -> ALLOCATED.
  if (wantAppr || wantEng) {
    const sets = [];
    const conds = [];
    if (wantAppr) {
      sets.push(`d.ApprovalLevelsJson = CASE WHEN t.NeedAppr = 1 AND ${NO_LEVELS} THEN @levels ELSE d.ApprovalLevelsJson END`);
      conds.push("t.NeedAppr = 1");
    }
    if (wantEng) {
      // Same rule as the single save: assigned people move PENDING -> ALLOCATED.
      sets.push(`d.Status = CASE WHEN t.NeedEng = 1 AND d.Status = 'PENDING' THEN 'ALLOCATED' ELSE d.Status END`);
      conds.push("(t.NeedEng = 1 AND d.Status = 'PENDING')");
    }
    parts.push(`
    ${wantAppr ? "SELECT @appr = COUNT(*) FROM #t WHERE NeedAppr = 1 AND IsNew = 0;" : ""}
    UPDATE d SET ${sets.join(",\n      ")},
      d.UpdatedBy = @by, d.UpdatedAt = SYSDATETIME()
    FROM dbo.DependencyActivityAssignment d
    JOIN #t t ON t.AssignmentId = d.Id
    WHERE t.IsNew = 0 AND (${conds.join(" OR ")});`);
  }

  if (wantEng) {
    parts.push(`
    INSERT INTO dbo.DependencyActivityEngineer (AssignmentId, EngineerId)
    SELECT t.AssignmentId, v.id
    FROM #t t
    CROSS JOIN (VALUES ${p.engineerIds.map((id) => `(${id})`).join(",")}) v(id)
    WHERE t.NeedEng = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer e WHERE e.AssignmentId = t.AssignmentId);
    SET @eng = @@ROWCOUNT / ${p.engineerIds.length};`);
  }

  if (wantQc) {
    parts.push(`
    INSERT INTO dbo.DependencyActivityQcAssignee (AssignmentId, QcUserId)
    SELECT t.AssignmentId, v.id
    FROM #t t
    CROSS JOIN (VALUES ${p.qcUserIds.map((id) => `(${id})`).join(",")}) v(id)
    WHERE t.NeedQc = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityQcAssignee q WHERE q.AssignmentId = t.AssignmentId);
    SET @qc = @@ROWCOUNT / ${p.qcUserIds.length};`);
  }

  // One row of counts. `activities` = assignments that needed something; an
  // approval-only run creates rows that are complete at creation, so add those.
  parts.push(`
    SELECT
      @created                                                                AS created,
      @appr ${wantAppr ? "+ @created" : ""}                                    AS approval,
      @eng                                                                    AS engineers,
      @qc                                                                     AS qc,
      (SELECT COUNT(*) FROM #t WHERE NeedEng = 1 OR NeedQc = 1 OR NeedAppr = 1)${!wantEng && !wantQc ? " + @created" : ""} AS activities;`);

  return parts.join("\n");
}

const bindScope = (request, p) => {
  request.input("projectId", sql.Int, p.projectId);
  if (p.towerId != null) request.input("towerId", sql.Int, p.towerId);
  return request;
};

/** Cheap size check for apply (index-only), instead of the full per-field aggregate. */
async function countInScope(pool, p) {
  const r = await bindScope(pool.request(), p).query(`
    SELECT COUNT(*) AS n
    FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    WHERE ${scopeWhere(p)}`);
  return Number(r.recordset[0]?.n || 0);
}

/** The whole apply in ONE transaction: all or nothing. */
async function runBatch(pool, p, actor) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const request = bindScope(tx.request(), p).input("by", sql.NVarChar(200), actor);
    if (p.approvalLevels.length) request.input("levels", sql.NVarChar(sql.MAX), JSON.stringify(p.approvalLevels));
    const result = await request.query(buildApplyBatch(p));
    await tx.commit();
    return result.recordset?.[0] || result.recordsets?.[0]?.[0] || {};
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* original error is what matters */
    }
    throw err;
  }
}

const toChanged = (c) => ({
  activities: Number(c.activities || 0),
  engineers: Number(c.engineers || 0),
  qc: Number(c.qc || 0),
  approval: Number(c.approval || 0),
  created: Number(c.created || 0),
});

/** Every user id the request names must exist (a bad id would fail the whole write). */
async function findUnknownUsers(pool, p) {
  const ids = [...new Set([...p.engineerIds, ...p.qcUserIds, ...p.approvalLevels.flatMap((l) => l.userIds)])];
  if (!ids.length) return [];
  const r = await pool.request().query(`SELECT id FROM dbo.users WHERE id IN (${ids.join(",")})`);
  const found = new Set(r.recordset.map((x) => Number(x.id)));
  return ids.filter((id) => !found.has(id));
}

const guard = requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit");

const tooBig = (n) => ({ error: `That is ${n} activities — pick a single block to stay under ${MAX_ACTIVITIES}.` });

async function handle(req, res, apply) {
  const p = parseRequest(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (!assertProjectAllowed(req, res, p.projectId)) return;

  try {
    const pool = getPool();
    const unknown = await findUnknownUsers(pool, p);
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown user id(s): ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}.` });
    }

    if (!apply) {
      const row = (await bindScope(pool.request(), p).query(buildPreviewSql(p))).recordset[0] || {};
      const summary = summaryFrom(p, row);
      if (summary.eligible > MAX_ACTIVITIES) return res.status(400).json(tooBig(summary.eligible));
      return res.json({ applied: false, summary });
    }

    const inScope = await countInScope(pool, p);
    if (inScope > MAX_ACTIVITIES) return res.status(400).json(tooBig(inScope));

    const actor = req.user?.email || req.user?.name || "system";

    // ONE transaction - all or nothing. (Splitting a huge run into parallel slices
    // was measured and does not help: the slices queue behind each other's table
    // locks and the log, so it only adds a worse failure mode.)
    const changed = toChanged(await runBatch(pool, p, actor));
    // Comment threads cache who may use them; engineers / approvers just changed.
    if (changed.activities > 0) invalidateAllThreads();
    res.json({ applied: true, changed });
  } catch (err) {
    console.error("[dependency-bulk-assign]", apply ? "apply" : "preview", "error:", err.message);
    res.status(500).json({ error: "Bulk assignment failed — nothing was changed." });
  }
}

router.post("/preview", guard, (req, res) => handle(req, res, false));
router.post("/apply", guard, (req, res) => handle(req, res, true));

module.exports = router;
module.exports._test = { parseRequest, normalizeLevels, toIntList, buildPreviewSql, buildApplyBatch, summaryFrom, MAX_ACTIVITIES };
