"use strict";
/**
 * Legal Verification workspace (Legal V2, phase 1). One workspace per land enquiry holds the verification activities
 * (LegalActivityTemplate, set up in Legal Setup). Each activity is tracked on its own: status, finding, assignee,
 * dates, priority, findings, documents and a permanent history. An activity cannot be completed while an activity it
 * depends on is open, unless an authorised user overrides it with a reason.
 *
 *   GET  /meta                         statuses, findings, priorities
 *   GET  /list                         workspaces with progress (pageable, project picker)
 *   GET  /startable                    enquiries that have no workspace yet
 *   POST /start { enquiryId, targetDate?, leadUserId? }
 *   GET  /my-tasks                     the signed-in user's activities
 *   GET  /:id                          one workspace with its activities
 *   PUT  /:id { targetDate, leadUserId, remarks }
 *   PUT  /activity/:activityId { status, finding, assignedUserId, … , updatedAt, overrideReason? }
 *   POST /activity/:activityId/document { fileId, title }
 *   GET  /activity/:activityId/history
 */
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { canAct, isAdmin, userOf } = require("./approvalAuthority");
const { writeAudit, nextCodeSql, codePrefix } = require("./legalAudit");
const { pageable } = require("./paging");
const projectGuard = require("./projectGuard");
const { notify } = require("../../services/legalNotify");
const { ENTRY_CONFIG, validateEntry, publicConfig, entryLabel } = require("./activityEntries");
const crypto = require("crypto");

const router = express.Router();
router.use(apiRateLimit);
router.use(async (req, _res, next) => { try { req.legalScope = await projectGuard.getProjectScope(req.user); } catch { /* unrestricted */ } next(); });

const PAGE = "legal-land-enquiry";
const STATUSES = ["Not Started", "Pending", "In Progress", "Applied", "Report Pending", "On Hold", "Completed", "Not Applicable", "Rejected"];
const FINDINGS = ["Found", "Not Found", "Matched", "Mismatched", "Discrepancy Found", "Additional Documents Required", "Unable to Verify"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const DONE = ["Completed", "Not Applicable"];
const BAD_FINDINGS = ["Mismatched", "Discrepancy Found", "Additional Documents Required", "Unable to Verify"];

const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalVerificationActivity', 'U') AS t")).recordset[0].t;
const inScope = (req, projectId) => !req.legalScope || (projectId != null && req.legalScope.includes(Number(projectId)));
const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);

const ACTIVITY_SELECT = `
  SELECT a.ActivityId, a.VerificationId, a.TemplateId, a.ActivityNo, a.ActivityName, a.IsMandatory, a.Status, a.Finding,
         a.AssignedUserId, au.name AS AssignedName, a.Department, a.Priority, a.ExpectedDays,
         CONVERT(char(10), a.StartDate, 23) AS StartDate, CONVERT(char(10), a.DueDate, 23) AS DueDate, CONVERT(char(10), a.CompletedDate, 23) AS CompletedDate,
         a.Findings, a.Remarks, a.HoldReason, a.NextAction, a.ReviewedBy, rv.name AS ReviewedByName, a.ReviewedAt,
         a.UpdatedAt, uu.name AS UpdatedByName, t.Stage, t.Description, t.ActivityCode,
         (SELECT COUNT(*) FROM dbo.LegalActivityEntry x WHERE x.ActivityId = a.ActivityId AND x.IsActive = 1) AS EntryCount
  FROM dbo.LegalVerificationActivity a
  JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
  LEFT JOIN dbo.users au ON au.id = a.AssignedUserId
  LEFT JOIN dbo.users rv ON rv.id = a.ReviewedBy
  LEFT JOIN dbo.users uu ON uu.id = a.UpdatedBy`;

const WORKSPACE_SELECT = `
  SELECT v.VerificationId, v.VerificationNo, v.EnquiryId, v.ProjectId, pr.name AS ProjectName, v.Status,
         CONVERT(char(10), v.StartDate, 23) AS StartDate, CONVERT(char(10), v.TargetDate, 23) AS TargetDate,
         v.LeadUserId, lu.name AS LeadName, v.Remarks, v.UpdatedAt,
         e.EnquiryNo, e.LandLocation, e.JLNo, CAST(e.ApproxArea AS FLOAT) AS ApproxArea, u.UnitName, e.ContactPerson, e.ContactNumber,
         m.MouzaName, d.DistrictName,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId) AS Total,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status = N'Completed') AS Completed,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status = N'Not Applicable') AS NotApplicable,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status = N'On Hold') AS OnHold,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Finding IN (N'Mismatched', N'Discrepancy Found')) AS Discrepancies,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Finding = N'Additional Documents Required') AS MissingDocuments,
         (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status NOT IN (N'Completed', N'Not Applicable')
            AND a.DueDate < CAST(GETDATE() AS DATE)) AS Overdue
  FROM dbo.LegalVerification v
  JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
  LEFT JOIN dbo.enterprise pr ON pr.id = v.ProjectId
  LEFT JOIN dbo.users lu ON lu.id = v.LeadUserId
  LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
  LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
  LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = e.AreaUnitId`;

/** Recompute a workspace's status from its activities (On Hold / Closed are kept when set by hand). */
async function refreshWorkspace(conn, verificationId) {
  const r = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT v.Status,
      (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.IsMandatory = 1
         AND a.Status NOT IN (N'Completed', N'Not Applicable')) AS OpenMandatory
    FROM dbo.LegalVerification v WHERE v.VerificationId = @V`)).recordset[0];
  if (!r || ["Closed", "On Hold", "Verified"].includes(r.Status)) return r?.Status;
  const next = r.OpenMandatory === 0 ? "Ready for Review" : "In Progress";
  if (next !== r.Status) await conn.request().input("V", sql.Int, verificationId).input("S", sql.NVarChar(30), next)
    .query("UPDATE dbo.LegalVerification SET Status = @S, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V");
  return next;
}

/** Open mandatory prerequisites of an activity, by number and name. */
async function openPrerequisites(conn, activity) {
  return (await conn.request().input("V", sql.Int, activity.VerificationId).input("T", sql.Int, activity.TemplateId).query(`
    SELECT p.ActivityNo, p.ActivityName, p.Status FROM dbo.LegalActivityDependency d
    JOIN dbo.LegalVerificationActivity p ON p.VerificationId = @V AND p.TemplateId = d.DependsOnTemplateId
    WHERE d.TemplateId = @T AND d.IsActive = 1 AND d.IsMandatory = 1 AND p.Status NOT IN (N'Completed', N'Not Applicable')
    ORDER BY p.ActivityNo`)).recordset;
}

async function loadActivity(pool, req, activityId) {
  const a = (await pool.request().input("A", sql.Int, activityId).query(`${ACTIVITY_SELECT} WHERE a.ActivityId = @A`)).recordset[0];
  if (!a) return { error: [404, "Activity not found"] };
  const v = (await pool.request().input("V", sql.Int, a.VerificationId).query("SELECT ProjectId, LeadUserId, VerificationNo, CreatedBy, Status FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
  if (!inScope(req, v.ProjectId)) return { error: [403, "You don't have access to this project."] };
  return { a, v };
}

router.get("/meta", requirePageRight(PAGE, "view"), (_req, res) => res.json({ statuses: STATUSES, findings: FINDINGS, priorities: PRIORITIES }));

router.get("/list", requirePageRight(PAGE, "view"), pageable("items"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json({ items: [] });
    res.json({ items: (await pool.request().query(`${WORKSPACE_SELECT} ORDER BY v.VerificationId DESC`)).recordset });
  } catch (err) {
    console.error("[legal-verification] list:", err.message);
    res.status(500).json({ error: "Could not load verifications" });
  }
});

router.get("/startable", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json([]);
    const rows = (await pool.request().query(`
      SELECT e.EnquiryId, e.EnquiryNo, e.LandLocation, e.EnquiryStatus, e.ProjectId, pr.name AS ProjectName, m.MouzaName
      FROM dbo.LegalLandEnquiry e
      LEFT JOIN dbo.enterprise pr ON pr.id = e.ProjectId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
      WHERE e.IsActive = 1 AND e.EnquiryStatus NOT IN (N'Rejected')
        AND NOT EXISTS (SELECT 1 FROM dbo.LegalVerification v WHERE v.EnquiryId = e.EnquiryId)
      ORDER BY e.EnquiryId DESC`)).recordset;
    res.json(rows.filter((r) => inScope(req, r.ProjectId)));
  } catch (err) {
    console.error("[legal-verification] startable:", err.message);
    res.status(500).json({ error: "Could not load enquiries" });
  }
});

router.post("/start", requirePageRight(PAGE, "create"), async (req, res) => {
  const enquiryId = Number.parseInt(req.body?.enquiryId, 10);
  if (!enquiryId) return res.status(400).json({ error: "Choose an enquiry" });
  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    if (!(await ready(pool))) return res.status(409).json({ error: "Run migration 715 first" });
    const e = (await pool.request().input("E", sql.Int, enquiryId).query("SELECT EnquiryId, EnquiryNo, ProjectId, EnquiryStatus, IsActive FROM dbo.LegalLandEnquiry WHERE EnquiryId = @E")).recordset[0];
    if (!e || !e.IsActive) return res.status(404).json({ error: "Enquiry not found" });
    if (!inScope(req, e.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    if (e.EnquiryStatus === "Rejected") return res.status(409).json({ error: "The enquiry is rejected" });
    const start = todayStr();
    const target = req.body?.targetDate ? day(req.body.targetDate) : null;
    const lead = Number(req.body?.leadUserId) || null;
    await tx.begin();
    const ins = await new sql.Request(tx).input("Prefix", sql.NVarChar(20), codePrefix("LV")).input("E", sql.Int, enquiryId).input("P", sql.Int, e.ProjectId)
      .input("S", sql.Date, start).input("T", sql.Date, target).input("L", sql.Int, lead).input("U", sql.Int, userOf(req)).query(`
        IF EXISTS (SELECT 1 FROM dbo.LegalVerification WITH (UPDLOCK, HOLDLOCK) WHERE EnquiryId = @E) SELECT CAST(NULL AS INT) AS VerificationId
        ELSE BEGIN
          INSERT INTO dbo.LegalVerification (VerificationNo, EnquiryId, ProjectId, StartDate, TargetDate, LeadUserId, CreatedBy, UpdatedBy, UpdatedAt)
          OUTPUT INSERTED.VerificationId, INSERTED.VerificationNo
          SELECT ${nextCodeSql("LegalVerification", "VerificationNo", "@Prefix")}, @E, @P, @S, @T, @L, @U, @U, SYSUTCDATETIME();
        END`);
    const v = ins.recordset[0];
    if (!v?.VerificationId) { await tx.rollback(); return res.status(409).json({ error: "Verification has already started for this enquiry" }); }
    // One activity per active template; due date = start + expected duration.
    const templates = (await new sql.Request(tx).query("SELECT TemplateId, ActivityNo, ActivityName, IsMandatory, Department, DefaultDays FROM dbo.LegalActivityTemplate WHERE IsActive = 1 ORDER BY ActivityNo")).recordset;
    for (const t of templates) {
      const a = await new sql.Request(tx).input("V", sql.Int, v.VerificationId).input("T", sql.Int, t.TemplateId).input("N", sql.Int, t.ActivityNo)
        .input("Name", sql.NVarChar(150), t.ActivityName).input("M", sql.Bit, t.IsMandatory).input("D", sql.NVarChar(80), t.Department)
        .input("X", sql.Int, t.DefaultDays).input("Due", sql.Date, t.DefaultDays != null ? addDays(start, t.DefaultDays) : null).input("U", sql.Int, userOf(req)).query(`
          INSERT INTO dbo.LegalVerificationActivity (VerificationId, TemplateId, ActivityNo, ActivityName, IsMandatory, Department, ExpectedDays, DueDate, CreatedBy)
          OUTPUT INSERTED.ActivityId VALUES (@V, @T, @N, @Name, @M, @D, @X, @Due, @U)`);
      await new sql.Request(tx).input("A", sql.Int, a.recordset[0].ActivityId).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, NewStatus, ChangedBy) VALUES (@A, N'Created', N'Not Started', @U)");
    }
    await tx.commit();
    await writeAudit(pool, req, { action: "Legal verification started", entityType: "LegalVerification", entityId: v.VerificationId, newValue: { enquiry: e.EnquiryNo, activities: templates.length } });
    await notify(pool, { roles: ["Verifier"], users: [lead], except: userOf(req), type: "legal_verification_started", title: `Verification started: ${e.EnquiryNo}`,
      body: `${v.VerificationNo} · ${templates.length} activities. Open Legal → Legal verification.`, refId: v.VerificationId, refType: "legal_verification" });
    res.status(201).json({ message: `Verification ${v.VerificationNo} started with ${templates.length} activities`, verificationId: v.VerificationId });
  } catch (err) {
    try { await tx.rollback(); } catch { /* not begun */ }
    console.error("[legal-verification] start:", err.message);
    res.status(500).json({ error: "Could not start verification" });
  }
});

router.get("/my-tasks", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json([]);
    const rows = (await pool.request().input("U", sql.Int, userOf(req)).query(`
      ${ACTIVITY_SELECT.replace("SELECT a.ActivityId", "SELECT v.VerificationNo, v.ProjectId, e.EnquiryNo, a.ActivityId")}
      JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
      JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
      WHERE a.AssignedUserId = @U AND v.Status <> N'Closed'
      ORDER BY CASE WHEN a.Status IN (N'Completed', N'Not Applicable') THEN 1 ELSE 0 END, ISNULL(a.DueDate, '9999-12-31'), a.ActivityNo`)).recordset;
    res.json(rows.filter((r) => inScope(req, r.ProjectId)));
  } catch (err) {
    console.error("[legal-verification] my-tasks:", err.message);
    res.status(500).json({ error: "Could not load your tasks" });
  }
});

router.get("/activity/:activityId/history", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const rows = (await pool.request().input("A", sql.Int, got.a.ActivityId).query(`
      SELECT h.HistoryId, h.Action, h.OldStatus, h.NewStatus, h.OldFinding, h.NewFinding, ou.name AS OldAssignee, nu.name AS NewAssignee,
             h.Remarks, h.FileId, f.FileName, cu.name AS ChangedBy, h.ChangedAt
      FROM dbo.LegalActivityHistory h
      LEFT JOIN dbo.users ou ON ou.id = h.OldAssignee LEFT JOIN dbo.users nu ON nu.id = h.NewAssignee LEFT JOIN dbo.users cu ON cu.id = h.ChangedBy
      LEFT JOIN dbo.LegalMasterFile f ON f.FileId = h.FileId
      WHERE h.ActivityId = @A ORDER BY h.HistoryId DESC`)).recordset;
    res.json(rows);
  } catch (err) {
    console.error("[legal-verification] history:", err.message);
    res.status(500).json({ error: "Could not load history" });
  }
});

router.put("/activity/:activityId", requirePageRight(PAGE, "edit"), async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    if (v.Status === "Closed" || v.Status === "Verified") return res.status(409).json({ error: v.Status === "Verified" ? "This verification is verified — a Legal Reviewer must reopen it before changes" : "This verification is closed" });
    const b = req.body || {};
    // Optimistic concurrency: refused if someone else saved the activity after it was opened.
    const seen = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
    const now = a.UpdatedAt ? new Date(a.UpdatedAt).getTime() : null;
    if ("updatedAt" in b && seen !== now)
      return res.status(409).json({ error: `${a.UpdatedByName ?? "Someone"} changed this activity after you opened it — reload and try again` });

    const next = {
      status: b.status ?? a.Status,
      finding: b.finding === undefined ? a.Finding : b.finding || null,
      assignedUserId: b.assignedUserId === undefined ? a.AssignedUserId : Number(b.assignedUserId) || null,
      priority: b.priority ?? a.Priority,
      startDate: b.startDate === undefined ? a.StartDate : day(b.startDate),
      dueDate: b.dueDate === undefined ? a.DueDate : day(b.dueDate),
      findings: b.findings === undefined ? a.Findings : String(b.findings || "").slice(0, 8000) || null,
      remarks: b.remarks === undefined ? a.Remarks : String(b.remarks || "").slice(0, 1000) || null,
      holdReason: b.holdReason === undefined ? a.HoldReason : String(b.holdReason || "").slice(0, 500) || null,
      nextAction: b.nextAction === undefined ? a.NextAction : String(b.nextAction || "").slice(0, 500) || null,
    };
    if (!STATUSES.includes(next.status)) return res.status(400).json({ error: "Unknown status" });
    if (next.finding && !FINDINGS.includes(next.finding)) return res.status(400).json({ error: "Unknown finding" });
    if (!PRIORITIES.includes(next.priority)) return res.status(400).json({ error: "Unknown priority" });
    if (next.status === "On Hold" && (!next.holdReason || !next.nextAction)) return res.status(400).json({ error: "On Hold needs a reason and the next action" });
    if (next.status === "Completed" && !next.finding) return res.status(400).json({ error: "Record the finding before completing — the result must be entered by the person who did the work" });
    if (next.status === "Rejected" && !next.remarks) return res.status(400).json({ error: "Say why it is returned (remarks)" });
    if (next.status === "Not Applicable" && !next.remarks && a.IsMandatory) return res.status(400).json({ error: "A mandatory activity marked Not Applicable needs remarks" });
    if (next.finding === "Mismatched" && !next.remarks) return res.status(400).json({ error: "An unresolved mismatch needs remarks" });
    if (next.startDate && next.dueDate && next.dueDate < next.startDate) return res.status(400).json({ error: "Due date is before the start date" });

    // Dependencies: completing needs every mandatory prerequisite done, or an authorised override with a reason.
    let override = null;
    if (next.status === "Completed" && a.Status !== "Completed") {
      const open = await openPrerequisites(pool, a);
      if (open.length) {
        const reason = String(b.overrideReason || "").trim();
        const list = open.map((p) => `${p.ActivityNo}. ${p.ActivityName} (${p.Status})`).join(", ");
        if (!reason) return res.status(409).json({ error: `Waiting for: ${list}`, blockedBy: open, needsOverride: true });
        if (!(isAdmin(req) || (await canAct(req, "Verifier", null)) || (await canAct(req, "Legal Reviewer", null))))
          return res.status(403).json({ error: `Waiting for: ${list}. Only a Verifier, Legal Reviewer or admin may override` });
        override = `Dependency overridden (${list}): ${reason.slice(0, 600)}`;
      }
    }

    const reopening = DONE.includes(a.Status) && !DONE.includes(next.status);
    const completedDate = next.status === "Completed" ? (a.CompletedDate ?? todayStr()) : reopening || next.status !== "Completed" ? null : a.CompletedDate;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const upd = await new sql.Request(tx).input("A", sql.Int, a.ActivityId).input("S", sql.NVarChar(30), next.status).input("F", sql.NVarChar(40), next.finding)
        .input("As", sql.Int, next.assignedUserId).input("P", sql.NVarChar(10), next.priority).input("SD", sql.Date, next.startDate).input("DD", sql.Date, next.dueDate)
        .input("CD", sql.Date, completedDate).input("Fi", sql.NVarChar(sql.MAX), next.findings).input("R", sql.NVarChar(1000), next.remarks)
        .input("H", sql.NVarChar(500), next.status === "On Hold" ? next.holdReason : null).input("N", sql.NVarChar(500), next.status === "On Hold" ? next.nextAction : null)
        .input("U", sql.Int, userOf(req)).input("Was", sql.DateTime2, a.UpdatedAt ?? null).query(`
          UPDATE dbo.LegalVerificationActivity SET Status = @S, Finding = @F, AssignedUserId = @As, Priority = @P, StartDate = @SD, DueDate = @DD,
                 CompletedDate = @CD, Findings = @Fi, Remarks = @R, HoldReason = @H, NextAction = @N,
                 ReviewedBy = CASE WHEN @S = N'Completed' AND Status <> N'Completed' THEN @U WHEN @S = N'Completed' THEN ReviewedBy ELSE NULL END,
                 ReviewedAt = CASE WHEN @S = N'Completed' AND Status <> N'Completed' THEN SYSUTCDATETIME() WHEN @S = N'Completed' THEN ReviewedAt ELSE NULL END,
                 UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
          WHERE ActivityId = @A AND ((@Was IS NULL AND UpdatedAt IS NULL) OR ABS(DATEDIFF_BIG(MICROSECOND, UpdatedAt, @Was)) < 1000)`);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(409).json({ error: "Someone changed this activity just now — reload and try again" }); }
      const histRemarks = [reopening ? "Reopened" : null, next.status === "On Hold" ? `On hold: ${next.holdReason} · Next: ${next.nextAction}` : null, b.remarks !== undefined ? next.remarks : null]
        .filter(Boolean).join(" · ").slice(0, 1000) || null;
      await new sql.Request(tx).input("A", sql.Int, a.ActivityId).input("OS", sql.NVarChar(30), a.Status).input("NS", sql.NVarChar(30), next.status)
        .input("OF", sql.NVarChar(40), a.Finding).input("NF", sql.NVarChar(40), next.finding).input("OA", sql.Int, a.AssignedUserId).input("NA", sql.Int, next.assignedUserId)
        .input("R", sql.NVarChar(1000), histRemarks).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldStatus, NewStatus, OldFinding, NewFinding, OldAssignee, NewAssignee, Remarks, ChangedBy) VALUES (@A, N'Updated', @OS, @NS, @OF, @NF, @OA, @NA, @R, @U)");
      if (override) await new sql.Request(tx).input("A", sql.Int, a.ActivityId).input("R", sql.NVarChar(1000), override.slice(0, 1000)).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, ChangedBy) VALUES (@A, N'Override', @R, @U)");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
    const wsStatus = await refreshWorkspace(pool, a.VerificationId);
    await writeAudit(pool, req, { action: override ? "Verification activity completed with override" : "Verification activity updated", entityType: "LegalVerificationActivity", entityId: a.ActivityId,
      oldValue: { status: a.Status, finding: a.Finding, assignee: a.AssignedUserId }, newValue: { status: next.status, finding: next.finding, assignee: next.assignedUserId }, remarks: override });

    // Notifications
    const label = `${v.VerificationNo} · ${a.ActivityNo}. ${a.ActivityName}`;
    const me = userOf(req);
    if (next.assignedUserId && next.assignedUserId !== a.AssignedUserId)
      await notify(pool, { users: [next.assignedUserId], except: me, type: "legal_activity_assigned", title: `Assigned to you: ${a.ActivityName}`, body: `${label}${next.dueDate ? ` · due ${next.dueDate}` : ""}`, refId: a.VerificationId, refType: "legal_verification" });
    if (next.status === "On Hold" && a.Status !== "On Hold")
      await notify(pool, { users: [v.LeadUserId, v.CreatedBy, next.assignedUserId], except: me, type: "legal_activity_hold", title: `On hold: ${a.ActivityName}`, body: `${label} — ${next.holdReason}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    if (next.status === "Rejected" && a.Status !== "Rejected")
      await notify(pool, { users: [next.assignedUserId], except: me, type: "legal_activity_returned", title: `Returned: ${a.ActivityName}`, body: `${label} — ${next.remarks}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    if (next.finding && BAD_FINDINGS.includes(next.finding) && next.finding !== a.Finding)
      await notify(pool, { roles: ["Verifier"], users: [v.LeadUserId], except: me, type: "legal_activity_discrepancy", title: `${next.finding}: ${a.ActivityName}`, body: label, refId: a.VerificationId, refType: "legal_verification" });
    if (wsStatus === "Ready for Review" && v.Status !== "Ready for Review")
      await notify(pool, { roles: ["Verifier", "Legal Reviewer"], users: [v.LeadUserId], except: me, type: "legal_verification_ready", title: `Ready for legal review: ${v.VerificationNo}`, body: "All mandatory activities are resolved.", refId: a.VerificationId, refType: "legal_verification" });

    res.json({ message: override ? "Saved — dependency override recorded" : "Saved", workspaceStatus: wsStatus });
  } catch (err) {
    console.error("[legal-verification] activity update:", err.message);
    res.status(500).json({ error: "Could not save the activity" });
  }
});

router.post("/activity/:activityId/document", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const fileId = Number(req.body?.fileId);
    if (!fileId) return res.status(400).json({ error: "Upload a file first" });
    const title = String(req.body?.title || "").trim().slice(0, 200) || null;
    await pool.request().input("A", sql.Int, got.a.ActivityId).input("F", sql.Int, fileId).input("T", sql.NVarChar(200), title).input("U", sql.Int, userOf(req))
      .query(`INSERT INTO dbo.LegalActivityDocument (ActivityId, FileId, Title, UploadedBy) VALUES (@A, @F, @T, @U);
              INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, FileId, ChangedBy) VALUES (@A, N'Document', ISNULL(@T, N'Document added'), @F, @U);`);
    res.status(201).json({ message: "Document attached" });
  } catch (err) {
    console.error("[legal-verification] document:", err.message);
    res.status(500).json({ error: "Could not attach the document" });
  }
});

// ── Detail entries (phase 2) ─────────────────────────────────────────────────────────────────────
router.get("/entry-config", requirePageRight(PAGE, "view"), (_req, res) => res.json(publicConfig()));

const ENTRY_SELECT = `
  SELECT x.EntryId, x.ActivityId, x.DataJson, x.CreatedAt, cu.name AS CreatedByName, x.UpdatedAt, uu.name AS UpdatedByName
  FROM dbo.LegalActivityEntry x LEFT JOIN dbo.users cu ON cu.id = x.CreatedBy LEFT JOIN dbo.users uu ON uu.id = x.UpdatedBy`;
const shapeEntry = (r) => ({ ...r, data: JSON.parse(r.DataJson || "{}"), DataJson: undefined });

/** File names for the file fields of a set of entries. */
async function withFileNames(pool, code, entries) {
  const keys = (ENTRY_CONFIG[code]?.fields ?? []).filter((f) => f.type === "file").map((f) => f.key);
  const ids = [...new Set(entries.flatMap((e) => keys.map((k) => e.data[k]).filter(Number.isFinite)))];
  if (!ids.length) return entries.map((e) => ({ ...e, files: {} }));
  const names = (await pool.request().query(`SELECT FileId, FileName FROM dbo.LegalMasterFile WHERE FileId IN (${ids.map(Number).join(",")})`)).recordset;
  return entries.map((e) => ({ ...e, files: Object.fromEntries(keys.filter((k) => e.data[k]).map((k) => [k, names.find((n) => n.FileId === e.data[k])?.FileName ?? null])) }));
}

const liveEntryIds = async (conn, activityId, except = null) =>
  (await conn.request().input("A", sql.Int, activityId).query("SELECT EntryId FROM dbo.LegalActivityEntry WHERE ActivityId = @A AND IsActive = 1")).recordset
    .map((r) => r.EntryId).filter((id) => id !== except);

router.get("/activity/:activityId/entries", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const rows = (await pool.request().input("A", sql.Int, got.a.ActivityId).query(`${ENTRY_SELECT} WHERE x.ActivityId = @A AND x.IsActive = 1 ORDER BY x.EntryId`)).recordset.map(shapeEntry);
    res.json(await withFileNames(pool, got.a.ActivityCode, rows));
  } catch (err) {
    console.error("[legal-verification] entries:", err.message);
    res.status(500).json({ error: "Could not load entries" });
  }
});

async function entryWrite(req, res, mode) {
  const pool = getPool();
  try {
    let entry = null;
    let activityId = Number(req.params.activityId);
    if (mode !== "add") {
      entry = (await pool.request().input("X", sql.Int, Number(req.params.entryId)).query(`${ENTRY_SELECT} WHERE x.EntryId = @X AND x.IsActive = 1`)).recordset[0];
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      activityId = entry.ActivityId;
    }
    const got = await loadActivity(pool, req, activityId);
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    if (v.Status === "Closed" || v.Status === "Verified") return res.status(409).json({ error: v.Status === "Verified" ? "This verification is verified — a Legal Reviewer must reopen it before changes" : "This verification is closed" });
    const code = a.ActivityCode;
    if (!ENTRY_CONFIG[code]) return res.status(400).json({ error: "This activity has no detail entries" });
    const b = req.body || {};
    if (entry && "updatedAt" in b) {
      const seen = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
      const now = entry.UpdatedAt ? new Date(entry.UpdatedAt).getTime() : null;
      if (seen !== now) return res.status(409).json({ error: `${entry.UpdatedByName ?? "Someone"} changed this entry after you opened it — reload and try again` });
    }
    const me = userOf(req);
    const cfg = ENTRY_CONFIG[code];
    if (mode === "remove") {
      const reason = String(b.reason || "").trim().slice(0, 500);
      if (!reason) return res.status(400).json({ error: "Say why the entry is removed" });
      if (await pool.request().input("A", sql.Int, a.ActivityId).input("X", sql.Int, entry.EntryId)
        .query("SELECT 1 AS x FROM dbo.LegalActivityEntry WHERE ActivityId = @A AND IsActive = 1 AND TRY_CAST(JSON_VALUE(DataJson, '$.previousEntryId') AS INT) = @X").then((r) => r.recordset.length))
        return res.status(409).json({ error: "Another deed points to this one as its previous deed — change that link first" });
      await pool.request().input("X", sql.Int, entry.EntryId).input("R", sql.NVarChar(500), reason).input("U", sql.Int, me).input("A", sql.Int, a.ActivityId)
        .input("H", sql.NVarChar(1000), `${cfg.entry} removed: ${entryLabel(code, JSON.parse(entry.DataJson))} — ${reason}`.slice(0, 1000)).input("J", sql.NVarChar(sql.MAX), entry.DataJson).query(`
          UPDATE dbo.LegalActivityEntry SET IsActive = 0, RemovedReason = @R, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE EntryId = @X;
          INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, EntryId, OldDataJson, ChangedBy) VALUES (@A, N'Entry removed', @H, @X, @J, @U);`);
      return res.json({ message: `${cfg.entry} removed` });
    }
    const ok = validateEntry(code, b.data, await liveEntryIds(pool, a.ActivityId, entry?.EntryId ?? null));
    if (ok.error) return res.status(400).json({ error: ok.error });
    const json = JSON.stringify(ok.data);
    if (mode === "add") {
      const r = await pool.request().input("A", sql.Int, a.ActivityId).input("J", sql.NVarChar(sql.MAX), json).input("U", sql.Int, me)
        .input("H", sql.NVarChar(1000), `${cfg.entry} added: ${entryLabel(code, ok.data)}`.slice(0, 1000)).query(`
          DECLARE @id TABLE (EntryId INT);
          INSERT INTO dbo.LegalActivityEntry (ActivityId, DataJson, CreatedBy, UpdatedBy, UpdatedAt) OUTPUT INSERTED.EntryId INTO @id VALUES (@A, @J, @U, @U, SYSUTCDATETIME());
          INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, EntryId, ChangedBy) SELECT @A, N'Entry added', @H, EntryId, @U FROM @id;
          SELECT EntryId FROM @id;`);
      if (a.Status === "Not Started") await pool.request().input("A", sql.Int, a.ActivityId).input("U", sql.Int, me).query(`
          UPDATE dbo.LegalVerificationActivity SET Status = N'In Progress', StartDate = ISNULL(StartDate, CAST(GETDATE() AS DATE)), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE ActivityId = @A AND Status = N'Not Started';
          INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldStatus, NewStatus, Remarks, ChangedBy) VALUES (@A, N'Updated', N'Not Started', N'In Progress', N'Started by the first entry', @U);`);
      return res.status(201).json({ message: `${cfg.entry} added`, entryId: r.recordset[0].EntryId });
    }
    await pool.request().input("X", sql.Int, entry.EntryId).input("J", sql.NVarChar(sql.MAX), json).input("U", sql.Int, me).input("A", sql.Int, a.ActivityId)
      .input("O", sql.NVarChar(sql.MAX), entry.DataJson).input("H", sql.NVarChar(1000), `${cfg.entry} changed: ${entryLabel(code, ok.data)}`.slice(0, 1000)).query(`
        UPDATE dbo.LegalActivityEntry SET DataJson = @J, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE EntryId = @X;
        INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, EntryId, OldDataJson, ChangedBy) VALUES (@A, N'Entry changed', @H, @X, @O, @U);`);
    res.json({ message: `${cfg.entry} saved` });
  } catch (err) {
    console.error("[legal-verification] entry", mode, err.message);
    res.status(500).json({ error: "Could not save the entry" });
  }
}
router.post("/activity/:activityId/entries", requirePageRight(PAGE, "edit"), (req, res) => entryWrite(req, res, "add"));
router.put("/entry/:entryId", requirePageRight(PAGE, "edit"), (req, res) => entryWrite(req, res, "edit"));
router.delete("/entry/:entryId", requirePageRight(PAGE, "edit"), (req, res) => entryWrite(req, res, "remove"));

// ── Ownership flowchart (phase 3): import from the deed chain, saved versions ─────────────────────
router.post("/activity/:activityId/import-deed-chain", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    if (got.a.ActivityCode !== "OWNERSHIP-FLOW") return res.status(400).json({ error: "Only the ownership flowchart imports the deed chain" });
    if (["Closed", "Verified"].includes(got.v.Status)) return res.status(409).json({ error: "This verification is closed or verified" });
    const deeds = (await pool.request().input("V", sql.Int, got.a.VerificationId).query(`
      SELECT x.DataJson FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
      JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
      WHERE a.VerificationId = @V AND t.ActivityCode = N'DEED-CHAIN' AND x.IsActive = 1`)).recordset.map((r) => JSON.parse(r.DataJson));
    const have = new Set((await pool.request().input("A", sql.Int, got.a.ActivityId)
      .query("SELECT JSON_VALUE(DataJson, '$.deedNo') AS d FROM dbo.LegalActivityEntry WHERE ActivityId = @A AND IsActive = 1")).recordset.map((r) => r.d).filter(Boolean));
    let added = 0, skipped = 0;
    for (const d of deeds) {
      if (!d.executant || !d.claimant || have.has(d.deedNo)) { skipped++; continue; }
      const t = String(d.deedType || "").toLowerCase();
      const type = ["gift", "partition", "settlement", "exchange", "inheritance"].find((k) => t.includes(k));
      const ok = validateEntry("OWNERSHIP-FLOW", { fromOwner: String(d.executant).slice(0, 200), toOwner: String(d.claimant).slice(0, 200), transferDate: d.deedDate, transferYear: d.regYear,
        transferType: type ? type[0].toUpperCase() + type.slice(1) : "Sale", deedNo: d.deedNo, deedYear: d.regYear, regOffice: d.regOffice, area: d.area, dag: d.dag,
        verification: "Unverified", fileId: d.fileId, remarks: "Imported from the deed chain" });
      if (ok.error) { skipped++; continue; }
      await pool.request().input("A", sql.Int, got.a.ActivityId).input("J", sql.NVarChar(sql.MAX), JSON.stringify(ok.data)).input("U", sql.Int, userOf(req))
        .input("H", sql.NVarChar(1000), `Ownership transfer imported: ${entryLabel("OWNERSHIP-FLOW", ok.data)}`.slice(0, 1000)).query(`
          DECLARE @id TABLE (EntryId INT);
          INSERT INTO dbo.LegalActivityEntry (ActivityId, DataJson, CreatedBy, UpdatedBy, UpdatedAt) OUTPUT INSERTED.EntryId INTO @id VALUES (@A, @J, @U, @U, SYSUTCDATETIME());
          INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, EntryId, ChangedBy) SELECT @A, N'Entry added', @H, EntryId, @U FROM @id;`);
      have.add(d.deedNo); added++;
    }
    res.json({ message: added ? `${added} transfer${added === 1 ? "" : "s"} imported as Unverified${skipped ? ` · ${skipped} skipped (already there or no executant / claimant)` : ""}` : "Nothing new to import from the deed chain" });
  } catch (err) {
    console.error("[legal-verification] import deed chain:", err.message);
    res.status(500).json({ error: "Could not import the deed chain" });
  }
});

router.get("/activity/:activityId/flow-versions", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const rows = (await pool.request().input("A", sql.Int, got.a.ActivityId).query(`
      SELECT h.HistoryId, h.Remarks, h.OldDataJson, u.name AS SavedBy, h.ChangedAt FROM dbo.LegalActivityHistory h LEFT JOIN dbo.users u ON u.id = h.ChangedBy
      WHERE h.ActivityId = @A AND h.Action = N'Flowchart version' ORDER BY h.HistoryId DESC`)).recordset;
    res.json(rows.map((r, i) => ({ versionNo: rows.length - i, HistoryId: r.HistoryId, remarks: r.Remarks, savedBy: r.SavedBy, savedAt: r.ChangedAt, entries: JSON.parse(r.OldDataJson || "[]") })));
  } catch (err) {
    console.error("[legal-verification] flow versions:", err.message);
    res.status(500).json({ error: "Could not load versions" });
  }
});

router.post("/activity/:activityId/flow-version", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    if (got.a.ActivityCode !== "OWNERSHIP-FLOW") return res.status(400).json({ error: "Only the ownership flowchart has versions" });
    const entries = (await pool.request().input("A", sql.Int, got.a.ActivityId).query("SELECT EntryId, DataJson FROM dbo.LegalActivityEntry WHERE ActivityId = @A AND IsActive = 1 ORDER BY EntryId"))
      .recordset.map((r) => ({ EntryId: r.EntryId, data: JSON.parse(r.DataJson) }));
    if (!entries.length) return res.status(400).json({ error: "Add transfers before saving a version" });
    const n = (await pool.request().input("A", sql.Int, got.a.ActivityId).query("SELECT COUNT(*) AS n FROM dbo.LegalActivityHistory WHERE ActivityId = @A AND Action = N'Flowchart version'")).recordset[0].n + 1;
    const note = String(req.body?.remarks || "").trim().slice(0, 800);
    await pool.request().input("A", sql.Int, got.a.ActivityId).input("J", sql.NVarChar(sql.MAX), JSON.stringify(entries)).input("U", sql.Int, userOf(req))
      .input("R", sql.NVarChar(1000), `Version ${n} · ${entries.length} transfers${note ? ` · ${note}` : ""}`)
      .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, OldDataJson, ChangedBy) VALUES (@A, N'Flowchart version', @R, @J, @U)");
    res.status(201).json({ message: `Flowchart version ${n} saved` });
  } catch (err) {
    console.error("[legal-verification] flow version:", err.message);
    res.status(500).json({ error: "Could not save the version" });
  }
});

// ── Legal review (phase 4) ───────────────────────────────────────────────────────────────────────
const REVIEW_DECISIONS = ["Verified", "Returned for Correction", "Additional Documents Required", "Further Investigation Required"];
const REVIEW_CHECKS = [
  ["owner", "Owner information"], ["rs", "RS records"], ["lr", "LR records"], ["match", "Ownership matching"], ["chain", "Deed chain"],
  ["flow", "Historical flowchart"], ["court", "Court search"], ["clearance", "Government clearances (LA / ULC)"], ["khajna", "Khajna"],
  ["heir", "Inheritance"], ["mother", "Mother deed"], ["copies", "Certified copies"], ["survey", "Survey and map records"],
];
const canReview = async (req) => isAdmin(req) || (await canAct(req, "Legal Reviewer", null)) || (await canAct(req, "Verifier", null));

/** Everything that was reviewed, frozen: activities with their status, finding, findings and live entries. */
async function snapshot(conn, verificationId) {
  const acts = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT a.ActivityId, a.ActivityNo, a.ActivityName, a.IsMandatory, a.Status, a.Finding, a.AssignedUserId, CONVERT(char(10), a.DueDate, 23) AS DueDate,
           CONVERT(char(10), a.CompletedDate, 23) AS CompletedDate, a.Findings, a.Remarks
    FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = @V ORDER BY a.ActivityNo`)).recordset;
  const entries = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT x.EntryId, x.ActivityId, x.DataJson FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
    WHERE a.VerificationId = @V AND x.IsActive = 1 ORDER BY x.EntryId`)).recordset;
  const docs = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT d.ActivityId, d.FileId FROM dbo.LegalActivityDocument d JOIN dbo.LegalVerificationActivity a ON a.ActivityId = d.ActivityId WHERE a.VerificationId = @V AND d.IsActive = 1`)).recordset;
  return acts.map((a) => ({ ...a, entries: entries.filter((e) => e.ActivityId === a.ActivityId).map((e) => ({ EntryId: e.EntryId, data: JSON.parse(e.DataJson) })),
    documents: docs.filter((d) => d.ActivityId === a.ActivityId).map((d) => d.FileId) }));
}

router.get("/:id/reviews", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query("SELECT ProjectId FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const rows = (await pool.request().input("V", sql.Int, id).query(`
      SELECT r.ReviewId, r.VersionNo, r.Decision, r.Remarks, r.ChecklistJson, r.SnapshotHash, u.name AS ReviewedBy, r.ReviewedAt
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V ORDER BY r.VersionNo DESC`)).recordset;
    res.json({ reviews: rows.map((r) => ({ ...r, checklist: JSON.parse(r.ChecklistJson || "{}"), ChecklistJson: undefined })), checks: REVIEW_CHECKS, decisions: REVIEW_DECISIONS, canReview: await canReview(req) });
  } catch (err) {
    console.error("[legal-verification] reviews:", err.message);
    res.status(500).json({ error: "Could not load reviews" });
  }
});

router.post("/:id/review", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query(`${WORKSPACE_SELECT} WHERE v.VerificationId = @V`)).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    if (!(await canReview(req))) return res.status(403).json({ error: "Only a Legal Reviewer, Verifier or admin can review" });
    const b = req.body || {};
    const decision = String(b.decision || "");
    const remarks = String(b.remarks || "").trim().slice(0, 2000) || null;
    if (!REVIEW_DECISIONS.includes(decision)) return res.status(400).json({ error: "Choose a decision" });
    if (["Verified", "Closed"].includes(w.Status)) return res.status(409).json({ error: `Already ${w.Status.toLowerCase()}` });
    if (decision !== "Verified" && !remarks) return res.status(400).json({ error: "Say what must be corrected or added (remarks)" });
    const checklist = {};
    for (const [k] of REVIEW_CHECKS) {
      const c = b.checklist?.[k] || {};
      const st = ["ok", "issue", "na"].includes(c.status) ? c.status : null;
      checklist[k] = { status: st, note: String(c.note || "").slice(0, 300) || null };
    }
    if (decision === "Verified") {
      if (w.Status !== "Ready for Review") return res.status(409).json({ error: "Every mandatory activity must be Completed or Not Applicable first" });
      const unset = REVIEW_CHECKS.filter(([k]) => !checklist[k].status).map(([, l]) => l);
      if (unset.length) return res.status(400).json({ error: `Mark every checklist item: ${unset.join(", ")}` });
      const issues = REVIEW_CHECKS.filter(([k]) => checklist[k].status === "issue").map(([, l]) => l);
      if (issues.length) return res.status(400).json({ error: `Checklist has issues (${issues.join(", ")}) — return it instead of verifying` });
      if (w.Discrepancies > 0 && !remarks) return res.status(400).json({ error: `${w.Discrepancies} activit${w.Discrepancies === 1 ? "y has" : "ies have"} a mismatch or discrepancy — explain in remarks why it is acceptable` });
    }
    const snap = JSON.stringify(await snapshot(pool, id));
    const hash = crypto.createHash("sha256").update(snap).digest("hex");
    const me = userOf(req);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let versionNo;
    try {
      versionNo = (await new sql.Request(tx).input("V", sql.Int, id).query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS n FROM dbo.LegalVerificationReview WITH (UPDLOCK, HOLDLOCK) WHERE VerificationId = @V")).recordset[0].n;
      await new sql.Request(tx).input("V", sql.Int, id).input("N", sql.Int, versionNo).input("D", sql.NVarChar(40), decision).input("R", sql.NVarChar(2000), remarks)
        .input("C", sql.NVarChar(sql.MAX), JSON.stringify(checklist)).input("S", sql.NVarChar(sql.MAX), snap).input("H", sql.Char(64), hash).input("U", sql.Int, me)
        .query("INSERT INTO dbo.LegalVerificationReview (VerificationId, VersionNo, Decision, Remarks, ChecklistJson, SnapshotJson, SnapshotHash, ReviewedBy) VALUES (@V, @N, @D, @R, @C, @S, @H, @U)");
      await new sql.Request(tx).input("V", sql.Int, id).input("S", sql.NVarChar(30), decision === "Verified" ? "Verified" : "Returned").input("U", sql.Int, me)
        .query("UPDATE dbo.LegalVerification SET Status = @S, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
    await writeAudit(pool, req, { action: `Legal review: ${decision}`, entityType: "LegalVerification", entityId: id, newValue: { versionNo, hash }, remarks });
    const assignees = (await pool.request().input("V", sql.Int, id).query("SELECT DISTINCT AssignedUserId AS id FROM dbo.LegalVerificationActivity WHERE VerificationId = @V AND AssignedUserId IS NOT NULL")).recordset.map((r) => r.id);
    await notify(pool, { users: [w.LeadUserId, ...(decision === "Verified" ? [] : assignees)], roles: decision === "Verified" ? ["Approver"] : [], except: me,
      type: decision === "Verified" ? "legal_verification_verified" : "legal_verification_returned", title: `${decision}: ${w.VerificationNo}`,
      body: (remarks || `Version ${versionNo} reviewed.`).slice(0, 300), refId: id, refType: "legal_verification" });
    res.json({ message: `Version ${versionNo} saved — ${decision}`, versionNo, hash });
  } catch (err) {
    console.error("[legal-verification] review:", err.message);
    res.status(500).json({ error: "Could not save the review" });
  }
});

router.post("/:id/reopen", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query("SELECT ProjectId, Status, VerificationNo FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    if (!(isAdmin(req) || (await canAct(req, "Legal Reviewer", null)))) return res.status(403).json({ error: "Only a Legal Reviewer or admin can reopen a verification" });
    if (w.Status !== "Verified") return res.status(409).json({ error: "Only a verified verification can be reopened" });
    const reason = String(req.body?.reason || "").trim().slice(0, 2000);
    if (!reason) return res.status(400).json({ error: "Say why it is reopened" });
    const snap = JSON.stringify(await snapshot(pool, id));
    const n = (await pool.request().input("V", sql.Int, id).query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS n FROM dbo.LegalVerificationReview WHERE VerificationId = @V")).recordset[0].n;
    await pool.request().input("V", sql.Int, id).input("N", sql.Int, n).input("R", sql.NVarChar(2000), reason).input("S", sql.NVarChar(sql.MAX), snap)
      .input("H", sql.Char(64), crypto.createHash("sha256").update(snap).digest("hex")).input("U", sql.Int, userOf(req)).query(`
        INSERT INTO dbo.LegalVerificationReview (VerificationId, VersionNo, Decision, Remarks, SnapshotJson, SnapshotHash, ReviewedBy) VALUES (@V, @N, N'Reopened', @R, @S, @H, @U);
        UPDATE dbo.LegalVerification SET Status = N'In Progress', UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V;`);
    await refreshWorkspace(pool, id);
    await writeAudit(pool, req, { action: "Legal verification reopened", entityType: "LegalVerification", entityId: id, remarks: reason });
    res.json({ message: `${w.VerificationNo} reopened` });
  } catch (err) {
    console.error("[legal-verification] reopen:", err.message);
    res.status(500).json({ error: "Could not reopen" });
  }
});

/** The verification behind a land (through its enquiry), for the land and approval screens. */
router.get("/by-land/:landId", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json(null);
    const w = (await pool.request().input("L", sql.Int, Number(req.params.landId)).query(`${WORKSPACE_SELECT} WHERE e.LandId = @L`)).recordset[0];
    if (!w) return res.json(null);
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const last = (await pool.request().input("V", sql.Int, w.VerificationId).query(`
      SELECT TOP 1 r.VersionNo, r.Decision, r.Remarks, r.SnapshotHash, u.name AS ReviewedBy, r.ReviewedAt
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V ORDER BY r.VersionNo DESC`)).recordset[0] || null;
    const open = (await pool.request().input("V", sql.Int, w.VerificationId).query(`
      SELECT ActivityNo, ActivityName, Status, Finding FROM dbo.LegalVerificationActivity WHERE VerificationId = @V
        AND (Status NOT IN (N'Completed', N'Not Applicable') OR Finding IN (N'Mismatched', N'Discrepancy Found', N'Additional Documents Required', N'Unable to Verify')) ORDER BY ActivityNo`)).recordset;
    res.json({ ...w, lastReview: last, issues: open });
  } catch (err) {
    console.error("[legal-verification] by-land:", err.message);
    res.status(500).json({ error: "Could not load the verification" });
  }
});

router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.status(404).json({ error: "Not found" });
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query(`${WORKSPACE_SELECT} WHERE v.VerificationId = @V`)).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const [acts, deps, docs, rs, lr] = await Promise.all([
      pool.request().input("V", sql.Int, id).query(`${ACTIVITY_SELECT} WHERE a.VerificationId = @V ORDER BY a.ActivityNo`),
      pool.request().input("V", sql.Int, id).query(`
        SELECT a.ActivityId, p.ActivityId AS DependsOnId, p.ActivityNo, p.ActivityName, p.Status, d.IsMandatory
        FROM dbo.LegalVerificationActivity a
        JOIN dbo.LegalActivityDependency d ON d.TemplateId = a.TemplateId AND d.IsActive = 1
        JOIN dbo.LegalVerificationActivity p ON p.VerificationId = a.VerificationId AND p.TemplateId = d.DependsOnTemplateId
        WHERE a.VerificationId = @V`),
      pool.request().input("V", sql.Int, id).query(`
        SELECT d.DocId, d.ActivityId, d.FileId, f.FileName, d.Title, u.name AS UploadedBy, d.UploadedAt
        FROM dbo.LegalActivityDocument d JOIN dbo.LegalVerificationActivity a ON a.ActivityId = d.ActivityId
        LEFT JOIN dbo.LegalMasterFile f ON f.FileId = d.FileId LEFT JOIN dbo.users u ON u.id = d.UploadedBy
        WHERE a.VerificationId = @V AND d.IsActive = 1 ORDER BY d.DocId`),
      pool.request().input("E", sql.Int, w.EnquiryId).query("IF OBJECT_ID('dbo.LegalEnquiryRsRecord','U') IS NOT NULL SELECT RsKhatianNo, RsDagNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = @E ELSE SELECT TOP 0 1 AS x"),
      pool.request().input("E", sql.Int, w.EnquiryId).query("IF OBJECT_ID('dbo.LegalEnquiryLrRecord','U') IS NOT NULL SELECT LrKhatianNo, LrDagNo FROM dbo.LegalEnquiryLrRecord WHERE EnquiryId = @E ELSE SELECT TOP 0 1 AS x"),
    ]);
    const today = todayStr();
    const activities = acts.recordset.map((a) => {
      const dependsOn = deps.recordset.filter((d) => d.ActivityId === a.ActivityId);
      return { ...a, dependsOn, blocked: dependsOn.some((d) => d.IsMandatory && !DONE.includes(d.Status)), overdue: !DONE.includes(a.Status) && !!a.DueDate && a.DueDate < today,
        documents: docs.recordset.filter((d) => d.ActivityId === a.ActivityId) };
    });
    res.json({ ...w, rs: rs.recordset, lr: lr.recordset, activities,
      canOverride: isAdmin(req) || (await canAct(req, "Verifier", null)) || (await canAct(req, "Legal Reviewer", null)) });
  } catch (err) {
    console.error("[legal-verification] get:", err.message);
    res.status(500).json({ error: "Could not load the verification" });
  }
});

router.put("/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query("SELECT VerificationId, ProjectId, Status FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const b = req.body || {};
    await pool.request().input("V", sql.Int, id).input("T", sql.Date, b.targetDate ? day(b.targetDate) : null).input("L", sql.Int, Number(b.leadUserId) || null)
      .input("R", sql.NVarChar(1000), String(b.remarks || "").slice(0, 1000) || null).input("U", sql.Int, userOf(req))
      .query("UPDATE dbo.LegalVerification SET TargetDate = @T, LeadUserId = @L, Remarks = @R, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V");
    await writeAudit(pool, req, { action: "Legal verification updated", entityType: "LegalVerification", entityId: id, newValue: b });
    res.json({ message: "Saved" });
  } catch (err) {
    console.error("[legal-verification] update:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
