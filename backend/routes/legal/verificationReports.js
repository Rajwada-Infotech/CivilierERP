"use strict";
/**
 * Legal V2 phase 5: the verification dashboard and the legal reports. Every report answers
 * { key, title, columns: [{ key, label }], rows } for the screen and the PDF / Excel export, follows the Legal
 * project picker (?project=all|none|<id>) and the user's project access, and takes ?from / ?to (YYYY-MM-DD) where a
 * date applies.
 *   GET /dashboard
 *   GET /list                     the reports on offer
 *   GET /:key                     one report (land-history needs ?verificationId)
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
const DONE = ["Completed", "Not Applicable"];
const today = () => new Date().toISOString().slice(0, 10);
const d10 = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);

/** Rows the user may see under the picked project. */
function scoped(req, rows) {
  const project = String(req.query.project ?? "all");
  return rows.filter((r) => (!req.legalScope || (r.ProjectId != null && req.legalScope.includes(Number(r.ProjectId))))
    && (project === "all" ? true : project === "none" ? !Number(r.ProjectId) : Number(r.ProjectId) === Number(project)));
}
const inRange = (req, d) => (!req.query.from || (d && d10(d) >= req.query.from)) && (!req.query.to || (d && d10(d) <= req.query.to));

const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalActivityEntry', 'U') AS t")).recordset[0].t;

async function workspaces(pool) {
  return (await pool.request().query(`
    SELECT v.VerificationId, v.VerificationNo, v.EnquiryId, v.ProjectId, pr.name AS ProjectName, v.Status, v.StartDate, v.TargetDate, lu.name AS LeadName,
           e.EnquiryNo, e.EnquiryDate, e.LandLocation, e.JLNo, CAST(e.ApproxArea AS FLOAT) AS ApproxArea, e.ContactPerson, m.MouzaName, d.DistrictName, e.LandId,
           (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId) AS Total,
           (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status IN (N'Completed', N'Not Applicable')) AS Resolved,
           (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Status NOT IN (N'Completed', N'Not Applicable') AND a.DueDate < CAST(GETDATE() AS DATE)) AS Overdue,
           (SELECT COUNT(*) FROM dbo.LegalVerificationActivity a WHERE a.VerificationId = v.VerificationId AND a.Finding IN (N'Mismatched', N'Discrepancy Found')) AS Discrepancies,
           (SELECT TOP 1 r.Decision FROM dbo.LegalVerificationReview r WHERE r.VerificationId = v.VerificationId ORDER BY r.VersionNo DESC) AS LastDecision
    FROM dbo.LegalVerification v JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
    LEFT JOIN dbo.enterprise pr ON pr.id = v.ProjectId LEFT JOIN dbo.users lu ON lu.id = v.LeadUserId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId`)).recordset;
}
async function activities(pool) {
  return (await pool.request().query(`
    SELECT a.ActivityId, a.VerificationId, v.VerificationNo, v.ProjectId, e.EnquiryNo, a.ActivityNo, a.ActivityName, a.IsMandatory, a.Status, a.Finding, a.Priority,
           a.AssignedUserId, u.name AS AssignedName, a.Department, a.StartDate, a.DueDate, a.CompletedDate, a.ExpectedDays, a.Remarks, a.HoldReason, a.NextAction
    FROM dbo.LegalVerificationActivity a JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
    JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId LEFT JOIN dbo.users u ON u.id = a.AssignedUserId`)).recordset;
}
async function entries(pool, codes) {
  const r = await pool.request().input("C", sql.NVarChar(500), codes.join("|")).query(`
    SELECT x.EntryId, t.ActivityCode, a.ActivityNo, v.VerificationId, v.VerificationNo, v.ProjectId, e.EnquiryNo, m.MouzaName, x.DataJson, x.CreatedAt, x.UpdatedAt
    FROM dbo.LegalActivityEntry x JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
    JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
    JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
    WHERE x.IsActive = 1 AND t.ActivityCode IN (SELECT value FROM STRING_SPLIT(@C, '|')) ORDER BY v.VerificationId, x.EntryId`);
  return r.recordset.map((x) => ({ ...x, d: JSON.parse(x.DataJson || "{}"), DataJson: undefined }));
}

const C = (key, label) => ({ key, label });
const WS = [C("VerificationNo", "Verification"), C("EnquiryNo", "Enquiry")];
const entryReport = (title, codes, cols, filter = () => true, dateKey = null) => ({
  title, run: async (req, pool) => {
    const rows = scoped(req, await entries(pool, codes)).filter((x) => filter(x.d, x)).filter((x) => inRange(req, dateKey ? x.d[dateKey] : x.CreatedAt));
    return { columns: [...WS, ...cols], rows: rows.map((x) => ({ VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName, ...x.d })) };
  },
});

const REPORTS = {
  "enquiry-register": { title: "Land Enquiry Register", run: async (req, pool) => {
    const rows = (await pool.request().query(`
      SELECT e.EnquiryNo, e.EnquiryDate, e.EnquiryStatus, e.ProjectId, pr.name AS ProjectName, m.MouzaName, e.JLNo, e.LandLocation, CAST(e.ApproxArea AS FLOAT) AS ApproxArea,
             e.ContactPerson, e.ContactNumber, CAST(e.ExpectedPrice AS FLOAT) AS ExpectedPrice, u.name AS AssignedName, v.VerificationNo, v.Status AS VerificationStatus
      FROM dbo.LegalLandEnquiry e LEFT JOIN dbo.enterprise pr ON pr.id = e.ProjectId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
      LEFT JOIN dbo.users u ON u.id = e.AssignedUserId LEFT JOIN dbo.LegalVerification v ON v.EnquiryId = e.EnquiryId
      WHERE e.IsActive = 1 ORDER BY e.EnquiryDate DESC`)).recordset;
    return { columns: [C("EnquiryNo", "Enquiry"), C("EnquiryDate", "Date"), C("ProjectName", "Project"), C("MouzaName", "Mouza"), C("JLNo", "J.L."), C("LandLocation", "Location"),
      C("ApproxArea", "Area"), C("ContactPerson", "Owner / contact"), C("ExpectedPrice", "Expected price"), C("EnquiryStatus", "Status"), C("VerificationNo", "Verification"), C("VerificationStatus", "Verification status")],
      rows: scoped(req, rows).filter((r) => inRange(req, r.EnquiryDate)).map((r) => ({ ...r, EnquiryDate: d10(r.EnquiryDate) })) };
  } },
  "verification-register": { title: "Legal Verification Register", run: async (req, pool) => ({
    columns: [...WS, C("ProjectName", "Project"), C("MouzaName", "Mouza"), C("LeadName", "Lead"), C("StartDate", "Started"), C("TargetDate", "Target"), C("Progress", "Resolved"),
      C("Overdue", "Overdue"), C("Discrepancies", "Discrepancies"), C("Status", "Status"), C("LastDecision", "Last review")],
    rows: scoped(req, await workspaces(pool)).filter((w) => inRange(req, w.StartDate))
      .map((w) => ({ ...w, StartDate: d10(w.StartDate), TargetDate: d10(w.TargetDate), Progress: `${w.Resolved}/${w.Total}` })),
  }) },
  "activity-pending": { title: "Activity-wise Pending Report", run: async (req, pool) => {
    const acts = scoped(req, await activities(pool)).filter((a) => !DONE.includes(a.Status));
    const by = new Map();
    for (const a of acts) {
      const k = `${a.ActivityNo}. ${a.ActivityName}`;
      const g = by.get(k) ?? { Activity: k, Pending: 0, OnHold: 0, Overdue: 0, Unassigned: 0, Rejected: 0, no: a.ActivityNo };
      g.Pending++; if (a.Status === "On Hold") g.OnHold++; if (a.Status === "Rejected") g.Rejected++;
      if (a.DueDate && d10(a.DueDate) < today()) g.Overdue++; if (!a.AssignedUserId) g.Unassigned++;
      by.set(k, g);
    }
    return { columns: [C("Activity", "Activity"), C("Pending", "Pending"), C("Overdue", "Overdue"), C("OnHold", "On hold"), C("Rejected", "Returned"), C("Unassigned", "Unassigned")],
      rows: [...by.values()].sort((a, b) => a.no - b.no) };
  } },
  "employee-performance": { title: "Employee Performance Report", run: async (req, pool) => {
    const acts = scoped(req, await activities(pool)).filter((a) => a.AssignedUserId);
    const by = new Map();
    for (const a of acts) {
      const g = by.get(a.AssignedName) ?? { Employee: a.AssignedName, Assigned: 0, Completed: 0, OnTime: 0, Late: 0, Open: 0, Overdue: 0, Returned: 0 };
      g.Assigned++;
      if (DONE.includes(a.Status)) {
        if (inRange(req, a.CompletedDate ?? a.DueDate)) { g.Completed++; if (a.DueDate && a.CompletedDate && d10(a.CompletedDate) > d10(a.DueDate)) g.Late++; else g.OnTime++; }
      } else { g.Open++; if (a.DueDate && d10(a.DueDate) < today()) g.Overdue++; if (a.Status === "Rejected") g.Returned++; }
      by.set(a.AssignedName, g);
    }
    return { columns: [C("Employee", "Employee"), C("Assigned", "Assigned"), C("Completed", "Completed"), C("OnTime", "On time"), C("Late", "Late"), C("Open", "Open"), C("Overdue", "Overdue"), C("Returned", "Returned"), C("OnTimePct", "On-time %")],
      rows: [...by.values()].map((g) => ({ ...g, OnTimePct: g.Completed ? `${Math.round((g.OnTime / g.Completed) * 100)}%` : "—" })).sort((a, b) => b.Assigned - a.Assigned) };
  } },
  "project-wise": { title: "Project-wise Land Report", run: async (req, pool) => {
    const ws = scoped(req, await workspaces(pool));
    const by = new Map();
    for (const w of ws) {
      const k = w.ProjectName ?? "No project";
      const g = by.get(k) ?? { Project: k, Verifications: 0, InProgress: 0, ReadyForReview: 0, Verified: 0, Returned: 0, Area: 0 };
      g.Verifications++; g.Area += Number(w.ApproxArea || 0);
      if (w.Status === "Verified") g.Verified++; else if (w.Status === "Ready for Review") g.ReadyForReview++; else if (w.Status === "Returned") g.Returned++; else g.InProgress++;
      by.set(k, g);
    }
    return { columns: [C("Project", "Project"), C("Verifications", "Verifications"), C("InProgress", "In progress"), C("ReadyForReview", "Ready for review"), C("Returned", "Returned"), C("Verified", "Verified"), C("Area", "Area (enquiry units)")],
      rows: [...by.values()].map((g) => ({ ...g, Area: Number(g.Area.toFixed(3)) })) };
  } },
  "owner-wise": { title: "Owner-wise Land Report", run: async (req, pool) => {
    const ents = scoped(req, await entries(pool, ["OWNER-MATCH", "OWNERSHIP-FLOW", "ONLINE-SEARCH", "KHAJNA", "LEGAL-HEIR"]));
    const rows = [];
    for (const x of ents) {
      const names = { "OWNER-MATCH": [x.d.rsOwner, x.d.lrOwner], "OWNERSHIP-FLOW": [x.d.fromOwner, x.d.toOwner], "ONLINE-SEARCH": [x.d.ownerName], KHAJNA: [x.d.ownerName], "LEGAL-HEIR": [x.d.deceasedOwner, x.d.heirName] }[x.ActivityCode] ?? [];
      for (const n of names.filter(Boolean)) rows.push({ Owner: n, VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName, Source: x.ActivityCode, Dag: x.d.dag ?? x.d.lrDag ?? x.d.rsDag ?? null });
    }
    const seen = new Set();
    return { columns: [C("Owner", "Owner"), ...WS, C("MouzaName", "Mouza"), C("Dag", "Dag"), C("Source", "Recorded in")],
      rows: rows.filter((r) => { const k = `${r.Owner.toLowerCase()}|${r.VerificationNo}|${r.Source}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.Owner.localeCompare(b.Owner)) };
  } },
  "mouza-wise": { title: "Mouza-wise Land Report", run: async (req, pool) => {
    const ws = scoped(req, await workspaces(pool));
    const by = new Map();
    for (const w of ws) {
      const k = w.MouzaName ?? "—";
      const g = by.get(k) ?? { Mouza: k, District: w.DistrictName, Verifications: 0, Verified: 0, Open: 0, Area: 0 };
      g.Verifications++; g.Area += Number(w.ApproxArea || 0); if (w.Status === "Verified") g.Verified++; else g.Open++;
      by.set(k, g);
    }
    return { columns: [C("Mouza", "Mouza"), C("District", "District"), C("Verifications", "Verifications"), C("Verified", "Verified"), C("Open", "Open"), C("Area", "Area")],
      rows: [...by.values()].map((g) => ({ ...g, Area: Number(g.Area.toFixed(3)) })).sort((a, b) => String(a.Mouza).localeCompare(String(b.Mouza))) };
  } },
  "dag-wise": { title: "Dag-wise Land Report", run: async (req, pool) => {
    const ents = scoped(req, await entries(pool, ["BANGLA-BHUMI", "LAND-SURVEY", "KHAJNA"]));
    return { columns: [C("Dag", "Dag"), C("Kind", "Type"), C("Khatian", "Khatian"), ...WS, C("MouzaName", "Mouza"), C("Detail", "Detail")],
      rows: ents.map((x) => x.ActivityCode === "BANGLA-BHUMI"
        ? { Dag: x.d.rsDag, Kind: "RS → LR", Khatian: x.d.rsKhatian, Detail: x.d.lrDag ? `LR ${x.d.lrDag} / Kh ${x.d.lrKhatian ?? "—"} · ${x.d.result}` : `No LR match · ${x.d.result}`, VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName }
        : x.ActivityCode === "LAND-SURVEY"
          ? { Dag: x.d.dag, Kind: "Survey", Khatian: x.d.khatian, Detail: `Required ${x.d.requiredArea ?? "—"} · measured ${x.d.measuredArea ?? "—"}`, VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName }
          : { Dag: x.d.dag, Kind: "Khajna", Khatian: x.d.khatian, Detail: `Last paid ${x.d.lastPaidYear ?? "—"} · ${x.d.status}`, VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, MouzaName: x.MouzaName })
        .filter((r) => r.Dag).sort((a, b) => String(a.Dag).localeCompare(String(b.Dag), undefined, { numeric: true })) };
  } },
  "deed-search": entryReport("Deed Search Report", ["ONLINE-SEARCH", "OFFLINE-SEARCH"],
    [C("ownerName", "Owner"), C("office", "Registry office"), C("officeName", "Office visited"), C("fromYear", "From"), C("toYear", "To"), C("searchDate", "Searched on"), C("result", "Result"), C("deedNo", "Deed no."), C("remarks", "Remarks")],
    () => true, "searchDate"),
  "court-search": entryReport("Court Search Report", ["COURT-SEARCH"],
    [C("court", "Court"), C("fromYear", "From"), C("toYear", "To"), C("searchDate", "Searched on"), C("ownerName", "Party searched"), C("result", "Result"), C("caseNo", "Case no."), C("caseType", "Case type"), C("caseStatus", "Case status")],
    () => true, "searchDate"),
  "la-ulc": entryReport("LA / ULC Report", ["LA-ULC"],
    [C("clearanceType", "Clearance"), C("applicationNo", "Application"), C("applicationDate", "Applied"), C("authority", "Authority"), C("expectedDate", "Expected"), C("reportDate", "Report"), C("status", "Status"), C("queryDetails", "Query")],
    () => true, "applicationDate"),
  "ownership-matching": entryReport("Ownership Matching Report", ["OWNER-MATCH"],
    [C("rsOwner", "RS owner"), C("rsKhatian", "RS Khatian"), C("lrOwner", "LR owner"), C("lrKhatian", "LR Khatian"), C("match", "Match"), C("deedNo", "Supporting deed"), C("remarks", "Explanation")]),
  "missing-documents": { title: "Missing Document Report", run: async (req, pool) => {
    const acts = scoped(req, await activities(pool)).filter((a) => a.Finding === "Additional Documents Required")
      .map((a) => ({ VerificationNo: a.VerificationNo, EnquiryNo: a.EnquiryNo, Where: `${a.ActivityNo}. ${a.ActivityName}`, What: a.Remarks ?? "Additional documents required", Owner: a.AssignedName }));
    const ents = scoped(req, await entries(pool, ["OWNERSHIP-FLOW", "LEGAL-HEIR", "DEED-CHAIN", "MOTHER-DEED-ORIGINAL"]))
      .filter((x) => x.d.verification === "Missing Document" || x.d.status === "Additional Document Required" || x.d.available === "No")
      .map((x) => ({ VerificationNo: x.VerificationNo, EnquiryNo: x.EnquiryNo, Where: `${x.ActivityNo}. ${x.ActivityCode}`,
        What: x.ActivityCode === "MOTHER-DEED-ORIGINAL" ? `Original mother deed not available (${x.d.motherDeedRef})` : x.d.remarks ?? `${x.d.fromOwner ?? x.d.deceasedOwner ?? x.d.deedNo ?? ""}`, Owner: null }));
    return { columns: [...WS, C("Where", "Activity"), C("What", "Missing"), C("Owner", "Assigned to")], rows: [...acts, ...ents] };
  } },
  "ownership-flowchart": entryReport("Historical Ownership Flowchart (transfers)", ["OWNERSHIP-FLOW"],
    [C("fromOwner", "Previous owner"), C("toOwner", "New owner"), C("transferType", "Type"), C("transferDate", "Date"), C("transferYear", "Year"), C("deedNo", "Deed no."), C("area", "Area"), C("verification", "Verification")]),
  mutation: entryReport("Mutation Report", ["MUTATION-CONVERSION"],
    [C("applicationNo", "Application"), C("applicationDate", "Applied"), C("office", "Office"), C("dag", "Dag"), C("ownerName", "Owner"), C("hearingDate", "Hearing"), C("status", "Status"), C("updatedKhatian", "Updated Khatian"), C("completionDate", "Completed")],
    (d) => d.recordType === "Mutation", "applicationDate"),
  conversion: entryReport("Conversion Report", ["MUTATION-CONVERSION"],
    [C("applicationNo", "Application"), C("applicationDate", "Applied"), C("office", "Authority"), C("dag", "Dag"), C("currentClass", "From class"), C("requestedClass", "To class"), C("inspectionDate", "Inspection"), C("status", "Status"), C("completionDate", "Completed")],
    (d) => d.recordType === "Conversion", "applicationDate"),
  overdue: { title: "Overdue Activity Report", run: async (req, pool) => ({
    columns: [...WS, C("Activity", "Activity"), C("AssignedName", "Assigned to"), C("Priority", "Priority"), C("Status", "Status"), C("DueDate", "Due"), C("DaysOverdue", "Days overdue")],
    rows: scoped(req, await activities(pool)).filter((a) => !DONE.includes(a.Status) && a.DueDate && d10(a.DueDate) < today())
      .map((a) => ({ ...a, Activity: `${a.ActivityNo}. ${a.ActivityName}`, DueDate: d10(a.DueDate), DaysOverdue: Math.round((Date.parse(today()) - Date.parse(d10(a.DueDate))) / 86_400_000) }))
      .sort((a, b) => b.DaysOverdue - a.DaysOverdue),
  }) },
  "land-history": { title: "Complete Land History", needsVerification: true, run: async (req, pool) => {
    const id = Number(req.query.verificationId);
    if (!id) return { columns: [], rows: [], note: "Choose a verification" };
    const w = scoped(req, (await workspaces(pool)).filter((x) => x.VerificationId === id))[0];
    if (!w) return { columns: [], rows: [], note: "Not found or not in your projects" };
    const h = (await pool.request().input("V", sql.Int, id).query(`
      SELECT h.ChangedAt, a.ActivityNo, a.ActivityName, h.Action, h.OldStatus, h.NewStatus, h.NewFinding, nu.name AS NewAssignee, h.Remarks, cu.name AS ChangedBy
      FROM dbo.LegalActivityHistory h JOIN dbo.LegalVerificationActivity a ON a.ActivityId = h.ActivityId
      LEFT JOIN dbo.users nu ON nu.id = h.NewAssignee LEFT JOIN dbo.users cu ON cu.id = h.ChangedBy WHERE a.VerificationId = @V
      UNION ALL
      SELECT r.ReviewedAt, NULL, N'Legal review', CONCAT(N'Review v', r.VersionNo), NULL, r.Decision, NULL, NULL, r.Remarks, u.name
      FROM dbo.LegalVerificationReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.VerificationId = @V
      ORDER BY 1`)).recordset;
    return { columns: [C("When", "When"), C("Activity", "Activity"), C("Action", "Action"), C("Change", "Change"), C("Remarks", "Remarks"), C("ChangedBy", "By")],
      rows: h.filter((r) => inRange(req, r.ChangedAt)).map((r) => ({ When: new Date(r.ChangedAt).toISOString().replace("T", " ").slice(0, 16), Activity: r.ActivityNo ? `${r.ActivityNo}. ${r.ActivityName}` : r.ActivityName,
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
    const mc = scoped(req, await entries(pool, ["MUTATION-CONVERSION"])).filter((x) => !["Completed", "Rejected"].includes(x.d.status));
    const open = acts.filter((a) => !DONE.includes(a.Status));
    const byAct = new Map();
    for (const a of open) { const k = a.ActivityNo; const g = byAct.get(k) ?? { no: k, name: a.ActivityName, open: 0, overdue: 0 }; g.open++; if (a.DueDate && d10(a.DueDate) < today()) g.overdue++; byAct.set(k, g); }
    res.json({
      enquiries: enq,
      verifications: ws.length,
      active: ws.filter((w) => ["In Progress", "Returned", "On Hold"].includes(w.Status)).length,
      readyForReview: ws.filter((w) => w.Status === "Ready for Review").length,
      verified: ws.filter((w) => w.Status === "Verified").length,
      returned: ws.filter((w) => w.Status === "Returned").length,
      overdueActivities: open.filter((a) => a.DueDate && d10(a.DueDate) < today()).length,
      onHoldActivities: open.filter((a) => a.Status === "On Hold").length,
      discrepancies: acts.filter((a) => ["Mismatched", "Discrepancy Found"].includes(a.Finding)).length,
      pendingMutation: mc.filter((x) => x.d.recordType === "Mutation").length,
      pendingConversion: mc.filter((x) => x.d.recordType === "Conversion").length,
      byActivity: [...byAct.values()].sort((a, b) => a.no - b.no),
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
    const rows = out.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? d10(v) : v])));
    res.json({ key: req.params.key, title: rep.title, ...out, rows });
  } catch (err) {
    console.error("[legal-verification-reports]", req.params.key, err.message);
    res.status(500).json({ error: "Could not build the report" });
  }
});

module.exports = router;
