const express = require("express");
const router = express.Router();
const multer = require("multer");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight, requireAnyPageRight } = require("../middleware/requirePageRight");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const PHOTO_PHASES = new Set(["before", "after"]);

const STATUS_VALUES = new Set(["PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "CANCELLED", "APPROVED", "REWORK", "COMPLETED"]);
const SOURCE_VALUES = new Set(["CONTRACTOR", "DEVELOPER"]);

// Rework forks a brand-new assignment attempt instead of mutating the
// rejected one in place (see migration 488's own comment) — the redo goes
// through the exact same Work Allocation -> Reporting -> QC -> Approval
// pipeline as a fresh activity, while the rejected attempt is kept,
// untouched, as history. Called from inside an already-open transaction
// by both the QC decision route (QC's own REWORK decision) and POST
// /:rungId/approval/reject (an approver rejecting a Completed, QC-passed
// activity instead of clearing it).
async function forkAssignmentForRework(tx, oldAssignmentId, rungId, reason, source, actor) {
  const old = (await new sql.Request(tx).input("id", sql.Int, oldAssignmentId).query(`
    SELECT AttemptNo, LabourSource, MaterialSource, LabourContractorId, MaterialContractorId,
           Description, ApprovalLevelsJson
    FROM dbo.DependencyActivityAssignment WHERE Id = @id
  `)).recordset[0];

  // Freeze the rejected attempt as history — no longer the current one,
  // and marked with why/how it was sent back.
  await new sql.Request(tx)
    .input("id", sql.Int, oldAssignmentId)
    .input("reason", sql.NVarChar(1000), reason || null)
    .input("source", sql.NVarChar(20), source)
    .input("by", sql.NVarChar(200), actor)
    .query(`
      UPDATE dbo.DependencyActivityAssignment
      SET IsCurrent = 0, ReworkReason = @reason, ReworkSource = @source, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);

  // The new attempt starts the whole Work Allocation cycle over — PENDING,
  // no progress, no dates — but keeps whatever describes the WORK itself
  // (labour/material source, description, the approval setup) so Work
  // Allocation opens pre-filled rather than blank.
  const ins = await new sql.Request(tx)
    .input("rungId", sql.Int, rungId)
    .input("attemptNo", sql.Int, (old?.AttemptNo || 1) + 1)
    .input("reworkFrom", sql.Int, oldAssignmentId)
    .input("labourSource", sql.NVarChar(20), old?.LabourSource || null)
    .input("materialSource", sql.NVarChar(20), old?.MaterialSource || null)
    .input("labourContractorId", sql.Int, old?.LabourContractorId ?? null)
    .input("materialContractorId", sql.Int, old?.MaterialContractorId ?? null)
    .input("description", sql.NVarChar(500), old?.Description || null)
    .input("approvalLevelsJson", sql.NVarChar(sql.MAX), old?.ApprovalLevelsJson || "[]")
    .input("by", sql.NVarChar(200), actor)
    .query(`
      INSERT INTO dbo.DependencyActivityAssignment
        (DependencyMasterActivityId, Status, AttemptNo, ReworkFromAssignmentId,
         LabourSource, MaterialSource, LabourContractorId, MaterialContractorId,
         Description, ApprovalLevelsJson, CreatedBy)
      OUTPUT INSERTED.Id AS id
      VALUES (@rungId, 'PENDING', @attemptNo, @reworkFrom,
              @labourSource, @materialSource, @labourContractorId, @materialContractorId,
              @description, @approvalLevelsJson, @by)
    `);
  const newAssignmentId = ins.recordset[0].id;

  // Carry forward materials, engineers and QC assignees — the redo is the
  // same scope of work, same people responsible, just a fresh attempt at
  // it. Work Allocation opens pre-filled and can still be changed there.
  await new sql.Request(tx).input("old", sql.Int, oldAssignmentId).input("new", sql.Int, newAssignmentId).query(`
    INSERT INTO dbo.DependencyActivityMaterial (AssignmentId, ItemId, Quantity)
    SELECT @new, ItemId, Quantity FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @old
  `);
  await new sql.Request(tx).input("old", sql.Int, oldAssignmentId).input("new", sql.Int, newAssignmentId).query(`
    INSERT INTO dbo.DependencyActivityEngineer (AssignmentId, EngineerId)
    SELECT @new, EngineerId FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @old
  `);
  await new sql.Request(tx).input("old", sql.Int, oldAssignmentId).input("new", sql.Int, newAssignmentId).query(`
    INSERT INTO dbo.DependencyActivityQcAssignee (AssignmentId, QcUserId)
    SELECT @new, QcUserId FROM dbo.DependencyActivityQcAssignee WHERE AssignmentId = @old
  `);

  return newAssignmentId;
}

// GET / — every rung that has been assigned an engineer/material at least
// once. Two callers share this: the Activity Reporting page (full list,
// across every chain) and Work Reporting's own "Link Dependency" card,
// which passes ?dependencyMasterId= to show just the saved flow for the
// chain currently picked there — so the gate accepts either page's view
// right rather than only Reporting's.
router.get(
  "/",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done", "civilworkdpr-quality-check"], "view"),
  async (req, res) => {
  const dependencyMasterId = req.query.dependencyMasterId ? parseInt(req.query.dependencyMasterId, 10) : null;
  const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
  try {
    const pool = await getPool();
    const request = pool.request();
    // Always the current attempt — a reworked rung can have older,
    // superseded assignment rows sitting alongside it (see migration 488),
    // and every list/tile/queue in the app should only ever see the live one.
    const conds = ["daa.IsCurrent = 1"];
    if (Number.isFinite(dependencyMasterId)) {
      request.input("dependencyMasterId", sql.Int, dependencyMasterId);
      conds.push("dm.Id = @dependencyMasterId");
    }
    if (statusFilter && STATUS_VALUES.has(statusFilter)) {
      request.input("statusFilter", sql.NVarChar(20), statusFilter);
      conds.push("daa.Status = @statusFilter");
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const r = await request.query(`
      SELECT
        daa.Id AS assignmentId,
        daa.DependencyMasterActivityId AS rungId,
        daa.StartDate AS startDate,
        daa.Days AS days,
        daa.EndDate AS endDate,
        daa.LabourSource AS labourSource,
        daa.MaterialSource AS materialSource,
        daa.Description AS description,
        daa.Remarks AS remarks,
        daa.Status AS status,
        daa.PreCancelStatus AS preCancelStatus,
        daa.ProgressPercent AS progressPercent,
        daa.AttemptNo AS attemptNo,
        daa.ReworkFromAssignmentId AS reworkFromAssignmentId,
        daa.ReworkReason AS reworkReason,
        daa.ReworkSource AS reworkSource,
        daa.UpdatedAt AS updatedAt,
        dma.SequenceNo AS sequenceNo,
        dma.ActivityId AS activityId, am.activity_name AS activityName,
        dm.Id AS dependencyMasterId, dm.Alias AS alias, dm.WorkType AS workType,
        dm.ProjectId AS projectId, ep.name AS projectName,
        dm.TowerId AS towerId, bm.BlockName AS towerName,
        dm.Floor AS floor,
        dm.FlatId AS flatId, um.UnitName AS flatName,
        dm.RoomId AS roomId, rm.RoomName AS roomName,
        CONCAT(
          ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor,
          ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—')
        ) AS scopePath,
        (
          SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
          FROM dbo.DependencyActivityEngineer dae
          JOIN dbo.users u ON u.id = dae.EngineerId
          WHERE dae.AssignmentId = daa.Id
        ) AS engineerNames,
        (
          SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
          FROM dbo.DependencyActivityQcAssignee daq
          JOIN dbo.users u ON u.id = daq.QcUserId
          WHERE daq.AssignmentId = daa.Id
        ) AS qcNames,
        (
          SELECT TOP 1 qc.Decision
          FROM dbo.DependencyActivityQc qc
          WHERE qc.AssignmentId = daa.Id
          ORDER BY qc.QcAt DESC, qc.Id DESC
        ) AS qcStatus,
        (
          SELECT img.M_Name AS name, dammat.Quantity AS quantity, img.M_UOM AS uom
          FROM dbo.DependencyActivityMaterial dammat
          JOIN dbo.Item_Master_Group img ON img.M_Id = dammat.ItemId
          WHERE dammat.AssignmentId = daa.Id
          ORDER BY img.M_Name ASC
          FOR JSON PATH
        ) AS materialsJson
      FROM dbo.DependencyActivityAssignment daa
      JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
      JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
      JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
      LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
      LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
      LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
      LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId
      ${where}
      ORDER BY daa.UpdatedAt DESC
    `);
    const rows = r.recordset.map(({ materialsJson, ...row }) => ({
      ...row,
      materials: materialsJson ? JSON.parse(materialsJson) : [],
    }));
    res.json(rows);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET / error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /amendments — Civil Work DPR's Amendment page: every superseded
// assignment attempt (IsCurrent = 0) across every chain, newest first.
// Every such row exists ONLY because it was reworked (see migration 488's
// fork-on-rework design — the only way IsCurrent ever becomes 0), so this
// is already exactly "every reworked activity", no extra status filter
// needed. currentStatus/currentAttemptNo describe whatever attempt
// eventually replaced it, so this reads as a log ("attempt 2 was sent
// back for rework by QC on this date; attempt 3 is now In Progress"), not
// just a pile of orphaned rows.
router.get(
  "/amendments",
  authMiddleware,
  requirePageRight("civilworkdpr-amendment", "view"),
  async (req, res) => {
    try {
      const pool = await getPool();
      const r = await pool.request().query(`
        SELECT
          daa.Id AS assignmentId,
          daa.DependencyMasterActivityId AS rungId,
          daa.AttemptNo AS attemptNo,
          daa.Status AS status,
          daa.ReworkReason AS reworkReason,
          daa.ReworkSource AS reworkSource,
          daa.StartDate AS startDate,
          daa.EndDate AS endDate,
          daa.UpdatedAt AS updatedAt,
          dma.SequenceNo AS sequenceNo,
          am.activity_name AS activityName,
          dm.Id AS dependencyMasterId, dm.Alias AS alias, dm.WorkType AS workType,
          dm.ProjectId AS projectId, ep.name AS projectName,
          dm.TowerId AS towerId, bm.BlockName AS towerName,
          dm.Floor AS floor,
          dm.FlatId AS flatId, um.UnitName AS flatName,
          dm.RoomId AS roomId, rm.RoomName AS roomName,
          CONCAT(
            ISNULL(bm.BlockName, '—'), ' > Floor ', dm.Floor,
            ' > ', ISNULL(um.UnitName, '—'), ' > ', ISNULL(rm.RoomName, '—')
          ) AS scopePath,
          (
            SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
            FROM dbo.DependencyActivityEngineer dae
            JOIN dbo.users u ON u.id = dae.EngineerId
            WHERE dae.AssignmentId = daa.Id
          ) AS engineerNames,
          cur.Status AS currentStatus,
          cur.AttemptNo AS currentAttemptNo
        FROM dbo.DependencyActivityAssignment daa
        JOIN dbo.DependencyMasterActivity dma ON dma.Id = daa.DependencyMasterActivityId
        JOIN dbo.DependencyMaster dm ON dm.Id = dma.DependencyMasterId
        JOIN dbo.ActivityMaster am ON am.id = dma.ActivityId
        LEFT JOIN dbo.enterprise  ep ON ep.id = dm.ProjectId AND ep.business_type = 'P'
        LEFT JOIN dbo.BlockMaster bm ON bm.Id = dm.TowerId
        LEFT JOIN dbo.UnitMaster  um ON um.Id = dm.FlatId
        LEFT JOIN dbo.RoomMaster  rm ON rm.Id = dm.RoomId
        LEFT JOIN dbo.DependencyActivityAssignment cur
          ON cur.DependencyMasterActivityId = daa.DependencyMasterActivityId AND cur.IsCurrent = 1
        WHERE daa.IsCurrent = 0
        ORDER BY daa.UpdatedAt DESC
      `);
      res.json(r.recordset);
    } catch (err) {
      console.error("[dependency-activity-assignment] GET /amendments error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── Quality Check ────────────────────────────────────────────────────────────
// QC inspects a Completed activity (work dragged to 100% in Reporting),
// signs off its checklist and either Approves it or sends it back for
// Rework. Goes through its own endpoint (not the generic status PATCH)
// because Completed can't otherwise move anywhere by hand; QC's
// Approved/Rework is the one sanctioned way out.

// GET /qc/:rungId/history: every past QC decision on this activity.
router.get(
  "/qc/:rungId/history",
  authMiddleware,
  requirePageRight("civilworkdpr-quality-check", "view"),
  async (req, res) => {
    const rungId = parseInt(req.params.rungId, 10);
    if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
    try {
      const pool = await getPool();
      const q = await pool.request().input("rungId", sql.Int, rungId).query(`
        SELECT qc.Id AS id, qc.Decision AS decision, qc.Remarks AS remarks, qc.QcAt AS qcAt,
               COALESCE(u.name, qc.QcBy) AS qcBy
        FROM dbo.DependencyActivityQc qc
        JOIN dbo.DependencyActivityAssignment daa ON daa.Id = qc.AssignmentId
        LEFT JOIN dbo.users u ON LOWER(u.email) = LOWER(qc.QcBy)
        WHERE daa.DependencyMasterActivityId = @rungId
        ORDER BY qc.QcAt DESC, qc.Id DESC
      `);
      const ids = q.recordset.map((r) => r.id);
      let checks = [];
      if (ids.length) {
        const c = await pool.request().query(`
          SELECT QcId AS qcId, FieldName AS fieldName, Passed AS passed, Rating AS rating, Note AS note
          FROM dbo.DependencyActivityQcCheck WHERE QcId IN (${ids.join(",")}) ORDER BY Id
        `);
        checks = c.recordset.map((r) => ({ ...r, passed: !!r.passed }));
      }
      res.json(q.recordset.map((r) => ({ ...r, checks: checks.filter((c) => c.qcId === r.id) })));
    } catch (err) {
      console.error("[dependency-activity-assignment] GET /qc/:rungId/history error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /qc/:rungId/decision. Body { decision: 'APPROVED'|'REWORK', remarks,
// checks: [{ checkpointId, rating: 'POOR'|'GOOD'|'EXCELLENT', note }] }.
// Each checkpoint is rated rather than a plain pass/fail toggle — Poor
// always fails it, Good/Excellent always pass it (derived server-side, not
// trusted from the client). Approving requires every checkpoint rated Good
// or Excellent; sending back for rework requires a remark, and un-ticks
// whichever checkpoints came back Poor so the engineer has to redo them.
router.post(
  "/qc/:rungId/decision",
  authMiddleware,
  requirePageRight("civilworkdpr-quality-check", "edit"),
  async (req, res) => {
    const rungId = parseInt(req.params.rungId, 10);
    if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
    const decision = String(req.body?.decision || "").toUpperCase();
    if (decision !== "APPROVED" && decision !== "REWORK") {
      return res.status(400).json({ error: "decision must be APPROVED or REWORK" });
    }
    const remarks = String(req.body?.remarks || "").trim().slice(0, 1000);
    const checks = Array.isArray(req.body?.checks) ? req.body.checks : [];
    if (decision === "REWORK" && remarks.length < 3) {
      return res.status(400).json({ error: "Add a remark explaining what needs rework." });
    }
    const actor = req.user?.email || req.user?.name || "system";

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      const a = await pool.request().input("rungId", sql.Int, rungId).query(
        "SELECT Id, Status, ApprovalLevelsJson FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
      );
      if (!a.recordset.length) return res.status(404).json({ error: "No assignment found for this activity." });
      const assignmentId = a.recordset[0].Id;
      if (a.recordset[0].Status !== "COMPLETED") {
        return res.status(400).json({ error: "Only a Completed activity (work dragged to 100%) can be quality-checked." });
      }
      let approvalLevels = [];
      try { approvalLevels = JSON.parse(a.recordset[0].ApprovalLevelsJson || "[]"); } catch { approvalLevels = []; }

      const cp = await pool.request().input("aid", sql.Int, assignmentId).query(
        "SELECT Id, FieldName FROM dbo.DependencyActivityCheckpoint WHERE AssignmentId = @aid ORDER BY SortOrder, Id",
      );
      const byId = new Map(cp.recordset.map((c) => [Number(c.Id), c]));
      const RATINGS = new Set(["POOR", "GOOD", "EXCELLENT"]);
      const verdict = new Map();
      for (const c of checks) {
        const id = Number(c.checkpointId);
        if (!byId.has(id)) continue;
        const rating = RATINGS.has(String(c.rating || "").toUpperCase()) ? String(c.rating).toUpperCase() : null;
        // Passed is derived from the rating, not trusted from the client —
        // Poor always fails a checkpoint, Good/Excellent always pass it.
        const passed = rating ? rating !== "POOR" : !!c.passed;
        verdict.set(id, { rating, passed, note: c.note ? String(c.note).slice(0, 500) : null });
      }
      const missing = cp.recordset.filter((c) => !verdict.get(Number(c.Id))?.passed);
      if (decision === "APPROVED" && missing.length) {
        return res.status(400).json({
          error: `Every checkpoint must be rated Good or Excellent before approval. Still open: ${missing.map((m) => m.FieldName).join(", ")}.`,
        });
      }

      await tx.begin();
      const ins = await new sql.Request(tx)
        .input("aid", sql.Int, assignmentId)
        .input("decision", sql.NVarChar(10), decision)
        .input("remarks", sql.NVarChar(1000), remarks || null)
        .input("by", sql.NVarChar(200), actor).query(`
          INSERT INTO dbo.DependencyActivityQc (AssignmentId, Decision, Remarks, QcBy)
          OUTPUT INSERTED.Id VALUES (@aid, @decision, @remarks, @by)
        `);
      const qcId = ins.recordset[0].Id;

      for (const c of cp.recordset) {
        const v = verdict.get(Number(c.Id));
        if (!v) continue;
        await new sql.Request(tx)
          .input("qcId", sql.Int, qcId)
          .input("cpId", sql.Int, c.Id)
          .input("field", sql.NVarChar(200), c.FieldName)
          .input("passed", sql.Bit, v.passed ? 1 : 0)
          .input("rating", sql.NVarChar(10), v.rating)
          .input("note", sql.NVarChar(500), v.note).query(`
            INSERT INTO dbo.DependencyActivityQcCheck (QcId, AssignmentCheckpointId, FieldName, Passed, Rating, Note)
            VALUES (@qcId, @cpId, @field, @passed, @rating, @note)
          `);
        if (decision === "REWORK" && !v.passed) {
          await new sql.Request(tx).input("cpId", sql.Int, c.Id)
            .query("UPDATE dbo.DependencyActivityCheckpoint SET IsChecked = 0 WHERE Id = @cpId");
        }
      }

      // Passing QC doesn't immediately finalize the activity if it has an
      // approval setup configured (ApprovalLevelsJson, from Work
      // Allocation's mini Approval Setup) — it stays Completed, now
      // awaiting that named approval chain (see /:rungId/approval below),
      // and only flips to APPROVED once every level clears. With no levels
      // configured there's nothing to wait on, so it finalizes immediately,
      // same as before this workflow existed.
      const finalStatus = decision === "APPROVED" && approvalLevels.length > 0 ? "COMPLETED" : decision;
      await new sql.Request(tx)
        .input("aid", sql.Int, assignmentId)
        .input("status", sql.NVarChar(20), finalStatus)
        .input("by", sql.NVarChar(200), actor).query(`
          UPDATE dbo.DependencyActivityAssignment
          SET Status = @status, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
          WHERE Id = @aid
        `);

      // A Rework decision forks a brand-new attempt right away — the
      // redo goes through Work Allocation again from a fresh PENDING
      // state, while this rejected attempt is kept as history (see
      // forkAssignmentForRework's own comment and migration 488).
      let reworkAssignmentId = null;
      if (finalStatus === "REWORK") {
        reworkAssignmentId = await forkAssignmentForRework(tx, assignmentId, rungId, remarks, "QC", actor);
      }

      await tx.commit();
      res.json({
        success: true,
        status: finalStatus,
        qcId,
        awaitingApproval: finalStatus === "COMPLETED" && decision === "APPROVED",
        reworkAssignmentId,
      });
    } catch (err) {
      try { await tx.rollback(); } catch (_) { /* not begun or already rolled back */ }
      console.error("[dependency-activity-assignment] POST /qc/:rungId/decision error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── Approval workflow ───────────────────────────────────────────────────────
// Enforces the per-assignment ApprovalLevelsJson config (Work Allocation's
// mini Approval Setup) once QC has passed a Completed activity. Levels
// clear strictly in order; a level with mode "all" needs every named
// userId to approve it, mode "any" needs just one. super_admin can clear
// any level regardless of who's named. Shared level-satisfaction logic
// between the two routes below (kept inline rather than factored out — the
// two call sites are the entire surface that needs it).
function satisfiedLevel(level, approvals) {
  const approvedIds = new Set(
    approvals.filter((x) => x.levelId === level.id).map((x) => Number(x.approverUserId)),
  );
  if (level.mode === "any") return level.userIds.some((id) => approvedIds.has(Number(id)));
  return level.userIds.length > 0 && level.userIds.every((id) => approvedIds.has(Number(id)));
}
function firstUnsatisfiedLevelIndex(levels, approvals) {
  for (let i = 0; i < levels.length; i++) {
    if (!satisfiedLevel(levels[i], approvals)) return i;
  }
  return null;
}

// GET /:rungId/approval — the workflow's current state: each level, who's
// cleared it so far, which level is next, and whether the viewer can act
// on it right now.
router.get(
  "/:rungId/approval",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "view"),
  async (req, res) => {
    const rungId = parseInt(req.params.rungId, 10);
    if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
    try {
      const pool = await getPool();
      const a = await pool.request().input("rungId", sql.Int, rungId).query(
        "SELECT Id, Status, ApprovalLevelsJson FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
      );
      if (!a.recordset.length) return res.status(404).json({ error: "No assignment found for this activity." });
      const assignmentId = a.recordset[0].Id;
      const status = a.recordset[0].Status;
      let levels = [];
      try { levels = JSON.parse(a.recordset[0].ApprovalLevelsJson || "[]"); } catch { levels = []; }

      const approvalsRes = await pool.request().input("aid", sql.Int, assignmentId).query(`
        SELECT da.LevelId AS levelId, da.ApproverUserId AS approverUserId, u.name AS approverName, da.ApprovedAt AS approvedAt
        FROM dbo.DependencyActivityApproval da
        LEFT JOIN dbo.users u ON u.id = da.ApproverUserId
        WHERE da.AssignmentId = @aid
        ORDER BY da.ApprovedAt ASC
      `);
      const approvals = approvalsRes.recordset;
      const currentLevelIndex = firstUnsatisfiedLevelIndex(levels, approvals);
      const currentLevel = currentLevelIndex != null ? levels[currentLevelIndex] : null;

      const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
      const isSuperAdmin = req.user?.role === "super_admin";
      const alreadyActed = currentLevel
        ? approvals.some((x) => x.levelId === currentLevel.id && Number(x.approverUserId) === Number(viewerUserId))
        : false;
      const canApprove =
        status === "COMPLETED" &&
        currentLevel != null &&
        !alreadyActed &&
        (isSuperAdmin || currentLevel.userIds.map(Number).includes(Number(viewerUserId)));

      res.json({
        status,
        levels: levels.map((l, i) => ({ ...l, satisfied: satisfiedLevel(l, approvals), current: i === currentLevelIndex })),
        approvals,
        currentLevelIndex,
        canApprove,
      });
    } catch (err) {
      console.error("[dependency-activity-assignment] GET /:rungId/approval error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// Shared by both the dedicated POST /:rungId/approval/approve route (used
// by ActivityDetailModal's own Approval tab) and the plain PUT
// /:rungId/approve alias (used by the shared Approval Inbox's generic
// ApprovalActions component, which always calls PUT .../<id>/approve) —
// same action, two entry points. The viewer clears whichever level is
// next in line; once the last level clears, the activity finally becomes
// APPROVED (it stayed Completed up to this point — see the QC decision
// route above).
async function handleApproveLevel(req, res) {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
  const isSuperAdmin = req.user?.role === "super_admin";
  if (!viewerUserId) return res.status(401).json({ error: "Not authenticated" });

  try {
    const pool = await getPool();
    const a = await pool.request().input("rungId", sql.Int, rungId).query(
      "SELECT Id, Status, ApprovalLevelsJson FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
    );
    if (!a.recordset.length) return res.status(404).json({ error: "No assignment found for this activity." });
    const assignmentId = a.recordset[0].Id;
    if (a.recordset[0].Status !== "COMPLETED") {
      return res.status(400).json({ error: "Only a Completed, QC-passed activity is awaiting approval." });
    }
    let levels = [];
    try { levels = JSON.parse(a.recordset[0].ApprovalLevelsJson || "[]"); } catch { levels = []; }
    if (!levels.length) return res.status(400).json({ error: "No approval setup is configured for this activity." });

    const approvalsRes = await pool.request().input("aid", sql.Int, assignmentId).query(
      "SELECT LevelId AS levelId, ApproverUserId AS approverUserId FROM dbo.DependencyActivityApproval WHERE AssignmentId = @aid",
    );
    const approvals = approvalsRes.recordset;
    const currentLevelIndex = firstUnsatisfiedLevelIndex(levels, approvals);
    if (currentLevelIndex == null) {
      return res.status(400).json({ error: "This activity has already cleared every approval level." });
    }
    const currentLevel = levels[currentLevelIndex];
    if (!isSuperAdmin && !currentLevel.userIds.map(Number).includes(Number(viewerUserId))) {
      return res.status(403).json({ error: "You're not named as an approver for this step." });
    }
    const already = approvals.some((x) => x.levelId === currentLevel.id && Number(x.approverUserId) === Number(viewerUserId));
    if (already) return res.status(400).json({ error: "You've already approved this step." });

    await pool.request()
      .input("aid", sql.Int, assignmentId)
      .input("levelId", sql.NVarChar(50), currentLevel.id)
      .input("levelIndex", sql.Int, currentLevelIndex)
      .input("userId", sql.Int, viewerUserId)
      .query(`
        INSERT INTO dbo.DependencyActivityApproval (AssignmentId, LevelId, LevelIndex, ApproverUserId)
        VALUES (@aid, @levelId, @levelIndex, @userId)
      `);

    // Levels clear strictly in order, so this level is only "the last
    // missing one" if it was also the last level overall.
    const fullyApproved = currentLevelIndex === levels.length - 1;
    if (fullyApproved) {
      await pool.request()
        .input("aid", sql.Int, assignmentId)
        .input("by", sql.NVarChar(200), req.user?.email || req.user?.name || "system")
        .query(`
          UPDATE dbo.DependencyActivityAssignment
          SET Status = 'APPROVED', UpdatedBy = @by, UpdatedAt = SYSDATETIME()
          WHERE Id = @aid
        `);
    }
    // newStatus/level/totalLevels match what the shared ApprovalActions
    // component (src/components/ApprovalActions.tsx) looks for to show its
    // "Level X of Y approved — awaiting further approval" toast instead of
    // a flat "approved" one.
    res.json({
      success: true,
      fullyApproved,
      newStatus: fullyApproved ? "Approved" : "Pending",
      level: currentLevelIndex + 1,
      totalLevels: levels.length,
    });
  } catch (err) {
    console.error("[dependency-activity-assignment] approve level error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// Shared by POST /:rungId/approval/reject (ActivityDetailModal's Approval
// tab) and the plain PUT /:rungId/reject alias (Approval Inbox's
// ApprovalActions, which always calls PUT .../<id>/reject with a body of
// { note, Remarks } — every field spelling this component's callers use
// across the codebase is accepted here). Requires a remark (same rule as
// QC's own REWORK decision) and forks a brand-new attempt exactly like
// that route does — this rejected one is kept as history, the redo starts
// over from PENDING in Work Allocation.
async function handleRejectLevel(req, res) {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
  const isSuperAdmin = req.user?.role === "super_admin";
  if (!viewerUserId) return res.status(401).json({ error: "Not authenticated" });
  const remarks = String(req.body?.remarks || req.body?.Remarks || req.body?.note || "").trim().slice(0, 1000);
  if (remarks.length < 3) {
    return res.status(400).json({ error: "Add a remark explaining what needs rework." });
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    const a = await pool.request().input("rungId", sql.Int, rungId).query(
      "SELECT Id, Status, ApprovalLevelsJson FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
    );
    if (!a.recordset.length) return res.status(404).json({ error: "No assignment found for this activity." });
    const assignmentId = a.recordset[0].Id;
    if (a.recordset[0].Status !== "COMPLETED") {
      return res.status(400).json({ error: "Only a Completed, QC-passed activity is awaiting approval." });
    }
    let levels = [];
    try { levels = JSON.parse(a.recordset[0].ApprovalLevelsJson || "[]"); } catch { levels = []; }
    if (!levels.length) return res.status(400).json({ error: "No approval setup is configured for this activity." });

    const approvalsRes = await pool.request().input("aid", sql.Int, assignmentId).query(
      "SELECT LevelId AS levelId, ApproverUserId AS approverUserId FROM dbo.DependencyActivityApproval WHERE AssignmentId = @aid",
    );
    const approvals = approvalsRes.recordset;
    const currentLevelIndex = firstUnsatisfiedLevelIndex(levels, approvals);
    if (currentLevelIndex == null) {
      return res.status(400).json({ error: "This activity has already cleared every approval level." });
    }
    const currentLevel = levels[currentLevelIndex];
    if (!isSuperAdmin && !currentLevel.userIds.map(Number).includes(Number(viewerUserId))) {
      return res.status(403).json({ error: "You're not named as an approver for this step." });
    }

    const actor = req.user?.email || req.user?.name || "system";
    await tx.begin();
    // Status goes straight to REWORK — unlike QC's own decision, there's
    // no per-checkpoint verdict to record here, just the one remark
    // explaining the rejection.
    await new sql.Request(tx)
      .input("aid", sql.Int, assignmentId)
      .input("by", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.DependencyActivityAssignment
        SET Status = 'REWORK', UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE Id = @aid
      `);
    const reworkAssignmentId = await forkAssignmentForRework(tx, assignmentId, rungId, remarks, "APPROVAL", actor);
    await tx.commit();
    res.json({ success: true, reworkAssignmentId });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* not begun or already rolled back */ }
    console.error("[dependency-activity-assignment] reject level error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// No requireAnyPageRight gate here — deliberately, same precedent as e.g.
// fundTransfer.js's PUT /:id/approve (just authenticateToken): the real
// authorization is the handler's own check (super_admin OR named on the
// activity's current approval level), not a generic Civil Work DPR page
// right. A named approver acting purely through the shared Approval Inbox
// (a director, say, who has no reason to hold "edit" on
// civilworkdpr-activity-reporting/work-done) must still be able to act on
// an activity that specifically names them — gating on those page rights
// here would 403 exactly the people this workflow is meant to let approve.
router.post("/:rungId/approval/approve", authMiddleware, handleApproveLevel);
router.post("/:rungId/approval/reject", authMiddleware, handleRejectLevel);
// Plain PUT aliases at the shared Approval Inbox's default path shape
// (${endpoint}/${recordId}/${action}) — see ApprovalInbox.tsx's
// MODULE_CONFIG["civilworkdpr-approval"] entry and ApprovalActions.tsx.
router.put("/:rungId/approve", authMiddleware, handleApproveLevel);
router.put("/:rungId/reject", authMiddleware, handleRejectLevel);

// GET /approvals/pending-count — how many Completed, QC-passed activities
// are sitting at a level the viewer can act on right now (named on that
// level, or super_admin). Polled by the sidebar for the Reporting nav
// item's badge — same "poll a small count endpoint" shape as the Approval
// Inbox badge (approvalInbox.js's own /count), just scoped to this
// separate per-assignment workflow instead of the module-wide one.
router.get(
  "/approvals/pending-count",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "view"),
  async (req, res) => {
    const viewerUserId = req.user?.userId ?? req.user?.id ?? null;
    const isSuperAdmin = req.user?.role === "super_admin";
    if (!viewerUserId) return res.json({ count: 0 });
    try {
      const pool = await getPool();
      const candidates = await pool.request().query(`
        SELECT daa.Id AS assignmentId, daa.ApprovalLevelsJson AS approvalLevelsJson
        FROM dbo.DependencyActivityAssignment daa
        WHERE daa.Status = 'COMPLETED'
          AND daa.IsCurrent = 1
          AND daa.ApprovalLevelsJson IS NOT NULL AND daa.ApprovalLevelsJson <> '[]'
          AND (
            SELECT TOP 1 qc.Decision FROM dbo.DependencyActivityQc qc
            WHERE qc.AssignmentId = daa.Id ORDER BY qc.QcAt DESC, qc.Id DESC
          ) = 'APPROVED'
      `);
      if (!candidates.recordset.length) return res.json({ count: 0 });

      const ids = candidates.recordset.map((c) => c.assignmentId);
      const approvalsRes = await pool.request().query(`
        SELECT AssignmentId AS assignmentId, LevelId AS levelId, ApproverUserId AS approverUserId
        FROM dbo.DependencyActivityApproval WHERE AssignmentId IN (${ids.join(",")})
      `);
      const approvalsByAssignment = new Map();
      for (const a of approvalsRes.recordset) {
        if (!approvalsByAssignment.has(a.assignmentId)) approvalsByAssignment.set(a.assignmentId, []);
        approvalsByAssignment.get(a.assignmentId).push(a);
      }

      let count = 0;
      for (const c of candidates.recordset) {
        let levels = [];
        try { levels = JSON.parse(c.approvalLevelsJson || "[]"); } catch { levels = []; }
        const approvals = approvalsByAssignment.get(c.assignmentId) || [];
        const currentLevelIndex = firstUnsatisfiedLevelIndex(levels, approvals);
        if (currentLevelIndex == null) continue;
        const currentLevel = levels[currentLevelIndex];
        const alreadyActed = approvals.some(
          (x) => x.levelId === currentLevel.id && Number(x.approverUserId) === Number(viewerUserId),
        );
        if (alreadyActed) continue;
        if (isSuperAdmin || currentLevel.userIds.map(Number).includes(Number(viewerUserId))) count++;
      }
      res.json({ count });
    } catch (err) {
      console.error("[dependency-activity-assignment] GET /approvals/pending-count error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// PATCH /:rungId/status — move a rung between report statuses, and/or
// update its Remarks (the Activity Detail modal's Remarks textarea saves
// on blur independently of the status dropdown) and/or its ProgressPercent
// (the modal's draggable progress bar, saved on drag-release) — all three
// are independent, so at least one must be present but none are required
// together.
//
// Manual status moves are just In Progress <-> Hold (mirrors
// allowedNextStatuses() in the frontend's dependencyActivityAssignmentApi.ts
// — keep the two in sync). Completed is reachable only bundled with
// progressPercent === 100 in this same request (the drag bar sends both
// together) — never chosen on its own. Rework's one way out is manually
// re-opening to In Progress. Approved/Cancelled are no longer settable
// here at all — Approved/Rework come only from the QC decision route
// above.
//
// ProgressPercent is a one-way ratchet — it can only increase, never
// decrease (dragging to 45% then means the bar can go to 50 but not back
// to 40), and once the activity is Completed it's locked outright: no
// further ProgressPercent change is accepted at all, forward or back. A
// mistaken 100% now has to go through QC sending it back for rework (a
// fresh attempt, not editing this one), not a drag on the same bar.
router.patch(
  "/:rungId/status",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit"),
  async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const hasStatus = req.body?.status !== undefined;
  const hasRemarks = req.body?.remarks !== undefined;
  const hasProgress = req.body?.progressPercent !== undefined;
  if (!hasStatus && !hasRemarks && !hasProgress) {
    return res.status(400).json({ error: "status, remarks or progressPercent is required" });
  }

  const status = hasStatus ? String(req.body.status).toUpperCase() : null;
  if (hasStatus && !STATUS_VALUES.has(status)) {
    return res.status(400).json({ error: `status must be one of: ${[...STATUS_VALUES].join(", ")}` });
  }
  const remarks = hasRemarks ? String(req.body.remarks || "").slice(0, 1000) : null;
  const progressPercent = hasProgress ? parseInt(req.body.progressPercent, 10) : null;
  if (hasProgress && (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100)) {
    return res.status(400).json({ error: "progressPercent must be an integer between 0 and 100" });
  }

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const MANUAL_STATUSES = new Set(["IN_PROGRESS", "HOLD"]);
    let current = null;
    let currentProgress = null;
    if (hasStatus || hasProgress) {
      const cur = await pool.request().input("rungId", sql.Int, rungId).query(
        "SELECT Status, ProgressPercent FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
      );
      current = cur.recordset[0]?.Status;
      currentProgress = cur.recordset[0]?.ProgressPercent;
    }

    if (hasProgress) {
      if (current === "COMPLETED") {
        return res.status(400).json({ error: "Work Done is locked once an activity is Completed." });
      }
      if (currentProgress != null && progressPercent < currentProgress) {
        return res.status(400).json({ error: "Work Done can only move forward, not backward." });
      }
    }

    if (hasStatus) {
      if (current && current !== status) {
        if (current === "CANCELLED") {
          return res.status(400).json({ error: "A Cancelled activity can't be changed." });
        } else if (status === "CANCELLED") {
          // Allowed from any stage, per explicit instruction — Cancel is
          // the one manual move with no forward-only restriction. What it
          // was right before is snapshotted below (PreCancelStatus) so a
          // super_admin restoring it later (see POST /:rungId/restore)
          // knows whether to put it back at APPROVED or IN_PROGRESS.
        } else if (status === "COMPLETED") {
          if (!(hasProgress && progressPercent === 100)) {
            return res.status(400).json({ error: "Completed is set automatically when work reaches 100%." });
          }
          if (!MANUAL_STATUSES.has(current)) {
            return res.status(400).json({ error: "Only an In Progress or Hold activity can be completed." });
          }
        } else if (current === "REWORK" && status === "IN_PROGRESS") {
          // Allowed — manually re-opening a reworked activity to redo it.
        } else if (!MANUAL_STATUSES.has(status)) {
          return res.status(400).json({ error: "Status can only be manually set to In Progress or Hold." });
        } else if (!MANUAL_STATUSES.has(current) && current !== "PENDING" && current !== "ALLOCATED") {
          return res.status(400).json({ error: "This activity's status can no longer be changed manually." });
        }
      }
    }
    const setClauses = [];
    if (hasStatus) setClauses.push("Status = @status");
    if (hasRemarks) setClauses.push("Remarks = @remarks");
    if (hasProgress) setClauses.push("ProgressPercent = @progressPercent");
    const capturingPreCancel = hasStatus && status === "CANCELLED" && current && current !== "CANCELLED";
    if (capturingPreCancel) setClauses.push("PreCancelStatus = @preCancelStatus");
    const request = pool.request()
      .input("rungId", sql.Int, rungId)
      .input("updatedBy", sql.NVarChar(200), actor);
    if (hasStatus) request.input("status", sql.NVarChar(20), status);
    if (hasRemarks) request.input("remarks", sql.NVarChar(1000), remarks);
    if (hasProgress) request.input("progressPercent", sql.Int, progressPercent);
    if (capturingPreCancel) request.input("preCancelStatus", sql.NVarChar(20), current);

    const result = await request.query(`
      UPDATE dbo.DependencyActivityAssignment
      SET ${setClauses.join(", ")}, UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
      WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1
    `);
    if (!result.rowsAffected[0]) {
      return res.status(404).json({ error: "No assignment found for this rung" });
    }
    res.json({ success: true, status, remarks, progressPercent });
  } catch (err) {
    console.error("[dependency-activity-assignment] PATCH /:rungId/status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:rungId/restore — bring a Cancelled activity back. super_admin
// only, deliberately checked by role directly rather than a page right —
// this is meant to be a rare, deliberate override, not something granted
// out via Menu Rights. Restores to APPROVED if that's genuinely what it
// was before being cancelled (PreCancelStatus, captured by the status
// PATCH above); anything else — it was never actually approved — comes
// back at IN_PROGRESS regardless of exactly where it was, so it has to go
// through Reporting/QC/Approval again rather than silently resuming
// wherever it happened to be.
router.post("/:rungId/restore", authMiddleware, async (req, res) => {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "Only a super admin can restore a Cancelled activity." });
  }
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  try {
    const pool = await getPool();
    const cur = await pool.request().input("rungId", sql.Int, rungId).query(
      "SELECT Id, Status, PreCancelStatus FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1",
    );
    if (!cur.recordset.length) return res.status(404).json({ error: "No assignment found for this rung" });
    if (cur.recordset[0].Status !== "CANCELLED") {
      return res.status(400).json({ error: "Only a Cancelled activity can be restored." });
    }
    const restoredStatus = cur.recordset[0].PreCancelStatus === "APPROVED" ? "APPROVED" : "IN_PROGRESS";
    const actor = req.user?.email || req.user?.name || "system";

    await pool.request()
      .input("id", sql.Int, cur.recordset[0].Id)
      .input("status", sql.NVarChar(20), restoredStatus)
      .input("by", sql.NVarChar(200), actor)
      .query(`
        UPDATE dbo.DependencyActivityAssignment
        SET Status = @status, PreCancelStatus = NULL, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true, status: restoredStatus });
  } catch (err) {
    console.error("[dependency-activity-assignment] POST /:rungId/restore error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:rungId/attempts — every assignment attempt ever made against this
// rung, oldest first, each with engineer/QC names and whatever
// ReworkReason/ReworkSource explains why it was superseded (see migration
// 488). The "keep the history of the reworked task" view — surfaced as a
// small history list in the Activity Detail modal once a rung has more
// than one attempt.
router.get(
  "/:rungId/attempts",
  authMiddleware,
  requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done", "civilworkdpr-quality-check"], "view"),
  async (req, res) => {
    const rungId = parseInt(req.params.rungId, 10);
    if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
    try {
      const pool = await getPool();
      const r = await pool.request().input("rungId", sql.Int, rungId).query(`
        SELECT
          daa.Id AS assignmentId, daa.AttemptNo AS attemptNo, daa.IsCurrent AS isCurrent,
          daa.Status AS status, daa.StartDate AS startDate, daa.EndDate AS endDate,
          daa.ReworkFromAssignmentId AS reworkFromAssignmentId,
          daa.ReworkReason AS reworkReason, daa.ReworkSource AS reworkSource,
          daa.CreatedAt AS createdAt, daa.UpdatedAt AS updatedAt,
          (
            SELECT STRING_AGG(u.name, ', ') WITHIN GROUP (ORDER BY u.name)
            FROM dbo.DependencyActivityEngineer dae
            JOIN dbo.users u ON u.id = dae.EngineerId
            WHERE dae.AssignmentId = daa.Id
          ) AS engineerNames
        FROM dbo.DependencyActivityAssignment daa
        WHERE daa.DependencyMasterActivityId = @rungId
        ORDER BY daa.AttemptNo ASC, daa.Id ASC
      `);
      res.json(r.recordset.map((row) => ({ ...row, isCurrent: !!row.isCurrent })));
    } catch (err) {
      console.error("[dependency-activity-assignment] GET /:rungId/attempts error:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// NOTE: this used to be PUT /engineer-approval/:id/confirm — each assigned
// engineer individually confirming their own task, surfaced as an Approval
// Inbox entry per engineer, gating ALLOCATED -> IN_PROGRESS. Removed:
// assigning engineers now starts work immediately (see the auto status
// transition in POST /:rungId above), and approval of the finished work is
// instead scoped per-assignment via ApprovalLevelsJson (set in that same
// route) — enforced wherever the actual approve action lives (Work
// Reporting), not here. dbo.DependencyActivityEngineer's Approved/ApprovedAt
// columns are left in place but no longer written to by anything.

// GET /engineers — active users, for the "Engineer Assign" picker on Work
// Reporting's per-rung assignment popup. Deliberately NOT gated behind
// PRIVILEGED_ROLES (see users.js GET /) — any authenticated Civil Work DPR
// user needs to be able to assign an engineer, same open-list precedent as
// GET /legal-executives in users.js.
router.get("/engineers", authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, name FROM dbo.users WHERE ISNULL(discontinue, 0) = 0 ORDER BY name ASC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /engineers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /contractors?projectId= — contractors for the "Labour/Material Given
// By" pickers, sourced from Contractor Master (dbo.AccountHeadMaster WHERE
// LHeadType='C'). Prefers contractors already allocated to this project
// (dbo.ContractorAllocation) so the list stays project-relevant where that
// data exists, but falls back to the full Contractor Master roster when the
// project has no allocations yet — an empty dropdown because nobody's
// gotten around to recording an allocation is worse than an unscoped list.
router.get("/contractors", authMiddleware, async (req, res) => {
  const projectId = parseInt(req.query.projectId, 10);
  if (!Number.isFinite(projectId)) return res.status(400).json({ error: "projectId is required" });
  try {
    const pool = await getPool();
    const scoped = await pool.request().input("projectId", sql.Int, projectId).query(`
      SELECT DISTINCT ahm.LHeadId AS id, ahm.LHeadName AS name
      FROM dbo.ContractorAllocation ca
      JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = ca.ContractorLHeadId
      WHERE ca.ProjectId = @projectId AND ISNULL(ahm.LHeadStatus, 1) = 1
      ORDER BY ahm.LHeadName ASC
    `);
    if (scoped.recordset.length) return res.json(scoped.recordset);

    const all = await pool.request().query(`
      SELECT LHeadId AS id, LHeadName AS name
      FROM dbo.AccountHeadMaster
      WHERE LHeadType = 'C' AND ISNULL(LHeadStatus, 1) = 1
      ORDER BY LHeadName ASC
    `);
    res.json(all.recordset);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /contractors error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:rungId — the existing assignment (if any) for one
// DependencyMasterActivity row, plus the candidate material list sourced
// from that rung's own ActivityItems links (Activity Master's "linked
// items" tab), so the popup can render quantity inputs for exactly the
// items the activity actually uses.
router.get("/:rungId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  try {
    const pool = await getPool();

    const rungRes = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT dma.Id, dma.ActivityId FROM dbo.DependencyMasterActivity dma WHERE dma.Id = @rungId
    `);
    if (!rungRes.recordset.length) return res.status(404).json({ error: "Activity rung not found" });
    const activityId = rungRes.recordset[0].ActivityId;

    const itemsRes = await pool.request().input("activityId", sql.Int, activityId).query(`
      SELECT img.M_Id AS itemId, img.M_Name AS itemName, img.M_code AS itemCode, img.M_UOM AS uom
      FROM dbo.ActivityItems ai
      JOIN dbo.Item_Master_Group img ON img.M_Id = ai.ItemId
      WHERE ai.ActivityId = @activityId
      ORDER BY img.M_Name ASC
    `);

    const assignRes = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT
        Id AS assignmentId, StartDate AS startDate, Days AS days, EndDate AS endDate,
        LabourSource AS labourSource, MaterialSource AS materialSource,
        LabourContractorId AS labourContractorId, MaterialContractorId AS materialContractorId,
        Description AS description, Remarks AS remarks, ApprovalLevelsJson AS approvalLevelsJson
      FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1
    `);
    const assignment = assignRes.recordset[0] || null;

    let materials = [];
    let engineerIds = [];
    let qcUserIds = [];
    let checkpoints = [];
    let approvalLevels = [];
    if (assignment) {
      const matRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT ItemId AS itemId, Quantity AS quantity
        FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @assignmentId
      `);
      materials = matRes.recordset;

      const engRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT EngineerId AS engineerId FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @assignmentId
      `);
      engineerIds = engRes.recordset.map((r) => r.engineerId);

      const qcRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT QcUserId AS qcUserId FROM dbo.DependencyActivityQcAssignee WHERE AssignmentId = @assignmentId
      `);
      qcUserIds = qcRes.recordset.map((r) => r.qcUserId);

      try {
        approvalLevels = assignment.approvalLevelsJson ? JSON.parse(assignment.approvalLevelsJson) : [];
      } catch {
        approvalLevels = [];
      }

      // Auto-seed this assignment's checklist from the activity's configured
      // template (Activity Master, dbo.ActivityCheckpointTemplate, migration
      // 469) the first time it's viewed with none yet — replaces the old
      // "Add Checkpoints" manual picker that used to live in this same
      // modal. Only fires when truly empty so a legacy assignment that
      // already had checkpoints picked by hand (or a template added to
      // later) is never silently rewritten.
      const existingCp = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId)
        .query(`SELECT TOP 1 1 AS found FROM dbo.DependencyActivityCheckpoint WHERE AssignmentId = @assignmentId`);
      if (existingCp.recordset.length === 0) {
        const templateRes = await pool.request().input("activityId", sql.Int, activityId).query(`
          SELECT t.SortOrder AS sortOrder, c.Id AS checkpointId, c.FieldName AS fieldName,
                 c.MinWaitDays AS minWaitDays, CAST(c.IsDaily AS BIT) AS isDaily
          FROM dbo.ActivityCheckpointTemplate t
          JOIN dbo.ActivityCheckpoint c ON c.Id = t.CheckpointId
          WHERE t.ActivityId = @activityId
          ORDER BY t.SortOrder ASC, t.Id ASC
        `);
        for (const row of templateRes.recordset) {
          await pool.request()
            .input("assignmentId", sql.Int, assignment.assignmentId)
            .input("checkpointId", sql.Int, row.checkpointId)
            .input("fieldName", sql.NVarChar(200), row.fieldName)
            .input("sortOrder", sql.Int, row.sortOrder)
            .input("minWaitDays", sql.Int, row.minWaitDays)
            .input("isDaily", sql.Bit, row.isDaily ? 1 : 0)
            .query(`
              INSERT INTO dbo.DependencyActivityCheckpoint
                (AssignmentId, CheckpointId, FieldName, SortOrder, MinWaitDays, IsDaily, IsChecked)
              VALUES (@assignmentId, @checkpointId, @fieldName, @sortOrder, @minWaitDays, @isDaily, 0)
            `);
        }
      }

      const cpRes = await pool.request().input("assignmentId", sql.Int, assignment.assignmentId).query(`
        SELECT c.Id AS id, c.CheckpointId AS checkpointId, c.FieldName AS fieldName, c.SortOrder AS sortOrder,
               c.IsChecked AS isChecked, c.MinWaitDays AS minWaitDays, CAST(c.IsDaily AS BIT) AS isDaily,
               (SELECT COUNT(*) FROM dbo.DependencyActivityCheckpointUpdate u WHERE u.AssignmentCheckpointId = c.Id) AS updateCount
        FROM dbo.DependencyActivityCheckpoint c WHERE c.AssignmentId = @assignmentId
        ORDER BY c.SortOrder ASC, c.Id ASC
      `);
      checkpoints = cpRes.recordset.map((c) => ({ ...c, isChecked: !!c.isChecked, isDaily: !!c.isDaily }));
    }

    res.json({
      rungId,
      activityId,
      candidateItems: itemsRes.recordset,
      assignment: assignment
        ? {
            engineerIds,
            qcUserIds,
            approvalLevels,
            startDate: assignment.startDate,
            days: assignment.days,
            endDate: assignment.endDate,
            labourSource: assignment.labourSource,
            materialSource: assignment.materialSource,
            labourContractorId: assignment.labourContractorId,
            materialContractorId: assignment.materialContractorId,
            description: assignment.description,
            remarks: assignment.remarks,
            materials,
            checkpoints,
          }
        : null,
    });
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:rungId — upsert the assignment for one rung: engineers, start
// date/duration/end date, labour & material source, description, remarks,
// and a material+quantity list. Engineers and materials are always replaced
// wholesale (delete + reinsert) rather than diffed — both lists are short,
// so this is simpler and avoids partial-update bugs.
router.post("/:rungId", authMiddleware, requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const {
    engineerIds, qcUserIds, approvalLevels, startDate, days, endDate, labourSource, materialSource,
    labourContractorId, materialContractorId, description, remarks, materials, checkpoints,
  } = req.body;

  if (engineerIds != null && !Array.isArray(engineerIds)) {
    return res.status(400).json({ error: "engineerIds must be an array" });
  }
  if (qcUserIds != null && !Array.isArray(qcUserIds)) {
    return res.status(400).json({ error: "qcUserIds must be an array" });
  }
  if (!Array.isArray(materials)) return res.status(400).json({ error: "materials must be an array" });
  if (checkpoints != null && !Array.isArray(checkpoints)) {
    return res.status(400).json({ error: "checkpoints must be an array" });
  }
  // Each level: { id, label, userIds: number[], mode: "all" | "any" }. Kept
  // loose (not schema-validated field by field) — same trust level the
  // client-supplied checkpoints/materials arrays already get on this route.
  // Always sent by the modal (defaults to []), same as materials/checkpoints
  // — not a "send undefined to preserve" field.
  if (approvalLevels != null && !Array.isArray(approvalLevels)) {
    return res.status(400).json({ error: "approvalLevels must be an array" });
  }
  const approvalLevelsJson = JSON.stringify(
    (approvalLevels || [])
      .map((lvl, i) => ({
        id: lvl?.id || `level-${i + 1}`,
        label: String(lvl?.label || `Level ${i + 1}`).slice(0, 200),
        userIds: Array.isArray(lvl?.userIds) ? lvl.userIds.map((v) => parseInt(v, 10)).filter(Number.isFinite) : [],
        mode: lvl?.mode === "any" ? "any" : "all",
      }))
      .filter((lvl) => lvl.userIds.length > 0),
  );

  // A checkpoint with a MinWaitDays snapshot can't honestly be checked off
  // until that many days have passed since the activity's own start date
  // — enforced here (not just in the UI) since this route is the only
  // place checkpoint state is actually persisted.
  if (Array.isArray(checkpoints)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const row of checkpoints) {
      const minWaitDays = Number.isFinite(row.minWaitDays) ? row.minWaitDays : null;
      if (!row.isChecked || !minWaitDays || minWaitDays <= 0) continue;
      if (!startDate) {
        return res.status(400).json({ error: `"${row.fieldName}" needs a start date set before it can be checked off.` });
      }
      const eligible = new Date(startDate);
      eligible.setDate(eligible.getDate() + minWaitDays);
      eligible.setHours(0, 0, 0, 0);
      if (today < eligible) {
        const daysLeft = Math.ceil((eligible.getTime() - today.getTime()) / 86400000);
        return res.status(400).json({
          error: `"${row.fieldName}" can't be checked off yet — needs ${minWaitDays} day(s) after the start date (${daysLeft} day(s) left).`,
        });
      }
    }
  }
  if (labourSource && !SOURCE_VALUES.has(labourSource)) {
    return res.status(400).json({ error: `labourSource must be one of: ${[...SOURCE_VALUES].join(", ")}` });
  }
  if (materialSource && !SOURCE_VALUES.has(materialSource)) {
    return res.status(400).json({ error: `materialSource must be one of: ${[...SOURCE_VALUES].join(", ")}` });
  }

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const rungCheck = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyMasterActivity WHERE Id = @rungId`);
    if (!rungCheck.recordset.length) return res.status(404).json({ error: "Activity rung not found" });

    const existing = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1`);

    const fieldInputs = (request) =>
      request
        .input("startDate", sql.Date, startDate || null)
        .input("days", sql.Int, Number.isFinite(days) ? days : null)
        .input("endDate", sql.Date, endDate || null)
        .input("labourSource", sql.NVarChar(20), labourSource || null)
        .input("materialSource", sql.NVarChar(20), materialSource || null)
        .input("labourContractorId", sql.Int, Number.isFinite(labourContractorId) ? labourContractorId : null)
        .input("materialContractorId", sql.Int, Number.isFinite(materialContractorId) ? materialContractorId : null)
        .input("description", sql.NVarChar(500), description || null)
        .input("remarks", sql.NVarChar(1000), remarks || null)
        .input("approvalLevelsJson", sql.NVarChar(sql.MAX), approvalLevelsJson);

    let assignmentId;
    if (existing.recordset.length) {
      assignmentId = existing.recordset[0].Id;
      await fieldInputs(pool.request())
        .input("id", sql.Int, assignmentId)
        .input("updatedBy", sql.NVarChar(200), actor)
        .query(`
          UPDATE dbo.DependencyActivityAssignment
          SET StartDate = @startDate, Days = @days, EndDate = @endDate,
              LabourSource = @labourSource, MaterialSource = @materialSource,
              LabourContractorId = @labourContractorId, MaterialContractorId = @materialContractorId,
              Description = @description, Remarks = @remarks, ApprovalLevelsJson = @approvalLevelsJson,
              UpdatedBy = @updatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    } else {
      const inserted = await fieldInputs(pool.request())
        .input("rungId", sql.Int, rungId)
        .input("createdBy", sql.NVarChar(200), actor)
        .query(`
          INSERT INTO dbo.DependencyActivityAssignment
            (DependencyMasterActivityId, StartDate, Days, EndDate, LabourSource, MaterialSource,
             LabourContractorId, MaterialContractorId, Description, Remarks, ApprovalLevelsJson, CreatedBy)
          OUTPUT INSERTED.Id AS id
          VALUES (@rungId, @startDate, @days, @endDate, @labourSource, @materialSource,
                  @labourContractorId, @materialContractorId, @description, @remarks, @approvalLevelsJson, @createdBy)
        `);
      assignmentId = inserted.recordset[0].id;
    }

    await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`DELETE FROM dbo.DependencyActivityMaterial WHERE AssignmentId = @assignmentId`);
    for (const row of materials) {
      const itemId = row.itemId;
      const quantity = parseFloat(row.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) continue;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("itemId", sql.UniqueIdentifier, itemId)
        .input("quantity", sql.Decimal(18, 2), quantity)
        .query(`
          INSERT INTO dbo.DependencyActivityMaterial (AssignmentId, ItemId, Quantity)
          VALUES (@assignmentId, @itemId, @quantity)
        `);
    }

    // Reconciled by EngineerId, not deleted and re-inserted — an engineer
    // who's already confirmed their assignment (Approved=1) must keep that
    // flag across an unrelated edit (dates, remarks, another engineer added)
    // instead of silently being asked to reconfirm every time the admin
    // saves. Only engineers actually added/removed touch a row.
    const keptEngineerIds = new Set(
      (engineerIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite),
    );
    const existingEngineers = (await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`SELECT EngineerId FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @assignmentId`))
      .recordset.map((r) => Number(r.EngineerId));
    const existingEngineerSet = new Set(existingEngineers);
    for (const engineerId of existingEngineers) {
      if (keptEngineerIds.has(engineerId)) continue;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("engineerId", sql.Int, engineerId)
        .query(`DELETE FROM dbo.DependencyActivityEngineer WHERE AssignmentId = @assignmentId AND EngineerId = @engineerId`);
    }
    for (const engineerId of keptEngineerIds) {
      if (existingEngineerSet.has(engineerId)) continue;
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("engineerId", sql.Int, engineerId)
        .query(`
          INSERT INTO dbo.DependencyActivityEngineer (AssignmentId, EngineerId)
          VALUES (@assignmentId, @engineerId)
        `);
    }

    // QC assignees — who will perform the quality check on this activity.
    // Simple delete-then-reinsert (unlike engineers above): there's no
    // per-QC "confirmed" flag to preserve, just a plain list.
    const keptQcUserIds = new Set(
      (qcUserIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite),
    );
    await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`DELETE FROM dbo.DependencyActivityQcAssignee WHERE AssignmentId = @assignmentId`);
    for (const qcUserId of keptQcUserIds) {
      await pool.request()
        .input("assignmentId", sql.Int, assignmentId)
        .input("qcUserId", sql.Int, qcUserId)
        .query(`
          INSERT INTO dbo.DependencyActivityQcAssignee (AssignmentId, QcUserId)
          VALUES (@assignmentId, @qcUserId)
        `);
    }

    // Auto status transition, driven purely by whether anyone's assigned:
    // PENDING (nobody assigned) -> IN_PROGRESS (assigned). Used to detour
    // through an ALLOCATED "awaiting each engineer's own confirmation" step
    // (PUT /engineer-approval/:id/confirm), surfaced as an Approval Inbox
    // entry per engineer — removed in favour of the ApprovalLevelsJson
    // config above: assigning engineers now starts the work immediately,
    // and who gets to APPROVE the finished work is whoever this assignment
    // names (plus super_admin), enforced where that approval action itself
    // lives (Work Reporting), not here. Only touches PENDING/ALLOCATED/
    // IN_PROGRESS — once work has moved further along (Hold/Approved/
    // Rework/Completed), adding/removing an engineer here never regresses
    // it. ALLOCATED counts as an equivalent starting point to PENDING here
    // — it's the old pre-confirmation status this replaced, and rows saved
    // under the old flow are still sitting at ALLOCATED (see migration 485
    // for the one-time data backfill this mirrors going forward).
    const currentStatusRow = (await pool.request().input("id", sql.Int, assignmentId)
      .query(`SELECT Status FROM dbo.DependencyActivityAssignment WHERE Id = @id`)).recordset[0];
    const currentStatus = currentStatusRow?.Status;
    let nextStatus = null;
    if (keptEngineerIds.size > 0 && (currentStatus === "PENDING" || currentStatus === "ALLOCATED")) nextStatus = "IN_PROGRESS";
    else if (keptEngineerIds.size === 0 && currentStatus === "IN_PROGRESS") nextStatus = "PENDING";
    if (nextStatus) {
      await pool.request().input("id", sql.Int, assignmentId).input("status", sql.NVarChar(20), nextStatus)
        .query(`UPDATE dbo.DependencyActivityAssignment SET Status = @status WHERE Id = @id`);
    }

    // Checkpoints are reconciled by id rather than deleted and re-inserted: a daily
    // checkpoint's per-date updates (photos) hang off its row, and rebuilding the
    // rows on every save would wipe them. Rows the client still lists keep their
    // id (and updates); new ones are inserted; ones it dropped are deleted.
    const savedCps = (await pool.request().input("assignmentId", sql.Int, assignmentId)
      .query(`SELECT Id, IsChecked FROM dbo.DependencyActivityCheckpoint WHERE AssignmentId = @assignmentId`)).recordset;
    const savedCpById = new Map(savedCps.map((r) => [Number(r.Id), r]));
    const keepCpIds = new Set();
    let cpSort = 0;
    for (const row of checkpoints || []) {
      const fieldName = String(row.fieldName || "").trim();
      if (!fieldName) continue;
      cpSort += 10;
      const rowId = Number(row.id);
      const saved = Number.isFinite(rowId) ? savedCpById.get(rowId) : null;
      if (saved && !keepCpIds.has(rowId)) {
        keepCpIds.add(rowId);
        const wasChecked = !!saved.IsChecked;
        await pool.request()
          .input("id", sql.Int, rowId)
          .input("sortOrder", sql.Int, cpSort)
          .input("isChecked", sql.Bit, !!row.isChecked)
          // Keep the original who/when when it stays checked; stamp fresh only on a new check.
          .input("stamp", sql.Bit, !!row.isChecked && !wasChecked)
          .input("checkedBy", sql.NVarChar(200), actor)
          .query(`
            UPDATE dbo.DependencyActivityCheckpoint
            SET SortOrder = @sortOrder,
                IsChecked = @isChecked,
                CheckedAt = CASE WHEN @isChecked = 0 THEN NULL WHEN @stamp = 1 THEN SYSDATETIME() ELSE CheckedAt END,
                CheckedBy = CASE WHEN @isChecked = 0 THEN NULL WHEN @stamp = 1 THEN @checkedBy ELSE CheckedBy END
            WHERE Id = @id
          `);
      } else {
        // The master decides whether it's a daily checkpoint — never trust the client for that.
        let isDaily = false;
        if (Number.isFinite(row.checkpointId)) {
          const m = await pool.request().input("cid", sql.Int, row.checkpointId)
            .query(`SELECT IsDaily FROM dbo.ActivityCheckpoint WHERE Id = @cid`);
          isDaily = !!m.recordset[0]?.IsDaily;
        }
        const ins = await pool.request()
          .input("assignmentId", sql.Int, assignmentId)
          .input("checkpointId", sql.Int, Number.isFinite(row.checkpointId) ? row.checkpointId : null)
          .input("fieldName", sql.NVarChar(200), fieldName)
          .input("sortOrder", sql.Int, cpSort)
          .input("minWaitDays", sql.Int, Number.isFinite(row.minWaitDays) ? row.minWaitDays : null)
          .input("isDaily", sql.Bit, isDaily)
          .input("isChecked", sql.Bit, !!row.isChecked)
          .input("checkedAt", sql.DateTime2, row.isChecked ? new Date() : null)
          .input("checkedBy", sql.NVarChar(200), row.isChecked ? actor : null)
          .query(`
            INSERT INTO dbo.DependencyActivityCheckpoint
              (AssignmentId, CheckpointId, FieldName, SortOrder, MinWaitDays, IsDaily, IsChecked, CheckedAt, CheckedBy)
            OUTPUT INSERTED.Id AS id
            VALUES (@assignmentId, @checkpointId, @fieldName, @sortOrder, @minWaitDays, @isDaily, @isChecked, @checkedAt, @checkedBy)
          `);
        keepCpIds.add(ins.recordset[0].id);
      }
    }
    for (const r of savedCps) {
      if (keepCpIds.has(Number(r.Id))) continue;
      await pool.request().input("id", sql.Int, r.Id)
        .query(`DELETE FROM dbo.DependencyActivityCheckpoint WHERE Id = @id`);
    }

    res.json({ success: true, assignmentId });
  } catch (err) {
    console.error("[dependency-activity-assignment] POST /:rungId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Daily checkpoint updates ────────────────────────────────────────────────
// A checkpoint flagged IsDaily (Work Checkpoint Master) gets one update per date:
// a live-camera photo and/or a note. Saved straight away (not with the big
// assignment save) because each is an event, not a form field.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (d) => DATE_RE.test(d) && !Number.isNaN(new Date(d + "T00:00:00Z").getTime());

// GET /checkpoint/:cpId/updates — the dates that have an update (no binary).
router.get("/checkpoint/:cpId/updates", authMiddleware, async (req, res) => {
  const cpId = parseInt(req.params.cpId, 10);
  if (!Number.isFinite(cpId)) return res.status(400).json({ error: "Invalid checkpoint id" });
  try {
    const pool = await getPool();
    const r = await pool.request().input("cpId", sql.Int, cpId).query(`
      SELECT Id AS id, CONVERT(VARCHAR(10), UpdateDate, 23) AS date,
             CAST(CASE WHEN Photo IS NULL THEN 0 ELSE 1 END AS BIT) AS hasPhoto,
             Note AS note, CreatedBy AS createdBy, CreatedAt AS createdAt
      FROM dbo.DependencyActivityCheckpointUpdate
      WHERE AssignmentCheckpointId = @cpId
      ORDER BY UpdateDate DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error("[checkpoint-updates] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /checkpoint/:cpId/updates — log (or replace) the update for one date.
// multipart: date (YYYY-MM-DD), note (optional), photo (optional file).
router.post("/checkpoint/:cpId/updates", authMiddleware, upload.single("photo"), async (req, res) => {
  const cpId = parseInt(req.params.cpId, 10);
  if (!Number.isFinite(cpId)) return res.status(400).json({ error: "Invalid checkpoint id" });
  const date = String(req.body?.date || "");
  if (!isRealDate(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  const note = String(req.body?.note || "").trim().slice(0, 500) || null;
  const photo = req.file || null;
  if (photo && !/^image\//i.test(photo.mimetype)) return res.status(400).json({ error: "The update photo must be an image" });

  // No future dates (one day of slack for timezone differences between browser and server).
  const limit = new Date();
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (date > limit.toISOString().slice(0, 10)) return res.status(400).json({ error: "You can't log an update for a future date" });

  const actor = req.user?.email || req.user?.name || "system";
  try {
    const pool = await getPool();
    const cp = await pool.request().input("cpId", sql.Int, cpId).query(`
      SELECT c.Id, c.IsDaily, c.FieldName, CONVERT(VARCHAR(10), a.StartDate, 23) AS startDate
      FROM dbo.DependencyActivityCheckpoint c
      JOIN dbo.DependencyActivityAssignment a ON a.Id = c.AssignmentId
      WHERE c.Id = @cpId
    `);
    if (!cp.recordset.length) return res.status(404).json({ error: "Checkpoint not found — save the assignment first" });
    const row = cp.recordset[0];
    if (!row.IsDaily) return res.status(400).json({ error: `"${row.FieldName}" isn't a daily-update checkpoint` });
    if (row.startDate && date < row.startDate) {
      return res.status(400).json({ error: `That date is before the activity's start date (${row.startDate}).` });
    }

    const existing = await pool.request().input("cpId", sql.Int, cpId).input("date", sql.Date, date)
      .query(`SELECT Id, Photo FROM dbo.DependencyActivityCheckpointUpdate WHERE AssignmentCheckpointId = @cpId AND UpdateDate = @date`);

    if (existing.recordset.length) {
      const id = existing.recordset[0].Id;
      await pool.request()
        .input("id", sql.Int, id)
        .input("note", sql.NVarChar(500), note)
        .input("hasNewPhoto", sql.Bit, !!photo)
        .input("photo", sql.VarBinary(sql.MAX), photo ? photo.buffer : null)
        .input("mime", sql.NVarChar(100), photo ? photo.mimetype : null)
        .input("by", sql.NVarChar(200), actor)
        .query(`
          UPDATE dbo.DependencyActivityCheckpointUpdate
          SET Note = COALESCE(@note, Note),
              Photo = CASE WHEN @hasNewPhoto = 1 THEN @photo ELSE Photo END,
              PhotoMime = CASE WHEN @hasNewPhoto = 1 THEN @mime ELSE PhotoMime END,
              UpdatedBy = @by, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
      return res.json({ success: true, id, replaced: true });
    }

    if (!photo && !note) return res.status(400).json({ error: "Add a photo or a note for this day" });
    const ins = await pool.request()
      .input("cpId", sql.Int, cpId)
      .input("date", sql.Date, date)
      .input("photo", sql.VarBinary(sql.MAX), photo ? photo.buffer : null)
      .input("mime", sql.NVarChar(100), photo ? photo.mimetype : null)
      .input("note", sql.NVarChar(500), note)
      .input("by", sql.NVarChar(200), actor)
      .query(`
        INSERT INTO dbo.DependencyActivityCheckpointUpdate (AssignmentCheckpointId, UpdateDate, Photo, PhotoMime, Note, CreatedBy)
        OUTPUT INSERTED.Id AS id
        VALUES (@cpId, @date, @photo, @mime, @note, @by)
      `);
    res.status(201).json({ success: true, id: ins.recordset[0].id, replaced: false });
  } catch (err) {
    console.error("[checkpoint-updates] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /checkpoint-update/:id/photo — stream the day's photo.
router.get("/checkpoint-update/:id/photo", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const r = await pool.request().input("id", sql.Int, id)
      .query(`SELECT Photo, PhotoMime FROM dbo.DependencyActivityCheckpointUpdate WHERE Id = @id`);
    const row = r.recordset[0];
    if (!row || !row.Photo) return res.status(404).json({ error: "No photo for this update" });
    res.setHeader("Content-Type", row.PhotoMime || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(row.Photo);
  } catch (err) {
    console.error("[checkpoint-updates] photo error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /checkpoint-update/:id — remove one day's update.
router.delete("/checkpoint-update/:id", authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const r = await pool.request().input("id", sql.Int, id)
      .query(`DELETE FROM dbo.DependencyActivityCheckpointUpdate WHERE Id = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Update not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[checkpoint-updates] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Blueprint Annotation Workflow ───────────────────────────────────────────
// Scoped per (rung, room) — two activities in the same chain that share a
// room's blueprint each get their own independent markup. The blueprint
// itself lives on dbo.RoomMaster (see roomMaster.js's own /:id/blueprint);
// this only stores what got drawn on top of it for one specific rung.

const ANNOTATION_CONTEXTS = new Set(["allocation", "reporting"]);

// GET /:rungId/blueprint-annotation?roomId=...&context=allocation|reporting
// — the saved annotation for this rung+room+context, or null if nothing's
// been drawn yet. context defaults to "allocation" so an older client that
// never sends it still gets the original (pre-Part-B) layer.
router.get("/:rungId/blueprint-annotation", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  const roomId = parseInt(req.query.roomId, 10);
  const context = ANNOTATION_CONTEXTS.has(req.query.context) ? req.query.context : "allocation";
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  if (!Number.isFinite(roomId)) return res.status(400).json({ error: "roomId is required" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("roomId", sql.Int, roomId)
      .input("context", sql.NVarChar(20), context).query(`
        SELECT ShapesJson AS shapesJson, ThumbnailBase64 AS thumbnailBase64, Version AS version,
               UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
        FROM dbo.ActivityBlueprintAnnotation
        WHERE DependencyMasterActivityId = @rungId AND RoomId = @roomId AND Context = @context
      `);
    res.json(result.recordset[0] || null);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId/blueprint-annotation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /:rungId/blueprint-annotation — upsert. body: { roomId, context,
// shapesJson, thumbnail, version }. version is the value the client loaded
// (0/absent for a brand-new annotation) — a mismatch against what's
// actually stored means someone else saved over this rung+context's markup
// in the meantime, so the save is rejected as a conflict rather than
// silently clobbering it. Allocation and reporting are separate rows (see
// migration 346) — saving one never touches the other's version or shapes.
router.put("/:rungId/blueprint-annotation", authMiddleware, requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done"], "edit"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });

  const { roomId, shapesJson, thumbnail, version } = req.body;
  const context = ANNOTATION_CONTEXTS.has(req.body.context) ? req.body.context : "allocation";
  const roomIdNum = parseInt(roomId, 10);
  if (!Number.isFinite(roomIdNum)) return res.status(400).json({ error: "roomId is required" });
  if (typeof shapesJson !== "string") return res.status(400).json({ error: "shapesJson must be a JSON string" });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();

    const rungCheck = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyMasterActivity WHERE Id = @rungId`);
    if (!rungCheck.recordset.length) return res.status(404).json({ error: "Activity rung not found" });

    const existing = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("roomId", sql.Int, roomIdNum)
      .input("context", sql.NVarChar(20), context)
      .query(`SELECT Id, Version FROM dbo.ActivityBlueprintAnnotation WHERE DependencyMasterActivityId = @rungId AND RoomId = @roomId AND Context = @context`);
    const current = existing.recordset[0];

    if (current && Number(version) !== current.Version) {
      return res.status(409).json({
        error: "This blueprint was annotated by someone else since you opened it. Reload and re-apply your markup.",
      });
    }

    if (current) {
      // Archive what's about to be overwritten (migration 353) — the
      // Activity Detail modal's revision scrubber pages back through these
      // rows, since dbo.ActivityBlueprintAnnotation itself only ever holds
      // the current state.
      await pool.request()
        .input("AnnotationId", sql.Int, current.Id)
        .query(`
          INSERT INTO dbo.ActivityBlueprintAnnotationHistory
            (AnnotationId, Version, ShapesJson, ThumbnailBase64, UpdatedBy, UpdatedAt)
          SELECT Id, Version, ShapesJson, ThumbnailBase64, UpdatedBy, UpdatedAt
          FROM dbo.ActivityBlueprintAnnotation WHERE Id = @AnnotationId
        `);

      await pool.request()
        .input("Id", sql.Int, current.Id)
        .input("ShapesJson", sql.NVarChar(sql.MAX), shapesJson)
        .input("Thumbnail", sql.NVarChar(sql.MAX), thumbnail || null)
        .input("Version", sql.Int, current.Version + 1)
        .input("UpdatedBy", sql.NVarChar(200), actor).query(`
          UPDATE dbo.ActivityBlueprintAnnotation SET
            ShapesJson = @ShapesJson, ThumbnailBase64 = @Thumbnail,
            Version = @Version, UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
          WHERE Id = @Id
        `);
      return res.json({ success: true, version: current.Version + 1 });
    }

    await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("roomId", sql.Int, roomIdNum)
      .input("context", sql.NVarChar(20), context)
      .input("ShapesJson", sql.NVarChar(sql.MAX), shapesJson)
      .input("Thumbnail", sql.NVarChar(sql.MAX), thumbnail || null)
      .input("UpdatedBy", sql.NVarChar(200), actor).query(`
        INSERT INTO dbo.ActivityBlueprintAnnotation
          (DependencyMasterActivityId, RoomId, Context, ShapesJson, ThumbnailBase64, Version, UpdatedBy, UpdatedAt)
        VALUES (@rungId, @roomId, @context, @ShapesJson, @Thumbnail, 1, @UpdatedBy, SYSDATETIME())
      `);
    res.json({ success: true, version: 1 });
  } catch (err) {
    console.error("[dependency-activity-assignment] PUT /:rungId/blueprint-annotation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:rungId/blueprint-annotation/history?roomId=&context= — every past
// revision (migration 353) plus the current one, oldest first, thumbnail
// only (no ShapesJson — the scrubber just displays each revision's
// pre-rendered PNG rather than re-driving a Konva stage per step).
router.get("/:rungId/blueprint-annotation/history", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  const roomId = parseInt(req.query.roomId, 10);
  const context = ANNOTATION_CONTEXTS.has(req.query.context) ? req.query.context : "allocation";
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  if (!Number.isFinite(roomId)) return res.status(400).json({ error: "roomId is required" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("roomId", sql.Int, roomId)
      .input("context", sql.NVarChar(20), context).query(`
        SELECT h.Version AS version, h.ThumbnailBase64 AS thumbnailBase64,
               h.UpdatedBy AS updatedBy, h.UpdatedAt AS updatedAt
        FROM dbo.ActivityBlueprintAnnotation a
        JOIN dbo.ActivityBlueprintAnnotationHistory h ON h.AnnotationId = a.Id
        WHERE a.DependencyMasterActivityId = @rungId AND a.RoomId = @roomId AND a.Context = @context
        UNION ALL
        SELECT a.Version AS version, a.ThumbnailBase64 AS thumbnailBase64,
               a.UpdatedBy AS updatedBy, a.UpdatedAt AS updatedAt
        FROM dbo.ActivityBlueprintAnnotation a
        WHERE a.DependencyMasterActivityId = @rungId AND a.RoomId = @roomId AND a.Context = @context
        ORDER BY version ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId/blueprint-annotation/history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Before/After Photo Capture (Part C) ─────────────────────────────────────
// Replaces the reporting-context blueprint markup as how a field engineer
// actually updates a work report — a handful of camera photos per phase,
// not a drawing. See migration 348.

// GET /:rungId/photos — grouped { before: [...], after: [...] }, metadata
// only (no FileData — keeps the list light even with several large photos).
router.get("/:rungId/photos", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  try {
    const pool = await getPool();
    const result = await pool.request().input("rungId", sql.Int, rungId).query(`
      SELECT Id AS id, Phase AS phase, FileName AS fileName, MimeType AS mimeType,
             Note AS note, CapturedBy AS capturedBy, CapturedAt AS capturedAt
      FROM dbo.ActivityPhoto
      WHERE DependencyMasterActivityId = @rungId
      ORDER BY CapturedAt DESC
    `);
    const before = result.recordset.filter((p) => p.phase === "before");
    const after = result.recordset.filter((p) => p.phase === "after");
    res.json({ before, after });
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId/photos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /:rungId/photos/:photoId — one photo's base64 data, always reached
// through fetchWithAuth (never a bare <img src>) for the same auth-token
// reason documented on room-master's /:id/blueprint endpoint.
router.get("/:rungId/photos/:photoId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  const photoId = parseInt(req.params.photoId, 10);
  if (!Number.isFinite(rungId) || !Number.isFinite(photoId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("photoId", sql.Int, photoId).query(`
        SELECT FileName AS fileName, MimeType AS mimeType, FileData AS dataBase64
        FROM dbo.ActivityPhoto
        WHERE DependencyMasterActivityId = @rungId AND Id = @photoId
      `);
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ error: "Photo not found" });
    res.json(row);
  } catch (err) {
    console.error("[dependency-activity-assignment] GET /:rungId/photos/:photoId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /:rungId/photos — upload one photo. multipart body: file, phase
// ('before'|'after'), note (optional).
router.post("/:rungId/photos", authMiddleware, requireAnyPageRight(["civilworkdpr-activity-reporting", "civilworkdpr-work-done", "civilworkdpr-quality-check"], "edit"), upload.single("file"), async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  if (!Number.isFinite(rungId)) return res.status(400).json({ error: "Invalid rungId" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!PHOTO_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: "Photo must be a JPG, PNG, WEBP, or HEIC image" });
  }
  const phase = PHOTO_PHASES.has(req.body.phase) ? req.body.phase : null;
  if (!phase) return res.status(400).json({ error: "phase must be 'before' or 'after'" });

  const actor = req.user?.email || req.user?.name || "system";

  try {
    const pool = await getPool();
    const rungCheck = await pool.request().input("rungId", sql.Int, rungId)
      .query(`SELECT Id FROM dbo.DependencyMasterActivity WHERE Id = @rungId`);
    if (!rungCheck.recordset.length) return res.status(404).json({ error: "Activity rung not found" });

    const insertRes = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("Phase", sql.NVarChar(10), phase)
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("FileData", sql.NVarChar(sql.MAX), req.file.buffer.toString("base64"))
      .input("Note", sql.NVarChar(500), req.body.note ? String(req.body.note).slice(0, 500) : null)
      .input("CapturedBy", sql.NVarChar(200), actor).query(`
        INSERT INTO dbo.ActivityPhoto
          (DependencyMasterActivityId, Phase, FileName, MimeType, FileData, Note, CapturedBy, CapturedAt)
        OUTPUT INSERTED.Id
        VALUES (@rungId, @Phase, @FileName, @MimeType, @FileData, @Note, @CapturedBy, SYSDATETIME())
      `);
    res.status(201).json({ id: insertRes.recordset[0].Id });
  } catch (err) {
    console.error("[dependency-activity-assignment] POST /:rungId/photos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:rungId/photos/:photoId
router.delete("/:rungId/photos/:photoId", authMiddleware, async (req, res) => {
  const rungId = parseInt(req.params.rungId, 10);
  const photoId = parseInt(req.params.photoId, 10);
  if (!Number.isFinite(rungId) || !Number.isFinite(photoId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rungId", sql.Int, rungId)
      .input("photoId", sql.Int, photoId)
      .query(`DELETE FROM dbo.ActivityPhoto WHERE DependencyMasterActivityId = @rungId AND Id = @photoId`);
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Photo not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[dependency-activity-assignment] DELETE /:rungId/photos/:photoId error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
