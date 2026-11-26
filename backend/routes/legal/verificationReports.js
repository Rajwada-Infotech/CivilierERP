"use strict";
/**
 * Legal V2.1: the legal dashboard counts and the 18 legal reports (plus the complete land history). Every report
 * answers { key, title, columns: [{ key, label }], rows } for the screen and the PDF / Excel export, built from the
 * live activity, entry, document and application records (no copies), and filtered by:
 *   ?project=all|none|<id>   the Legal project picker (and the user's project access, always)
 *   ?from / ?to              date range (YYYY-MM-DD) on the report's date
 *   ?enquiry ?mouza ?dag ?employee ?status ?verify   text filters (verify = activity verification status)
 *   GET /dashboard · GET /list · GET /:key (land-history needs ?verificationId)
 */
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const projectGuard = require("./projectGuard");

const router = express.Router();
router.use(apiRateLimit);
router.use(async (req, _res, next) => { try { req.legalScope = await projectGuard.getProjectScope(req.user); } catch { /* unrestricted */ } next(); });
const PAGE = "legal-land-enquiry";
const today = () => new Date().toISOString().slice(0, 10);
const d10 = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const OPEN_WORK = (a) => !["Submitted for Review", "Closed"].includes(a.Status);

/** Rows the user may see under the picked project. */
function scoped(req, rows) {
  const project = String(req.query.project ?? "all");
  return rows.filter((r) => (!req.legalScope || (r.ProjectId != null && req.legalScope.includes(Number(r.ProjectId))))
    && (project === "all" ? true : project === "none" ? !Number(r.ProjectId) : Number(r.ProjectId) === Number(project)));
}
const inRange = (req, d) => (!req.query.from || (d && d10(d) >= req.query.from)) && (!req.query.to || (d && d10(d) <= req.query.to));
const same = (v, q) => v != null && String(v).trim().toLowerCase() === String(q).trim().toLowerCase();
// Which columns each filter looks at.
const FILTER_KEYS = {
  enquiry: ["VerificationNo", "EnquiryNo"],
  mouza: ["MouzaName", "mouza", "Mouza"],
  employee: ["AssignedName", "Employee", "searchedBy", "LeadName", "surveyor"],
  status: ["Status", "status", "result", "match", "continuity", "verification", "ApplicationStatus"],
  verify: ["VerifyStatus"],
};
const dagKeys = (r) => Object.keys(r).filter((k) => /dag/i.test(k));
/** The filters (picked from dropdowns), applied to the finished rows: exact match, case ignored. */
function filters(req, rows) {
  const q = req.query;
  const any = (r, keys, val) => keys.some((k) => same(r[k], val));
  return rows.filter((r) => Object.entries(FILTER_KEYS).every(([f, keys]) => !q[f] || any(r, keys, q[f]))
    && (!q.dag || dagKeys(r).some((k) => String(r[k] ?? "").split(/[,;]\s*/).some((d) => same(d, q.dag)))));
}
/** Dropdown choices: the distinct values of the report's own rows (before filtering). */
function filterOptions(rows) {
  const out = {};
  const sorted = (set) => [...set].filter((v) => v != null && String(v).trim() !== "").map(String).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [f, keys] of Object.entries(FILTER_KEYS)) out[f] = sorted(new Set(rows.flatMap((r) => keys.map((k) => r[k]))));
  out.dag = sorted(new Set(rows.flatMap((r) => dagKeys(r).flatMap((k) => String(r[k] ?? "").split(/[,;]\s*/)))));
  return out;
}

const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalActivityEntry', 'U') AS t")).recordset[0].t
  && !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalVerificationActivity', 'VerifyStatus') AS c")).recordset[0].c;

async function workspaces(pool) {
  const c = (w) => `(SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND ${w})`;
  return (await pool.request().query(`
    SELECT v.VerificationId, v.VerificationNo, v.EnquiryId, v.ProjectId, pr.name AS ProjectName, v.Status, v.StartDate, v.TargetDate, lu.name AS LeadName,
           e.EnquiryNo, e.EnquiryDate, e.LandLocation, e.JLNo, CAST(e.ApproxArea AS FLOAT) AS ApproxArea, e.ContactPerson, m.MouzaName, d.DistrictName, e.LandId,
           ${c("1 = 1")} AS Total, ${c("a.VerifyStatus IN (N'Verified', N'N/A')")} AS Resolved, ${c("a.VerifyStatus = N'Rejected'")} AS Rejected,
           ${c("a.Status = N'Submitted for Review'")} AS AwaitingVerification, ${c("a.VerifyStatus = N'Returned'")} AS Returned,
           ${c("a.Status NOT IN (N'Submitted for Review', N'Closed') AND a.DueDate < CAST(GETDATE() AS DATE)")} AS Overdue,
           ${c("a.Finding IN (N'Mismatched', N'Discrepancy Found')")} AS Discrepancies,
           (SELECT COUNT(*) FROM dbo.LegalVerificationException x WHERE x.VerificationId = v.VerificationId) AS Exceptions,
           (SELECT TOP 1 r.Decision FROM dbo.LegalVerificationReview r WHERE r.VerificationId = v.VerificationId ORDER BY r.VersionNo DESC) AS LastDecision
    FROM dbo.LegalVerification v JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
    LEFT JOIN dbo.enterprise pr ON pr.id = v.ProjectId LEFT JOIN dbo.users lu ON lu.id = v.LeadUserId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId`)).recordset;
}
async function activities(pool) {
  return (await pool.request().query(`
    SELECT a.ActivityId, a.VerificationId, v.VerificationNo, v.ProjectId, e.EnquiryNo, m.MouzaName, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, t.SortOrder,
           a.ActivityName, a.IsMandatory, a.Status, a.VerifyStatus, a.Finding, a.Priority, a.AssignedUserId, u.name AS AssignedName, vu.name AS VerifierName, a.Department,
           a.StartDate, a.DueDate, a.CompletedDate, a.SubmittedAt, a.ExpectedDays, a.Remarks, a.HoldReason, a.NextAction
    FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
    JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
    JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
    LEFT JOIN dbo.users u ON u.id = a.AssignedUserId LEFT JOIN dbo.users vu ON vu.id = a.VerifierUserId`)).recordset;
}
async function entries(pool, codes) {
  const r = await pool.request().input("C", sql.NVarChar(500), codes.join("|")).query(`
    SELECT x.EntryId, t.ActivityCode, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS ActivityRef, v.VerificationId, v.VerificationNo, v.ProjectId, e.EnquiryNo,
           m.MouzaName, a.VerifyStatus, a.Status AS WorkStatus, u.name AS AssignedName, x.DataJson, x.CreatedAt, x.UpdatedAt
    FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
    JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
    JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.users u ON u.id = a.AssignedUserId
    WHERE x.IsActive = 1 AND t.ActivityCode IN (SELECT value FROM STRING_SPLIT(@C, '|')) ORDER BY v.VerificationId, x.EntryId`);
  return r.recordset.map((x) => ({ ...x, d: JSON.parse(x.DataJson || "{}"), DataJson: undefined }));
}

const C = (key, label) => ({ key, label });
const WS = [C("VerificationNo", "Verification"), C("EnquiryNo", "Enquiry")];
const ACT = [C("AssignedName", "Employee"), C("VerifyStatus", "Verification status")];
/** A report straight from one or more activities' entries. */
const entryReport = (title, codes, cols, { filter = () => true, dateKey = null, map = (d) => d } = {}) => ({
  title, run: async (req, pool) => {
    const rows = scoped(req, await entries(pool, codes)).filter((x) => filter(x.d, x)).filter((x) => inRange(req, dateKey ? x.d[dateKey] : x.CreatedAt));
    return { columns: [...WS, C("MouzaName", "Mouza"), ...cols, ...ACT],
      rows: rows.map((x) => ({ VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName, AssignedName: x.AssignedName, VerifyStatus: x.VerifyStatus, Activity: x.ActivityRef, ...map(x.d, x) })) };
  },
});

const REPORTS = {
  "enquiry-register": { title: "Land Enquiry Register", run: async (req, pool) => {
    const rows = (await pool.request().query(`
      SELECT e.EnquiryNo, e.EnquiryDate, e.EnquiryStatus AS Status, e.ProjectId, pr.name AS ProjectName, m.MouzaName, e.JLNo, e.LandLocation, CAST(e.ApproxArea AS FLOAT) AS ApproxArea,
             e.ContactPerson, e.ContactNumber, CAST(e.ExpectedPrice AS FLOAT) AS ExpectedPrice, u.name AS AssignedName, v.VerificationNo, v.Status AS VerificationStatus
      FROM dbo.LegalLandEnquiry e LEFT JOIN dbo.enterprise pr ON pr.id = e.ProjectId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
      LEFT JOIN dbo.users u ON u.id = e.AssignedUserId LEFT JOIN dbo.LegalVerification v ON v.EnquiryId = e.EnquiryId
      WHERE e.IsActive = 1 ORDER BY e.EnquiryDate DESC`)).recordset;
    return { columns: [C("EnquiryNo", "Enquiry"), C("EnquiryDate", "Date"), C("ProjectName", "Project"), C("MouzaName", "Mouza"), C("JLNo", "J.L."), C("LandLocation", "Location"),
      C("ApproxArea", "Area"), C("ContactPerson", "Owner / contact"), C("ExpectedPrice", "Expected price"), C("AssignedName", "Assigned"), C("Status", "Status"),
      C("VerificationNo", "Verification"), C("VerificationStatus", "Verification status")],
      rows: scoped(req, rows).filter((r) => inRange(req, r.EnquiryDate)).map((r) => ({ ...r, EnquiryDate: d10(r.EnquiryDate) })) };
  } },
  "verification-summary": { title: "Legal Verification Summary", run: async (req, pool) => ({
    columns: [...WS, C("ProjectName", "Project"), C("MouzaName", "Mouza"), C("LeadName", "Lead"), C("StartDate", "Started"), C("TargetDate", "Target"),
      C("Progress", "Verified / N/A"), C("AwaitingVerification", "Awaiting verification"), C("Returned", "Returned"), C("Rejected", "Rejected"), C("Overdue", "Overdue"),
      C("Discrepancies", "Discrepancies"), C("Exceptions", "Exceptions"), C("Status", "Status"), C("LastDecision", "Final review")],
    rows: scoped(req, await workspaces(pool)).filter((w) => inRange(req, w.StartDate))
      .map((w) => ({ ...w, StartDate: d10(w.StartDate), TargetDate: d10(w.TargetDate), Progress: `${w.Resolved}/${w.Total}` })),
  }) },
  "activity-pending": { title: "Activity-wise Pending Report", run: async (req, pool) => {
    const acts = scoped(req, await activities(pool)).filter((a) => !["Verified", "N/A"].includes(a.VerifyStatus));
    const by = new Map();
    for (const a of acts) {
      const k = `${a.ActivityRef}. ${a.ActivityName}`;
      const g = by.get(k) ?? { Activity: k, Pending: 0, InProgress: 0, AwaitingReports: 0, AwaitingVerification: 0, OnHold: 0, Overdue: 0, Returned: 0, Rejected: 0, Unassigned: 0, o: a.SortOrder };
      g.Pending++;
      if (a.Status === "In Progress") g.InProgress++; if (["Applied", "Report Pending"].includes(a.Status)) g.AwaitingReports++;
      if (a.Status === "Submitted for Review") g.AwaitingVerification++; if (a.Status === "On Hold") g.OnHold++;
      if (a.VerifyStatus === "Returned") g.Returned++; if (a.VerifyStatus === "Rejected") g.Rejected++;
      if (OPEN_WORK(a) && a.DueDate && d10(a.DueDate) < today()) g.Overdue++; if (!a.AssignedUserId) g.Unassigned++;
      by.set(k, g);
    }
    return { columns: [C("Activity", "Activity"), C("Pending", "Not yet verified"), C("InProgress", "In progress"), C("AwaitingReports", "Awaiting reports"),
      C("AwaitingVerification", "Awaiting verification"), C("OnHold", "On hold"), C("Overdue", "Overdue"), C("Returned", "Returned"), C("Rejected", "Rejected"), C("Unassigned", "Unassigned")],
      rows: [...by.values()].sort((a, b) => a.o - b.o) };
  } },
  "employee-workload": { title: "Employee-wise Workload Report", run: async (req, pool) => {
    const acts = scoped(req, await activities(pool)).filter((a) => a.AssignedUserId);
    const by = new Map();
    for (const a of acts) {
      const g = by.get(a.AssignedName) ?? { Employee: a.AssignedName, Assigned: 0, Open: 0, Overdue: 0, Submitted: 0, Verified: 0, Returned: 0, Rejected: 0, OnTime: 0, Late: 0 };
      g.Assigned++;
      if (OPEN_WORK(a)) { g.Open++; if (a.DueDate && d10(a.DueDate) < today()) g.Overdue++; }
      if (a.Status === "Submitted for Review") g.Submitted++;
      if (a.VerifyStatus === "Verified" && inRange(req, a.CompletedDate)) { g.Verified++; if (a.DueDate && a.SubmittedAt && d10(a.SubmittedAt) > d10(a.DueDate)) g.Late++; else g.OnTime++; }
      if (a.VerifyStatus === "Returned") g.Returned++; if (a.VerifyStatus === "Rejected") g.Rejected++;
      by.set(a.AssignedName, g);
    }
    return { columns: [C("Employee", "Employee"), C("Assigned", "Assigned"), C("Open", "Open"), C("Overdue", "Overdue"), C("Submitted", "Awaiting verification"),
      C("Verified", "Verified"), C("OnTime", "Submitted on time"), C("Late", "Submitted late"), C("Returned", "Returned"), C("Rejected", "Rejected")],
      rows: [...by.values()].sort((a, b) => b.Open - a.Open) };
  } },
  overdue: { title: "Overdue Activity Report", run: async (req, pool) => ({
    columns: [...WS, C("MouzaName", "Mouza"), C("Activity", "Activity"), C("AssignedName", "Employee"), C("Priority", "Priority"), C("Status", "Work status"),
      C("VerifyStatus", "Verification status"), C("DueDate", "Target date"), C("DaysOverdue", "Days overdue")],
    rows: scoped(req, await activities(pool)).filter((a) => OPEN_WORK(a) && a.DueDate && d10(a.DueDate) < today())
      .map((a) => ({ ...a, Activity: `${a.ActivityRef}. ${a.ActivityName}`, DueDate: d10(a.DueDate), DaysOverdue: Math.round((Date.parse(today()) - Date.parse(d10(a.DueDate))) / 86_400_000) }))
      .sort((a, b) => b.DaysOverdue - a.DaysOverdue),
  }) },
  "online-search": entryReport("Online Search Report", ["ONLINE-SEARCH"],
    [C("searchBy", "Search by"), C("ownerName", "Owner / party"), C("fromYear", "From"), C("toYear", "To"), C("office", "Registry office"), C("searchDate", "Searched on"),
      C("result", "Result"), C("deedNo", "Deed no."), C("deedYear", "Deed year"), C("dag", "Dag"), C("remarks", "Remarks")], { dateKey: "searchDate" }),
  "offline-search": entryReport("Offline Search Report", ["OFFLINE-SEARCH"],
    [C("officeName", "Office"), C("officeLocation", "Location"), C("searchedBy", "Searched by"), C("searchDate", "Visit date"), C("fromYear", "From"), C("toYear", "To"),
      C("ownerName", "Owner / party"), C("result", "Result"), C("findings", "Findings")], { dateKey: "searchDate" }),
  "plot-information": entryReport("Plot Information Report", ["PLOT-INFO"],
    [C("applicationNo", "Application"), C("applicationDate", "Applied"), C("office", "Office"), C("dagNo", "Dag"), C("khatianNo", "Khatian"), C("reportDate", "Report received"),
      C("plotArea", "Plot area"), C("classification", "Classification"), C("recordedOwner", "Recorded owner"), C("status", "Status")], { dateKey: "applicationDate" }),
  "dag-mapping": entryReport("RS-LR Dag Mapping Report", ["BANGLA-BHUMI"],
    [C("jlNo", "J.L."), C("rsDag", "RS Dag"), C("rsKhatian", "RS Khatian"), C("lrDag", "LR Dag"), C("lrKhatian", "LR Khatian"), C("recordedOwner", "Recorded owner"),
      C("area", "Area"), C("result", "Result"), C("remarks", "Remarks")]),
  "owner-matching": entryReport("RS-LR Owner Matching Report", ["OWNER-MATCH"],
    [C("rsOwner", "RS owner"), C("rsKhatian", "RS Khatian"), C("rsShare", "RS share"), C("lrOwner", "LR owner"), C("lrKhatian", "LR Khatian"), C("lrShare", "LR share"),
      C("match", "Match"), C("deedNo", "Supporting deed"), C("remarks", "Explanation")]),
  "deed-chain": entryReport("Deed Chain Verification Report", ["DEED-CHAIN", "DEED-CHAIN-FINAL"],
    [C("Stage", "Stage"), C("chainRole", "Role"), C("deedNo", "Deed"), C("deedDate", "Date"), C("executant", "Executant"), C("claimant", "Claimant"), C("area", "Area"),
      C("status", "Identification"), C("sourceReviewed", "Reviewed against"), C("continuity", "Continuity"), C("discrepancies", "Missing links / discrepancies")],
    { map: (d, x) => ({ ...d, Stage: x.ActivityCode === "DEED-CHAIN" ? "6A identified" : "6B verified", deedNo: d.deedNo ?? d.deedRef }) }),
  "ownership-flowchart": entryReport("Ownership Flowchart Report", ["OWNERSHIP-FLOW"],
    [C("fromOwner", "Previous owner"), C("toOwner", "New owner"), C("transferType", "Event"), C("transferDate", "Date"), C("transferYear", "Year"),
      C("shareBefore", "Share before"), C("shareAfter", "Share after"), C("areaBefore", "Area before"), C("area", "Transferred"), C("areaRetained", "Retained"),
      C("dag", "Dag"), C("deedNo", "Deed"), C("verification", "Event verification")]),
  inheritance: entryReport("Inheritance and Legal Heir Report", ["LEGAL-HEIR"],
    [C("deceasedOwner", "Deceased owner"), C("deathDate", "Date of death"), C("heirName", "Legal heir"), C("relationship", "Relationship"), C("share", "Share"),
      C("successionDoc", "Succession document"), C("commissionCheck", "Commission check"), C("verification", "Heir verification"), C("remarks", "Remarks")]),
  "court-search": entryReport("Court Search and Case Report", ["COURT-SEARCH"],
    [C("court", "Court"), C("fromYear", "From"), C("toYear", "To"), C("searchDate", "Searched on"), C("ownerName", "Party searched"), C("result", "Result"),
      C("caseNo", "Case no."), C("caseYear", "Case year"), C("caseType", "Category"), C("plaintiff", "Plaintiff"), C("defendant", "Defendant"), C("caseStatus", "Case status")],
    { dateKey: "searchDate" }),
  "la-ulc": entryReport("LA and ULC Clearance Report", ["LA-ULC"],
    [C("clearanceType", "Clearance"), C("applicationNo", "Application"), C("applicationDate", "Applied"), C("authority", "Authority"), C("fee", "Fee"), C("hearingDate", "Hearing"),
      C("reportDate", "Report received"), C("status", "Status"), C("queryDetails", "Queries")], { dateKey: "applicationDate" }),
  khajna: entryReport("Khajna Receipt Report", ["KHAJNA"],
    [C("ownerName", "Owner"), C("dag", "Dag"), C("khatian", "Khatian"), C("lastPaidYear", "Last paid year"), C("paymentDate", "Paid on"), C("receiptNo", "Receipt"),
      C("amount", "Amount"), C("outstanding", "Outstanding"), C("status", "Status")], { dateKey: "paymentDate" }),
  survey: entryReport("Survey and Area Difference Report", ["LAND-SURVEY"],
    [C("surveyType", "Method"), C("surveyDate", "Date"), C("surveyor", "Surveyor"), C("dag", "Dag"), C("requiredArea", "Required area"), C("measuredArea", "Measured area"),
      C("difference", "Difference"), C("roadAccess", "Road access"), C("discrepancies", "Discrepancies")],
    { dateKey: "surveyDate", map: (d) => ({ ...d, difference: d.requiredArea != null && d.measuredArea != null ? Number((d.measuredArea - d.requiredArea).toFixed(4)) : null }) }),
  "mutation-conversion": { title: "Mutation and Conversion Status Report", run: async (req, pool) => {
    const rows = (await pool.request().query(`
      SELECT m.Kind, l.LandCode, l.LandName, l.ProjectId, mz.MouzaName, m.ApplicationNo, m.ApplicationDate, m.OfficeName, m.DagNo, m.ApplicationStatus AS Status,
             u.name AS AssignedName, m.DueDate, m.HearingDate, m.CompletionDate, m.RequestedClass, m.OrderNo,
             (SELECT COUNT(*) FROM dbo.LegalApplicationQuery q WHERE q.MutationId = m.MutationId AND q.IsActive = 1 AND q.ResponseDate IS NULL) AS OpenQueries
      FROM dbo.LegalMutation m JOIN dbo.LegalLand l ON l.LandId = m.LandId AND l.IsActive = 1
      LEFT JOIN dbo.LegalMouza mz ON mz.MouzaId = l.MouzaId LEFT JOIN dbo.users u ON u.id = m.AssignedUserId
      WHERE m.IsActive = 1 ORDER BY m.Kind, m.MutationId DESC`)).recordset;
    return { columns: [C("Kind", "Type"), C("LandCode", "Land"), C("MouzaName", "Mouza"), C("ApplicationNo", "Application"), C("ApplicationDate", "Applied"), C("OfficeName", "Office"),
      C("DagNo", "Dag"), C("AssignedName", "Employee"), C("DueDate", "Target"), C("HearingDate", "Hearing"), C("Status", "Status"), C("OpenQueries", "Open queries"),
      C("RequestedClass", "Requested class"), C("CompletionDate", "Completed")],
      rows: scoped(req, rows).filter((r) => inRange(req, r.ApplicationDate)).map((r) => ({ ...r, ApplicationDate: d10(r.ApplicationDate), DueDate: d10(r.DueDate), HearingDate: d10(r.HearingDate), CompletionDate: d10(r.CompletionDate) })) };
  } },
  "land-history": { title: "Complete Land History", needsVerification: true, run: async (req, pool) => {
    const id = Number(req.query.verificationId);
    if (!id) return { columns: [], rows: [], note: "Choose a verification" };
    const w = scoped(req, (await workspaces(pool)).filter((x) => x.VerificationId === id))[0];
    if (!w) return { columns: [], rows: [], note: "Not found or not in your projects" };
    const h = (await pool.request().input("V", sql.Int, id).query(`
      SELECT h.ChangedAt, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) AS Ref, a.ActivityName, h.Action, h.OldStatus, h.NewStatus, h.NewFinding, nu.name AS NewAssignee, h.Remarks, cu.name AS ChangedBy
      FROM dbo.LegalActivityHistory h JOIN dbo.LegalVerificationActivity a ON a.ActivityId = h.ActivityId JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
      LEFT JOIN dbo.users nu ON nu.id = h.NewAssignee LEFT JOIN dbo.users cu ON cu.id = h.ChangedBy WHERE a.VerificationId = @V
      UNION ALL
      SELECT r.ReviewedAt, NULL, N'Final legal review', CONCAT(N'Review v', r.VersionNo), NULL, r.Decision, NULL, NULL, r.Remarks, u.name
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V
      UNION ALL
      SELECT x.CreatedAt, NULL, N'Exception', x.Kind, NULL, NULL, NULL, NULL, x.Reason, u.name
      FROM dbo.LegalVerificationException x LEFT JOIN dbo.users u ON u.id = x.CreatedBy WHERE x.VerificationId = @V
      ORDER BY 1`)).recordset;
    return { columns: [C("When", "When"), C("Activity", "Activity"), C("Action", "Action"), C("Change", "Change"), C("Remarks", "Remarks"), C("ChangedBy", "By")],
      rows: h.filter((r) => inRange(req, r.ChangedAt)).map((r) => ({ When: new Date(r.ChangedAt).toISOString().replace("T", " ").slice(0, 16), Activity: r.Ref ? `${r.Ref}. ${r.ActivityName}` : r.ActivityName,
        Action: r.Action, Change: [r.OldStatus || r.NewStatus ? `${r.OldStatus ?? "—"} → ${r.NewStatus ?? "—"}` : null, r.NewFinding ? `finding ${r.NewFinding}` : null, r.NewAssignee ? `to ${r.NewAssignee}` : null].filter(Boolean).join(" · "),
        Remarks: r.Remarks, ChangedBy: r.ChangedBy })),
      subtitle: `${w.VerificationNo} · ${w.EnquiryNo} · ${w.MouzaName ?? ""}` };
  } },
};

router.get("/dashboard", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json(null);
    const ws = scoped(req, await workspaces(pool));
    const ids = new Set(ws.map((w) => w.VerificationId));
    const acts = (await activities(pool)).filter((a) => ids.has(a.VerificationId));
    const enq = scoped(req, (await pool.request().query("SELECT ProjectId FROM dbo.LegalLandEnquiry WHERE IsActive = 1")).recordset).length;
    const la = scoped(req, await entries(pool, ["LA-ULC"])).filter((x) => !["Cleared", "Not Cleared"].includes(x.d.status));
    const mc = (await pool.request().query("IF COL_LENGTH('dbo.LegalMutation', 'Kind') IS NOT NULL SELECT m.Kind, l.ProjectId FROM dbo.LegalMutation m JOIN dbo.LegalLand l ON l.LandId = m.LandId AND l.IsActive = 1 WHERE m.IsActive = 1 AND m.ApplicationStatus NOT IN (N'Approved', N'Rejected') AND m.CompletionDate IS NULL ELSE SELECT TOP 0 '' AS Kind, 0 AS ProjectId")).recordset;
    const landPending = scoped(req, (await pool.request().query("SELECT l.ProjectId FROM dbo.LegalLand l WHERE l.IsActive = 1 AND l.VerificationStatus = N'Verified' AND ISNULL(l.WorkflowStatus, N'') NOT IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered') AND ISNULL(l.IsCancelled, 0) = 0")).recordset).length;
    const open = acts.filter(OPEN_WORK);
    const byAct = new Map();
    for (const a of acts.filter((x) => !["Verified", "N/A"].includes(x.VerifyStatus))) {
      const g = byAct.get(a.ActivityRef) ?? { no: a.ActivityRef, name: a.ActivityName, open: 0, overdue: 0, o: a.SortOrder };
      g.open++; if (OPEN_WORK(a) && a.DueDate && d10(a.DueDate) < today()) g.overdue++; byAct.set(a.ActivityRef, g);
    }
    const byEmp = new Map();
    for (const a of open.filter((x) => x.AssignedName)) {
      const g = byEmp.get(a.AssignedName) ?? { name: a.AssignedName, open: 0, overdue: 0 };
      g.open++; if (a.DueDate && d10(a.DueDate) < today()) g.overdue++; byEmp.set(a.AssignedName, g);
    }
    res.json({
      enquiries: enq,
      verifications: ws.length,
      pendingVerification: ws.filter((w) => !["Verified", "Rejected", "Closed"].includes(w.Status)).length,
      inProgress: acts.filter((a) => a.Status === "In Progress").length,
      awaitingReports: acts.filter((a) => ["Applied", "Report Pending"].includes(a.Status)).length,
      awaitingVerification: acts.filter((a) => a.Status === "Submitted for Review").length,
      returned: acts.filter((a) => a.VerifyStatus === "Returned").length,
      overdueActivities: open.filter((a) => a.DueDate && d10(a.DueDate) < today()).length,
      onHoldActivities: acts.filter((a) => a.Status === "On Hold").length,
      finalReviewPending: ws.filter((w) => w.Status === "Ready for Review").length,
      verified: ws.filter((w) => w.Status === "Verified").length,
      landApprovalPending: landPending,
      laUlcPending: la.length,
      pendingMutation: scoped(req, mc).filter((m) => m.Kind === "Mutation").length,
      pendingConversion: scoped(req, mc).filter((m) => m.Kind === "Conversion").length,
      discrepancies: acts.filter((a) => ["Mismatched", "Discrepancy Found"].includes(a.Finding)).length,
      byActivity: [...byAct.values()].sort((a, b) => a.o - b.o),
      byEmployee: [...byEmp.values()].sort((a, b) => b.open - a.open),
    });
  } catch (err) {
    console.error("[legal-verification-reports] dashboard:", err.message);
    res.status(500).json({ error: "Could not load the verification dashboard" });
  }
});

router.get("/list", requirePageRight(PAGE, "view"), (_req, res) =>
  res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, needsVerification: !!r.needsVerification }))));

router.get("/:key", requirePageRight(PAGE, "view"), async (req, res) => {
  const rep = REPORTS[req.params.key];
  if (!rep) return res.status(404).json({ error: "Unknown report" });
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json({ key: req.params.key, title: rep.title, columns: [], rows: [] });
    const out = await rep.run(req, pool);
    const options = filterOptions(out.rows);
    const rows = filters(req, out.rows).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? d10(v) : v])));
    res.json({ key: req.params.key, title: rep.title, ...out, rows, options });
  } catch (err) {
    console.error("[legal-verification-reports]", req.params.key, err.message);
    res.status(500).json({ error: "Could not build the report" });
  }
});

module.exports = router;
