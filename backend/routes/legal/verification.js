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
         a.UpdatedAt, uu.name AS UpdatedByName, t.Stage, t.Description
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
  if (!r || r.Status === "Closed" || r.Status === "On Hold") return r?.Status;
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
    if (v.Status === "Closed") return res.status(409).json({ error: "This verification is closed" });
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
