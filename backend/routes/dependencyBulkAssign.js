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
 * allocation changes. Each write re-checks emptiness itself (NOT EXISTS / WHERE),
 * so it also holds if someone edits the same activity while a run is in progress.
 * Cancelled and Approved activities are skipped.
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
const { invalidateThread } = require("../services/activityThread");

const SKIP_STATUSES = new Set(["CANCELLED", "APPROVED"]);
const MAX_ACTIVITIES = 10000;

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

/** What each activity in scope needs, given what it already has. */
async function planFor(executor, p) {
  const req = executor.request().input("projectId", sql.Int, p.projectId);
  if (p.towerId != null) req.input("towerId", sql.Int, p.towerId);
  const r = await req.query(`
    SELECT dma.Id AS rungId, daa.Id AS assignmentId, daa.Status AS status, daa.ApprovalLevelsJson AS levelsJson,
           (SELECT COUNT(*) FROM dbo.DependencyActivityEngineer e WHERE e.AssignmentId = daa.Id) AS engCount,
           (SELECT COUNT(*) FROM dbo.DependencyActivityQcAssignee q WHERE q.AssignmentId = daa.Id) AS qcCount
    FROM dbo.DependencyMasterActivity dma
    JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
    LEFT JOIN dbo.DependencyActivityAssignment daa
           ON daa.DependencyMasterActivityId = dma.Id AND daa.IsCurrent = 1
    WHERE dm.ProjectId = @projectId AND ISNULL(dm.IsActive, 1) = 1
      ${p.towerId != null ? "AND dm.TowerId = @towerId" : ""}
    ORDER BY dma.Id
  `);

  const summary = {
    totalActivities: r.recordset.length,
    skippedCancelledOrApproved: 0,
    eligible: 0,
    willChange: 0,
    engineers: { requested: p.engineerIds.length > 0, willFill: 0, alreadySet: 0 },
    qc: { requested: p.qcUserIds.length > 0, willFill: 0, alreadySet: 0 },
    approval: { requested: p.approvalLevels.length > 0, willFill: 0, alreadySet: 0 },
  };
  const rows = [];
  for (const row of r.recordset) {
    if (row.status && SKIP_STATUSES.has(row.status)) {
      summary.skippedCancelledOrApproved += 1;
      continue;
    }
    summary.eligible += 1;
    let hasLevels = false;
    try {
      hasLevels = JSON.parse(row.levelsJson || "[]").length > 0;
    } catch {
      hasLevels = false;
    }
    const needEng = p.engineerIds.length > 0 && !(row.engCount > 0);
    const needQc = p.qcUserIds.length > 0 && !(row.qcCount > 0);
    const needAppr = p.approvalLevels.length > 0 && !hasLevels;
    if (p.engineerIds.length) (needEng ? summary.engineers.willFill++ : summary.engineers.alreadySet++);
    if (p.qcUserIds.length) (needQc ? summary.qc.willFill++ : summary.qc.alreadySet++);
    if (p.approvalLevels.length) (needAppr ? summary.approval.willFill++ : summary.approval.alreadySet++);
    if (needEng || needQc || needAppr) {
      summary.willChange += 1;
      rows.push({ rungId: row.rungId, assignmentId: row.assignmentId, status: row.status, needEng, needQc, needAppr });
    }
  }
  return { summary, rows };
}

const guard = requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit");

async function handle(req, res, apply) {
  const p = parseRequest(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  if (!assertProjectAllowed(req, res, p.projectId)) return;

  try {
    const pool = getPool();
    const { summary, rows } = await planFor(pool, p);
    if (summary.eligible > MAX_ACTIVITIES) {
      return res.status(400).json({ error: `That is ${summary.eligible} activities — pick a single block to stay under ${MAX_ACTIVITIES}.` });
    }
    if (!apply) return res.json({ applied: false, summary });

    const actor = req.user?.email || req.user?.name || "system";
    const levelsJson = JSON.stringify(p.approvalLevels);
    const engValues = p.engineerIds.map((id) => `(${id})`).join(",");
    const qcValues = p.qcUserIds.map((id) => `(${id})`).join(",");

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const changedRungs = [];
    const done = { engineers: 0, qc: 0, approval: 0, created: 0 };
    try {
      for (const row of rows) {
        let assignmentId = row.assignmentId;
        let touched = false;
        if (!assignmentId) {
          const ins = await tx.request()
            .input("rungId", sql.Int, row.rungId)
            .input("levels", sql.NVarChar(sql.MAX), row.needAppr ? levelsJson : "[]")
            .input("by", sql.NVarChar(200), actor)
            .query(`
              INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, ApprovalLevelsJson, CreatedBy)
              OUTPUT INSERTED.Id AS id
              VALUES (@rungId, @levels, @by)
            `);
          assignmentId = ins.recordset[0].id;
          done.created += 1;
          if (row.needAppr) done.approval += 1;
          touched = true;
        } else if (row.needAppr) {
          const u = await tx.request()
            .input("id", sql.Int, assignmentId)
            .input("levels", sql.NVarChar(sql.MAX), levelsJson)
            .input("by", sql.NVarChar(200), actor)
            .query(`
              UPDATE dbo.DependencyActivityAssignment
              SET ApprovalLevelsJson = @levels, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              WHERE Id = @id AND (ApprovalLevelsJson IS NULL OR LTRIM(RTRIM(ApprovalLevelsJson)) IN ('', '[]'))
            `);
          if (u.rowsAffected[0] > 0) {
            done.approval += 1;
            touched = true;
          }
        }

        if (row.needEng) {
          const e = await tx.request().input("a", sql.Int, assignmentId).query(`
            INSERT INTO dbo.DependencyActivityEngineer (AssignmentId, EngineerId)
            SELECT @a, v.id FROM (VALUES ${engValues}) v(id)
            WHERE NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @a)
          `);
          if (e.rowsAffected[0] > 0) {
            done.engineers += 1;
            touched = true;
            // Same rule as the single save: assigned people move PENDING -> ALLOCATED.
            await tx.request().input("a", sql.Int, assignmentId).query(
              "UPDATE dbo.DependencyActivityAssignment SET Status = 'ALLOCATED' WHERE Id = @a AND Status = 'PENDING'",
            );
          }
        }

        if (row.needQc) {
          const q = await tx.request().input("a", sql.Int, assignmentId).query(`
            INSERT INTO dbo.DependencyActivityQcAssignee (AssignmentId, QcUserId)
            SELECT @a, v.id FROM (VALUES ${qcValues}) v(id)
            WHERE NOT EXISTS (SELECT 1 FROM dbo.DependencyActivityQcAssignee WHERE AssignmentId = @a)
          `);
          if (q.rowsAffected[0] > 0) {
            done.qc += 1;
            touched = true;
          }
        }
        if (touched) changedRungs.push(row.rungId);
      }
      await tx.commit();
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* original error is what matters */
      }
      throw err;
    }

    // Comment threads cache who may use them; engineers / approvers just changed.
    changedRungs.forEach((id) => invalidateThread(id));
    res.json({ applied: true, summary, changed: { activities: changedRungs.length, ...done } });
  } catch (err) {
    console.error("[dependency-bulk-assign]", apply ? "apply" : "preview", "error:", err.message);
    res.status(500).json({ error: "Bulk assignment failed — nothing was changed." });
  }
}

router.post("/preview", guard, (req, res) => handle(req, res, false));
router.post("/apply", guard, (req, res) => handle(req, res, true));

module.exports = router;
module.exports._test = { parseRequest, normalizeLevels, toIntList };
