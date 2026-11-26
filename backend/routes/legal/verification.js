"use strict";
/**
 * Legal Verification workspace (Legal V2 / V2.1). One workspace per land enquiry holds the verification activities
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
const { requirePageRight, hasAnyPageAction } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const { canAct, isAdmin, ownWork, userOf } = require("./approvalAuthority");
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
// V2.1: an activity has a Work Status (the employee's progress) and a Verification Status (the verifier's decision).
// Finishing the work does not verify it: the employee submits it, an authorised verifier verifies, returns or rejects.
const WORK_STATUSES = ["Not Started", "In Progress", "Applied", "Report Pending", "On Hold", "Submitted for Review", "Closed"];
const EMPLOYEE_STATUSES = ["Not Started", "In Progress", "Applied", "Report Pending", "On Hold"]; // the rest come from actions
const VERIFY_STATUSES = ["Not Reviewed", "Under Review", "Verified", "Returned", "Rejected", "N/A"];
const FINDINGS = ["Found", "Not Found in Sources Searched", "Incomplete", "Records Not Available", "Matched", "Mismatched", "Discrepancy Found",
  "Additional Documents Required", "Unable to Verify", "Case Found"];
const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
const CLEARED = ["Verified", "N/A"]; // a prerequisite counts as done
const ASSESSED = ["Verified", "N/A", "Rejected"]; // the verifier has decided
const BAD_FINDINGS = ["Mismatched", "Discrepancy Found", "Additional Documents Required", "Unable to Verify", "Case Found", "Incomplete", "Records Not Available"];
const GOV_DATES = { govSubmissionDate: "GovSubmissionDate", ackDate: "AckDate", queryDate: "QueryDate", queryResponseDate: "QueryResponseDate",
  hearingDate: "HearingDate", reportReceiptDate: "ReportReceiptDate", orderDate: "OrderDate" };

/**
 * Edit right on an activity: the enquiry page's edit right, or a Search Executive (Approval Control) — who may then
 * change only the search activities (Department = Search); the handler checks that with req.searchOnly.
 */
const editOrSearch = async (req, res, next) => {
  try {
    if (await hasAnyPageAction(req, PAGE, ["edit"])) return next();
    if (await canAct(req, "Search Executive", null)) { req.searchOnly = true; return next(); }
    return res.status(403).json({ error: "You cannot change verification activities" });
  } catch (e) { return next(e); }
};
const searchBlocked = (req, a) => (req.searchOnly && a.Department !== "Search" ? "A Search Executive can change only the search activities" : null);
/** Who may verify, approve N/A, override a dependency or reopen: a Verifier, Legal Reviewer, Legal Admin or administrator. */
const canVerify = async (req) => isAdmin(req) || (await canAct(req, "Verifier", null)) || (await canAct(req, "Legal Reviewer", null)) || (await canAct(req, "Legal Admin", null));

const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalVerificationActivity', 'U') AS t")).recordset[0].t;
const inScope = (req, projectId) => !req.legalScope || (projectId != null && req.legalScope.includes(Number(projectId)));
const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayStr = () => new Date().toISOString().slice(0, 10);
const ref = (a) => a.ActivityRef ?? String(a.ActivityNo);

const ACTIVITY_SELECT = `
  SELECT a.ActivityId, a.VerificationId, a.TemplateId, a.ActivityNo, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, t.SortOrder,
         a.ActivityName, a.IsMandatory, a.Status, a.VerifyStatus, a.Finding,
         a.AssignedUserId, au.name AS AssignedName, a.VerifierUserId, vu.name AS VerifierName, a.Department, a.Priority, a.ExpectedDays,
         CONVERT(char(10), a.StartDate, 23) AS StartDate, CONVERT(char(10), a.DueDate, 23) AS DueDate, CONVERT(char(10), a.CompletedDate, 23) AS CompletedDate,
         CONVERT(char(10), a.GovSubmissionDate, 23) AS GovSubmissionDate, CONVERT(char(10), a.AckDate, 23) AS AckDate, CONVERT(char(10), a.QueryDate, 23) AS QueryDate,
         CONVERT(char(10), a.QueryResponseDate, 23) AS QueryResponseDate, CONVERT(char(10), a.HearingDate, 23) AS HearingDate,
         CONVERT(char(10), a.ReportReceiptDate, 23) AS ReportReceiptDate, CONVERT(char(10), a.OrderDate, 23) AS OrderDate,
         a.Findings, a.Remarks, a.HoldReason, a.NextAction, a.ReviewedBy, rv.name AS ReviewedByName, a.ReviewedAt, a.VerifyRemarks,
         a.SubmittedBy, su.name AS SubmittedByName, a.SubmittedAt,
         a.NaReason, a.NaRequestedBy, nu.name AS NaRequestedByName, a.NaRequestedAt, na.name AS NaApprovedByName, a.NaApprovedAt,
         a.UpdatedAt, uu.name AS UpdatedByName, t.Stage, t.Description, t.ActivityCode, t.PeriodFromYear, t.PeriodToYear, t.PeriodYears,
         (SELECT COUNT(*) FROM dbo.LegalActivityEntry x WHERE x.ActivityId = a.ActivityId AND x.IsActive = 1) AS EntryCount
  FROM dbo.LegalVerificationActivity a
  JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
  LEFT JOIN dbo.users au ON au.id = a.AssignedUserId
  LEFT JOIN dbo.users vu ON vu.id = a.VerifierUserId
  LEFT JOIN dbo.users rv ON rv.id = a.ReviewedBy
  LEFT JOIN dbo.users su ON su.id = a.SubmittedBy
  LEFT JOIN dbo.users nu ON nu.id = a.NaRequestedBy
  LEFT JOIN dbo.users na ON na.id = a.NaApprovedBy
  LEFT JOIN dbo.users uu ON uu.id = a.UpdatedBy`;

const cnt = (where) => `(SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND ${where})`;
const WORKSPACE_SELECT = `
  SELECT v.VerificationId, v.VerificationNo, v.EnquiryId, v.ProjectId, pr.name AS ProjectName, v.Status,
         CONVERT(char(10), v.StartDate, 23) AS StartDate, CONVERT(char(10), v.TargetDate, 23) AS TargetDate,
         v.LeadUserId, lu.name AS LeadName, v.Remarks, v.UpdatedAt, v.CreatedBy,
         e.EnquiryNo, e.LandLocation, e.JLNo, CAST(e.ApproxArea AS FLOAT) AS ApproxArea, u.UnitName, e.ContactPerson, e.ContactNumber, e.LandId,
         m.MouzaName, d.DistrictName,
         ${cnt("1 = 1")} AS Total,
         ${cnt("a.VerifyStatus = N'Verified'")} AS Completed,
         ${cnt("a.VerifyStatus = N'N/A'")} AS NotApplicable,
         ${cnt("a.VerifyStatus = N'Rejected'")} AS Rejected,
         ${cnt("a.Status = N'Submitted for Review'")} AS AwaitingVerification,
         ${cnt("a.VerifyStatus = N'Returned'")} AS Returned,
         ${cnt("a.Status IN (N'Applied', N'Report Pending')")} AS AwaitingReports,
         ${cnt("a.Status = N'On Hold'")} AS OnHold,
         ${cnt("a.NaRequestedAt IS NOT NULL AND a.VerifyStatus <> N'N/A'")} AS NaRequests,
         ${cnt("a.Finding IN (N'Mismatched', N'Discrepancy Found')")} AS Discrepancies,
         ${cnt("a.Finding = N'Additional Documents Required'")} AS MissingDocuments,
         ${cnt("a.Status NOT IN (N'Submitted for Review', N'Closed') AND a.DueDate < CAST(GETDATE() AS DATE)")} AS Overdue
  FROM dbo.LegalVerification v
  JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
  LEFT JOIN dbo.enterprise pr ON pr.id = v.ProjectId
  LEFT JOIN dbo.users lu ON lu.id = v.LeadUserId
  LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
  LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
  LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = e.AreaUnitId`;

/** Recompute a workspace's status: Ready for Review once every mandatory activity is assessed by a verifier. */
async function refreshWorkspace(conn, verificationId) {
  const r = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT v.Status,
      (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.IsMandatory = 1
         AND a.VerifyStatus NOT IN (N'Verified', N'N/A', N'Rejected')) AS OpenMandatory
    FROM dbo.LegalVerification v WHERE v.VerificationId = @V`)).recordset[0];
  if (!r || ["Closed", "On Hold", "Verified", "Rejected"].includes(r.Status)) return r?.Status;
  const next = r.OpenMandatory === 0 ? "Ready for Review" : r.Status === "Returned" ? "Returned" : "In Progress";
  if (next !== r.Status) await conn.request().input("V", sql.Int, verificationId).input("S", sql.NVarChar(30), next)
    .query("UPDATE dbo.LegalVerification SET Status = @S, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V");
  return next;
}

/** Mandatory prerequisites not yet verified (or N/A). */
async function openPrerequisites(conn, activity) {
  return (await conn.request().input("V", sql.Int, activity.VerificationId).input("T", sql.Int, activity.TemplateId).query(`
    SELECT ISNULL(t.DisplayNo, CAST(p.ActivityNo AS NVARCHAR(5))) AS ActivityRef, p.ActivityName, p.Status, p.VerifyStatus
    FROM dbo.LegalActivityDependency d
    JOIN dbo.LegalVerificationActivity p ON p.VerificationId = @V AND p.TemplateId = d.DependsOnTemplateId
    JOIN dbo.LegalActivityTemplate t ON t.TemplateId = p.TemplateId
    WHERE d.TemplateId = @T AND d.IsActive = 1 AND d.IsMandatory = 1 AND p.VerifyStatus NOT IN (N'Verified', N'N/A')
    ORDER BY t.SortOrder`)).recordset;
}

async function loadActivity(pool, req, activityId) {
  const a = (await pool.request().input("A", sql.Int, activityId).query(`${ACTIVITY_SELECT} WHERE a.ActivityId = @A`)).recordset[0];
  if (!a) return { error: [404, "Activity not found"] };
  const v = (await pool.request().input("V", sql.Int, a.VerificationId).query("SELECT ProjectId, LeadUserId, VerificationNo, CreatedBy, Status FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
  if (!inScope(req, v.ProjectId)) return { error: [403, "You don't have access to this project."] };
  return { a, v };
}

/** Shared guards for every activity write. Returns an error [status, message] or null. */
function writeGuards(req, a, v, b) {
  const sb = searchBlocked(req, a);
  if (sb) return [403, sb];
  if (v.Status === "Closed" || v.Status === "Verified") return [409, v.Status === "Verified" ? "This verification is approved — a Legal Reviewer must reopen it before changes" : "This verification is closed"];
  if (b && "updatedAt" in b) {
    const seen = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
    const now = a.UpdatedAt ? new Date(a.UpdatedAt).getTime() : null;
    if (seen !== now) return [409, `${a.UpdatedByName ?? "Someone"} changed this activity after you opened it — reload and try again`];
  }
  return null;
}

/**
 * Write an activity change in one transaction: the columns in `set` ({ column: [sqlType, value] }), one history row,
 * and optional extra history rows / an exception record. Refused when the row changed since it was read.
 */
async function writeActivity(pool, req, a, set, hist, extra = {}) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = new sql.Request(tx).input("A", sql.Int, a.ActivityId).input("U", sql.Int, userOf(req)).input("Was", sql.DateTime2, a.UpdatedAt ?? null);
    const cols = Object.entries(set).map(([c, [t, val]], i) => { r.input(`p${i}`, t, val); return `${c} = @p${i}`; });
    const upd = await r.query(`UPDATE dbo.LegalVerificationActivity SET ${cols.join(", ")}${cols.length ? ", " : ""}UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
      WHERE ActivityId = @A AND ((@Was IS NULL AND UpdatedAt IS NULL) OR ABS(DATEDIFF_BIG(MICROSECOND, UpdatedAt, @Was)) < 1000)`);
    if (!upd.rowsAffected[0]) { await tx.rollback(); return false; }
    for (const h of [hist, ...(extra.history ?? [])].filter(Boolean)) {
      await new sql.Request(tx).input("A", sql.Int, a.ActivityId).input("Act", sql.NVarChar(30), h.action).input("OS", sql.NVarChar(30), h.oldStatus ?? null)
        .input("NS", sql.NVarChar(30), h.newStatus ?? null).input("OF", sql.NVarChar(40), h.oldFinding ?? null).input("NF", sql.NVarChar(40), h.newFinding ?? null)
        .input("OA", sql.Int, h.oldAssignee ?? null).input("NA", sql.Int, h.newAssignee ?? null).input("R", sql.NVarChar(1000), h.remarks ? String(h.remarks).slice(0, 1000) : null)
        .input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, OldStatus, NewStatus, OldFinding, NewFinding, OldAssignee, NewAssignee, Remarks, ChangedBy) VALUES (@A, @Act, @OS, @NS, @OF, @NF, @OA, @NA, @R, @U)");
    }
    for (const x of [extra.exception, ...(extra.exceptions ?? [])].filter(Boolean)) {
      await new sql.Request(tx).input("K", sql.NVarChar(40), x.kind).input("V", sql.Int, a.VerificationId).input("A", sql.Int, a.ActivityId)
        .input("R", sql.NVarChar(1000), String(x.reason).slice(0, 1000)).input("Rm", sql.NVarChar(1000), x.remarks ? String(x.remarks).slice(0, 1000) : null)
        .input("D", sql.NVarChar(1000), x.detail ? String(x.detail).slice(0, 1000) : null).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalVerificationException (Kind, VerificationId, ActivityId, Reason, Remarks, Detail, ApprovedBy, CreatedBy) VALUES (@K, @V, @A, @R, @Rm, @D, @U, @U)");
    }
    await tx.commit();
    return true;
  } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
}
const STALE = "Someone changed this activity just now — reload and try again";
const label = (v, a) => `${v.VerificationNo} · ${ref(a)}. ${a.ActivityName}`;

/** Notify the reviewers when the workspace becomes ready for the Final Legal Review. */
async function afterChange(pool, req, a, v) {
  const ws = await refreshWorkspace(pool, a.VerificationId);
  if (ws === "Ready for Review" && v.Status !== "Ready for Review")
    await notify(pool, { roles: ["Legal Reviewer"], users: [v.LeadUserId], except: userOf(req), type: "legal_verification_ready", title: `Final Legal Review pending: ${v.VerificationNo}`,
      body: "Every mandatory activity has been assessed by a verifier.", refId: a.VerificationId, refType: "legal_verification" });
  return ws;
}

router.get("/meta", requirePageRight(PAGE, "view"), (_req, res) =>
  res.json({ statuses: EMPLOYEE_STATUSES, workStatuses: WORK_STATUSES, verifyStatuses: VERIFY_STATUSES, findings: FINDINGS, priorities: PRIORITIES }));

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
    // One activity per active pre-registration template; target date = start + expected duration (a default, not a promise).
    const templates = (await new sql.Request(tx).query(`SELECT TemplateId, ActivityNo, ActivityName, IsMandatory, Department, DefaultDays FROM dbo.LegalActivityTemplate
      WHERE IsActive = 1 AND Stage = N'Verification' ORDER BY ISNULL(SortOrder, ActivityNo * 10)`)).recordset;
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

/** My work: activities assigned to me, and those waiting for me as verifier. */
router.get("/my-tasks", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json([]);
    const verifier = await canVerify(req);
    const rows = (await pool.request().input("U", sql.Int, userOf(req)).input("Vf", sql.Bit, verifier ? 1 : 0).query(`
      ${ACTIVITY_SELECT.replace("SELECT a.ActivityId", "SELECT v.VerificationNo, v.ProjectId, e.EnquiryNo, CASE WHEN a.AssignedUserId = @U THEN 1 ELSE 0 END AS Mine, a.ActivityId")}
      JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
      JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
      WHERE v.Status NOT IN (N'Closed') AND (a.AssignedUserId = @U
        OR (a.Status = N'Submitted for Review' AND (a.VerifierUserId = @U OR (a.VerifierUserId IS NULL AND @Vf = 1)) AND ISNULL(a.SubmittedBy, 0) <> @U)
        OR (a.NaRequestedAt IS NOT NULL AND a.VerifyStatus <> N'N/A' AND @Vf = 1 AND ISNULL(a.NaRequestedBy, 0) <> @U))
      ORDER BY CASE WHEN a.Status = N'Closed' THEN 1 ELSE 0 END, ISNULL(a.DueDate, '9999-12-31'), t.SortOrder`)).recordset;
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

router.get("/activity/:activityId/comments", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    res.json((await pool.request().input("A", sql.Int, got.a.ActivityId).query(`
      SELECT c.CommentId, c.Comment, u.name AS CreatedBy, c.CreatedAt FROM dbo.LegalActivityComment c LEFT JOIN dbo.users u ON u.id = c.CreatedBy
      WHERE c.ActivityId = @A ORDER BY c.CommentId DESC`)).recordset);
  } catch (err) {
    console.error("[legal-verification] comments:", err.message);
    res.status(500).json({ error: "Could not load comments" });
  }
});

router.post("/activity/:activityId/comment", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const text = String(req.body?.comment || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "Write a comment" });
    await pool.request().input("A", sql.Int, got.a.ActivityId).input("C", sql.NVarChar(2000), text).input("U", sql.Int, userOf(req))
      .query("INSERT INTO dbo.LegalActivityComment (ActivityId, Comment, CreatedBy) VALUES (@A, @C, @U)");
    res.status(201).json({ message: "Comment added" });
  } catch (err) {
    console.error("[legal-verification] comment:", err.message);
    res.status(500).json({ error: "Could not add the comment" });
  }
});

/** The employee's work: work status, finding, people, dates, findings and remarks. Verification goes through /submit and /verify. */
router.put("/activity/:activityId", editOrSearch, async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const b = req.body || {};
    const g = writeGuards(req, a, v, b);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (a.Status === "Closed") return res.status(409).json({ error: `This activity is ${a.VerifyStatus === "N/A" ? "marked N/A" : a.VerifyStatus.toLowerCase()} — reopen it to change it` });
    if (a.Status === "Submitted for Review" && b.status && b.status !== a.Status)
      return res.status(409).json({ error: "This activity is with the verifier — wait for the decision or ask the verifier to return it" });

    const str = (k, max) => (b[k] === undefined ? undefined : String(b[k] || "").trim().slice(0, max) || null);
    const next = {
      status: b.status ?? a.Status,
      finding: b.finding === undefined ? a.Finding : b.finding || null,
      assignedUserId: b.assignedUserId === undefined ? a.AssignedUserId : Number(b.assignedUserId) || null,
      verifierUserId: b.verifierUserId === undefined ? a.VerifierUserId : Number(b.verifierUserId) || null,
      priority: b.priority ?? a.Priority,
      startDate: b.startDate === undefined ? a.StartDate : day(b.startDate),
      dueDate: b.dueDate === undefined ? a.DueDate : day(b.dueDate),
      findings: b.findings === undefined ? a.Findings : String(b.findings || "").slice(0, 8000) || null,
      remarks: str("remarks", 1000) === undefined ? a.Remarks : str("remarks", 1000),
      holdReason: str("holdReason", 500) === undefined ? a.HoldReason : str("holdReason", 500),
      nextAction: str("nextAction", 500) === undefined ? a.NextAction : str("nextAction", 500),
    };
    const gov = Object.fromEntries(Object.entries(GOV_DATES).map(([k, col]) => [col, b[k] === undefined ? a[col] : day(b[k])]));
    if (req.searchOnly && (next.assignedUserId !== a.AssignedUserId || next.verifierUserId !== a.VerifierUserId)) return res.status(403).json({ error: "A Search Executive cannot reassign activities" });
    if (next.status !== a.Status && !EMPLOYEE_STATUSES.includes(next.status)) return res.status(400).json({ error: "Use Submit for review to send the work to the verifier" });
    if (next.finding && !FINDINGS.includes(next.finding)) return res.status(400).json({ error: "Unknown finding" });
    if (!PRIORITIES.includes(next.priority)) return res.status(400).json({ error: "Unknown priority" });
    if (next.status === "On Hold" && (!next.holdReason || !next.nextAction)) return res.status(400).json({ error: "On Hold needs a reason and the next action" });
    if (next.finding === "Mismatched" && !next.remarks) return res.status(400).json({ error: "An unresolved mismatch needs remarks" });
    if (next.startDate && next.dueDate && next.dueDate < next.startDate) return res.status(400).json({ error: "Target date is before the start date" });
    if (next.verifierUserId && next.verifierUserId === next.assignedUserId) return res.status(400).json({ error: "The verifier must be someone other than the assigned employee" });
    const reassigned = next.assignedUserId !== a.AssignedUserId;
    const handover = String(b.handoverNote || "").trim().slice(0, 800);
    if (reassigned && a.AssignedUserId && !handover) return res.status(400).json({ error: "Write a handover note when reassigning the activity" });
    if (reassigned && !(await hasAnyPageAction(req, PAGE, ["edit"]))) return res.status(403).json({ error: "You cannot reassign activities" });

    const set = {
      Status: [sql.NVarChar(30), next.status], Finding: [sql.NVarChar(40), next.finding], AssignedUserId: [sql.Int, next.assignedUserId],
      VerifierUserId: [sql.Int, next.verifierUserId], Priority: [sql.NVarChar(10), next.priority], StartDate: [sql.Date, next.startDate],
      DueDate: [sql.Date, next.dueDate], Findings: [sql.NVarChar(sql.MAX), next.findings], Remarks: [sql.NVarChar(1000), next.remarks],
      HoldReason: [sql.NVarChar(500), next.status === "On Hold" ? next.holdReason : null], NextAction: [sql.NVarChar(500), next.status === "On Hold" ? next.nextAction : null],
      ...Object.fromEntries(Object.entries(gov).map(([c, val]) => [c, [sql.Date, val]])),
      ...(next.status !== "Not Started" && !a.StartDate && !next.startDate ? { StartDate: [sql.Date, todayStr()] } : {}),
      ...(next.dueDate !== a.DueDate ? { EscalatedOn: [sql.Date, null] } : {}),
    };
    const hist = { action: reassigned ? "Reassigned" : "Updated", oldStatus: a.Status, newStatus: next.status, oldFinding: a.Finding, newFinding: next.finding,
      oldAssignee: a.AssignedUserId, newAssignee: next.assignedUserId,
      remarks: [reassigned && handover ? `Handover: ${handover}` : null, next.status === "On Hold" && a.Status !== "On Hold" ? `On hold: ${next.holdReason} · Next: ${next.nextAction}` : null,
        b.remarks !== undefined && next.remarks !== a.Remarks ? next.remarks : null, next.verifierUserId !== a.VerifierUserId ? "Verifier changed" : null].filter(Boolean).join(" · ") };
    if (!(await writeActivity(pool, req, a, set, hist))) return res.status(409).json({ error: STALE });
    await writeAudit(pool, req, { action: reassigned ? "Verification activity reassigned" : "Verification activity updated", entityType: "LegalVerificationActivity", entityId: a.ActivityId,
      oldValue: { status: a.Status, finding: a.Finding, assignee: a.AssignedUserId }, newValue: { status: next.status, finding: next.finding, assignee: next.assignedUserId } });

    const me = userOf(req);
    if (reassigned && next.assignedUserId)
      await notify(pool, { users: [next.assignedUserId], except: me, type: a.AssignedUserId ? "legal_activity_reassigned" : "legal_activity_assigned",
        title: `${a.AssignedUserId ? "Reassigned" : "Assigned"} to you: ${a.ActivityName}`, body: `${label(v, a)}${next.dueDate ? ` · target ${next.dueDate}` : ""}${handover ? ` — ${handover}` : ""}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    if (reassigned && a.AssignedUserId) await notify(pool, { users: [a.AssignedUserId], except: me, type: "legal_activity_reassigned", title: `Reassigned: ${a.ActivityName}`, body: `${label(v, a)} moved to another employee`, refId: a.VerificationId, refType: "legal_verification" });
    if (next.verifierUserId && next.verifierUserId !== a.VerifierUserId)
      await notify(pool, { users: [next.verifierUserId], except: me, type: "legal_activity_verifier", title: `You verify: ${a.ActivityName}`, body: label(v, a), refId: a.VerificationId, refType: "legal_verification" });
    if (next.status === "On Hold" && a.Status !== "On Hold")
      await notify(pool, { users: [v.LeadUserId, v.CreatedBy, next.assignedUserId], except: me, type: "legal_activity_hold", title: `On hold: ${a.ActivityName}`, body: `${label(v, a)} — ${next.holdReason}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    if (gov.ReportReceiptDate && !a.ReportReceiptDate)
      await notify(pool, { users: [v.LeadUserId, next.verifierUserId], except: me, type: "legal_activity_report", title: `Report received: ${a.ActivityName}`, body: `${label(v, a)} · ${gov.ReportReceiptDate}`, refId: a.VerificationId, refType: "legal_verification" });
    if (next.finding && BAD_FINDINGS.includes(next.finding) && next.finding !== a.Finding)
      await notify(pool, { roles: ["Verifier"], users: [v.LeadUserId], except: me, type: "legal_activity_discrepancy", title: `${next.finding}: ${a.ActivityName}`, body: label(v, a), refId: a.VerificationId, refType: "legal_verification" });
    res.json({ message: "Saved" });
  } catch (err) {
    console.error("[legal-verification] activity update:", err.message);
    res.status(500).json({ error: "Could not save the activity" });
  }
});

/**
 * Submit the work for verification. Needs the finding; mandatory prerequisites must be verified (or an authorised
 * override with a reason — the override does not verify or waive the prerequisite); Mouza map cutting needs the
 * updated Dag sketch (or an authorised exception).
 */
router.post("/activity/:activityId/submit", editOrSearch, async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const b = req.body || {};
    const g = writeGuards(req, a, v, b);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (["Submitted for Review", "Closed"].includes(a.Status)) return res.status(409).json({ error: `Already ${a.Status === "Closed" ? "closed" : "submitted"}` });
    if (!a.Finding) return res.status(400).json({ error: "Record the finding before submitting — the result must be entered by the person who did the work" });
    const extraHist = [];
    let exception = null;
    const open = await openPrerequisites(pool, a);
    if (open.length) {
      const reason = String(b.overrideReason || "").trim();
      const list = open.map((p) => `${p.ActivityRef}. ${p.ActivityName} (${p.VerifyStatus})`).join(", ");
      if (!reason) return res.status(409).json({ error: `Waiting for: ${list}`, blockedBy: open, needsOverride: true });
      if (!(await canVerify(req))) return res.status(403).json({ error: `Waiting for: ${list}. Only a Verifier, Legal Reviewer, Legal Admin or admin may override` });
      exception = { kind: "Dependency override", reason, remarks: b.overrideRemarks, detail: `Open prerequisites: ${list}` };
      extraHist.push({ action: "Override", remarks: `Dependency overridden (${list}): ${reason}. Not a verification or waiver of the prerequisite.` });
    }
    const exceptions = exception ? [exception] : [];
    if (a.ActivityCode === "MOUZA-MAP") {
      const sketch = (await pool.request().input("A", sql.Int, a.ActivityId)
        .query("SELECT COUNT(*) AS n FROM dbo.LegalActivityEntry WHERE ActivityId = @A AND IsActive = 1 AND JSON_VALUE(DataJson, '$.sheetType') = N'Updated Dag Sketch'")).recordset[0].n;
      if (!sketch) {
        const reason = String(b.exceptionReason || "").trim();
        if (!reason) return res.status(409).json({ error: "The updated Dag sketch is not uploaded — add it, or record an authorised exception", needsException: true });
        if (!(await canVerify(req))) return res.status(403).json({ error: "Only a Verifier, Legal Reviewer, Legal Admin or admin may record a map-sketch exception" });
        exceptions.push({ kind: "Map sketch exception", reason, detail: "Submitted without the updated Dag sketch" });
        extraHist.push({ action: "Exception", remarks: `Map sketch exception: ${reason}` });
      }
    }
    const ok = await writeActivity(pool, req, a, {
      Status: [sql.NVarChar(30), "Submitted for Review"], VerifyStatus: [sql.NVarChar(20), "Under Review"],
      SubmittedBy: [sql.Int, userOf(req)], SubmittedAt: [sql.DateTime2, new Date()], StartDate: [sql.Date, a.StartDate ?? todayStr()],
    }, { action: "Submitted", oldStatus: a.Status, newStatus: "Submitted for Review", remarks: String(b.remarks || "").slice(0, 500) || null }, { history: extraHist, exceptions });
    if (!ok) return res.status(409).json({ error: STALE });
    await writeAudit(pool, req, { action: "Verification activity submitted", entityType: "LegalVerificationActivity", entityId: a.ActivityId, remarks: exceptions.map((x) => `${x.kind}: ${x.reason}`).join(" · ") || null });
    await notify(pool, { users: [a.VerifierUserId], roles: a.VerifierUserId ? [] : ["Verifier"], except: userOf(req), type: "legal_activity_submitted",
      title: `To verify: ${a.ActivityName}`, body: `${label(v, a)} · finding ${a.Finding}`, refId: a.VerificationId, refType: "legal_verification" });
    res.json({ message: exceptions.length ? `Submitted — ${exceptions.map((x) => x.kind.toLowerCase()).join(" and ")} recorded` : "Submitted for verification" });
  } catch (err) {
    console.error("[legal-verification] submit:", err.message);
    res.status(500).json({ error: "Could not submit" });
  }
});

/** The verifier's decision on submitted work: Verified, Returned (to correct) or Rejected. Never the submitter's own. */
router.post("/activity/:activityId/verify", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const b = req.body || {};
    const g = writeGuards({ ...req, searchOnly: false }, a, v, b);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (!(await canVerify(req))) return res.status(403).json({ error: "Only a Verifier, Legal Reviewer, Legal Admin or admin can verify" });
    if (a.VerifierUserId && a.VerifierUserId !== userOf(req) && !isAdmin(req)) return res.status(403).json({ error: `${a.VerifierName} is the verifier of this activity` });
    const own = ownWork(req, a.SubmittedBy, "this work") || ownWork(req, a.AssignedUserId, "this work");
    if (own) return res.status(403).json({ error: own });
    if (a.Status !== "Submitted for Review") return res.status(409).json({ error: "Only submitted work can be verified" });
    const decision = String(b.decision || "");
    if (!["Verified", "Returned", "Rejected"].includes(decision)) return res.status(400).json({ error: "Choose Verified, Returned or Rejected" });
    const remarks = String(b.remarks || "").trim().slice(0, 1000) || null;
    if (decision !== "Verified" && !remarks) return res.status(400).json({ error: decision === "Returned" ? "Say what must be corrected" : "Give the reason for rejecting" });
    const work = decision === "Returned" ? "In Progress" : "Closed";
    const ok = await writeActivity(pool, req, a, {
      Status: [sql.NVarChar(30), work], VerifyStatus: [sql.NVarChar(20), decision], VerifyRemarks: [sql.NVarChar(1000), remarks],
      ReviewedBy: [sql.Int, userOf(req)], ReviewedAt: [sql.DateTime2, new Date()],
      CompletedDate: [sql.Date, work === "Closed" ? todayStr() : null],
    }, { action: `Verification: ${decision}`, oldStatus: a.Status, newStatus: work, remarks });
    if (!ok) return res.status(409).json({ error: STALE });
    await writeAudit(pool, req, { action: `Verification activity ${decision.toLowerCase()}`, entityType: "LegalVerificationActivity", entityId: a.ActivityId, remarks });
    if (decision !== "Verified")
      await notify(pool, { users: [a.AssignedUserId, a.SubmittedBy], except: userOf(req), type: "legal_activity_returned", title: `${decision}: ${a.ActivityName}`,
        body: `${label(v, a)} — ${remarks}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    const ws = await afterChange(pool, req, a, v);
    res.json({ message: `${ref(a)}. ${a.ActivityName}: ${decision}`, workspaceStatus: ws });
  } catch (err) {
    console.error("[legal-verification] verify:", err.message);
    res.status(500).json({ error: "Could not save the decision" });
  }
});

/** Ask for the activity to be treated as not applicable (reason required); an authorised verifier approves or refuses. */
router.post("/activity/:activityId/na-request", editOrSearch, async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const g = writeGuards(req, a, v, req.body);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (a.Status === "Closed") return res.status(409).json({ error: "This activity is closed — reopen it first" });
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: "Give the reason it does not apply" });
    const ok = await writeActivity(pool, req, a, { NaReason: [sql.NVarChar(500), reason], NaRequestedBy: [sql.Int, userOf(req)], NaRequestedAt: [sql.DateTime2, new Date()] },
      { action: "N/A requested", remarks: reason });
    if (!ok) return res.status(409).json({ error: STALE });
    await notify(pool, { roles: ["Verifier", "Legal Reviewer"], users: [a.VerifierUserId], except: userOf(req), type: "legal_activity_na", title: `N/A requested: ${a.ActivityName}`,
      body: `${label(v, a)} — ${reason}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    res.json({ message: "N/A requested — waiting for approval" });
  } catch (err) {
    console.error("[legal-verification] na-request:", err.message);
    res.status(500).json({ error: "Could not request N/A" });
  }
});

router.post("/activity/:activityId/na-decision", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const g = writeGuards({ ...req, searchOnly: false }, a, v, req.body);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (!a.NaRequestedAt || a.VerifyStatus === "N/A") return res.status(409).json({ error: "No N/A request is waiting" });
    if (!(await canVerify(req))) return res.status(403).json({ error: "Only a Verifier, Legal Reviewer, Legal Admin or admin can approve N/A" });
    const own = ownWork(req, a.NaRequestedBy, "this N/A request");
    if (own) return res.status(403).json({ error: own });
    const approve = req.body?.approve === true;
    const remarks = String(req.body?.remarks || "").trim().slice(0, 1000) || null;
    if (!approve && !remarks) return res.status(400).json({ error: "Say why N/A is refused" });
    const ok = approve
      ? await writeActivity(pool, req, a, { Status: [sql.NVarChar(30), "Closed"], VerifyStatus: [sql.NVarChar(20), "N/A"], NaApprovedBy: [sql.Int, userOf(req)], NaApprovedAt: [sql.DateTime2, new Date()],
          VerifyRemarks: [sql.NVarChar(1000), remarks], CompletedDate: [sql.Date, todayStr()] },
        { action: "N/A approved", oldStatus: a.Status, newStatus: "Closed", remarks: `${a.NaReason}${remarks ? ` · ${remarks}` : ""}` },
        { exception: { kind: "N/A approval", reason: a.NaReason, remarks } })
      : await writeActivity(pool, req, a, { NaReason: [sql.NVarChar(500), null], NaRequestedBy: [sql.Int, null], NaRequestedAt: [sql.DateTime2, null] },
        { action: "N/A refused", remarks });
    if (!ok) return res.status(409).json({ error: STALE });
    await notify(pool, { users: [a.NaRequestedBy, a.AssignedUserId], except: userOf(req), type: "legal_activity_na", title: `N/A ${approve ? "approved" : "refused"}: ${a.ActivityName}`,
      body: `${label(v, a)}${remarks ? ` — ${remarks}` : ""}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    const ws = await afterChange(pool, req, a, v);
    res.json({ message: approve ? "Marked N/A" : "N/A refused", workspaceStatus: ws });
  } catch (err) {
    console.error("[legal-verification] na-decision:", err.message);
    res.status(500).json({ error: "Could not save the decision" });
  }
});

/** Reopen a closed or submitted activity (authorised users, with a reason). History is kept. */
router.post("/activity/:activityId/reopen", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadActivity(pool, req, Number(req.params.activityId));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const { a, v } = got;
    const g = writeGuards({ ...req, searchOnly: false }, a, v, req.body);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (!(await canVerify(req))) return res.status(403).json({ error: "Only a Verifier, Legal Reviewer, Legal Admin or admin can reopen an activity" });
    if (!["Closed", "Submitted for Review"].includes(a.Status)) return res.status(409).json({ error: "The activity is already open" });
    const reason = String(req.body?.reason || "").trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: "Give the reason for reopening" });
    const ok = await writeActivity(pool, req, a, { Status: [sql.NVarChar(30), "In Progress"], VerifyStatus: [sql.NVarChar(20), "Not Reviewed"], CompletedDate: [sql.Date, null],
      NaReason: [sql.NVarChar(500), null], NaRequestedBy: [sql.Int, null], NaRequestedAt: [sql.DateTime2, null], NaApprovedBy: [sql.Int, null], NaApprovedAt: [sql.DateTime2, null] },
      { action: "Reopened", oldStatus: a.Status, newStatus: "In Progress", remarks: `Was ${a.VerifyStatus} — ${reason}` });
    if (!ok) return res.status(409).json({ error: STALE });
    await notify(pool, { users: [a.AssignedUserId], except: userOf(req), type: "legal_activity_reopened", title: `Reopened: ${a.ActivityName}`, body: `${label(v, a)} — ${reason}`.slice(0, 300), refId: a.VerificationId, refType: "legal_verification" });
    const ws = await afterChange(pool, req, a, v);
    res.json({ message: "Activity reopened", workspaceStatus: ws });
  } catch (err) {
    console.error("[legal-verification] reopen activity:", err.message);
    res.status(500).json({ error: "Could not reopen" });
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
    const g = writeGuards(req, a, v, null);
    if (g) return res.status(g[0]).json({ error: g[1] });
    if (["Submitted for Review", "Closed"].includes(a.Status))
      return res.status(409).json({ error: a.Status === "Closed" ? "This activity is closed — reopen it to change its entries" : "This activity is with the verifier — it must be returned before its entries change" });
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
router.post("/activity/:activityId/entries", editOrSearch, (req, res) => entryWrite(req, res, "add"));
router.put("/entry/:entryId", editOrSearch, (req, res) => entryWrite(req, res, "edit"));
router.delete("/entry/:entryId", editOrSearch, (req, res) => entryWrite(req, res, "remove"));

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

// ── Final Legal Review (V2.1) ────────────────────────────────────────────────────────────────────
// Decisions: Verified (shown as "Approve"), Returned for Correction / Additional Documents Required / Further
// Investigation Required (all return the workspace), Rejected (with reasons). Land Approval waits for "Verified".
const REVIEW_DECISIONS = ["Verified", "Returned for Correction", "Additional Documents Required", "Further Investigation Required", "Rejected"];
const REVIEW_CHECKS = [
  ["mandatory", "All mandatory activities completed and verified"], ["applicable", "Applicable activities correctly identified"],
  ["na", "N/A activities have authorised reasons"], ["documents", "Required documents available and reviewed"],
  ["ownership", "Ownership mismatches assessed"], ["chain", "Missing deed links assessed"], ["court", "Court search findings reviewed"],
  ["clearance", "LA and ULC clearance positions reviewed"], ["succession", "Inheritance and succession documents reviewed"],
  ["survey", "Survey discrepancies assessed"], ["exceptions", "Dependency overrides and legal exceptions reviewed"],
  ["risks", "Significant legal remarks and risks recorded"],
];
const canReview = async (req) => isAdmin(req) || (await canAct(req, "Legal Reviewer", null));

/** Everything that was reviewed, frozen: activities with both statuses, findings, entries and linked documents. */
async function snapshot(conn, verificationId) {
  const acts = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT a.ActivityId, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, a.ActivityName, a.IsMandatory, a.Status, a.VerifyStatus, a.Finding,
           a.AssignedUserId, a.ReviewedBy, a.ReviewedAt, CONVERT(char(10), a.DueDate, 23) AS DueDate, CONVERT(char(10), a.CompletedDate, 23) AS CompletedDate,
           a.Findings, a.Remarks, a.VerifyRemarks, a.NaReason
    FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @V ORDER BY t.SortOrder`)).recordset;
  const entries = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT x.EntryId, x.ActivityId, x.DataJson FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
    WHERE a.VerificationId = @V AND x.IsActive = 1 ORDER BY x.EntryId`)).recordset;
  const docs = (await conn.request().input("V", sql.Int, verificationId).query(`
    SELECT l.ActivityId, d.DocId, d.FileId, d.VersionNo, d.VerifyStatus FROM dbo.LegalVerificationDocumentLink l JOIN dbo.LegalVerificationDocument d ON d.DocId = l.DocId
    WHERE d.VerificationId = @V AND d.IsActive = 1 AND l.ActivityId IS NOT NULL`)).recordset;
  return acts.map((a) => ({ ...a, entries: entries.filter((e) => e.ActivityId === a.ActivityId).map((e) => ({ EntryId: e.EntryId, data: JSON.parse(e.DataJson) })),
    documents: docs.filter((d) => d.ActivityId === a.ActivityId).map(({ ActivityId, ...d }) => d) }));
}

const exceptionsOf = async (pool, verificationId) => (await pool.request().input("V", sql.Int, verificationId).query(`
  SELECT x.ExceptionId, x.Kind, x.ActivityId, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, a.ActivityName, x.Reason, x.Remarks, x.Detail,
         u.name AS CreatedBy, x.CreatedAt
  FROM dbo.LegalVerificationException x LEFT JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
  LEFT JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId LEFT JOIN dbo.users u ON u.id = x.CreatedBy
  WHERE x.VerificationId = @V ORDER BY x.ExceptionId DESC`)).recordset;

router.get("/:id/reviews", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = Number.parseInt(req.params.id, 10);
    const w = (await pool.request().input("V", sql.Int, id).query("SELECT ProjectId FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
    if (!w) return res.status(404).json({ error: "Verification not found" });
    if (!inScope(req, w.ProjectId)) return res.status(403).json({ error: "You don't have access to this project." });
    const rows = (await pool.request().input("V", sql.Int, id).query(`
      SELECT r.ReviewId, r.VersionNo, r.Decision, r.Remarks, r.Risks, r.ChecklistJson, r.SnapshotHash, u.name AS ReviewedBy, r.ReviewedAt
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V ORDER BY r.VersionNo DESC`)).recordset;
    const unverifiedDocs = (await pool.request().input("V", sql.Int, id).query(
      "SELECT COUNT(*) AS n FROM dbo.LegalVerificationDocument WHERE VerificationId = @V AND IsActive = 1 AND VerifyStatus <> N'Verified'")).recordset[0].n;
    res.json({ reviews: rows.map((r) => ({ ...r, checklist: JSON.parse(r.ChecklistJson || "{}"), ChecklistJson: undefined })), checks: REVIEW_CHECKS, decisions: REVIEW_DECISIONS,
      exceptions: await exceptionsOf(pool, id), unverifiedDocs, canReview: await canReview(req) });
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
    if (!(await canReview(req))) return res.status(403).json({ error: "Only a Legal Reviewer or admin can do the Final Legal Review" });
    const own = ownWork(req, w.LeadUserId, "the verification you lead");
    if (own) return res.status(403).json({ error: own });
    const b = req.body || {};
    const decision = String(b.decision || "");
    const remarks = String(b.remarks || "").trim().slice(0, 2000) || null;
    const risks = String(b.risks || "").trim().slice(0, 4000) || null;
    if (!REVIEW_DECISIONS.includes(decision)) return res.status(400).json({ error: "Choose a decision" });
    if (["Verified", "Closed", "Rejected"].includes(w.Status)) return res.status(409).json({ error: `Already ${w.Status === "Verified" ? "approved" : w.Status.toLowerCase()}` });
    if (decision !== "Verified" && !remarks) return res.status(400).json({ error: decision === "Rejected" ? "Give the reasons for rejecting" : "Say what must be corrected or added (remarks)" });
    const checklist = {};
    for (const [k] of REVIEW_CHECKS) {
      const c = b.checklist?.[k] || {};
      const st = ["ok", "issue", "na"].includes(c.status) ? c.status : null;
      checklist[k] = { status: st, note: String(c.note || "").slice(0, 300) || null };
    }
    if (decision === "Verified") {
      if (w.Status !== "Ready for Review") return res.status(409).json({ error: "Every mandatory activity must be verified (or approved as N/A) first" });
      const rejected = (await pool.request().input("V", sql.Int, id).query(`SELECT ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) + N'. ' + a.ActivityName AS n
        FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @V AND a.IsMandatory = 1 AND a.VerifyStatus = N'Rejected'`)).recordset;
      if (rejected.length) return res.status(409).json({ error: `Rejected by the verifier: ${rejected.map((r) => r.n).join(", ")} — reject or return the review` });
      const unset = REVIEW_CHECKS.filter(([k]) => !checklist[k].status).map(([, l]) => l);
      if (unset.length) return res.status(400).json({ error: `Mark every checklist item: ${unset.join("; ")}` });
      const issues = REVIEW_CHECKS.filter(([k]) => checklist[k].status === "issue").map(([, l]) => l);
      if (issues.length) return res.status(400).json({ error: `Checklist has issues (${issues.join("; ")}) — return or reject instead of approving` });
      if ((w.Discrepancies > 0 || (await exceptionsOf(pool, id)).length) && !risks)
        return res.status(400).json({ error: "There are discrepancies or recorded exceptions — record the legal risks before approving" });
    }
    const snap = JSON.stringify(await snapshot(pool, id));
    const hash = crypto.createHash("sha256").update(snap).digest("hex");
    const me = userOf(req);
    const status = decision === "Verified" ? "Verified" : decision === "Rejected" ? "Rejected" : "Returned";
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let versionNo;
    try {
      versionNo = (await new sql.Request(tx).input("V", sql.Int, id).query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS n FROM dbo.LegalVerificationReview WITH (UPDLOCK, HOLDLOCK) WHERE VerificationId = @V")).recordset[0].n;
      await new sql.Request(tx).input("V", sql.Int, id).input("N", sql.Int, versionNo).input("D", sql.NVarChar(40), decision).input("R", sql.NVarChar(2000), remarks)
        .input("Rk", sql.NVarChar(sql.MAX), risks).input("C", sql.NVarChar(sql.MAX), JSON.stringify(checklist)).input("S", sql.NVarChar(sql.MAX), snap).input("H", sql.Char(64), hash).input("U", sql.Int, me)
        .query("INSERT INTO dbo.LegalVerificationReview (VerificationId, VersionNo, Decision, Remarks, Risks, ChecklistJson, SnapshotJson, SnapshotHash, ReviewedBy) VALUES (@V, @N, @D, @R, @Rk, @C, @S, @H, @U)");
      await new sql.Request(tx).input("V", sql.Int, id).input("S", sql.NVarChar(30), status).input("U", sql.Int, me)
        .query("UPDATE dbo.LegalVerification SET Status = @S, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE VerificationId = @V");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
    await writeAudit(pool, req, { action: `Final legal review: ${decision}`, entityType: "LegalVerification", entityId: id, newValue: { versionNo, hash }, remarks });
    const assignees = (await pool.request().input("V", sql.Int, id).query("SELECT DISTINCT AssignedUserId AS id FROM dbo.LegalVerificationActivity WHERE VerificationId = @V AND AssignedUserId IS NOT NULL")).recordset.map((r) => r.id);
    await notify(pool, { users: [w.LeadUserId, w.CreatedBy, ...(decision === "Verified" ? [] : assignees)], roles: decision === "Verified" ? ["Approver"] : [], except: me,
      type: decision === "Verified" ? "legal_verification_verified" : "legal_verification_returned",
      title: decision === "Verified" ? `Land Approval pending: ${w.VerificationNo} legally approved` : `${decision}: ${w.VerificationNo}`,
      body: (remarks || `Final legal review version ${versionNo}.`).slice(0, 300), refId: id, refType: "legal_verification" });
    res.json({ message: `Version ${versionNo} saved — ${decision === "Verified" ? "Approved" : decision}`, versionNo, hash });
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
    if (!(await canReview(req))) return res.status(403).json({ error: "Only a Legal Reviewer or admin can reopen a verification" });
    if (!["Verified", "Rejected"].includes(w.Status)) return res.status(409).json({ error: "Only an approved or rejected verification can be reopened" });
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
      SELECT TOP 1 r.VersionNo, r.Decision, r.Remarks, r.Risks, r.SnapshotHash, u.name AS ReviewedBy, r.ReviewedAt
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V ORDER BY r.VersionNo DESC`)).recordset[0] || null;
    const open = (await pool.request().input("V", sql.Int, w.VerificationId).query(`
      SELECT ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityNo, a.ActivityName, a.Status, a.VerifyStatus, a.Finding
      FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId WHERE a.VerificationId = @V
        AND (a.VerifyStatus NOT IN (N'Verified', N'N/A') OR a.Finding IN (N'Mismatched', N'Discrepancy Found', N'Additional Documents Required', N'Unable to Verify', N'Case Found'))
      ORDER BY t.SortOrder`)).recordset;
    res.json({ ...w, lastReview: last, issues: open, exceptions: await exceptionsOf(pool, w.VerificationId) });
  } catch (err) {
    console.error("[legal-verification] by-land:", err.message);
    res.status(500).json({ error: "Could not load the verification" });
  }
});

// ── Central documents (V2.1) ─────────────────────────────────────────────────────────────────────
// One register per workspace. A document can be linked to several activities and entries (e.g. ownership events);
// uploading never verifies it; replacing keeps the old version; verification is a separate decision.
const DOC_TYPES = ["Title Deed", "Mother Deed", "Link Deed", "Certified Copy", "RS Record", "LR Record", "Khatian Record", "Bangla Bhumi Report", "Panchayat Report",
  "Plot Information Report", "Court Search Report", "LA Report", "ULC Report", "Khajna Receipt", "Death Certificate", "Farznama / Partition Document", "Mouza Map",
  "Dag Sketch", "Survey Report", "Mutation Document", "Conversion Document", "Search Report", "Other supporting document"];
const COPY_TYPES = ["Original", "Certified Copy", "Photocopy", "Scan"];
const DOC_SELECT = `
  SELECT d.DocId, d.VerificationId, d.FileId, f.FileName, d.DocType, d.DocNo, CONVERT(char(10), d.DocDate, 23) AS DocDate, d.Authority, d.OwnerRef, d.DagRef, d.KhatianRef,
         d.CopyType, d.OriginalAvailable, d.OriginalHolder, d.Condition, d.VerifyStatus, vb.name AS VerifiedBy, d.VerifiedAt, d.RejectionReason, d.VersionNo, d.PreviousDocId,
         d.Remarks, d.IsActive, ub.name AS UploadedBy, d.UploadedBy AS UploadedById, d.UploadedAt, d.UpdatedAt
  FROM dbo.LegalVerificationDocument d LEFT JOIN dbo.LegalMasterFile f ON f.FileId = d.FileId
  LEFT JOIN dbo.users vb ON vb.id = d.VerifiedBy LEFT JOIN dbo.users ub ON ub.id = d.UploadedBy`;

async function loadWorkspaceForDoc(pool, req, verificationId) {
  const w = (await pool.request().input("V", sql.Int, verificationId).query("SELECT VerificationId, ProjectId, Status, VerificationNo FROM dbo.LegalVerification WHERE VerificationId = @V")).recordset[0];
  if (!w) return { error: [404, "Verification not found"] };
  if (!inScope(req, w.ProjectId)) return { error: [403, "You don't have access to this project."] };
  return { w };
}
async function docLinks(pool, docIds) {
  if (!docIds.length) return [];
  return (await pool.request().query(`
    SELECT l.LinkId, l.DocId, l.ActivityId, l.EntryId, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, a.ActivityName,
           ISNULL(ea.ActivityId, a.ActivityId) AS OwnerActivityId
    FROM dbo.LegalVerificationDocumentLink l
    LEFT JOIN dbo.LegalActivityEntry x ON x.EntryId = l.EntryId
    LEFT JOIN dbo.LegalVerificationActivity ea ON ea.ActivityId = x.ActivityId
    LEFT JOIN dbo.LegalVerificationActivity a ON a.ActivityId = ISNULL(l.ActivityId, x.ActivityId)
    LEFT JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
    WHERE l.DocId IN (${docIds.map(Number).join(",")})`)).recordset;
}
/** Check that the activities / entries belong to the workspace. */
async function linkTargetsOk(pool, verificationId, activityIds, entryIds) {
  const ids = (arr) => [...new Set((arr || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const a = ids(activityIds), e = ids(entryIds);
  if (a.length && (await pool.request().input("V", sql.Int, verificationId).query(`SELECT COUNT(*) AS n FROM dbo.LegalVerificationActivity WHERE VerificationId = @V AND ActivityId IN (${a.join(",")})`)).recordset[0].n !== a.length) return null;
  if (e.length && (await pool.request().input("V", sql.Int, verificationId).query(`SELECT COUNT(*) AS n FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
    WHERE a.VerificationId = @V AND x.IsActive = 1 AND x.EntryId IN (${e.join(",")})`)).recordset[0].n !== e.length) return null;
  return { a, e };
}
function docFields(b) {
  const s = (k, n) => (b[k] == null || String(b[k]).trim() === "" ? null : String(b[k]).trim().slice(0, n));
  const f = { DocType: s("docType", 80), DocNo: s("docNo", 80), DocDate: b.docDate ? day(b.docDate) : null, Authority: s("authority", 200), OwnerRef: s("ownerRef", 200),
    DagRef: s("dagRef", 200), KhatianRef: s("khatianRef", 200), CopyType: s("copyType", 20) ?? "Scan", OriginalAvailable: s("originalAvailable", 10),
    OriginalHolder: s("originalHolder", 200), Condition: s("condition", 20), Remarks: s("remarks", 1000) };
  if (!f.DocType || !DOC_TYPES.includes(f.DocType)) return { error: "Choose the document type" };
  if (!COPY_TYPES.includes(f.CopyType)) return { error: "Choose original, certified copy, photocopy or scan" };
  if (f.OriginalAvailable && !["Yes", "No", "Unknown"].includes(f.OriginalAvailable)) return { error: "Original available: Yes, No or Unknown" };
  if (f.Condition && !["Good", "Fair", "Damaged"].includes(f.Condition)) return { error: "Condition: Good, Fair or Damaged" };
  return { f };
}
const DOC_TYPES_SQL = { DocType: sql.NVarChar(80), DocNo: sql.NVarChar(80), DocDate: sql.Date, Authority: sql.NVarChar(200), OwnerRef: sql.NVarChar(200), DagRef: sql.NVarChar(200),
  KhatianRef: sql.NVarChar(200), CopyType: sql.NVarChar(20), OriginalAvailable: sql.NVarChar(10), OriginalHolder: sql.NVarChar(200), Condition: sql.NVarChar(20), Remarks: sql.NVarChar(1000) };

router.get("/:id/documents", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadWorkspaceForDoc(pool, req, Number(req.params.id));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    const all = req.query.all === "1";
    const docs = (await pool.request().input("V", sql.Int, got.w.VerificationId).query(`${DOC_SELECT} WHERE d.VerificationId = @V${all ? "" : " AND d.IsActive = 1"} ORDER BY d.DocId DESC`)).recordset;
    const links = await docLinks(pool, docs.map((d) => d.DocId));
    res.json({ documents: docs.map((d) => ({ ...d, links: links.filter((l) => l.DocId === d.DocId) })), docTypes: DOC_TYPES, copyTypes: COPY_TYPES, canVerify: await canVerify(req) });
  } catch (err) {
    console.error("[legal-verification] documents:", err.message);
    res.status(500).json({ error: "Could not load documents" });
  }
});

router.post("/:id/documents", editOrSearch, async (req, res) => {
  const pool = getPool();
  try {
    const got = await loadWorkspaceForDoc(pool, req, Number(req.params.id));
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    if (["Verified", "Closed"].includes(got.w.Status)) return res.status(409).json({ error: "This verification is approved or closed" });
    const b = req.body || {};
    const fileId = Number(b.fileId);
    if (!fileId) return res.status(400).json({ error: "Upload the file first" });
    const df = docFields(b);
    if (df.error) return res.status(400).json({ error: df.error });
    const t = await linkTargetsOk(pool, got.w.VerificationId, b.activityIds, b.entryIds);
    if (!t) return res.status(400).json({ error: "Link only to activities and entries of this verification" });
    if (req.searchOnly && t.a.length && (await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.LegalVerificationActivity WHERE ActivityId IN (${t.a.join(",")}) AND ISNULL(Department, N'') <> N'Search'`)).recordset[0].n)
      return res.status(403).json({ error: "A Search Executive can attach documents only to the search activities" });
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let docId;
    try {
      const r = new sql.Request(tx).input("V", sql.Int, got.w.VerificationId).input("F", sql.Int, fileId).input("U", sql.Int, userOf(req));
      for (const [k, v] of Object.entries(df.f)) r.input(k, DOC_TYPES_SQL[k], v);
      docId = (await r.query(`INSERT INTO dbo.LegalVerificationDocument (VerificationId, FileId, ${Object.keys(df.f).join(", ")}, UploadedBy)
        OUTPUT INSERTED.DocId VALUES (@V, @F, ${Object.keys(df.f).map((k) => `@${k}`).join(", ")}, @U)`)).recordset[0].DocId;
      for (const a of t.a) await new sql.Request(tx).input("D", sql.Int, docId).input("A", sql.Int, a).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), `${df.f.DocType} added${df.f.DocNo ? ` (${df.f.DocNo})` : ""} · not yet verified`).input("F", sql.Int, fileId)
        .query(`INSERT INTO dbo.LegalVerificationDocumentLink (DocId, ActivityId, LinkedBy) VALUES (@D, @A, @U);
                INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, FileId, ChangedBy) VALUES (@A, N'Document', @R, @F, @U);`);
      for (const e of t.e) await new sql.Request(tx).input("D", sql.Int, docId).input("E", sql.Int, e).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalVerificationDocumentLink (DocId, EntryId, LinkedBy) VALUES (@D, @E, @U)");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
    await writeAudit(pool, req, { action: "Verification document added", entityType: "LegalVerificationDocument", entityId: docId, newValue: { ...df.f, fileId, activities: t.a, entries: t.e } });
    res.status(201).json({ message: "Document added — not verified yet", docId });
  } catch (err) {
    console.error("[legal-verification] add document:", err.message);
    res.status(500).json({ error: "Could not add the document" });
  }
});

/** Edit a document's details, replace its file (new version) or change its links. */
router.put("/documents/:docId", editOrSearch, async (req, res) => {
  const pool = getPool();
  try {
    const d = (await pool.request().input("D", sql.Int, Number(req.params.docId)).query(`${DOC_SELECT} WHERE d.DocId = @D`)).recordset[0];
    if (!d || !d.IsActive) return res.status(404).json({ error: "Document not found" });
    const got = await loadWorkspaceForDoc(pool, req, d.VerificationId);
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    if (["Verified", "Closed"].includes(got.w.Status)) return res.status(409).json({ error: "This verification is approved or closed" });
    const b = req.body || {};
    if ("updatedAt" in b && (b.updatedAt ? new Date(b.updatedAt).getTime() : null) !== (d.UpdatedAt ? new Date(d.UpdatedAt).getTime() : null))
      return res.status(409).json({ error: "Someone changed this document after you opened it — reload and try again" });
    const df = docFields({ docType: d.DocType, docNo: d.DocNo, docDate: d.DocDate, authority: d.Authority, ownerRef: d.OwnerRef, dagRef: d.DagRef, khatianRef: d.KhatianRef,
      copyType: d.CopyType, originalAvailable: d.OriginalAvailable, originalHolder: d.OriginalHolder, condition: d.Condition, remarks: d.Remarks, ...b });
    if (df.error) return res.status(400).json({ error: df.error });
    const links = await docLinks(pool, [d.DocId]);
    const t = await linkTargetsOk(pool, d.VerificationId, b.activityIds ?? links.filter((l) => l.ActivityId).map((l) => l.ActivityId), b.entryIds ?? links.filter((l) => l.EntryId).map((l) => l.EntryId));
    if (!t) return res.status(400).json({ error: "Link only to activities and entries of this verification" });
    const newFile = b.fileId && Number(b.fileId) !== d.FileId ? Number(b.fileId) : null;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let target = d.DocId;
    try {
      if (newFile) {
        // A new file is a new version: the old row is kept (inactive) with its verification decision.
        const r = new sql.Request(tx).input("V", sql.Int, d.VerificationId).input("F", sql.Int, newFile).input("U", sql.Int, userOf(req)).input("N", sql.Int, d.VersionNo + 1).input("P", sql.Int, d.DocId);
        for (const [k, v] of Object.entries(df.f)) r.input(k, DOC_TYPES_SQL[k], v);
        target = (await r.query(`UPDATE dbo.LegalVerificationDocument SET IsActive = 0, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE DocId = @P;
          INSERT INTO dbo.LegalVerificationDocument (VerificationId, FileId, ${Object.keys(df.f).join(", ")}, VersionNo, PreviousDocId, UploadedBy)
          OUTPUT INSERTED.DocId VALUES (@V, @F, ${Object.keys(df.f).map((k) => `@${k}`).join(", ")}, @N, @P, @U)`)).recordset[0].DocId;
      } else {
        const r = new sql.Request(tx).input("D", sql.Int, d.DocId).input("U", sql.Int, userOf(req));
        for (const [k, v] of Object.entries(df.f)) r.input(k, DOC_TYPES_SQL[k], v);
        await r.query(`UPDATE dbo.LegalVerificationDocument SET ${Object.keys(df.f).map((k) => `${k} = @${k}`).join(", ")},
          VerifyStatus = CASE WHEN DocType <> @DocType OR ISNULL(DocNo, N'') <> ISNULL(@DocNo, N'') THEN N'Not Reviewed' ELSE VerifyStatus END,
          UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE DocId = @D`);
      }
      await new sql.Request(tx).input("D", sql.Int, target).query("DELETE FROM dbo.LegalVerificationDocumentLink WHERE DocId = @D");
      for (const a of t.a) await new sql.Request(tx).input("D", sql.Int, target).input("A", sql.Int, a).input("U", sql.Int, userOf(req))
        .input("R", sql.NVarChar(1000), newFile ? `${df.f.DocType} replaced — version ${d.VersionNo + 1}, not yet verified` : null).input("F", sql.Int, newFile)
        .query(`INSERT INTO dbo.LegalVerificationDocumentLink (DocId, ActivityId, LinkedBy) VALUES (@D, @A, @U);
                IF @R IS NOT NULL INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, FileId, ChangedBy) VALUES (@A, N'Document', @R, @F, @U);`);
      for (const e of t.e) await new sql.Request(tx).input("D", sql.Int, target).input("E", sql.Int, e).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalVerificationDocumentLink (DocId, EntryId, LinkedBy) VALUES (@D, @E, @U)");
      await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch { /* already */ } throw e; }
    await writeAudit(pool, req, { action: newFile ? "Verification document replaced" : "Verification document updated", entityType: "LegalVerificationDocument", entityId: target,
      oldValue: { fileId: d.FileId, version: d.VersionNo }, newValue: { ...df.f, fileId: newFile ?? d.FileId, activities: t.a, entries: t.e } });
    res.json({ message: newFile ? `New version ${d.VersionNo + 1} saved — not verified yet` : "Document saved", docId: target });
  } catch (err) {
    console.error("[legal-verification] update document:", err.message);
    res.status(500).json({ error: "Could not save the document" });
  }
});

/** Verify or reject a document (an authorised verifier, not the uploader). Uploading never verifies. */
router.post("/documents/:docId/verify", requirePageRight(PAGE, "view"), async (req, res) => {
  const pool = getPool();
  try {
    const d = (await pool.request().input("D", sql.Int, Number(req.params.docId)).query(`${DOC_SELECT} WHERE d.DocId = @D`)).recordset[0];
    if (!d || !d.IsActive) return res.status(404).json({ error: "Document not found" });
    const got = await loadWorkspaceForDoc(pool, req, d.VerificationId);
    if (got.error) return res.status(got.error[0]).json({ error: got.error[1] });
    if (!(await canVerify(req))) return res.status(403).json({ error: "Only a Verifier, Legal Reviewer, Legal Admin or admin can verify documents" });
    const own = ownWork(req, d.UploadedById, "this document");
    if (own) return res.status(403).json({ error: own });
    const decision = String(req.body?.decision || "");
    if (!["Verified", "Rejected"].includes(decision)) return res.status(400).json({ error: "Choose Verified or Rejected" });
    const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
    if (decision === "Rejected" && !reason) return res.status(400).json({ error: "Give the rejection reason" });
    await pool.request().input("D", sql.Int, d.DocId).input("S", sql.NVarChar(20), decision).input("R", sql.NVarChar(500), decision === "Rejected" ? reason : null).input("U", sql.Int, userOf(req))
      .query("UPDATE dbo.LegalVerificationDocument SET VerifyStatus = @S, RejectionReason = @R, VerifiedBy = @U, VerifiedAt = SYSUTCDATETIME(), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE DocId = @D");
    const links = await docLinks(pool, [d.DocId]);
    for (const a of [...new Set(links.map((l) => l.OwnerActivityId).filter(Boolean))])
      await pool.request().input("A", sql.Int, a).input("R", sql.NVarChar(1000), `${d.DocType}${d.DocNo ? ` (${d.DocNo})` : ""} v${d.VersionNo}: ${decision}${reason ? ` — ${reason}` : ""}`).input("F", sql.Int, d.FileId).input("U", sql.Int, userOf(req))
        .query("INSERT INTO dbo.LegalActivityHistory (ActivityId, Action, Remarks, FileId, ChangedBy) VALUES (@A, N'Document verification', @R, @F, @U)");
    await writeAudit(pool, req, { action: `Verification document ${decision.toLowerCase()}`, entityType: "LegalVerificationDocument", entityId: d.DocId, remarks: reason });
    res.json({ message: `Document ${decision.toLowerCase()}` });
  } catch (err) {
    console.error("[legal-verification] verify document:", err.message);
    res.status(500).json({ error: "Could not save the decision" });
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
      pool.request().input("V", sql.Int, id).query(`${ACTIVITY_SELECT} WHERE a.VerificationId = @V ORDER BY ISNULL(t.SortOrder, a.ActivityNo * 10)`),
      pool.request().input("V", sql.Int, id).query(`
        SELECT a.ActivityId, p.ActivityId AS DependsOnId, ISNULL(pt.DisplayNo, CAST(p.ActivityNo AS NVARCHAR(5))) AS ActivityNo, p.ActivityName, p.Status, p.VerifyStatus, d.IsMandatory
        FROM dbo.LegalVerificationActivity a
        JOIN dbo.LegalActivityDependency d ON d.TemplateId = a.TemplateId AND d.IsActive = 1
        JOIN dbo.LegalVerificationActivity p ON p.VerificationId = a.VerificationId AND p.TemplateId = d.DependsOnTemplateId
        JOIN dbo.LegalActivityTemplate pt ON pt.TemplateId = p.TemplateId
        WHERE a.VerificationId = @V`),
      pool.request().input("V", sql.Int, id).query(`
        SELECT l.ActivityId, d.DocId, d.FileId, f.FileName, d.DocType AS Title, d.DocNo, d.CopyType, d.VerifyStatus, d.VersionNo, u.name AS UploadedBy, d.UploadedAt
        FROM dbo.LegalVerificationDocumentLink l JOIN dbo.LegalVerificationDocument d ON d.DocId = l.DocId
        LEFT JOIN dbo.LegalMasterFile f ON f.FileId = d.FileId LEFT JOIN dbo.users u ON u.id = d.UploadedBy
        WHERE d.VerificationId = @V AND d.IsActive = 1 AND l.ActivityId IS NOT NULL ORDER BY d.DocId`),
      pool.request().input("E", sql.Int, w.EnquiryId).query("IF OBJECT_ID('dbo.LegalEnquiryRsRecord','U') IS NOT NULL SELECT RsKhatianNo, RsDagNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = @E ELSE SELECT TOP 0 1 AS x"),
      pool.request().input("E", sql.Int, w.EnquiryId).query("IF OBJECT_ID('dbo.LegalEnquiryLrRecord','U') IS NOT NULL SELECT LrKhatianNo, LrDagNo FROM dbo.LegalEnquiryLrRecord WHERE EnquiryId = @E ELSE SELECT TOP 0 1 AS x"),
    ]);
    const today = todayStr();
    const activities = acts.recordset.map((a) => {
      const dependsOn = deps.recordset.filter((d) => d.ActivityId === a.ActivityId);
      return { ...a, dependsOn, blocked: dependsOn.some((d) => d.IsMandatory && !CLEARED.includes(d.VerifyStatus)),
        overdue: !["Submitted for Review", "Closed"].includes(a.Status) && !!a.DueDate && a.DueDate < today,
        documents: docs.recordset.filter((d) => d.ActivityId === a.ActivityId) };
    });
    const edit = await hasAnyPageAction(req, PAGE, ["edit"]);
    res.json({ ...w, rs: rs.recordset, lr: lr.recordset, activities, me: userOf(req),
      canOverride: await canVerify(req), canVerify: await canVerify(req), canReview: await canReview(req),
      canEdit: !!edit, searchOnly: !edit && (await canAct(req, "Search Executive", null)) });
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
