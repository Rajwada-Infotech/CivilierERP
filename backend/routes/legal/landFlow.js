"use strict";
// Legal Flow Chart: find a land by any number it is known by (Land ID, Enquiry no., RS / LR Khatian or Dag), then show
// the whole land — where it stands in the pipeline, its details and records, and every recorded change (version history).
//   GET /search?q=     matching lands and enquiries
//   GET /land/:id      one land, complete
//   GET /enquiry/:id   an enquiry that is not a land yet (or its land, when it has one)
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");
const router = express.Router();
router.use(apiRateLimit);
const PAGE = "legal-land-master";

const idParam = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const parse = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return s; } };
const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

router.get("/search", requirePageRight(PAGE, "view"), async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  if (q.length < 1) return res.json({ results: [] });
  try {
    const pool = getPool();
    const like = `%${q.replace(/[%_[\]]/g, (c) => `[${c}]`)}%`;
    const r = await pool.request().input("Q", sql.NVarChar(80), like).input("Exact", sql.NVarChar(60), q).query(`
      WITH hits AS (
        SELECT l.LandId, l.EnquiryId, N'Land ID' AS MatchedOn, l.LandCode AS Value FROM dbo.LegalLand l WHERE l.LandCode LIKE @Q OR CAST(l.LandId AS NVARCHAR(20)) = @Exact
        UNION ALL SELECT l.LandId, l.EnquiryId, N'Land name', l.LandName FROM dbo.LegalLand l WHERE l.LandName LIKE @Q
        UNION ALL SELECT l.LandId, l.EnquiryId, N'RS Khatian', l.RsKhatianNo FROM dbo.LegalLand l WHERE l.RsKhatianNo LIKE @Q
        UNION ALL SELECT l.LandId, l.EnquiryId, N'RS Dag', l.RsDagNo FROM dbo.LegalLand l WHERE l.RsDagNo LIKE @Q
        UNION ALL SELECT l.LandId, l.EnquiryId, N'LR Khatian', l.LrKhatianNo FROM dbo.LegalLand l WHERE l.LrKhatianNo LIKE @Q
        UNION ALL SELECT l.LandId, l.EnquiryId, N'LR Dag', l.LrDagNo FROM dbo.LegalLand l WHERE l.LrDagNo LIKE @Q
        UNION ALL SELECT r.LandId, NULL, N'RS Khatian', r.RsKhatianNo FROM dbo.LegalLandRsRecord r WHERE r.IsActive = 1 AND r.RsKhatianNo LIKE @Q
        UNION ALL SELECT r.LandId, NULL, N'RS Dag', r.RsDagNo FROM dbo.LegalLandRsRecord r WHERE r.IsActive = 1 AND r.RsDagNo LIKE @Q
        UNION ALL SELECT r.LandId, NULL, N'LR Khatian', r.LrKhatianNo FROM dbo.LegalLandLrRecord r WHERE r.IsActive = 1 AND r.LrKhatianNo LIKE @Q
        UNION ALL SELECT r.LandId, NULL, N'LR Dag', r.LrDagNo FROM dbo.LegalLandLrRecord r WHERE r.IsActive = 1 AND r.LrDagNo LIKE @Q
        UNION ALL SELECT e.LandId, e.EnquiryId, N'Enquiry no.', e.EnquiryNo FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND (e.EnquiryNo LIKE @Q OR CAST(e.EnquiryId AS NVARCHAR(20)) = @Exact)
        UNION ALL SELECT e.LandId, e.EnquiryId, N'RS Khatian', e.RsKhatianNo FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND e.RsKhatianNo LIKE @Q
        UNION ALL SELECT e.LandId, e.EnquiryId, N'RS Dag', e.RsDagNo FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND e.RsDagNo LIKE @Q
        UNION ALL SELECT e.LandId, e.EnquiryId, N'LR Khatian', e.LrKhatianNo FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND e.LrKhatianNo LIKE @Q
        UNION ALL SELECT e.LandId, e.EnquiryId, N'LR Dag', e.LrDagNo FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND e.LrDagNo LIKE @Q
        UNION ALL SELECT e.LandId, x.EnquiryId, N'RS Khatian', x.RsKhatianNo FROM dbo.LegalEnquiryRsRecord x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId WHERE x.IsActive = 1 AND x.RsKhatianNo LIKE @Q
        UNION ALL SELECT e.LandId, x.EnquiryId, N'RS Dag', x.RsDagNo FROM dbo.LegalEnquiryRsRecord x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId WHERE x.IsActive = 1 AND x.RsDagNo LIKE @Q
        UNION ALL SELECT e.LandId, x.EnquiryId, N'LR Khatian', x.LrKhatianNo FROM dbo.LegalEnquiryLrRecord x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId WHERE x.IsActive = 1 AND x.LrKhatianNo LIKE @Q
        UNION ALL SELECT e.LandId, x.EnquiryId, N'LR Dag', x.LrDagNo FROM dbo.LegalEnquiryLrRecord x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId WHERE x.IsActive = 1 AND x.LrDagNo LIKE @Q
      ), keyed AS (
        SELECT COALESCE(h.LandId, l2.LandId) AS LandId, COALESCE(h.EnquiryId, l2.EnquiryId) AS EnquiryId, h.MatchedOn, h.Value
        FROM (SELECT DISTINCT * FROM hits) h LEFT JOIN dbo.LegalLand l2 ON l2.LandId = h.LandId
      )
      SELECT TOP 40 k.LandId, MAX(k.EnquiryId) AS EnquiryId,
             STRING_AGG(CONCAT(k.MatchedOn, N' ', k.Value), N' · ') AS Matched,
             MAX(l.LandCode) AS LandCode, MAX(l.LandName) AS LandName, MAX(l.WorkflowStatus) AS WorkflowStatus, MAX(l.ProjectId) AS LandProjectId,
             MAX(e.EnquiryNo) AS EnquiryNo, MAX(e.EnquiryStatus) AS EnquiryStatus, MAX(e.LandLocation) AS EnquiryLocation, MAX(e.ProjectId) AS EnquiryProjectId,
             MAX(m.MouzaName) AS MouzaName
      FROM keyed k
      LEFT JOIN dbo.LegalLand l ON l.LandId = k.LandId
      LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = COALESCE(k.EnquiryId, l.EnquiryId)
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = COALESCE(l.MouzaId, e.MouzaId)
      GROUP BY k.LandId, CASE WHEN k.LandId IS NULL THEN k.EnquiryId END
      ORDER BY MAX(l.LandCode), MAX(e.EnquiryNo)`);
    res.json({ results: r.recordset.map((x) => ({ ...x, ProjectId: x.LandProjectId ?? x.EnquiryProjectId ?? null })) });
  } catch (err) {
    console.error("[legal-flow] search:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

async function loadEnquiry(pool, enquiryId) {
  if (!enquiryId) return null;
  const e = (await pool.request().input("E", sql.Int, enquiryId).query(`
    SELECT e.*, m.MouzaName, d.DistrictName, u.UnitName AS AreaUnitName, s.Name AS SourceName, p.name AS ProjectName
    FROM dbo.LegalLandEnquiry e LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = e.AreaUnitId LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = e.EnquirySourceId
    LEFT JOIN dbo.enterprise p ON p.id = e.ProjectId WHERE e.EnquiryId = @E`)).recordset[0];
  if (!e) return null;
  const q = (text) => safe(async () => (await pool.request().input("E", sql.Int, enquiryId).query(text)).recordset, []);
  return {
    ...e,
    rsRecords: await q("SELECT x.*, m.MouzaName FROM dbo.LegalEnquiryRsRecord x LEFT JOIN dbo.LegalMouza m ON m.MouzaId = x.MouzaId WHERE x.EnquiryId = @E AND x.IsActive = 1 ORDER BY x.RsRecordId"),
    lrRecords: await q("SELECT x.*, m.MouzaName FROM dbo.LegalEnquiryLrRecord x LEFT JOIN dbo.LegalMouza m ON m.MouzaId = x.MouzaId WHERE x.EnquiryId = @E AND x.IsActive = 1 ORDER BY x.LrRecordId"),
    deedSearches: await q("SELECT SearchId, OfficeType, CalendarYear, Status, DueDate, DeedNo, DeedDate, Parties, RequestedAt, CompletedAt FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @E ORDER BY CalendarYear, SearchId"),
  };
}

async function auditTrail(pool, landId, enquiryId) {
  return safe(async () => (await pool.request().input("L", sql.Int, landId).input("E", sql.Int, enquiryId).query(`
    SELECT a.EventId, a.Action, a.EntityType, a.EntityId, a.OldValue, a.NewValue, a.Remarks, a.CreatedAt, a.UserId,
           COALESCE(u.name, u.email) AS UserName
    FROM dbo.LegalRecordAudit a LEFT JOIN dbo.users u ON u.id = a.UserId
    WHERE (@L IS NOT NULL AND a.LandId = @L) OR (@E IS NOT NULL AND a.EntityType LIKE N'%nquiry%' AND a.EntityId = @E)
    ORDER BY a.CreatedAt, a.EventId`)).recordset.map((a) => ({ ...a, OldValue: parse(a.OldValue), NewValue: parse(a.NewValue) })), []);
}

// The starting versions: the enquiry as first entered and the land as first registered, so every land has a v1
// (records loaded in bulk have no change entries). Recorded changes follow, oldest first.
const ENQ_KEYS = ["EnquiryNo", "EnquiryDate", "LandLocation", "MouzaName", "JLNo", "ApproxArea", "AreaUnitName", "ContactPerson", "ExpectedPrice", "RsKhatianNo", "RsDagNo", "LrKhatianNo", "LrDagNo"];
const LAND_KEYS = ["LandCode", "LandName", "ProjectName", "MouzaName", "DistrictName", "RsKhatianNo", "RsDagNo", "LrKhatianNo", "LrDagNo", "Area", "AreaUnitName", "EntryType", "LandStatus"];
const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row[k] != null && row[k] !== "").map((k) => [k, row[k]]));
function withBaseline(history, land, enquiry) {
  const base = [];
  if (enquiry) base.push({ EventId: -2, Action: "Enquiry created", EntityType: "LandEnquiry", EntityId: enquiry.EnquiryId, Remarks: null,
    CreatedAt: enquiry.CreatedAt || enquiry.EnquiryDate, UserName: null, OldValue: null, NewValue: pick(enquiry, ENQ_KEYS), baseline: true });
  if (land) base.push({ EventId: -1, Action: "Land registered", EntityType: "Land", EntityId: land.LandId, Remarks: land.EntryType || null,
    CreatedAt: land.CreatedAt, UserName: null, OldValue: enquiry ? pick(enquiry, ["RsKhatianNo", "RsDagNo", "LrKhatianNo", "LrDagNo"]) : null, NewValue: pick(land, LAND_KEYS), baseline: true });
  return [...base, ...history].sort((a, b) => new Date(a.CreatedAt || 0) - new Date(b.CreatedAt || 0));
}

/** The pipeline, step by step, from what the records say. */
function stages(land, enquiry, x) {
  const st = (key, label, state, date, note) => ({ key, label, state, date: date || null, note: note || null });
  const wf = land?.WorkflowStatus || "";
  const order = ["Draft (Verification Pending)", "Deed Process", "Deed Completed", "Deed Registration", "Registered"];
  const at = order.indexOf(wf);
  const searchesDone = (enquiry?.deedSearches || []).filter((s) => s.Status === "Completed" || s.CompletedAt).length;
  const searches = (enquiry?.deedSearches || []).length;
  const clearDone = x.clearances.filter((c) => c.Status === "Obtained").length;
  const clearAny = x.clearances.some((c) => c.Status && c.Status !== "Not Applied");
  return [
    st("enquiry", "Land Enquiry", enquiry ? "done" : land ? "skipped" : "pending", enquiry?.EnquiryDate, enquiry ? `${enquiry.EnquiryNo} · ${enquiry.EnquiryStatus || ""}` : land ? "Registered directly (no enquiry)" : null),
    st("deed-search", "Deed Registry Search", !searches ? (land ? "skipped" : "pending") : searchesDone === searches ? "done" : "current", null, searches ? `${searchesDone} / ${searches} searches done` : null),
    st("register", "Land Register", land ? "done" : enquiry ? "current" : "pending", land?.CreatedAt, land ? `${land.LandCode} · ${land.EntryType || ""}` : null),
    st("verification", "Verification (L1 / L2 / Final)", !land ? "pending" : land.FinalVerifiedAt || at >= 1 ? "done" : "current", land?.FinalVerifiedAt || land?.L2ApprovedAt || land?.L1ReviewedAt,
      land ? `L1 ${land.L1Status || "—"} · L2 ${land.L2Status || "—"}${land.FinalVerifiedAt ? " · Final verified" : ""}` : null),
    st("deed", "Deed Process", !land || at < 1 ? "pending" : land.DeedCompletedAt || at >= 2 ? "done" : "current", land?.DeedCompletedAt || land?.DeedTargetDate,
      land?.DeedTargetDate ? `Target ${new Date(land.DeedTargetDate).toISOString().slice(0, 10)}${land.DeedApprovalStatus ? ` · ${land.DeedApprovalStatus}` : ""}` : null),
    st("clearance", "LA & ULC Clearance", !land || at < 1 ? "pending" : clearDone === x.clearances.length && x.clearances.length ? "done" : clearAny ? "current" : "pending", null,
      x.clearances.length ? x.clearances.map((c) => `${c.Kind} ${c.Status || "Not Applied"}`).join(" · ") : null),
    st("registration", "Deed Registration", !land || at < 2 ? "pending" : wf === "Registered" || land.RegCompletedAt ? "done" : "current", land?.RegCompletedAt || land?.RegAppliedAt,
      land?.RegDeedNo ? `Deed no. ${land.RegDeedNo}` : land?.RegAppliedAt ? "Applied" : null),
    st("post", "Post-Registration (Mutation)", wf !== "Registered" ? "pending" : x.mutations.some((m) => /approved|complete/i.test(m.ApplicationStatus || "")) ? "done" : "current", null,
      x.mutations.length ? x.mutations.map((m) => m.ApplicationStatus).join(" · ") : null),
  ];
}

async function landState(pool, landId) {
  const land = (await pool.request().input("L", sql.Int, landId).query(`
    SELECT l.*, m.MouzaName, m.JLNo, d.DistrictName, u.UnitName AS AreaUnitName, p.name AS ProjectName, t.LandTypeName
    FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId LEFT JOIN dbo.enterprise p ON p.id = l.ProjectId
    LEFT JOIN dbo.LegalLandType t ON t.LandTypeId = l.LandTypeId
    WHERE l.LandId = @L`).catch(async () => pool.request().input("L", sql.Int, landId).query("SELECT l.* FROM dbo.LegalLand l WHERE l.LandId = @L"))).recordset[0];
  if (!land) return null;
  const q = (text) => safe(async () => (await pool.request().input("L", sql.Int, landId).query(text)).recordset, []);
  const x = {
    rsRecords: await q("SELECT r.*, m.MouzaName FROM dbo.LegalLandRsRecord r LEFT JOIN dbo.LegalMouza m ON m.MouzaId = r.MouzaId WHERE r.LandId = @L AND r.IsActive = 1 ORDER BY r.RsRecordId"),
    lrRecords: await q("SELECT r.*, m.MouzaName FROM dbo.LegalLandLrRecord r LEFT JOIN dbo.LegalMouza m ON m.MouzaId = r.MouzaId WHERE r.LandId = @L AND r.IsActive = 1 ORDER BY r.LrRecordId"),
    owners: await q("SELECT OwnerName, OwnerGuardian, SharePct, ValidFrom, ValidTo, VerificationStatus FROM dbo.LegalOwnershipRecord WHERE LandId = @L AND IsActive = 1 ORDER BY ValidFrom, RecordId"),
    transfers: await q("SELECT EventId, EventDate, PreviousOwnerName, NewOwnerName, DeedNo, TransferSharePct, VerificationStatus FROM dbo.LegalOwnershipEvent WHERE LandId = @L AND IsActive = 1 ORDER BY EventDate, EventId"),
    documents: await q(`SELECT d.DocumentId, d.DocumentCode, d.Title, d.DocumentNo, d.DocumentDate, d.CurrentVersionNo, d.RelatedSection, t.DocTypeName, d.UpdatedAt, d.CreatedAt,
                               v.FileId, f.FileName, v.ReviewStatus
                        FROM dbo.LegalLandDocument d LEFT JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId
                        LEFT JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
                        LEFT JOIN dbo.LegalMasterFile f ON f.FileId = v.FileId
                        WHERE d.LandId = @L AND d.IsActive = 1 ORDER BY d.CreatedAt`),
    clearances: await q("SELECT Kind, Status, AppliedOn, ApplicationNo, ObtainedOn, CertificateNo FROM dbo.LegalLandClearance WHERE LandId = @L ORDER BY Kind"),
    mutations: await q("SELECT MutationId, ApplicationNo, ApplicationDate, ApplicationStatus, PreviousKhatian, OrderNo, OrderDate FROM dbo.LegalMutation WHERE LandId = @L AND IsActive = 1 ORDER BY ApplicationDate"),
  };
  const enquiryId = land.EnquiryId || (await safe(async () => (await pool.request().input("L", sql.Int, landId).query("SELECT TOP 1 EnquiryId FROM dbo.LegalLandEnquiry WHERE LandId = @L")).recordset[0]?.EnquiryId, null));
  const enquiry = await loadEnquiry(pool, enquiryId);
  return { land, enquiry, enquiryId, ...x };
}

// ── Versions ─────────────────────────────────────────────────────────────────
// One version = one full cycle that ends in approval. v1: enquiry → land register → verification, approved when the land
// is verified and sent to Deed Process. Any change after that opens the next version, approved when a verifier
// re-verifies the changes. At each approval the whole land is saved (LegalLandRegisterSnapshot, Remarks "Version N …"),
// so every version can be shown as it was and compared with the one before.
const APPROVAL_ACTIONS = new Set(["Land verified — sent to Deed Process", "Deed changes re-verified"]);
const META = /^(IsActive|CreatedBy|CreatedAt|UpdatedBy|UpdatedAt|VerifiedBy|VerifiedAt|DocFileId|LandId|EnquiryId)$/;
const LAND_SKIP = /^(L1|L2|Final|Deed|Reg|Igr|Workflow|Verification|IsOnHold|IsCancelled|Cancel|Checklist|CreatedBy|CreatedAt|UpdatedBy|UpdatedAt|IsActive)|FileId$|Id$/;
const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !META.test(k) && v != null && v !== "")));

function snapshotOf(st) {
  const land = Object.fromEntries(Object.entries(st.land).filter(([k, v]) => (!LAND_SKIP.test(k) || k === "LandCode") && v != null && v !== ""));
  return {
    land,
    rsRecords: clean(st.rsRecords.map(({ RsRecordId, ...r }) => r)),
    lrRecords: clean(st.lrRecords.map(({ LrRecordId, ...r }) => r)),
    owners: clean(st.owners),
    documents: clean(st.documents.map(({ DocumentId, UpdatedAt, FileId, FileName, ReviewStatus, ...r }) => r)),
    clearances: clean(st.clearances),
    mutations: clean(st.mutations.map(({ MutationId, ...r }) => r)),
  };
}

/** Called after an approval is recorded: saves the land as this version. */
async function snapshotVersion(pool, landId, userId, action, amendment = null) {
  const st = await landState(pool, landId);
  if (!st) return;
  const n = (await pool.request().input("L", sql.Int, landId)
    .query("SELECT COUNT(*) AS n FROM dbo.LegalLandRegisterSnapshot WHERE LandId = @L AND Remarks LIKE N'Version %'")).recordset[0].n + 1;
  const checklist = await checklistNow(pool, landId);
  await pool.request().input("L", sql.Int, landId).input("J", sql.NVarChar(sql.MAX), JSON.stringify({ ...snapshotOf(st), checklist, ...(amendment ? { amendment } : {}) }))
    .input("R", sql.NVarChar(500), `Version ${n} approved — ${action}`).input("U", sql.Int, userId || null)
    .query("INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy) VALUES (@L, @J, @R, @U)");
  return n;
}

/** The land's document checklist as it stands now: each required / optional document and its state. */
async function checklistNow(pool, landId) {
  try {
    const r = await require("./landDocuments").requiredDocuments(pool, landId);
    return { template: r.templateName, items: r.items.map((i) => ({ doc: i.docTypeName, requirement: i.requirement, stage: i.stage, state: i.state })) };
  } catch { return null; }
}

/** Document files uploaded in a window (a version's period), oldest first. */
async function uploadsBetween(pool, landId, from, to) {
  return safe(async () => (await pool.request().input("L", sql.Int, landId).input("F", sql.DateTime2, from ? new Date(from) : null).input("T", sql.DateTime2, to ? new Date(to) : null).query(`
    SELECT d.DocumentCode, d.Title, t.DocTypeName, v.VersionNo, v.UploadedAt, v.ReviewStatus, u.name AS UploadedBy, f.FileName, v.FileId
    FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalLandDocument d ON d.DocumentId = v.DocumentId
    LEFT JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId LEFT JOIN dbo.users u ON u.id = v.UploadedBy
    LEFT JOIN dbo.LegalMasterFile f ON f.FileId = v.FileId
    WHERE d.LandId = @L AND (@F IS NULL OR v.UploadedAt > @F) AND (@T IS NULL OR v.UploadedAt <= @T)
    ORDER BY v.UploadedAt, d.DocumentCode`)).recordset, []);
}

async function buildVersions(pool, st, history) {
  const snaps = await safe(async () => (await pool.request().input("L", sql.Int, st.land.LandId).query(`
    SELECT s.SnapshotId, s.SnapshotJson, s.Remarks, s.CreatedAt, u.name AS ByName
    FROM dbo.LegalLandRegisterSnapshot s LEFT JOIN dbo.users u ON u.id = s.CreatedBy
    WHERE s.LandId = @L AND s.Remarks LIKE N'Version %' ORDER BY s.CreatedAt, s.SnapshotId`)).recordset, []);
  const current = snapshotOf(st);
  const approvals = snaps.map((s) => ({ at: new Date(s.CreatedAt), by: s.ByName, snapshot: parse(s.SnapshotJson), approx: false, remarks: s.Remarks }));
  // Lands approved before versions were kept: v1 approved at final verification, its data shown as it is now.
  if (!approvals.length && (st.land.FinalVerifiedAt || ["Deed Process", "Deed Completed", "Deed Registration", "Registered"].includes(st.land.WorkflowStatus))) {
    const at = st.land.FinalVerifiedAt || st.land.L2ApprovedAt || st.land.UpdatedAt || st.land.CreatedAt;
    approvals.push({ at: new Date(at), by: null, snapshot: current, approx: true, remarks: "Version 1 approved — verified (before versions were kept)" });
    if (st.land.DeedReverifiedAt && new Date(st.land.DeedReverifiedAt) > new Date(at)) approvals.push({ at: new Date(st.land.DeedReverifiedAt), by: null, snapshot: current, approx: true, remarks: "Version 2 approved — re-verified" });
  }
  const versions = [];
  let prevAt = null;
  approvals.forEach((a, i) => {
    const events = history.filter((h) => (h.baseline ? i === 0 : (() => { const t = new Date(h.CreatedAt || 0); return (!prevAt || t > prevAt) && t <= a.at; })()));
    const am = a.snapshot && typeof a.snapshot === "object" ? a.snapshot.amendment || null : null;
    versions.push({ no: i + 1, status: am ? `Approved — amendment ${am.no} after registration` : "Approved", afterRegistration: !!am, amendment: am, startedAt: events[0]?.CreatedAt || prevAt || st.land.CreatedAt, approvedAt: a.at, approvedBy: a.by,
      approval: a.remarks?.replace(/^Version \d+ approved — /, "") || null, snapshot: a.snapshot, approxSnapshot: a.approx, events });
    prevAt = a.at;
  });
  const open = history.filter((h) => (versions.length ? !h.baseline && new Date(h.CreatedAt || 0) > prevAt : true));
  const changedSince = !!st.land.DeedChangedAt;
  const pending = await safe(async () => (await pool.request().input("L", sql.Int, st.land.LandId).query(`
    SELECT TOP 1 a.AmendmentId, a.AmendmentNo, a.AmendType, a.Reason, a.ReferenceNo, a.ChangesJson, a.RequestedAt, u.name AS RequestedByName
    FROM dbo.LegalLandAmendment a LEFT JOIN dbo.users u ON u.id = a.RequestedBy WHERE a.LandId = @L AND a.Status = N'Pending'`)).recordset[0] || null, null);
  if (!versions.length || open.length || changedSince || pending) {
    versions.push({ no: versions.length + 1, afterRegistration: !!pending || st.land.WorkflowStatus === "Registered" && versions.length > 0 && open.some((e) => /Amendment/.test(e.Action)),
      amendment: pending ? { no: pending.AmendmentNo, type: pending.AmendType, reason: pending.Reason, referenceNo: pending.ReferenceNo, requestedBy: pending.RequestedByName, changes: parse(pending.ChangesJson), pending: true, id: pending.AmendmentId } : null,
      status: pending ? `Amendment ${pending.AmendmentNo} requested — waiting for approval` : versions.length ? (changedSince ? "Changed — waiting for re-verification" : "Open") : "In progress — not approved yet",
      startedAt: open[0]?.CreatedAt || prevAt || st.land.CreatedAt, approvedAt: null, approvedBy: null, approval: null, snapshot: current, approxSnapshot: false, events: open });
  }
  // Documents of each version: what was uploaded in its period, and the checklist (saved at approval; now for the open one).
  // A document "belongs" to the version whose saved record first has it at that file version.
  const now = await checklistNow(pool, st.land.LandId);
  const all = await uploadsBetween(pool, st.land.LandId, null, null);
  const key = (code, no) => `${code}#${no}`;
  const info = new Map(all.map((u) => [key(u.DocumentCode, u.VersionNo), u]));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i];
    const docs = (v.snapshot && typeof v.snapshot === "object" ? v.snapshot.documents : null) || [];
    let uploads;
    if (docs.length || v.snapshot) {
      uploads = docs.filter((d) => !seen.has(key(d.DocumentCode, d.CurrentVersionNo)))
        .map((d) => info.get(key(d.DocumentCode, d.CurrentVersionNo)) || { DocumentCode: d.DocumentCode, Title: d.Title, DocTypeName: d.DocTypeName, VersionNo: d.CurrentVersionNo });
      docs.forEach((d) => seen.add(key(d.DocumentCode, d.CurrentVersionNo)));
    } else {
      uploads = await uploadsBetween(pool, st.land.LandId, i === 0 ? null : versions[i - 1].approvedAt, v.approvedAt);
    }
    const saved = v.snapshot && typeof v.snapshot === "object" && !v.approxSnapshot ? v.snapshot.checklist : null;
    out.push({ ...v, flow: versionFlow(v, i, st), uploads, checklist: saved || now, checklistNow: !saved });
  }
  return out;
}

/** The steps of one version: the full pipeline for v1, change → re-verification → approval for later ones. */
function versionFlow(v, i, st) {
  const ok = (b) => (b ? "done" : "pending");
  if (i === 0) {
    const has = (re) => v.events.some((e) => re.test(`${e.Action} ${e.EntityType}`));
    return [
      { label: "Enquiry", state: st.enquiry ? "done" : "skipped", date: st.enquiry?.EnquiryDate || null },
      { label: "Deed registry search", state: st.enquiry?.deedSearches?.length ? "done" : "skipped", date: null },
      { label: "Land register", state: "done", date: st.land.CreatedAt },
      { label: "RS / LR records & documents", state: ok(v.snapshot?.rsRecords?.length || v.snapshot?.lrRecords?.length || has(/record|document/i)), date: null },
      { label: "Verification (L1 / L2)", state: v.approvedAt ? "done" : st.land.L1Status && st.land.L1Status !== "Pending" ? "current" : "pending", date: st.land.L2ApprovedAt || st.land.L1ReviewedAt || null },
      { label: "Approved", state: v.approvedAt ? "done" : "pending", date: v.approvedAt },
    ];
  }
  if (v.afterRegistration) {
    return [
      { label: "Registered land", state: "done", date: st.land.RegCompletedAt || null },
      { label: "Amendment requested", state: "done", date: v.events.find((e) => e.Action === "Amendment requested")?.CreatedAt || v.startedAt },
      { label: "Amendment approval", state: v.approvedAt ? "done" : "current", date: v.approvedAt },
      { label: "Applied — no re-registration", state: v.approvedAt ? "done" : "pending", date: v.approvedAt },
    ];
  }
  return [
    { label: "Changes made", state: v.events.length ? "done" : "pending", date: v.events[0]?.CreatedAt || v.startedAt },
    { label: "Re-verification", state: v.approvedAt ? "done" : v.events.length ? "current" : "pending", date: null },
    { label: "Approved", state: v.approvedAt ? "done" : "pending", date: v.approvedAt },
  ];
}

async function loadLand(pool, landId) {
  const st = await landState(pool, landId);
  if (!st) return null;
  const { enquiryId, ...x } = st;
  const history = withBaseline(await auditTrail(pool, landId, enquiryId || null), st.land, st.enquiry);
  return { ...x, stages: stages(st.land, st.enquiry, st), history, versions: await buildVersions(pool, st, history) };
}

router.get("/land/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  try {
    const out = await loadLand(getPool(), id);
    if (!out) return res.status(404).json({ error: "Land not found" });
    res.json(out);
  } catch (err) {
    console.error("[legal-flow] land:", err.message);
    res.status(500).json({ error: "Could not load the land" });
  }
});

// GET /land/:id/version/:no/pdf | zip — download one version: a PDF summary, or a ZIP with the PDF and all its documents.
router.get("/land/:id/version/:no/:kind", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id), no = idParam(req.params.no);
  if (!id || !no || !["pdf", "zip"].includes(req.params.kind)) return res.status(400).json({ error: "Invalid land, version or file type" });
  try {
    const pool = getPool();
    const data = await loadLand(pool, id);
    if (!data) return res.status(404).json({ error: "Land not found" });
    const v = data.versions.find((x) => x.no === no);
    if (!v) return res.status(404).json({ error: "Version not found" });
    const prev = data.versions.find((x) => x.no === no - 1) || null;
    const exp = require("../../services/legalVersionExport");
    const base = `${exp.fileSafe(data.land.LandCode)} - Version ${no}`;
    const buf = req.params.kind === "pdf" ? await exp.pdfBuffer(data, v, prev) : await exp.zipBuffer(pool, data, v, prev);
    res.setHeader("Content-Type", req.params.kind === "pdf" ? "application/pdf" : "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(base)}.${req.params.kind}"; filename*=UTF-8''${encodeURIComponent(base)}.${req.params.kind}`);
    res.send(buf);
  } catch (err) {
    console.error("[legal-flow] version download:", err.message);
    res.status(500).json({ error: "Could not prepare the download" });
  }
});

router.get("/enquiry/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid enquiry" });
  try {
    const pool = getPool();
    const enquiry = await loadEnquiry(pool, id);
    if (!enquiry) return res.status(404).json({ error: "Enquiry not found" });
    if (enquiry.LandId) return res.json(await loadLand(pool, enquiry.LandId));
    const empty = { rsRecords: [], lrRecords: [], owners: [], transfers: [], documents: [], clearances: [], mutations: [] };
    const history = withBaseline(await auditTrail(pool, null, id), null, enquiry);
    res.json({ land: null, enquiry, ...empty, stages: stages(null, enquiry, empty), history,
      versions: [{ no: 1, status: "In progress — not a land yet", startedAt: enquiry.CreatedAt || enquiry.EnquiryDate, approvedAt: null, approvedBy: null, approval: null,
        snapshot: null, approxSnapshot: false, events: history, flow: [{ label: "Enquiry", state: "done", date: enquiry.EnquiryDate }, { label: "Land register", state: "pending", date: null }, { label: "Verification", state: "pending", date: null }, { label: "Approved", state: "pending", date: null }] }] });
  } catch (err) {
    console.error("[legal-flow] enquiry:", err.message);
    res.status(500).json({ error: "Could not load the enquiry" });
  }
});

module.exports = router;
module.exports.snapshotVersion = snapshotVersion;
module.exports.APPROVAL_ACTIONS = APPROVAL_ACTIONS;
