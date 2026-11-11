"use strict";
// Legal due diligence (Phase 1) — the stage before Final Verification.
//   • Ownership & seller details (data entry), and a status per area set by a Verifier (never the land's own entry user):
//     Ownership & Seller, Inheritance, Title, Documents.
//   • Automatic risk flags (worked out from the land's records — a flag, not a legal finding) and the manual risk
//     assessment by a Verifier / Legal Reviewer (kept as history).
//   • Legal review (advocate opinion). Only a Legal Reviewer (Setup → Approval Control) gives final clearance.
// Final Verification waits for diligenceGate() to pass.
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { canAct, ownWork } = require("./approvalAuthority");
const { writeAudit } = require("./legalAudit");
const { suggestShares, differs } = require("../../services/successionShares");

const router = express.Router();
const LAND_PAGE = "legal-land-master";

const AREAS = {
  ownership: "Ownership & Seller",
  inheritance: "Inheritance",
  title: "Title & Ownership History",
  documents: "Legal Documents",
};
const AREA_STATUS = ["Pending", "Verified", "Incomplete", "Disputed", "Requires Legal Review", "Not Applicable"];
const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
const REVIEW_STATUS = ["Not Required", "Pending", "Under Review", "Additional Information Required", "Legally Cleared", "Not Recommended"];
const OWNERSHIP = {
  OwnershipType: ["Individual", "Joint Ownership", "Inherited Property", "Company", "Trust", "Religious Institution", "Other"],
  OwnershipSource: ["Purchase", "Inheritance", "Gift", "Partition", "Will", "Other Legal Transfer"],
  SellerIdStatus: ["Verified", "Pending", "Not verified"],
  SellerAuthority: ["Has authority", "Pending", "No authority", "Authorised representative"],
  OwnersConsent: ["All owners consented", "Pending", "Not all consented"],
};

const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const ready = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalDiligenceArea', 'U') AS t")).recordset[0].t;
const safe = async (pool, q, fallback) => { try { return (await q(pool.request())).recordset; } catch { return fallback; } };

/** Phase 2 facts (migration 650): restrictions, uncleared open cases / stay orders, attachment orders. Empty before it runs. */
async function phase2(pool, landId) {
  const has = (await pool.request().query("SELECT OBJECT_ID('dbo.LegalPropertyRestriction', 'U') AS t, COL_LENGTH('dbo.LegalCase', 'ClearedAt') AS c, COL_LENGTH('dbo.LegalMortgage', 'AttachmentOrder') AS m")).recordset[0];
  const out = { restrictions: [], cases: [], attachments: 0 };
  if (has.t) out.restrictions = (await pool.request().input("Id", sql.Int, landId).query(
    "SELECT RestrictionId, Category, PermissionRequired, Status FROM dbo.LegalPropertyRestriction WHERE LandId = @Id AND IsActive = 1")).recordset;
  if (has.c) out.cases = (await pool.request().input("Id", sql.Int, landId).query(`
    SELECT c.CaseId, c.CaseNumber, c.CourtName, ISNULL(c.StayType, N'None') AS StayType, c.StayDetails, c.ClearedAt, c.ClearRemarks,
           (SELECT name FROM dbo.users WHERE id = c.ClearedBy) AS ClearedByName, ISNULL(s.Name, N'Open') AS CaseStatus
    FROM dbo.LegalCase c LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = c.LegalStatusId
    WHERE c.LandId = @Id AND c.IsActive = 1 AND (ISNULL(s.Name, N'Open') IN (N'Open', N'Pending', N'Appealed') OR ISNULL(c.StayType, N'None') <> N'None')`)).recordset;
  if (has.m) out.attachments = (await pool.request().input("Id", sql.Int, landId).query(
    "SELECT COUNT(*) AS n FROM dbo.LegalMortgage WHERE LandId = @Id AND IsActive = 1 AND AttachmentOrder = N'Attachment order in force'")).recordset[0].n;
  return out;
}
const restrictionOpen = (r) => r.Status === "Transfer prohibited" || (r.Status === "Pending" && r.PermissionRequired !== "No");

/** Share suggestion for one inheritance (null before migration 653 or without a chosen law). */
async function inheritanceSuggestion(pool, inheritanceId) {
  const ok = (await pool.request().query("SELECT OBJECT_ID('dbo.LegalSuccessionRule', 'U') AS t")).recordset[0].t;
  if (!ok) return null;
  const inh = (await pool.request().input("I", sql.Int, inheritanceId).query(`
    SELECT InheritanceId, LandId, DeceasedName, SuccessionLaw, ShareDecision, ShareDecisionRemarks, ShareDecisionAt, (SELECT name FROM dbo.users WHERE id = ShareDecisionBy) AS ShareDecisionByName
    FROM dbo.LegalInheritance WHERE InheritanceId = @I AND IsActive = 1`)).recordset[0];
  if (!inh) return null;
  const heirs = (await pool.request().input("I", sql.Int, inheritanceId).query(`
    SELECT HeirId AS id, HeirName AS name, HeirRole AS role, BranchOf AS branchOf, Relinquished AS relinquished, CAST(SharePct AS FLOAT) AS recordedPct
    FROM dbo.LegalInheritanceHeir WHERE InheritanceId = @I AND IsActive = 1 ORDER BY HeirId`)).recordset;
  if (!inh.SuccessionLaw || ["Will / Probate", "Other"].includes(inh.SuccessionLaw)) return { inheritance: inh, heirs, result: null };
  const rules = (await pool.request().input("L", sql.NVarChar(60), inh.SuccessionLaw).query("SELECT * FROM dbo.LegalSuccessionRule WHERE Law = @L AND IsActive = 1")).recordset;
  return { inheritance: inh, heirs, result: suggestShares(inh.SuccessionLaw, heirs, rules) };
}

/** Automatic risk flags from the land's records. Each { level, text }. These are flags for review, not findings. */
async function autoFlags(pool, landId) {
  const flags = [];
  const r = (await pool.request().input("Id", sql.Int, landId).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.LegalCase c LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = c.LegalStatusId
         WHERE c.LandId = @Id AND c.IsActive = 1 AND ISNULL(s.Name, N'Open') IN (N'Open', N'Pending', N'Appealed')) AS openCases,
      (SELECT COUNT(*) FROM dbo.LegalMortgage m WHERE m.LandId = @Id AND m.IsActive = 1 AND ISNULL(m.LoanStatus, N'Active') IN (N'Active', N'Overdue', N'Unknown') AND m.LoanClosureDate IS NULL) AS openLoans,
      (SELECT ISNULL(SUM(SharePct), 0) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL) AS shareTotal,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipRecord WHERE LandId = @Id AND IsActive = 1 AND ValidTo IS NULL) AS owners,
      (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = @Id AND IsActive = 1 AND DocFileId IS NULL AND RegisteredDeedId IS NULL) AS transfersNoCopy,
      (SELECT COUNT(*) FROM dbo.LegalLandDocument WHERE LandId = @Id AND IsActive = 1) AS documents,
      l.SellerAuthority, l.OwnersConsent, l.SellerIdStatus
    FROM dbo.LegalLand l WHERE l.LandId = @Id`)).recordset[0];
  if (!r) return flags;
  const disputes = (await safe(pool, (q) => q.input("Id", sql.Int, landId).query(
    "SELECT COUNT(*) AS n FROM dbo.LegalInheritance WHERE LandId = @Id AND IsActive = 1 AND DisputePending = N'Yes'"), [{ n: 0 }]))[0].n;
  const areas = await safe(pool, (q) => q.input("Id", sql.Int, landId).query("SELECT Area, Status FROM dbo.LegalDiligenceArea WHERE LandId = @Id"), []);
  const p2 = await phase2(pool, landId);
  p2.restrictions.filter((x) => x.Status === "Transfer prohibited").forEach((x) => flags.push({ key: "restriction_prohibited", level: "Critical", text: `${x.Category}: transfer prohibited` }));
  p2.restrictions.filter((x) => x.Status === "Pending" && x.PermissionRequired !== "No").forEach((x) => flags.push({ key: "restriction_pending", level: "High", text: `${x.Category}: permission ${x.PermissionRequired === "Yes" ? "required" : "to be determined"} — not yet obtained` }));
  p2.cases.filter((c) => !c.ClearedAt && c.StayType !== "None").forEach((c) => flags.push({ key: "stay_order", level: "Critical", text: `Case ${c.CaseNumber}: ${c.StayType.toLowerCase()} in force` }));
  if (p2.attachments) flags.push({ key: "attachment_order", level: "High", text: `${p2.attachments} attachment order(s) in force` });
  if (r.openCases) flags.push({ key: "open_case", level: "High", text: `${r.openCases} open court case(s) on this land` });
  if (disputes) flags.push({ key: "inheritance_dispute", level: "High", text: `${disputes} inheritance dispute(s) pending` });
  if (r.SellerAuthority === "No authority") flags.push({ key: "seller_no_authority", level: "High", text: "Seller has no legal authority to sell" });
  if (r.OwnersConsent === "Not all consented") flags.push({ key: "consent_missing", level: "High", text: "Not all owners have consented" });
  areas.filter((a) => a.Status === "Disputed").forEach((a) => flags.push({ key: "area_disputed", level: "High", text: `${AREAS[a.Area] ?? a.Area}: disputed` }));
  if (r.openLoans) flags.push({ key: "open_loan", level: "Medium", text: `${r.openLoans} loan / mortgage not closed` });
  if (r.owners && Math.abs(Number(r.shareTotal) - 100) > 0.01) flags.push({ key: "share_mismatch", level: "Medium", text: `Current owners' shares add up to ${Number(r.shareTotal)}%, not 100%` });
  if (!r.owners) flags.push({ key: "no_owner", level: "Medium", text: "No current owner recorded" });
  if (r.transfersNoCopy) flags.push({ key: "title_gap", level: "Medium", text: `${r.transfersNoCopy} ownership transfer(s) without a document copy (title chain gap)` });
  if (!r.documents) flags.push({ key: "no_documents", level: "Medium", text: "No legal document uploaded" });
  if (r.SellerIdStatus !== "Verified") flags.push({ key: "seller_id", level: "Medium", text: "Seller identity not verified" });
  if (r.OwnersConsent === "Pending" || !r.OwnersConsent) flags.push({ key: "consent_pending", level: "Medium", text: "Owners' consent not confirmed" });
  const expired = (await safe(pool, (q) => q.input("Id", sql.Int, landId).query(`
    SELECT COUNT(*) AS n FROM dbo.LegalLandDocument d JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId
    WHERE d.LandId = @Id AND d.IsActive = 1 AND t.ExpiryDays IS NOT NULL AND d.DocumentDate IS NOT NULL AND DATEADD(day, t.ExpiryDays, d.DocumentDate) < CAST(GETDATE() AS DATE)`), [{ n: 0 }]))[0].n;
  // Recorded heir shares that differ from the suggestion, with no decision yet (a prompt, not a finding).
  const inhs = await safe(pool, (q) => q.input("Id", sql.Int, landId).query("SELECT InheritanceId, DeceasedName FROM dbo.LegalInheritance WHERE LandId = @Id AND IsActive = 1 AND SuccessionLaw IS NOT NULL AND ShareDecision IS NULL"), []);
  for (const x of inhs) {
    const sgg = await inheritanceSuggestion(pool, x.InheritanceId).catch(() => null);
    if (sgg?.result && differs(sgg.result.lines)) flags.push({ key: "share_suggestion", level: "Medium", text: `${x.DeceasedName}: recorded heir shares differ from the suggested shares — review` });
  }
  if (expired) flags.push({ key: "doc_expired", level: "Medium", text: `${expired} document(s) past their validity — renew` });
  areas.filter((a) => a.Status === "Incomplete" || a.Status === "Requires Legal Review").forEach((a) => flags.push({ key: "area_incomplete", level: "Medium", text: `${AREAS[a.Area] ?? a.Area}: ${a.Status.toLowerCase()}` }));
  return applyRules(flags, await ruleConfig(pool));
}

/** Setup → Legal Rules (migration 652): a rule can be switched off or graded differently; before it, the built-in grading. */
async function ruleConfig(pool) {
  const rows = await safe(pool, (q) => q.query("SELECT RuleKey, RiskLevel, IsBlocking, IsActive FROM dbo.LegalRuleConfig"), []);
  return Object.fromEntries(rows.map((r) => [r.RuleKey, r]));
}
const applyRules = (flags, cfg) => flags
  .filter((f) => !cfg[f.key] || cfg[f.key].IsActive)
  .map((f) => (cfg[f.key] && ["Low", "Medium", "High", "Critical"].includes(cfg[f.key].RiskLevel) ? { ...f, level: cfg[f.key].RiskLevel } : f));
const blocks = (cfg, key) => (cfg[key] ? !!cfg[key].IsActive && !!cfg[key].IsBlocking : true);
const RANK = { Low: 0, Medium: 1, High: 2, Critical: 3 };
const maxLevel = (levels) => levels.reduce((m, l) => (RANK[l] > RANK[m] ? l : m), "Low");

/** What still stands between the land and Final Verification. Empty list = may verify. */
async function diligenceGate(pool, landId) {
  if (!(await ready(pool))) return [];
  const blockers = [];
  const areas = (await pool.request().input("Id", sql.Int, landId).query("SELECT Area, Status FROM dbo.LegalDiligenceArea WHERE LandId = @Id")).recordset;
  for (const [key, label] of Object.entries(AREAS)) {
    const st = areas.find((a) => a.Area === key)?.Status ?? "Pending";
    if (st !== "Verified" && !(st === "Not Applicable" && key === "inheritance")) blockers.push(`${label}: ${st}`);
  }
  const risk = (await pool.request().input("Id", sql.Int, landId).query("SELECT TOP 1 RiskLevel FROM dbo.LegalRiskAssessment WHERE LandId = @Id ORDER BY AssessedAt DESC, RiskId DESC")).recordset[0];
  const flags = await autoFlags(pool, landId);
  const level = maxLevel([risk?.RiskLevel ?? "Low", ...flags.map((f) => f.level)]);
  if (!risk) blockers.push("Risk assessment not done");
  const review = (await pool.request().input("Id", sql.Int, landId).query("SELECT TOP 1 Status FROM dbo.LegalReview WHERE LandId = @Id ORDER BY CreatedAt DESC, ReviewId DESC")).recordset[0];
  if (review?.Status === "Not Recommended") blockers.push("Legal review: not recommended");
  else if (review && !["Legally Cleared", "Not Required"].includes(review.Status)) blockers.push(`Legal review: ${review.Status}`);
  if ((level === "High" || level === "Critical") && review?.Status !== "Legally Cleared") blockers.push(`${level} risk — legal clearance (Legally Cleared) is required`);
  if (risk?.RiskLevel === "Critical") blockers.push("Critical risk — cannot proceed");
  blockers.push(...(await processingBlockers(pool, landId)));
  return blockers;
}

/** Hard stops at every later step too (Final Verify, Deed approvals): restricted property without permission,
 *  open court cases / stay orders not cleared by a legal officer, attachment orders in force. */
async function processingBlockers(pool, landId) {
  const p2 = await phase2(pool, landId);
  const out = [];
  const cfg = await ruleConfig(pool);
  p2.restrictions.filter(restrictionOpen).forEach((x) => {
    const prohibited = x.Status === "Transfer prohibited";
    if (blocks(cfg, prohibited ? "restriction_prohibited" : "restriction_pending")) out.push(`${x.Category}: ${prohibited ? "transfer prohibited" : "permission not obtained"}`);
  });
  p2.cases.filter((c) => !c.ClearedAt).forEach((c) => {
    if (blocks(cfg, c.StayType !== "None" ? "stay_order" : "open_case")) out.push(`Court case ${c.CaseNumber}${c.StayType !== "None" ? ` (${c.StayType.toLowerCase()})` : ""} not cleared by a legal officer`);
  });
  if (p2.attachments && blocks(cfg, "attachment_order")) out.push("Attachment order in force on a loan / mortgage");
  return out;
}

// GET /:landId — everything the Due Diligence tab shows.
router.get("/:landId", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const pool = getPool();
  try {
    if (!(await ready(pool))) return res.status(503).json({ error: "Due diligence is not set up yet (migration 649)" });
    const land = (await pool.request().input("Id", sql.Int, id).query(`
      SELECT LandId, LandCode, CreatedBy, OwnershipType, OwnershipSource, SellerIdStatus, SellerAuthority, OwnersConsent, SellerContact,
        (SELECT STRING_AGG(o.OwnerName + N' (' + CAST(CAST(o.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + N'%)', N', ') FROM dbo.LegalOwnershipRecord o WHERE o.LandId = l.LandId AND o.IsActive = 1 AND o.ValidTo IS NULL) AS CurrentOwners,
        (SELECT COUNT(*) FROM dbo.LegalInheritance WHERE LandId = l.LandId AND IsActive = 1) AS Inheritances,
        (SELECT COUNT(*) FROM dbo.LegalOwnershipEvent WHERE LandId = l.LandId AND IsActive = 1) AS Transfers,
        (SELECT COUNT(*) FROM dbo.LegalLandRsRecord WHERE LandId = l.LandId AND IsActive = 1) + (SELECT COUNT(*) FROM dbo.LegalLandLrRecord WHERE LandId = l.LandId AND IsActive = 1) AS LandRecords,
        (SELECT COUNT(*) FROM dbo.LegalLandDocument WHERE LandId = l.LandId AND IsActive = 1) AS Documents
      FROM dbo.LegalLand l WHERE LandId = @Id AND IsActive = 1`)).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    const [areas, risks, reviews] = (await pool.request().input("Id", sql.Int, id).query(`
      SELECT a.Area, a.Status, a.Remarks, a.CheckedAt, (SELECT name FROM dbo.users WHERE id = a.CheckedBy) AS CheckedByName FROM dbo.LegalDiligenceArea a WHERE a.LandId = @Id;
      SELECT r.RiskId, r.RiskLevel, r.AutoFlags, r.Remarks, r.FileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = r.FileId) AS FileName,
             r.AssessedAt, (SELECT name FROM dbo.users WHERE id = r.AssessedBy) AS AssessedByName
        FROM dbo.LegalRiskAssessment r WHERE r.LandId = @Id ORDER BY r.AssessedAt DESC, r.RiskId DESC;
      SELECT v.ReviewId, v.Status, v.AdvocateId, (SELECT AdvocateName FROM dbo.LegalAdvocate a WHERE a.AdvocateId = v.AdvocateId) AS AdvocateName,
             CONVERT(char(10), v.AssignedOn, 23) AS AssignedOn, CONVERT(char(10), v.CompletedOn, 23) AS CompletedOn, v.Opinion, v.Observations, v.AdditionalDocs, v.Recommendation,
             v.FileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = v.FileId) AS FileName, v.CreatedAt, (SELECT name FROM dbo.users WHERE id = v.CreatedBy) AS CreatedByName
        FROM dbo.LegalReview v WHERE v.LandId = @Id ORDER BY v.CreatedAt DESC, v.ReviewId DESC;`)).recordsets;
    const flags = await autoFlags(pool, id);
    const p2 = await phase2(pool, id);
    const isVerifier = await canAct(req, "Verifier", LAND_PAGE);
    const isReviewer = await canAct(req, "Legal Reviewer", LAND_PAGE);
    res.json({
      land, areas: Object.entries(AREAS).map(([key, label]) => ({ key, label, ...(areas.find((a) => a.Area === key) ?? { Status: "Pending" }) })),
      restrictions: p2.restrictions, cases: p2.cases,
      autoFlags: flags, autoLevel: flags.length ? maxLevel(flags.map((f) => f.level)) : "Low", risks, reviews,
      blockers: await diligenceGate(pool, id),
      options: { areaStatus: AREA_STATUS, riskLevels: RISK_LEVELS, reviewStatus: REVIEW_STATUS, ownership: OWNERSHIP },
      can: { verify: isVerifier && !ownWork(req, land.CreatedBy, "this land"), assessRisk: isVerifier || isReviewer, clear: isReviewer },
    });
  } catch (err) {
    console.error("[legal-diligence] get:", err.message);
    res.status(500).json({ error: "Could not load the due diligence" });
  }
});

// PUT /:landId/ownership — ownership & seller details (data entry: land edit right).
router.put("/:landId/ownership", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idOf(req.params.landId);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  const b = req.body || {};
  const v = {};
  for (const [k, opts] of Object.entries(OWNERSHIP)) {
    if (b[k] != null && b[k] !== "" && !opts.includes(b[k])) return res.status(400).json({ error: `Invalid value for ${k}` });
    v[k] = b[k] || null;
  }
  const pool = getPool();
  try {
    const q = pool.request().input("Id", sql.Int, id).input("U", sql.Int, req.user?.userId || null).input("Contact", sql.NVarChar(200), txt(b.SellerContact, 200));
    Object.entries(v).forEach(([k, val]) => q.input(k, sql.NVarChar(40), val));
    const r = await q.query(`UPDATE dbo.LegalLand SET ${Object.keys(v).map((k) => `${k} = @${k}`).join(", ")}, SellerContact = @Contact, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.LandId WHERE LandId = @Id AND IsActive = 1`);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    // A changed ownership answer sends the Ownership & Seller check back to Pending.
    await pool.request().input("Id", sql.Int, id).query("UPDATE dbo.LegalDiligenceArea SET Status = N'Pending', CheckedBy = NULL, CheckedAt = NULL WHERE LandId = @Id AND Area = N'ownership' AND Status = N'Verified'");
    await writeAudit(pool, req, { action: "Ownership & seller details updated", entityType: "Land Property", entityId: id, landId: id, newValue: { ...v, SellerContact: txt(b.SellerContact, 200) } });
    res.json({ message: "Ownership & seller details saved" });
  } catch (err) {
    console.error("[legal-diligence] ownership:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// PUT /:landId/area/:area { status, remarks } — a Verifier sets an area's status (remarks needed unless Verified).
router.put("/:landId/area/:area", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  const area = req.params.area;
  const status = req.body?.status;
  const remarks = txt(req.body?.remarks, 1000);
  if (!id || !AREAS[area] || !AREA_STATUS.includes(status)) return res.status(400).json({ error: "Invalid request" });
  if (status === "Not Applicable" && area !== "inheritance") return res.status(400).json({ error: "Only Inheritance can be Not Applicable" });
  if (status !== "Verified" && status !== "Pending" && !remarks) return res.status(400).json({ error: "Write the remarks" });
  const pool = getPool();
  try {
    if (!(await canAct(req, "Verifier", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier (Setup → Approval Control) can set this" });
    const land = (await pool.request().input("Id", sql.Int, id).query("SELECT LandCode, CreatedBy FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1")).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    const own = ownWork(req, land.CreatedBy, "this land");
    if (own) return res.status(409).json({ error: own });
    const before = (await pool.request().input("Id", sql.Int, id).input("A", sql.NVarChar(30), area).query("SELECT Status FROM dbo.LegalDiligenceArea WHERE LandId = @Id AND Area = @A")).recordset[0];
    await pool.request().input("Id", sql.Int, id).input("A", sql.NVarChar(30), area).input("S", sql.NVarChar(30), status).input("R", sql.NVarChar(1000), remarks).input("U", sql.Int, req.user?.userId || null).query(`
      MERGE dbo.LegalDiligenceArea AS t USING (SELECT @Id AS LandId, @A AS Area) AS s ON t.LandId = s.LandId AND t.Area = s.Area
      WHEN MATCHED THEN UPDATE SET Status = @S, Remarks = @R, CheckedBy = @U, CheckedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (LandId, Area, Status, Remarks, CheckedBy, CheckedAt) VALUES (@Id, @A, @S, @R, @U, SYSUTCDATETIME());`);
    await writeAudit(pool, req, { action: "Due diligence checked", entityType: "Land Property", entityId: id, landId: id, oldValue: { area: AREAS[area], status: before?.Status ?? "Pending" }, newValue: { area: AREAS[area], status }, remarks });
    res.json({ message: `${AREAS[area]}: ${status}` });
  } catch (err) {
    console.error("[legal-diligence] area:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:landId/risk { level, remarks, fileId } — manual risk assessment (Verifier or Legal Reviewer). History is kept.
router.post("/:landId/risk", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  const level = req.body?.level;
  const remarks = txt(req.body?.remarks, 2000);
  if (!id || !RISK_LEVELS.includes(level)) return res.status(400).json({ error: "Choose the risk level" });
  if (!remarks) return res.status(400).json({ error: "Explain the risk assessment" });
  const pool = getPool();
  try {
    if (!(await canAct(req, "Verifier", LAND_PAGE)) && !(await canAct(req, "Legal Reviewer", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier or Legal Reviewer can assess the risk" });
    const flags = await autoFlags(pool, id);
    const r = await pool.request().input("Id", sql.Int, id).input("L", sql.NVarChar(20), level).input("F", sql.NVarChar(2000), flags.map((f) => `[${f.level}] ${f.text}`).join("\n").slice(0, 2000) || null)
      .input("R", sql.NVarChar(2000), remarks).input("File", sql.Int, idOf(req.body?.fileId)).input("U", sql.Int, req.user?.userId || null).query(`
        INSERT INTO dbo.LegalRiskAssessment (LandId, RiskLevel, AutoFlags, Remarks, FileId, AssessedBy)
        OUTPUT INSERTED.RiskId SELECT @Id, @L, @F, @R, @File, @U WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1)`);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, { action: "Risk assessed", entityType: "Land Property", entityId: id, landId: id, newValue: { level, autoFlags: flags.length }, remarks });
    res.status(201).json({ message: `Risk assessed: ${level}` });
  } catch (err) {
    console.error("[legal-diligence] risk:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:landId/review — a legal review entry (history kept). Final outcomes (Legally Cleared / Not Recommended /
// Not Required) only by a Legal Reviewer; others (assign, under review, more documents) by anyone with edit right.
router.post("/:landId/review", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  const b = req.body || {};
  if (!id || !REVIEW_STATUS.includes(b.status)) return res.status(400).json({ error: "Choose the review status" });
  const final = ["Legally Cleared", "Not Recommended", "Not Required"].includes(b.status);
  const pool = getPool();
  try {
    if (final && !(await canAct(req, "Legal Reviewer", LAND_PAGE))) return res.status(403).json({ error: "Only a Legal Reviewer (Setup → Approval Control) can give this outcome" });
    if (!final) {
      const { hasAnyPageAction } = require("../../middleware/requirePageRight");
      if (!(await hasAnyPageAction(req, LAND_PAGE, ["edit"])) && !(await canAct(req, "Legal Reviewer", LAND_PAGE))) return res.status(403).json({ error: "You cannot update the legal review" });
    }
    if (final && b.status !== "Not Required" && !txt(b.opinion, 4000)) return res.status(400).json({ error: "Write the legal opinion" });
    if (b.status === "Additional Information Required" && !txt(b.additionalDocs, 1000)) return res.status(400).json({ error: "List the additional documents needed" });
    const r = await pool.request().input("Id", sql.Int, id).input("S", sql.NVarChar(40), b.status).input("Adv", sql.Int, idOf(b.advocateId))
      .input("Rev", sql.Int, req.user?.userId || null).input("As", sql.Date, dateOf(b.assignedOn)).input("Co", sql.Date, dateOf(b.completedOn) ?? (final ? new Date().toISOString().slice(0, 10) : null))
      .input("Op", sql.NVarChar(4000), txt(b.opinion, 4000)).input("Ob", sql.NVarChar(2000), txt(b.observations, 2000)).input("Ad", sql.NVarChar(1000), txt(b.additionalDocs, 1000))
      .input("Rec", sql.NVarChar(1000), txt(b.recommendation, 1000)).input("File", sql.Int, idOf(b.fileId)).query(`
        INSERT INTO dbo.LegalReview (LandId, Status, AdvocateId, ReviewerUserId, AssignedOn, CompletedOn, Opinion, Observations, AdditionalDocs, Recommendation, FileId, CreatedBy)
        OUTPUT INSERTED.ReviewId SELECT @Id, @S, @Adv, @Rev, @As, @Co, @Op, @Ob, @Ad, @Rec, @File, @Rev WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1)`);
    if (!r.recordset.length) return res.status(404).json({ error: "Land not found" });
    await writeAudit(pool, req, { action: "Legal review updated", entityType: "Land Property", entityId: id, landId: id, newValue: { status: b.status }, remarks: txt(b.recommendation, 1000) });
    res.status(201).json({ message: `Legal review: ${b.status}` });
  } catch (err) {
    console.error("[legal-diligence] review:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:landId/case/:caseId/clear { remarks } — a Legal Reviewer clears an open case / stay after reviewing the evidence.
router.post("/:landId/case/:caseId/clear", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId), caseId = idOf(req.params.caseId);
  const remarks = txt(req.body?.remarks, 1000);
  if (!id || !caseId) return res.status(400).json({ error: "Invalid request" });
  if (!remarks) return res.status(400).json({ error: "Write the reason for clearing (evidence reviewed)" });
  const pool = getPool();
  try {
    if (!(await canAct(req, "Legal Reviewer", LAND_PAGE))) return res.status(403).json({ error: "Only a Legal Reviewer can clear a court case" });
    const r = await pool.request().input("Id", sql.Int, id).input("C", sql.Int, caseId).input("U", sql.Int, req.user?.userId || null).input("R", sql.NVarChar(1000), remarks).query(`
      UPDATE dbo.LegalCase SET ClearedBy = @U, ClearedAt = SYSUTCDATETIME(), ClearRemarks = @R OUTPUT INSERTED.CaseNumber WHERE CaseId = @C AND LandId = @Id AND IsActive = 1`);
    if (!r.recordset.length) return res.status(404).json({ error: "Case not found" });
    await writeAudit(pool, req, { action: "Court case cleared", entityType: "Land Property", entityId: id, landId: id, newValue: { caseNumber: r.recordset[0].CaseNumber }, remarks });
    res.json({ message: `Case ${r.recordset[0].CaseNumber} cleared` });
  } catch (err) {
    console.error("[legal-diligence] clear case:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// GET /:landId/inheritances — each inheritance with its share suggestion (for the Due Diligence tab).
router.get("/:landId/inheritances", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    const list = await safe(pool, (q) => q.input("Id", sql.Int, id).query("SELECT InheritanceId FROM dbo.LegalInheritance WHERE LandId = @Id AND IsActive = 1 ORDER BY InheritanceId"), []);
    const out = [];
    for (const x of list) { const s = await inheritanceSuggestion(pool, x.InheritanceId); if (s) out.push(s); }
    res.json({ items: out, canDecide: (await canAct(req, "Verifier", LAND_PAGE)) || (await canAct(req, "Legal Reviewer", LAND_PAGE)) });
  } catch (err) {
    console.error("[legal-diligence] inheritances:", err.message);
    res.status(500).json({ error: "Could not load" });
  }
});

// POST /inheritance/:id/decision { decision: "Accept suggestion" | "Keep recorded shares", remarks }
// Only a Verifier / Legal Reviewer. Accepting writes the suggested shares to the heirs; both need remarks.
router.post("/inheritance/:id/decision", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const iid = idOf(req.params.id);
  const decision = req.body?.decision;
  const remarks = txt(req.body?.remarks, 1000);
  if (!iid || !["Accept suggestion", "Keep recorded shares"].includes(decision)) return res.status(400).json({ error: "Invalid request" });
  if (!remarks) return res.status(400).json({ error: "Write the remarks (legal basis for the decision)" });
  const pool = getPool();
  try {
    if (!(await canAct(req, "Verifier", LAND_PAGE)) && !(await canAct(req, "Legal Reviewer", LAND_PAGE))) return res.status(403).json({ error: "Only a Verifier or Legal Reviewer can decide the shares" });
    const s = await inheritanceSuggestion(pool, iid);
    if (!s) return res.status(404).json({ error: "Inheritance not found" });
    if (decision === "Accept suggestion") {
      if (!s.result || s.result.lines.some((l) => l.suggestedPct == null)) return res.status(409).json({ error: "The suggestion is incomplete — some heirs have no rule; keep the recorded shares instead" });
      for (const l of s.result.lines) {
        await pool.request().input("H", sql.Int, l.id).input("P", sql.Decimal(9, 4), l.suggestedPct).input("U", sql.Int, req.user?.userId || null)
          .query("UPDATE dbo.LegalInheritanceHeir SET SharePct = @P, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE HeirId = @H");
      }
    }
    await pool.request().input("I", sql.Int, iid).input("D", sql.NVarChar(40), decision).input("R", sql.NVarChar(1000), remarks).input("U", sql.Int, req.user?.userId || null).query(
      "UPDATE dbo.LegalInheritance SET ShareDecision = @D, ShareDecisionRemarks = @R, ShareDecisionBy = @U, ShareDecisionAt = SYSUTCDATETIME() WHERE InheritanceId = @I");
    await writeAudit(pool, req, { action: "Heir shares decided", entityType: "Land Property", entityId: s.inheritance.LandId, landId: s.inheritance.LandId,
      oldValue: { shares: s.heirs.map((h) => ({ name: h.name, pct: h.recordedPct })) }, newValue: { decision, suggested: s.result?.lines.map((l) => ({ name: l.name, pct: l.suggestedPct })) }, remarks });
    res.json({ message: `${s.inheritance.DeceasedName}: ${decision.toLowerCase()}` });
  } catch (err) {
    console.error("[legal-diligence] share decision:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// Saved government-site fetches (evidence): what was fetched, from where, when, by whom, and how it compares.
const fetchReady = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalPortalFetchLog', 'U') AS t")).recordset[0].t;
router.get("/:landId/fetches", requirePageRight(LAND_PAGE, "view"), async (req, res) => {
  const id = idOf(req.params.landId);
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  try {
    const pool = getPool();
    if (!(await fetchReady(pool))) return res.json([]);
    res.json((await pool.request().input("Id", sql.Int, id).query(`
      SELECT FetchId, SiteName, SourceUrl, LEFT(Response, 4000) AS Response, MatchResult, Remarks, FetchedAt, (SELECT name FROM dbo.users WHERE id = f.FetchedBy) AS FetchedByName
      FROM dbo.LegalPortalFetchLog f WHERE LandId = @Id ORDER BY FetchedAt DESC`)).recordset);
  } catch (err) {
    console.error("[legal-diligence] fetches:", err.message);
    res.status(500).json({ error: "Could not load" });
  }
});
router.post("/:landId/fetches", requirePageRight(LAND_PAGE, "edit"), async (req, res) => {
  const id = idOf(req.params.landId);
  const b = req.body || {};
  if (!id) return res.status(400).json({ error: "Invalid land id" });
  if (!["Matches our records", "Partly matches", "Does not match", "Not compared"].includes(b.matchResult)) return res.status(400).json({ error: "Say how it compares with our records" });
  try {
    const pool = getPool();
    if (!(await fetchReady(pool))) return res.status(503).json({ error: "Not set up yet (migration 652)" });
    await pool.request().input("Id", sql.Int, id).input("L", sql.Int, idOf(b.linkId)).input("S", sql.NVarChar(200), txt(b.siteName, 200))
      .input("Url", sql.NVarChar(1000), /^https:\/\//i.test(String(b.sourceUrl || "")) ? txt(b.sourceUrl, 1000) : null)
      .input("Resp", sql.NVarChar(sql.MAX), String(b.response ?? "").slice(0, 200000) || null).input("M", sql.NVarChar(40), b.matchResult)
      .input("R", sql.NVarChar(1000), txt(b.remarks, 1000)).input("U", sql.Int, req.user?.userId || null).query(`
        INSERT INTO dbo.LegalPortalFetchLog (LandId, LinkId, SiteName, SourceUrl, Response, MatchResult, Remarks, FetchedBy)
        SELECT @Id, @L, @S, @Url, @Resp, @M, @R, @U WHERE EXISTS (SELECT 1 FROM dbo.LegalLand WHERE LandId = @Id AND IsActive = 1)`);
    await writeAudit(pool, req, { action: "Government site data saved", entityType: "Land Property", entityId: id, landId: id, newValue: { site: txt(b.siteName, 200), match: b.matchResult }, remarks: txt(b.remarks, 1000), documentRef: txt(b.sourceUrl, 200) });
    res.status(201).json({ message: "Saved as evidence on the land" });
  } catch (err) {
    console.error("[legal-diligence] save fetch:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
module.exports.diligenceGate = diligenceGate;
module.exports.processingBlockers = processingBlockers;
