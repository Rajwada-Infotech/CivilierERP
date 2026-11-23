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
// Project access (User / Role Project Access): a restricted user reaches only lands / enquiries of their projects.
const projectGuard = require("./projectGuard");
router.use(async (req, _res, next) => { try { req.legalScope = await projectGuard.getProjectScope(req.user); } catch { /* unrestricted */ } next(); });
router.param("id", projectGuard.landParam("auto"));
const PAGE = "legal-land-master";

const idParam = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const parse = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return s; } };
const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

// GET /lands — every active land with its RS / LR numbers (Land Flowchart's land tabs; filtered by project on the page).
router.get("/lands", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT LandId, LandCode, LandName, ProjectId, WorkflowStatus, RsKhatianNo, RsDagNo, LrKhatianNo, LrDagNo
      FROM dbo.LegalLand WHERE IsActive = 1 AND ISNULL(IsCancelled, 0) = 0 ORDER BY LandCode`);
    res.json({ lands: await projectGuard.filterRows(req, r.recordset) });
  } catch (err) {
    console.error("[legal-flow] lands:", err.message);
    res.status(500).json({ error: "Could not load the lands" });
  }
});

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
    res.json({ results: await projectGuard.filterRows(req, r.recordset.map((x) => ({ ...x, ProjectId: x.LandProjectId ?? x.EnquiryProjectId ?? null }))) });
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
  const clearDone = x.clearances.filter((c) => ["Approved", "Obtained", "Not Applicable"].includes(c.Status)).length;
  const clearAny = x.clearances.some((c) => c.Status && c.Status !== "Not Applied");
  return [
    st("enquiry", "Land Enquiry", enquiry ? "done" : land ? "skipped" : "pending", enquiry?.EnquiryDate, enquiry ? `${enquiry.EnquiryNo} · ${enquiry.EnquiryStatus || ""}` : land ? "Registered directly (no enquiry)" : null),
    st("deed-search", "Deed Registry Search", !searches ? (land ? "skipped" : "pending") : searchesDone === searches ? "done" : "current", null, searches ? `${searchesDone} / ${searches} searches done` : null),
    st("register", "Land Register", land ? "done" : enquiry ? "current" : "pending", land?.CreatedAt, land ? `${land.LandCode} · ${land.EntryType || ""}` : null),
    st("verification", "Verification & approval", !land ? "pending" : land.FinalVerifiedAt || at >= 1 ? "done" : "current", land?.FinalVerifiedAt || land?.L2ApprovedAt || land?.L1ReviewedAt,
      land ? `Approval ${land.L2Status === "Approved" ? "Approved" : land.L1Status || "—"}${land.FinalVerifiedAt ? " · Final verified" : ""}` : null),
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
// Since migration 701 a version is made only when an Approver approves a land review (see the Land review section below).
// decide() saves the version itself (it needs to know about an open amendment).
const APPROVAL_ACTIONS = new Set([]);
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
/** The land's full record as a version snapshot (JSON) — built outside any transaction. */
async function buildSnapshot(pool, landId, amendment = null) {
  const st = await landState(pool, landId);
  if (!st) return null;
  const checklist = await checklistNow(pool, landId);
  const entry = await entrySections(pool, landId, st).catch(() => null);
  const json = JSON.stringify({ ...snapshotOf(st), checklist, entry, ...(amendment ? { amendment } : {}) });
  return { json, entry, hash: sha256(json) };
}
const sha256 = (x) => require("crypto").createHash("sha256").update(String(x)).digest("hex");

/** Freeze a built snapshot as the next version (inside the caller's transaction when `conn` is one). Stores its SHA-256. */
async function insertSnapshot(conn, landId, snap, userId, action) {
  const n = (await conn.request().input("L", sql.Int, landId)
    .query("SELECT COUNT(*) AS n FROM dbo.LegalLandRegisterSnapshot WITH (UPDLOCK, HOLDLOCK) WHERE LandId = @L AND Remarks LIKE N'Version %'")).recordset[0].n + 1;
  const hashCol = !!(await conn.request().query("SELECT COL_LENGTH('dbo.LegalLandRegisterSnapshot', 'SnapshotHash') AS c")).recordset[0].c;
  await conn.request().input("L", sql.Int, landId).input("J", sql.NVarChar(sql.MAX), snap.json).input("H", sql.NVarChar(64), snap.hash)
    .input("R", sql.NVarChar(500), `Version ${n} approved — ${action}`).input("U", sql.Int, userId || null)
    .query(`INSERT INTO dbo.LegalLandRegisterSnapshot (LandId, SnapshotJson, Remarks, CreatedBy${hashCol ? ", SnapshotHash" : ""}) VALUES (@L, @J, @R, @U${hashCol ? ", @H" : ""})`);
  return n;
}

async function snapshotVersion(pool, landId, userId, action, amendment = null) {
  const snap = await buildSnapshot(pool, landId, amendment);
  if (!snap) return;
  return insertSnapshot(pool, landId, snap, userId, action);
}

/** Every approval decision is its own row (migration 712), never edited or deleted. */
async function logDecision(conn, landId, stage, action, { versionNo = null, reason = null, userId = null } = {}) {
  await conn.request().input("L", sql.Int, landId).input("S", sql.NVarChar(30), stage).input("A", sql.NVarChar(30), action).input("V", sql.Int, versionNo)
    .input("R", sql.NVarChar(1000), reason ? String(reason).slice(0, 1000) : null).input("U", sql.Int, userId)
    .query("IF OBJECT_ID('dbo.LegalLandDecision','U') IS NOT NULL INSERT INTO dbo.LegalLandDecision (LandId, Stage, Action, VersionNo, Reason, DecidedBy) VALUES (@L, @S, @A, @V, @R, @U)")
    .catch((e) => console.error("[legal-flow] decision log:", e.message));
}

/**
 * Migration 704 (live presentation data) inserts versions as placeholders — SnapshotJson {"rebuild":true,"exclude":[[master,id]…]}
 * — because a version's record is built here, not in SQL. The first time the land is opened each placeholder is
 * filled with the land as it now is, leaving out the rows named in "exclude" (entries added after that version).
 * Review ticks saved as hash "*" are fixed to the section as it now is in the same way.
 */
async function healPlaceholders(pool, landId) {
  const ph = await safe(async () => (await pool.request().input("L", sql.Int, landId).query(
    "SELECT SnapshotId, SnapshotJson FROM dbo.LegalLandRegisterSnapshot WHERE LandId = @L AND SnapshotJson LIKE N'{\"rebuild\":true%' ORDER BY SnapshotId")).recordset, []);
  if (ph.length) {
    const st = await landState(pool, landId);
    const checklist = await checklistNow(pool, landId);
    const entry = await entrySections(pool, landId).catch(() => null);
    for (const p of ph) {
      const ex = new Set(((parse(p.SnapshotJson) || {}).exclude || []).map(([m, id]) => `${m}#${id}`));
      // ["master", id] leaves out one entry; ["master", "*"] every entry of that kind (e.g. the registration, before it).
      const e = entry ? entry.map((sec) => ({ ...sec, records: sec.records.filter((r) => !ex.has(`${r.master}#${r.id}`) && !ex.has(`${r.master}#*`)) })).filter((sec) => sec.key !== "registration" || sec.records.length) : null;
      const json = JSON.stringify({ ...snapshotOf(st), checklist, entry: e });
      await pool.request().input("Id", sql.Int, p.SnapshotId).input("J", sql.NVarChar(sql.MAX), json).input("H", sql.NVarChar(64), sha256(json))
        .query("IF COL_LENGTH('dbo.LegalLandRegisterSnapshot', 'SnapshotHash') IS NOT NULL EXEC sp_executesql N'UPDATE dbo.LegalLandRegisterSnapshot SET SnapshotJson = @J, SnapshotHash = @H WHERE SnapshotId = @Id', N'@J NVARCHAR(MAX), @H NVARCHAR(64), @Id INT', @J = @J, @H = @H, @Id = @Id; ELSE UPDATE dbo.LegalLandRegisterSnapshot SET SnapshotJson = @J WHERE SnapshotId = @Id");
    }
  }
  const rv = await safe(async () => (await pool.request().input("L", sql.Int, landId).query(
    "SELECT ReviewId, ChecksJson FROM dbo.LegalLandReview WHERE LandId = @L AND (ChecksJson LIKE N'%\"hash\":\"*\"%' OR ChecksJson LIKE N'%\"auto\":%')")).recordset, []);
  if (rv.length) {
    const entry = await entrySections(pool, landId);
    const hashes = Object.fromEntries(entry.map((sec) => [sec.key, sectionHash(sec)]));
    const secOf = Object.fromEntries(entry.map((sec) => [sec.key, sec]));
    for (const r of rv) {
      const c = parse(r.ChecksJson) || {};
      // "*all" ticks every section (a submitted demo review).
      if (c["*all"]) { const by = c["*all"]; delete c["*all"]; for (const k of Object.keys(hashes)) c[k] = { hash: hashes[k], by: by.by, at: by.at }; }
      for (const k of Object.keys(c)) if (c[k]?.hash === "*") { if (hashes[k]) c[k].hash = hashes[k]; else delete c[k]; }
      // { auto: "ok", bad: [field names], pending: [field names] } → field-by-field ✓ / ✗ on the section as it now is.
      for (const k of Object.keys(c)) if (c[k]?.auto) {
        const sec = secOf[k];
        if (!sec) { delete c[k]; continue; }
        const bad = new Set(c[k].bad || []), pend = new Set(c[k].pending || []);
        const fields = {};
        for (const rec of sec.records) for (const fd of rec.fields) {
          if (pend.has(fd.n) || !needsCheck(fd)) continue;
          fields[`${rec.master}#${rec.id}#${fd.n}`] = { d: bad.has(fd.n) ? "bad" : fd.v == null || fd.v === "" ? "na" : "ok", v: fd.v ?? null };
        }
        c[k] = { fields, ...(sec.records.length ? {} : { empty: true }), by: c[k].by, at: c[k].at };
      }
      await pool.request().input("Id", sql.Int, r.ReviewId).input("J", sql.NVarChar(sql.MAX), JSON.stringify(c)).query("UPDATE dbo.LegalLandReview SET ChecksJson = @J WHERE ReviewId = @Id");
    }
  }
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
  const hashCol = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLandRegisterSnapshot', 'SnapshotHash') AS c")).recordset[0].c;
  const snaps = await safe(async () => (await pool.request().input("L", sql.Int, st.land.LandId).query(`
    SELECT s.SnapshotId, s.SnapshotJson, s.Remarks, s.CreatedAt, u.name AS ByName,
           ${hashCol ? "s.SnapshotHash" : "CAST(NULL AS NVARCHAR(64))"} AS SnapshotHash
    FROM dbo.LegalLandRegisterSnapshot s LEFT JOIN dbo.users u ON u.id = s.CreatedBy
    WHERE s.LandId = @L AND s.Remarks LIKE N'Version %' ORDER BY s.CreatedAt, s.SnapshotId`)).recordset, []);
  const current = snapshotOf(st);
  // Integrity: the stored SHA-256 of each frozen version is checked against its snapshot ("ok"; "altered" if it differs).
  const approvals = snaps.map((s) => ({ at: new Date(s.CreatedAt), by: s.ByName, snapshot: parse(s.SnapshotJson), approx: false, remarks: s.Remarks,
    integrity: s.SnapshotHash ? (sha256(s.SnapshotJson) === s.SnapshotHash ? "ok" : "altered") : null, hash: s.SnapshotHash || null }));
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
      approval: a.remarks?.replace(/^Version \d+ approved — /, "") || null, snapshot: a.snapshot, approxSnapshot: a.approx, events, integrity: a.integrity ?? null, hash: a.hash ?? null });
    prevAt = a.at;
  });
  // Workflow steps (review, deed, registration, amendment decisions) are not changes to the land's data.
  const WORKFLOW = /^(Land review|Land verified|Deed |Applied for deed|Amendment|Registry search|Due diligence|Risk assessed|Legal review|Court case cleared|Post-registration|Stamp duty)/;
  const open = history.filter((h) => !WORKFLOW.test(h.Action || "") && (versions.length ? !h.baseline && new Date(h.CreatedAt || 0) > prevAt : true));
  const changedSince = !!st.land.DeedChangedAt;
  const pending = await safe(async () => (await pool.request().input("L", sql.Int, st.land.LandId).query(`
    SELECT TOP 1 a.AmendmentId, a.AmendmentNo, a.AmendType, a.Reason, a.ReferenceNo, a.ChangesJson, a.RequestedAt, u.name AS RequestedByName
    FROM dbo.LegalLandAmendment a LEFT JOIN dbo.users u ON u.id = a.RequestedBy WHERE a.LandId = @L AND a.Status = N'Pending'`)).recordset[0] || null, null);
  // An open (next) version exists only when the land's data differs from the last saved version — not for a request,
  // a review or a workflow step alone (a waiting amendment shows in its own box until its edits are entered).
  const nowEntry = await entrySections(pool, st.land.LandId, st).catch(() => null);
  const lastEntry = approvals.length ? approvals[approvals.length - 1].snapshot?.entry : null;
  const strip = (e) => (e || []).filter((x) => x.key !== "registration");
  const differs = !lastEntry || !nowEntry ? open.length > 0 || changedSince
    : JSON.stringify(strip(nowEntry).map((x) => [x.key, sectionHash(x)])) !== JSON.stringify(strip(lastEntry).map((x) => [x.key, sectionHash(x)]));
  if (!versions.length || differs) {
    versions.push({ no: versions.length + 1, afterRegistration: !!pending || st.land.WorkflowStatus === "Registered" && versions.length > 0 && open.some((e) => /Amendment/.test(e.Action)),
      amendment: pending ? { no: pending.AmendmentNo, type: pending.AmendType, reason: pending.Reason, referenceNo: pending.ReferenceNo, requestedBy: pending.RequestedByName, changes: parse(pending.ChangesJson), pending: true, id: pending.AmendmentId } : null,
      status: pending ? `Amendment ${pending.AmendmentNo} requested — waiting for approval` : versions.length ? (changedSince ? "Changed — waiting for re-verification" : "Open") : "In progress — not approved yet",
      startedAt: open[0]?.CreatedAt || prevAt || st.land.CreatedAt, approvedAt: null, approvedBy: null, approval: null, snapshot: { ...current, entry: nowEntry }, approxSnapshot: false, events: open });
  }
  // Documents of each version: what was uploaded in its period, and the checklist (saved at approval; now for the open one).
  // A document "belongs" to the version whose saved record first has it at that file version.
  const now = await checklistNow(pool, st.land.LandId);
  const all = await uploadsBetween(pool, st.land.LandId, null, null);
  const key = (code, no) => `${code}#${no}`;
  const info = new Map(all.map((u) => [key(u.DocumentCode, u.VersionNo), u]));
  const seen = new Set();
  const out = [];
  const reviews = await safe(async () => (await pool.request().input("L", sql.Int, st.land.LandId).query(`
    SELECT r.VersionNo, r.Status, r.ChecksJson, u.name AS VerifierName FROM dbo.LegalLandReview r LEFT JOIN dbo.users u ON u.id = r.SubmittedBy
    WHERE r.LandId = @L ORDER BY r.ReviewId DESC`)).recordset, []);
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
    // Which sections the verifier ticked for this version (its approved review; the open review for the open version).
    const rv = reviews.find((x) => x.VersionNo === v.no && (v.approvedAt ? x.Status === "Approved" : ["Verifying", "Submitted"].includes(x.Status)));
    const cj = rv ? parse(rv.ChecksJson) || {} : {};
    const ticks = Object.keys(cj).filter((k) => !k.startsWith("*"));
    // Field decisions of this version (✓ / ✗), keyed master#id#field; an older whole-section tick means ✓ on all its fields.
    const fieldDecisions = {};
    for (const k of ticks) {
      if (cj[k]?.fields) for (const [fk, x] of Object.entries(cj[k].fields)) fieldDecisions[fk] = x.d;
      // (an old whole-section tick gives no field marks)
    }
    out.push({ ...v, flow: versionFlow(v, i, st), uploads, checklist: saved || now, checklistNow: !saved,
      verifiedSections: ticks, verifiedBy: rv?.VerifierName ?? null, fieldDecisions });
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
      { label: "Verification & approval", state: v.approvedAt ? "done" : st.land.L1Status && st.land.L1Status !== "Pending" ? "current" : "pending", date: st.land.L2ApprovedAt || st.land.L1ReviewedAt || null },
      { label: "Approved", state: v.approvedAt ? "done" : "pending", date: v.approvedAt },
    ];
  }
  if (/^Deed registered/.test(v.approval || "")) {
    return [
      { label: "Deed approved", state: "done", date: st.land.L2ApprovedAt || null },
      { label: "Applied for registration", state: "done", date: st.land.RegAppliedAt || null },
      { label: "Registered", state: "done", date: v.approvedAt },
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
    { label: "Entries / edits made", state: v.events.length ? "done" : "pending", date: v.events[0]?.CreatedAt || v.startedAt },
    { label: "Verified in Land Flowchart", state: v.approvedAt ? "done" : v.events.length ? "current" : "pending", date: null },
    { label: "Approved", state: v.approvedAt ? "done" : "pending", date: v.approvedAt },
  ];
}

async function loadLand(pool, landId) {
  await healPlaceholders(pool, landId);
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

// ── Land review (Land Flowchart) ─────────────────────────────────────────────
// Every version goes through one review: the verifier opens the land, goes through it step by step (basic information,
// RS records, LR records, ownership history, documents, …), ticks each step, and submits; an Approver then approves and
// the land is saved as the next version. The first review covers every step; later reviews only the steps that changed
// since the last approved version. A tick holds for the step as it was when ticked — if the step changes again, the tick
// drops off. Table LegalLandReview (migration 701); one open review per land.
const crypto = require("crypto");
const { canAct, isSuperAdmin, userOf } = require("./approvalAuthority");
const { writeAudit } = require("./legalAudit");
// The steps: the land's entry sections as on the land workspace, each with every field of every entry (filled or not)
// and the documents attached to them.
const ENTRY_SECTIONS = [
  ["basic", "Basic Information", ["land"]],
  ["ownership", "Ownership History", ["ownership-record", "inheritance", "partition", "property-restriction"]],
  ["acquisition", "Acquisition & Purchase", ["ownership-event", "land-purchase"]],
  ["records", "Land Records (RS / LR)", ["land-rs-record", "land-lr-record"]],
  ["legal", "Legal Dispute Information", ["legal-case", "land-legal-record"]],
  ["loans", "Loan & Mortgage", ["mortgage"]],
  ["mutation", "Mutation Records", ["mutation"]],
  ["payments", "Payment History", ["payment"]],
  ["tax", "Land Tax (Khajna)", ["land-tax"]],
  ["survey", "Survey & Valuation", ["valuation"]],
  ["documents", "Other Documents", []],
  ["photos", "Notes & Attachments", ["land-photo"]],
];
// Sections a land needs at least one entry in; the rest may stay empty.
const NEEDED = new Set(["basic", "ownership", "records", "documents"]);
const SKIP_FIELD = (f) => f.system || f.hidden || f.type === "password" || f.name === "IsActive";
const shown = (f, raw, row) => {
  if (raw === null || raw === undefined || raw === "") return null;
  if (f.type === "ref") return row[`${f.name}__label`] ?? String(raw);
  if (f.type === "file") return row[`${f.name}__label`] ?? "File";
  if (f.type === "bit") return raw ? "Yes" : "No";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw);
};

/** Every entry section of a land: its entries, each with all its fields (value or empty) and attached files. */
async function entrySections(pool, landId, given = null) {
  const { MASTERS } = require("./masterConfig");
  const { baseSql } = require("./legalMasters");
  const rowsOf = async (key) => {
    const cfg = MASTERS[key];
    if (!cfg) return [];
    const where = key === "land" ? " AND t.LandId = @Parent" : "";
    const sqlText = key === "land" ? baseSql(cfg, null, false) + where : baseSql(cfg, landId, false);
    const run = (extra) => pool.request().input("Parent", sql.Int, landId).query(sqlText + extra);
    const r = await run(" AND t.IsActive = 1").catch(() => run("")).catch(() => ({ recordset: [] }));
    return r.recordset.map((row) => ({
      master: key, title: cfg.title, id: row[cfg.pk],
      fields: cfg.fields.filter((fd) => !SKIP_FIELD(fd)).map((fd) => {
        const v = shown(fd, row[fd.name], row);
        // info: not entered data (the land it belongs to, generated codes) — shown, never verified.
        const info = fd.name === cfg.parent || fd.name === "LandId" || !!fd.auto;
        return { n: fd.name, l: fd.label, v, req: !!fd.required, ...(info ? { info: true } : {}), ...(fd.type === "file" && row[fd.name] ? { file: row[fd.name] } : {}) };
      }),
    }));
  };
  const st = given || await landState(pool, landId);
  const checklist = await checklistNow(pool, landId);
  const out = [];
  for (const [key, label, masters] of ENTRY_SECTIONS) {
    let records = [];
    for (const m of masters) records = records.concat(await rowsOf(m));
    if (key === "documents") {
      records = (st?.documents || []).map((d) => ({ master: "land-document", title: "Document", id: d.DocumentId, fields: [
        { n: "Title", l: "Title", v: d.Title ?? null, req: true },
        { n: "DocTypeName", l: "Document type", v: d.DocTypeName ?? null, req: true },
        { n: "DocumentNo", l: "Document number", v: d.DocumentNo ?? null, req: false },
        { n: "DocumentDate", l: "Document date", v: d.DocumentDate ? new Date(d.DocumentDate).toISOString().slice(0, 10) : null, req: false },
        { n: "File", l: "File", v: d.FileName ?? null, req: true, ...(d.FileId ? { file: d.FileId } : {}) },
      ] }));
    }
    const all = records.flatMap((r) => r.fields);
    // An empty section still lists what it asks for, so the verifier sees what is not filled.
    const template = records.length ? undefined : masters.map((m) => ({ title: MASTERS[m]?.title ?? m, fields: (MASTERS[m]?.fields || []).filter((fd) => !SKIP_FIELD(fd)).map((fd) => ({ l: fd.label, req: !!fd.required })) }));
    out.push({ key, label, records, template, needed: NEEDED.has(key),
      filled: all.filter((x) => x.v != null).length, total: all.length,
      missingRequired: all.filter((x) => x.req && x.v == null).map((x) => x.l),
      files: all.filter((x) => x.file).length,
      checklist: key === "documents" ? (checklist?.items || []) : undefined });
  }
  const reg = await registrationSection(pool, landId);
  if (reg) out.push(reg);
  return out;
}

/**
 * The deed registration of a land (Deed Registration page), shown in its versions once it is in registration:
 * consideration, payment schedule, payments made, registration & stamp duty, and the registration itself.
 */
const payCol = async (pool) => !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalPayment', 'PaymentStatus') AS c")).recordset[0].c;
async function registrationSection(pool, landId) {
  const r = await safe(async () => (await pool.request().input("L", sql.Int, landId).query(`
    SELECT l.LandId, l.WorkflowStatus, l.RegAppliedAt, ua.name AS RegAppliedByName, l.RegFinalDate, o.OfficeName, mv.Name AS RegMode, l.RegDeedNo,
           l.RegDeedFileId, f.FileName AS RegDeedFileName, l.RegCompletedAt, uc.name AS RegCompletedByName,
           l.ConsDate, l.ConsTotalAmount, l.ConsRate, ru.UnitName AS ConsRateUnit, l.ConsAdvanceAmount, pm.Name AS ConsPaymentMode, l.ConsRemarks
    FROM dbo.LegalLand l LEFT JOIN dbo.users ua ON ua.id = l.RegAppliedBy LEFT JOIN dbo.users uc ON uc.id = l.RegCompletedBy
    LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = l.RegOfficeId LEFT JOIN dbo.LegalLookupValue mv ON mv.LookupId = l.RegModeId
    LEFT JOIN dbo.LegalLookupValue pm ON pm.LookupId = l.ConsPaymentModeId LEFT JOIN dbo.LegalAreaUnit ru ON ru.AreaUnitId = l.ConsRateUnitId
    LEFT JOIN dbo.LegalMasterFile f ON f.FileId = l.RegDeedFileId WHERE l.LandId = @L`)).recordset[0], null);
  if (!r || !(r.RegAppliedAt || r.RegCompletedAt || r.ConsTotalAmount != null || ["Deed Registration", "Registered"].includes(r.WorkflowStatus))) return null;
  const q = (text) => safe(async () => (await pool.request().input("L", sql.Int, landId).query(text)).recordset, []);
  const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
  const n = (x) => (x == null ? null : String(Number(x)));
  const F = (name, label, v, req = false, file) => ({ n: name, l: label, v: v ?? null, req, ...(file ? { file } : {}) });
  const records = [];

  // 1. Consideration
  records.push({ master: "reg-consideration", title: "Consideration", id: r.LandId, fields: [
    F("ConsDate", "Agreement / consideration date", d(r.ConsDate), true), F("ConsTotalAmount", "Total consideration (₹)", n(r.ConsTotalAmount), true),
    F("ConsRate", "Rate (₹)", r.ConsRate != null ? `${n(r.ConsRate)}${r.ConsRateUnit ? ` per ${r.ConsRateUnit}` : ""}` : null),
    F("ConsAdvanceAmount", "Advance (₹)", n(r.ConsAdvanceAmount)), F("ConsPaymentMode", "Payment mode", r.ConsPaymentMode), F("ConsRemarks", "Remarks", r.ConsRemarks),
  ] });

  // 2. Payment schedule (instalments) and 3. payments made, with paid / balance.
  const sched = await q(`SELECT s.ScheduleId, s.Label, s.DueDate, s.Amount, s.SharePct, t.Name AS TxnType, s.Remarks
    FROM dbo.LegalPaymentSchedule s LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = s.TxnTypeId WHERE s.LandId = @L ORDER BY s.DueDate, s.ScheduleId`);
  sched.forEach((x, i) => records.push({ master: "reg-schedule", title: `Instalment ${i + 1}`, id: x.ScheduleId, fields: [
    F("Label", "Instalment", x.Label), F("DueDate", "Due date", d(x.DueDate), true), F("Amount", "Amount (₹)", n(x.Amount), true),
    F("SharePct", "Share %", n(x.SharePct)), F("TxnType", "Type", x.TxnType), F("Remarks", "Remarks", x.Remarks),
  ] }));
  const pays = await q(`SELECT p.PaymentId, p.PaymentDate, t.Name AS TxnType, p.Amount, m.Name AS Mode, p.Payer, p.Payee, p.TransactionRef, p.ReceiptNo,
      p.ReceiptFileId, f.FileName AS ReceiptName, p.VerificationStatus, ${await payCol(pool) ? "ISNULL(p.PaymentStatus, N'Cleared')" : "N'Cleared'"} AS PayStatus
    FROM dbo.LegalPayment p LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = p.TxnTypeId LEFT JOIN dbo.LegalLookupValue m ON m.LookupId = p.PaymentModeId
    LEFT JOIN dbo.LegalMasterFile f ON f.FileId = p.ReceiptFileId WHERE p.LandId = @L AND p.IsActive = 1 ORDER BY p.PaymentDate, p.PaymentId`);
  for (const x of pays) x.PayStatus = x.PayStatus ?? "Cleared";
  pays.forEach((x) => records.push({ master: "reg-payment", title: `Payment · ${x.TxnType ?? ""}`.trim(), id: x.PaymentId, fields: [
    F("PaymentDate", "Date", d(x.PaymentDate), true), F("TxnType", "Type", x.TxnType, true), F("Amount", "Amount (₹)", n(x.Amount), true), F("Mode", "Mode", x.Mode),
    F("Payer", "Paid by", x.Payer), F("Payee", "Paid to", x.Payee), F("TransactionRef", "Transaction ref.", x.TransactionRef), F("ReceiptNo", "Receipt no.", x.ReceiptNo),
    F("Receipt", "Receipt", x.ReceiptName, false, x.ReceiptFileId), F("PayStatus", "Payment status", x.PayStatus),
  ] }));
  const paid = pays.filter((x) => x.PayStatus === "Cleared").reduce((s2, x) => s2 + (x.TxnType === "Refund" ? -Number(x.Amount || 0) : ["Sale Receipt", "Expense"].includes(x.TxnType) ? 0 : Number(x.Amount || 0)), 0);
  records.push({ master: "reg-paid", title: "Paid so far", id: r.LandId, fields: [
    F("Total", "Total consideration (₹)", n(r.ConsTotalAmount)), F("Paid", "Paid (₹)", n(paid)),
    F("Balance", "Balance (₹)", r.ConsTotalAmount != null ? n(Number(r.ConsTotalAmount) - paid) : null), F("Instalments", "Instalments / payments", `${sched.length} / ${pays.length}`),
  ] });

  // 4. Registration & stamp duty: calculation (if any) and the fee / duty entries.
  const duty = await q(`SELECT CalculationId, CalculationDate, GovtMarketValue, ConsiderationValue, StampDuty, RegistrationFee, ScanningFee, OtherCharges, TotalPayable, CalculationSource
    FROM dbo.LegalStampDuty WHERE LandId = @L AND IsActive = 1 ORDER BY CalculationDate`);
  duty.forEach((x) => records.push({ master: "reg-duty", title: "Stamp duty calculation", id: x.CalculationId, fields: [
    F("CalculationDate", "Calculated on", d(x.CalculationDate)), F("GovtMarketValue", "Govt. market value (₹)", n(x.GovtMarketValue)), F("ConsiderationValue", "Consideration value (₹)", n(x.ConsiderationValue)),
    F("StampDuty", "Stamp duty (₹)", n(x.StampDuty)), F("RegistrationFee", "Registration fee (₹)", n(x.RegistrationFee)), F("ScanningFee", "Scanning fee (₹)", n(x.ScanningFee)),
    F("OtherCharges", "Other charges (₹)", n(x.OtherCharges)), F("TotalPayable", "Total payable (₹)", n(x.TotalPayable)), F("CalculationSource", "Source", x.CalculationSource),
  ] }));
  const fees = await q(`SELECT x.QueryId, x.QueryDate, t.Name AS FeeType, x.Amount, x.Remarks FROM dbo.LegalStampDutyQuery x
    LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.FeeTypeId WHERE x.LandId = @L ORDER BY x.QueryDate, x.QueryId`);
  fees.forEach((x) => records.push({ master: "reg-fee", title: `Registration & stamp duty · ${x.FeeType ?? "fee"}`, id: x.QueryId, fields: [
    F("QueryDate", "Date", d(x.QueryDate), true), F("FeeType", "Fee / duty", x.FeeType, true), F("Amount", "Amount (₹)", n(x.Amount), true), F("Remarks", "Remarks", x.Remarks),
  ] }));
  if (fees.length) records.push({ master: "reg-fee-total", title: "Registration & stamp duty — total", id: r.LandId, fields: [
    F("Total", "Total (₹)", n(fees.reduce((s2, x) => s2 + Number(x.Amount || 0), 0))), F("Entries", "Entries", String(fees.length)),
  ] });

  // 5. The registration itself.
  records.push({ master: "registration", title: r.RegCompletedAt ? "Deed registered" : "Deed registration (in progress)", id: r.LandId, fields: [
    F("RegAppliedAt", "Applied for registration", d(r.RegAppliedAt), true), F("RegAppliedBy", "Applied by", r.RegAppliedByName),
    F("RegFinalDate", "Registration date", d(r.RegFinalDate), true), F("RegOffice", "Registration office", r.OfficeName, true), F("RegMode", "Registration mode", r.RegMode, true),
    F("RegDeedNo", "Registered deed number", r.RegDeedNo, true), F("RegDeedFile", "Registered deed copy", r.RegDeedFileName, true, r.RegDeedFileId),
    F("RegCompletedAt", "Registered on", d(r.RegCompletedAt)), F("RegCompletedBy", "Registered by", r.RegCompletedByName),
  ] });

  const all = records.flatMap((x) => x.fields);
  return { key: "registration", label: "Consideration, Payments & Deed Registration", records, needed: false, readOnly: true,
    filled: all.filter((x) => x.v != null).length, total: all.length,
    missingRequired: r.RegCompletedAt ? all.filter((x) => x.req && x.v == null).map((x) => x.l) : [], files: all.filter((x) => x.file).length };
}
/** A field the verifier must mark: it has a value, or it is required. Empty optional fields are "not needed". */
// Every entered field is decided by the verifier (✓ correct, ✗ wrong, N/A not needed); information fields are not.
const needsCheck = (fd) => !fd.info;
const sectionHash = (sec) => hashOf(sec.records.map((r) => [r.master, r.id, r.fields.map((x) => [x.n, x.v, x.file ?? null])]));

const hashOf = (x) => crypto.createHash("sha1").update(JSON.stringify(x ?? null)).digest("hex");
const reviewReady = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalLandReview', 'U') AS t")).recordset[0].t;

/** The land's review as it stands: each step with what it holds now, what it held at the last version, and its tick. */
async function reviewState(pool, landId) {
  await healPlaceholders(pool, landId);
  const st = await landState(pool, landId);
  if (!st) return null;
  // Deed registration is recorded by the deed team (it shows in versions), not entered — it is not verified here.
  const now = (await entrySections(pool, landId, st)).filter((sec) => sec.key !== "registration");
  const last = (await pool.request().input("L", sql.Int, landId).query(`
    SELECT TOP 1 SnapshotJson FROM dbo.LegalLandRegisterSnapshot WHERE LandId = @L AND Remarks LIKE N'Version %' ORDER BY CreatedAt DESC, SnapshotId DESC`)).recordset[0];
  const prev = last ? parse(last.SnapshotJson) : null;
  const versionNo = (await pool.request().input("L", sql.Int, landId).query(
    "SELECT COUNT(*) AS n FROM dbo.LegalLandRegisterSnapshot WHERE LandId = @L AND Remarks LIKE N'Version %'")).recordset[0].n + 1;
  const open = (await pool.request().input("L", sql.Int, landId).query(`
    SELECT TOP 1 r.*, s.name AS SubmittedByName, d.name AS DecidedByName, e.name AS EntrySubmittedByName FROM dbo.LegalLandReview r
    LEFT JOIN dbo.users s ON s.id = r.SubmittedBy LEFT JOIN dbo.users d ON d.id = r.DecidedBy LEFT JOIN dbo.users e ON e.id = r.EntrySubmittedBy
    WHERE r.LandId = @L AND r.Status IN (N'Verifying', N'Submitted') ORDER BY r.ReviewId DESC`)).recordset[0] || null;
  const amendment = await safe(async () => (await pool.request().input("L", sql.Int, landId).query(`
    SELECT TOP 1 AmendmentId, AmendmentNo, AmendType, Reason, Status FROM dbo.LegalLandAmendment
    WHERE LandId = @L AND Status IN (N'Pending', N'Open') ORDER BY AmendmentId DESC`)).recordset[0] || null, null);
  const lastReturn = open ? null : (await pool.request().input("L", sql.Int, landId).query(`
    SELECT TOP 1 r.Remarks, r.DecidedAt, r.ChecksJson, d.name AS DecidedByName FROM dbo.LegalLandReview r LEFT JOIN dbo.users d ON d.id = r.DecidedBy
    WHERE r.LandId = @L AND r.Status = N'Returned' ORDER BY r.ReviewId DESC`)).recordset[0] || null;
  const checks = open ? parse(open.ChecksJson) || {} : {};
  const lastVerified = (await pool.request().input("L", sql.Int, landId).query(`
    SELECT TOP 1 r.SubmittedBy, u.name AS Name, r.Remarks FROM dbo.LegalLandReview r LEFT JOIN dbo.users u ON u.id = r.SubmittedBy
    WHERE r.LandId = @L AND r.Status = N'Approved' ORDER BY r.ReviewId DESC`)).recordset[0] || null;
  // Sent back: the fields the verifier marked ✗, so data entry sees exactly what to correct (fixed once the value changes).
  const returnedChecks = !open && lastReturn ? parse(lastReturn.ChecksJson) || {} : {};
  const prevEntry = prev && Array.isArray(prev.entry) ? prev.entry : null;
  const steps = now.map((sec) => {
    const before = prevEntry ? prevEntry.find((p) => p.key === sec.key) || { records: [] } : null;
    const hash = sectionHash(sec);
    // A version saved before sections were kept has nothing to compare with: every step is checked again.
    const changed = !prev || !before || sectionHash(before) !== hash;
    const c = checks[sec.key];
    // Field-by-field: each field gets ✓ (correct) or ✗ (wrong); a decision holds while the field keeps that value.
    // An older whole-section tick (hash) counts as ✓ on every field while the section is unchanged.
    const whole = false; // an old whole-section tick no longer stands for field decisions — every field is marked by the verifier
    const decisions = {};
    const remarks = {};
    let total = 0;
    for (const r of sec.records) for (const fd of r.fields) {
      if (!needsCheck(fd)) continue;
      total++;
      const fk = `${r.master}#${r.id}#${fd.n}`;
      const dcs = c?.fields?.[fk];
      if (whole) decisions[fk] = "ok";
      else if (dcs && (dcs.v ?? null) === (fd.v ?? null)) { decisions[fk] = dcs.d; if (dcs.r) remarks[fk] = dcs.r; }
    }
    const decided = Object.keys(decisions).length;
    const crosses = Object.values(decisions).filter((d) => d === "bad").length;
    // An empty section is verified with one tick ("nothing to enter").
    const emptyOk = !sec.records.length && !!c && (c.empty || c.hash === hash) && (!c.hash || c.hash === hash);
    const checked = sec.records.length ? decided === total && total > 0 : emptyOk;
    const staleTick = !!c && ((c.hash && c.hash !== hash && !c.fields) || (!!c.fields && Object.keys(c.fields).length > decided));
    return { ...sec, changed, previous: prev && before ? before.records : null, hash, decisions, remarks, decided, fieldTotal: total, crosses,
      checked, checkedBy: checked ? c?.by ?? null : null, checkedAt: checked ? c?.at ?? null : null, staleTick };
  });
  const toFix = [];
  if (lastReturn && !open) {
    for (const sec of now) {
      const rc = returnedChecks[sec.key];
      if (!rc?.fields) continue;
      for (const [fk, x] of Object.entries(rc.fields)) {
        if (x.d !== "bad") continue;
        const [master, rid, fname] = fk.split("#");
        const rec = sec.records.find((r) => r.master === master && String(r.id) === rid);
        const fd = rec?.fields.find((y) => y.n === fname);
        const fixed = !rec || (fd?.v ?? null) !== (x.v ?? null);
        toFix.push({ section: sec.label, sectionKey: sec.key, entry: rec?.title ?? "Removed entry", field: fd?.l ?? fname, was: x.v ?? null, now: fd?.v ?? null, fixed, key: fk, remark: x.r ?? null });
        const st2 = steps.find((y) => y.key === sec.key);
        if (st2 && !fixed) st2.decisions[fk] = "bad";
      }
    }
  }
  // When anything changed, every step is verified again (ticked) for the new version — changed ones are highlighted.
  const anyChanged = steps.some((s) => s.changed);
  const toCheck = anyChanged ? steps : [];
  return { land: { LandId: st.land.LandId, LandCode: st.land.LandCode, LandName: st.land.LandName, WorkflowStatus: st.land.WorkflowStatus },
    versionNo, first: !prev, steps, toCheck: toCheck.length, ticked: toCheck.filter((s) => s.checked).length,
    // Draft = entries not yet sent for verification; Verifying = with the verifier; Submitted = with the Approver.
    status: open?.Status === "Submitted" ? "Submitted" : open ? "Verifying" : anyChanged ? "Draft" : "Up to date",
    review: open ? { ReviewId: open.ReviewId, Status: open.Status, SubmittedBy: open.SubmittedBy, SubmittedByName: open.SubmittedByName, SubmittedAt: open.SubmittedAt, Remarks: open.Remarks,
      EntrySubmittedByName: open.EntrySubmittedByName, EntrySubmittedAt: open.EntrySubmittedAt, EntrySubmittedBy: open.EntrySubmittedBy } : null,
    registered: st.land.WorkflowStatus === "Registered", amendment,
    // Fully verified (latest version saved, nothing changed since) but not yet in Deed Process → waits for the Approver.
    awaitingApproval: !open && !anyChanged && !!prev && st.land.VerificationStatus === "Verified" && !IN_PIPELINE.includes(st.land.WorkflowStatus),
    lastVerifiedBy: lastVerified?.SubmittedBy ?? null, lastVerifiedByName: lastVerified?.Name ?? null, lastVerifiedRemarks: lastVerified?.Remarks ?? null,
    returned: lastReturn ? { Remarks: lastReturn.Remarks, DecidedAt: lastReturn.DecidedAt, DecidedByName: lastReturn.DecidedByName } : null, toFix };
}

async function openReview(pool, landId, versionNo) {
  const r = (await pool.request().input("L", sql.Int, landId).query(
    "SELECT TOP 1 ReviewId, Status, ChecksJson FROM dbo.LegalLandReview WHERE LandId = @L AND Status IN (N'Verifying', N'Submitted') ORDER BY ReviewId DESC")).recordset[0];
  return r || null;
}

// GET /land/:id/review — the review of the land's next version.
router.get("/land/:id/review", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  try {
    const pool = getPool();
    if (!(await reviewReady(pool))) return res.status(503).json({ error: "Land review is not set up yet (migration 701)" });
    const out = await reviewState(pool, id);
    if (!out) return res.status(404).json({ error: "Land not found" });
    res.json({ ...out, canVerify: await canAct(req, "Verifier", PAGE), canApprove: await canAct(req, "Approver", PAGE), userId: userOf(req) });
  } catch (err) {
    console.error("[legal-flow] review:", err.message);
    res.status(500).json({ error: "Could not load the review" });
  }
});

// POST /land/:id/review/request { remarks } — data entry sends the land (its new or changed entries) for verification.
router.post("/land/:id/review/request", requirePageRight(PAGE, "edit"), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  try {
    const pool = getPool();
    const st = await reviewState(pool, id);
    if (!st) return res.status(404).json({ error: "Land not found" });
    if (st.status === "Verifying" || st.status === "Submitted") return res.status(409).json({ error: "Already sent for verification" });
    if (st.status === "Up to date") return res.status(409).json({ error: "Nothing new to verify — enter or change something first" });
    if (st.registered && st.amendment?.Status !== "Open") return res.status(409).json({ error: "This land is registered — its changes need an approved amendment first" });
    // Resubmitted after a send-back: the verifier's earlier ✓ / N/A marks carry over; each still holds only while its
    // field keeps the value checked, so only the corrected (✗) and changed fields need checking again.
    const prevR = (await pool.request().input("L", sql.Int, id).query(
      "SELECT TOP 1 ChecksJson FROM dbo.LegalLandReview WHERE LandId = @L AND Status = N'Returned' ORDER BY ReviewId DESC")).recordset[0];
    const carry = {};
    for (const [k, c] of Object.entries(parse(prevR?.ChecksJson) || {})) {
      if (!c?.fields) continue;
      const keep = Object.fromEntries(Object.entries(c.fields).filter(([, x]) => x.d !== "bad"));
      if (Object.keys(keep).length) carry[k] = { fields: keep, by: c.by, at: c.at };
    }
    // The submission: the exact data sent for verification, kept with its hash.
    const subJson = JSON.stringify(st.steps.map((x) => ({ key: x.key, records: x.records })));
    const hasSub = !!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalLandReview', 'SubmissionJson') AS c")).recordset[0].c;
    await pool.request().input("L", sql.Int, id).input("V", sql.Int, st.versionNo).input("U", sql.Int, userOf(req)).input("J", sql.NVarChar(sql.MAX), JSON.stringify(carry))
      .input("SJ", sql.NVarChar(sql.MAX), subJson).input("SH", sql.NVarChar(64), sha256(subJson))
      .input("A", sql.Int, st.amendment?.Status === "Open" ? st.amendment.AmendmentId : null).input("M", sql.NVarChar(1000), String(req.body?.remarks || "").trim().slice(0, 1000) || null)
      .query(`INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, EntrySubmittedBy, EntrySubmittedAt, AmendmentId, Remarks${hasSub ? ", SubmissionJson, SubmissionHash" : ""})
              VALUES (@L, @V, N'Verifying', @J, @U, SYSUTCDATETIME(), @A, @M${hasSub ? ", @SJ, @SH" : ""})`);
    await writeAudit(pool, req, { action: "Land review submitted", entityType: "Land Property", entityId: id, landId: id, remarks: `Sent for verification — version ${st.versionNo}` });
    await require("../../services/legalNotify").notify(pool, { roles: ["Verifier"], except: userOf(req), type: "legal_land_verify", title: `To verify: ${st.land.LandCode}`, body: `Version ${st.versionNo} sent for verification. Open Legal → Approvals → Land verification.`, refId: id });
    res.json({ message: `${st.land.LandCode}: sent for verification (version ${st.versionNo})` });
  } catch (err) {
    console.error("[legal-flow] review request:", err.message);
    res.status(500).json({ error: "Could not send for verification" });
  }
});

// POST /land/:id/review/return { remarks } — the verifier sends it back to data entry (something is wrong or missing).
router.post("/land/:id/review/return", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const remarks = String(req.body?.remarks || "").trim().slice(0, 1000);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  if (!remarks) return res.status(400).json({ error: "Write what needs correcting" });
  try {
    const pool = getPool();
    if (!(await canAct(req, "Verifier", PAGE))) return res.status(403).json({ error: "Only a Verifier can send it back" });
    const st = await reviewState(pool, id);
    if (!st || st.status !== "Verifying") return res.status(409).json({ error: "Not with the verifier" });
    await pool.request().input("R", sql.Int, st.review.ReviewId).input("U", sql.Int, userOf(req)).input("M", sql.NVarChar(1000), remarks)
      .query("UPDATE dbo.LegalLandReview SET Status = N'Returned', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), Remarks = @M WHERE ReviewId = @R");
    await recordFieldChecks(pool, id, st.review.ReviewId, st.versionNo, "Sent back", st).catch((e) => console.error("[legal-flow] field record:", e.message));
    await logDecision(pool, id, "Verification", "Send back", { versionNo: st.versionNo, reason: remarks, userId: userOf(req) });
    await require("../../services/legalNotify").notify(pool, { users: [st.review.EntrySubmittedBy], type: "legal_land_sent_back", title: `Sent back: ${st.land.LandCode}`, body: `The verifier sent it back — ${remarks}`.slice(0, 300), refId: id });
    await writeAudit(pool, req, { action: "Land review returned", entityType: "Land Property", entityId: id, landId: id, remarks });
    res.json({ message: `${st.land.LandCode}: sent back to data entry` });
  } catch (err) {
    console.error("[legal-flow] review return:", err.message);
    res.status(500).json({ error: "Could not send back" });
  }
});

// PUT /land/:id/review/check { step, checked } — the verifier ticks or unticks one step.
router.put("/land/:id/review/check", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const key = String(req.body?.step || "");
  if (!id || !ENTRY_SECTIONS.some(([k]) => k === key)) return res.status(400).json({ error: "Invalid step" });
  try {
    const pool = getPool();
    if (!(await canAct(req, "Verifier", PAGE))) return res.status(403).json({ error: "Only a Verifier (Setup → Approval Control) can tick the steps" });
    // Fast path: the page sends the values it shows ({ values: { fieldKey: value } }), so one small read + one write,
    // without rebuilding the whole land. The next full load re-checks every mark against the current values anyway.
    if (req.body && typeof req.body.values === "object" && req.body.values) {
      const b = req.body;
      const r = (await pool.request().input("L", sql.Int, id).query(
        "SELECT TOP 1 ReviewId, ChecksJson FROM dbo.LegalLandReview WHERE LandId = @L AND Status = N'Verifying' ORDER BY ReviewId DESC")).recordset[0];
      if (!r) return res.status(409).json({ error: "Not sent for verification yet" });
      const checks = parse(r.ChecksJson) || {};
      const cur = checks[key] && checks[key].fields ? checks[key] : { fields: {} };
      const vals = b.values;
      if (b.field) {
        const who = req.user?.name || req.user?.email || `User ${userOf(req)}`;
        if (["ok", "bad", "na"].includes(b.decision)) cur.fields[b.field] = { d: b.decision, v: vals[b.field] ?? null, by: who, at: new Date().toISOString(),
          ...(b.decision === "bad" && b.remark ? { r: String(b.remark).slice(0, 500) } : {}) };
        else delete cur.fields[b.field];
      } else if (b.all === "ok") {
        for (const [fk, v] of Object.entries(vals)) if (v != null && v !== "" && (!cur.fields[fk] || cur.fields[fk].v !== v)) cur.fields[fk] = { d: "ok", v };
        if (!Object.keys(vals).length) cur.empty = true;
      } else if (b.all === "clear") { cur.fields = {}; delete cur.empty; }
      else return res.status(400).json({ error: "Nothing to save" });
      cur.by = req.user?.name || req.user?.email || `User ${userOf(req)}`; cur.at = new Date().toISOString();
      checks[key] = cur;
      await pool.request().input("R", sql.Int, r.ReviewId).input("J", sql.NVarChar(sql.MAX), JSON.stringify(checks))
        .query("UPDATE dbo.LegalLandReview SET ChecksJson = @J WHERE ReviewId = @R AND Status = N'Verifying'");
      return res.json({ ok: true });
    }
    const st = await reviewState(pool, id);
    if (!st) return res.status(404).json({ error: "Land not found" });
    if (st.status !== "Verifying") return res.status(409).json({ error: st.status === "Submitted" ? "Already submitted — waiting for the Approver" : "Not sent for verification yet" });
    const step = st.steps.find((s) => s.key === key);
    if (!step) return res.status(400).json({ error: "This land has no such step" });
    const r = await openReview(pool, id, st.versionNo);
    if (!r) return res.status(409).json({ error: "Not sent for verification yet" });
    const checks = parse(r.ChecksJson) || {};
    const by = req.user?.name || req.user?.email || `User ${userOf(req)}`;
    const cur = checks[key] && checks[key].fields ? checks[key] : { fields: {} };
    const valueOf = Object.fromEntries(step.records.flatMap((rec) => rec.fields.filter(needsCheck).map((fd) => [`${rec.master}#${rec.id}#${fd.n}`, fd.v ?? null])));
    const body = req.body || {};
    let message;
    if (body.field) {
      // { step, field, decision: "ok" | "bad" | "na" | null }
      if (!(body.field in valueOf)) return res.status(400).json({ error: "Unknown field" });
      if (body.decision === "ok" || body.decision === "bad" || body.decision === "na") cur.fields[body.field] = { d: body.decision, v: valueOf[body.field] };
      else delete cur.fields[body.field];
      message = "Saved";
    } else if (body.all === "ok" || body.checked === true) {
      // ✓ on every field not yet decided (or "nothing to enter" for an empty section)
      // ✓ on filled fields, N/A on empty ones (the verifier can change any of them).
      // ✓ on every filled field not marked yet; empty fields stay for the verifier to mark (✓, ✗ or N/A).
      for (const [fk, v] of Object.entries(valueOf)) if (v != null && v !== "" && (!cur.fields[fk] || cur.fields[fk].v !== v)) cur.fields[fk] = { d: "ok", v };
      if (!step.records.length) cur.empty = true;
      message = `${step.label}: all ✓`;
    } else if (body.all === "clear" || body.checked === false) {
      cur.fields = {}; delete cur.empty;
      message = `${step.label}: cleared`;
    } else return res.status(400).json({ error: "Nothing to save" });
    cur.by = by; cur.at = new Date().toISOString();
    checks[key] = cur;
    await pool.request().input("R", sql.Int, r.ReviewId).input("J", sql.NVarChar(sql.MAX), JSON.stringify(checks))
      .query("UPDATE dbo.LegalLandReview SET ChecksJson = @J WHERE ReviewId = @R");
    res.json({ message });
  } catch (err) {
    console.error("[legal-flow] review check:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /land/:id/review/submit { remarks } — the verifier has marked every field (✓ / N/A, no ✗): verify and save the
// version with the remarks. A land not yet in Deed Process then waits for the Approver (Approvals · Land approval), who
// sends it on to Deed Process. Later versions (changes in Deed Process, amendments after registration) are complete here.
router.post("/land/:id/review/submit", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const remarks = String(req.body?.remarks || "").trim().slice(0, 1000);
  if (!id) return res.status(400).json({ error: "Invalid land" });
  if (remarks.length < 3) return res.status(400).json({ error: "Write the verification remarks" });
  try {
    const pool = getPool();
    if (!(await canAct(req, "Verifier", PAGE))) return res.status(403).json({ error: "Only a Verifier can verify the land" });
    const st = await reviewState(pool, id);
    if (!st) return res.status(404).json({ error: "Land not found" });
    if (st.status !== "Verifying") return res.status(409).json({ error: "Not sent for verification yet" });
    const left = st.steps.filter((s) => !s.checked);
    if (left.length) return res.status(409).json({ error: `Mark every field (✓, ✗ or N/A) first: ${left.map((s) => s.label).join(", ")}` });
    const wrong = st.steps.filter((s) => s.crosses);
    if (wrong.length) return res.status(409).json({ error: `Fields marked ✗ in ${wrong.map((s) => s.label).join(", ")} — send it back to data entry to correct` });
    const r = await openReview(pool, id, st.versionNo);
    const amend = st.registered && st.amendment?.Status === "Open" ? st.amendment : null;
    // Build the version from the data as it is now, and compare it with exactly what the verifier checked: if anything
    // changed in between (another user editing), nothing is saved and the verifier sees what changed.
    const snap = await buildSnapshot(pool, id, amend ? { no: amend.AmendmentNo, type: amend.AmendType, reason: amend.Reason, remarks, changes: [] } : null);
    const moved = st.steps.filter((x) => { const e = (snap?.entry || []).find((y) => y.key === x.key); return !e || sectionHash(e) !== x.hash; });
    if (!snap || moved.length) return res.status(409).json({ error: `Changed while you were verifying (${moved.map((x) => x.label).join(", ") || "the land"}) — check those fields again` });
    const pre = !IN_PIPELINE.includes(st.land.WorkflowStatus);
    // Freeze in one transaction: the version (with its hash), the verification result, the per-field records and the
    // land's status are saved together or not at all.
    const tx = pool.transaction();
    await tx.begin();
    let no;
    try {
      no = await insertSnapshot(tx, id, snap, userOf(req), "Land verified");
      await tx.request().input("R", sql.Int, r.ReviewId).input("U", sql.Int, userOf(req)).input("M", sql.NVarChar(1000), remarks).input("N", sql.Int, no)
        .query("UPDATE dbo.LegalLandReview SET Status = N'Approved', VersionNo = @N, SubmittedBy = @U, SubmittedAt = SYSUTCDATETIME(), DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), Remarks = @M WHERE ReviewId = @R AND Status = N'Verifying'");
      if (amend) await tx.request().input("A", sql.Int, amend.AmendmentId).input("N", sql.Int, no).query("UPDATE dbo.LegalLandAmendment SET Status = N'Completed', VersionNo = @N WHERE AmendmentId = @A");
      await recordFieldChecks(tx, id, r.ReviewId, no, "Verified", st);
      // Verifying is also the re-verification of changes made in Deed Process.
      await tx.request().input("L", sql.Int, id).input("U", sql.Int, userOf(req)).query(`
        IF COL_LENGTH('dbo.LegalLand', 'DeedChangedAt') IS NOT NULL
          EXEC sp_executesql N'UPDATE dbo.LegalLand SET DeedChangedAt = NULL, DeedChangedBy = NULL, DeedReverifiedAt = SYSUTCDATETIME(), DeedReverifiedBy = @U WHERE LandId = @L AND DeedChangedAt IS NOT NULL', N'@L INT, @U INT', @L = @L, @U = @U;`);
      if (pre) await tx.request().input("L", sql.Int, id).input("U", sql.Int, userOf(req))
        .query("UPDATE dbo.LegalLand SET VerificationStatus = N'Verified', FinalVerifiedBy = @U, FinalVerifiedAt = SYSUTCDATETIME() WHERE LandId = @L");
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }
    await writeAudit(pool, req, { action: "Land review approved", entityType: "Land Property", entityId: id, landId: id, remarks: `Version ${no} verified — ${remarks}` });
    if (pre) await require("../../services/legalNotify").notify(pool, { roles: ["Approver"], except: userOf(req), type: "legal_land_approval", title: `Land approval pending: ${st.land.LandCode}`, body: `Version ${no} verified. Open Legal → Approvals → Land approval.`, refId: id });
    res.json({ message: `${st.land.LandCode}: verified — version ${no} saved${pre ? "; waiting for the Approver to send it to Deed Process" : amend ? ` (amendment ${amend.AmendmentNo} done, land locked again)` : ""}` });
  } catch (err) {
    console.error("[legal-flow] review submit:", err.message);
    res.status(500).json({ error: "Could not verify" });
  }
});

const IN_PIPELINE = ["Deed Process", "Deed Completed", "Deed Registration", "Registered"];

/** The permanent per-field verification record of one round (migration 711): every marked field with the value seen. */
async function recordFieldChecks(pool, landId, reviewId, versionNo, outcome, st) {
  if (!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalLandFieldCheck','U') AS t")).recordset[0].t) return;
  const r = (await pool.request().input("R", sql.Int, reviewId).query("SELECT ChecksJson FROM dbo.LegalLandReview WHERE ReviewId = @R")).recordset[0];
  const checks = parse(r?.ChecksJson) || {};
  const label = {};
  for (const sec of st.steps) for (const rec of sec.records) for (const fd of rec.fields) label[`${rec.master}#${rec.id}#${fd.n}`] = `${rec.title} › ${fd.l}`;
  for (const [sec, c] of Object.entries(checks)) {
    for (const [fk, x] of Object.entries(c?.fields || {})) {
      await pool.request().input("L", sql.Int, landId).input("R", sql.Int, reviewId).input("V", sql.Int, versionNo).input("O", sql.NVarChar(20), outcome)
        .input("S", sql.NVarChar(30), sec).input("K", sql.NVarChar(200), fk.slice(0, 200)).input("FL", sql.NVarChar(200), (label[fk] || null)?.slice(0, 200) ?? null)
        .input("Val", sql.NVarChar(sql.MAX), x.v ?? null).input("St", sql.NVarChar(10), x.d).input("Rm", sql.NVarChar(500), x.r ?? null)
        .input("By", sql.NVarChar(150), x.by || c.by || null).input("At", sql.DateTime2, x.at ? new Date(x.at) : c.at ? new Date(c.at) : null)
        .query(`INSERT INTO dbo.LegalLandFieldCheck (LandId, ReviewId, VersionNo, Outcome, SectionKey, FieldKey, FieldLabel, ValueSnapshot, Status, Remarks, VerifiedBy, VerifiedAt)
                VALUES (@L, @R, @V, @O, @S, @K, @FL, @Val, @St, @Rm, @By, @At)`);
    }
  }
}

// POST /land/:id/review/decide { action: "Approve" | "Return", remarks } — the Approver, for a fully verified land not yet in
// Deed Process: Approve sends it to Deed Process (towards registration); Return sends it back to data entry with the reason.
router.post("/land/:id/review/decide", requirePageRight(PAGE, "view"), async (req, res) => {
  const id = idParam(req.params.id);
  const action = req.body?.action;
  const remarks = String(req.body?.remarks || "").trim().slice(0, 1000);
  if (!id || !["Approve", "Return"].includes(action)) return res.status(400).json({ error: "Invalid request" });
  if (action === "Return" && !remarks) return res.status(400).json({ error: "Give the reason" });
  try {
    const pool = getPool();
    if (!(await canAct(req, "Approver", PAGE))) return res.status(403).json({ error: "Only an Approver (Setup → Approval Control) can decide" });
    const st = await reviewState(pool, id);
    if (!st) return res.status(404).json({ error: "Land not found" });
    if (!st.awaitingApproval) return res.status(409).json({ error: st.status === "Draft" ? "Changed after it was verified — it must be verified again first" : "Not waiting for approval" });
    if (action === "Approve" && !isSuperAdmin(req) && Number(st.lastVerifiedBy) === Number(userOf(req)))
      return res.status(409).json({ error: "You verified this land — another user must approve it" });
    if (action === "Approve") {
      await pool.request().input("L", sql.Int, id).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), remarks || null).query(`
        UPDATE dbo.LegalLand SET WorkflowStatus = N'Deed Process', L1Status = N'Pending', L1ReviewerId = NULL, L1ReviewedAt = NULL, L1Remarks = NULL,
               L2Status = N'Pending', L2ApproverId = NULL, L2ApprovedAt = NULL, L2Remarks = NULL, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @L`);
      await logDecision(pool, id, "Land approval", "Approve", { versionNo: st.versionNo - 1, reason: remarks || null, userId: userOf(req) });
      await writeAudit(pool, req, { action: "Land verified — sent to Deed Process", entityType: "Land Property", entityId: id, landId: id, remarks: remarks || `Version ${st.versionNo - 1} approved` });
      return res.json({ message: `${st.land.LandCode}: approved — moved to Deed Process` });
    }
    await pool.request().input("L", sql.Int, id).query("UPDATE dbo.LegalLand SET VerificationStatus = N'Draft' WHERE LandId = @L");
    await pool.request().input("L", sql.Int, id).input("V", sql.Int, st.versionNo).input("U", sql.Int, userOf(req)).input("M", sql.NVarChar(1000), remarks)
      .query("INSERT INTO dbo.LegalLandReview (LandId, VersionNo, Status, ChecksJson, DecidedBy, DecidedAt, Remarks) VALUES (@L, @V, N'Returned', N'{}', @U, SYSUTCDATETIME(), @M)");
    // The verified version stays as it is; the send-back is its own decision record.
    await logDecision(pool, id, "Land approval", "Send back", { versionNo: st.versionNo - 1, reason: remarks, userId: userOf(req) });
    await require("../../services/legalNotify").notify(pool, { users: [st.lastVerifiedBy], roles: [], type: "legal_land_sent_back", title: `Sent back: ${st.land.LandCode}`, body: `Land approval refused — ${remarks}`.slice(0, 300), refId: id });
    await writeAudit(pool, req, { action: "Land review returned", entityType: "Land Property", entityId: id, landId: id, remarks });
    res.json({ message: `${st.land.LandCode}: sent back to data entry` });
  } catch (err) {
    console.error("[legal-flow] review decide:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// GET /section-rights — which land sections this user may add to / edit / delete in (Role Rights → Legal - Land sections).
router.get("/section-rights", requirePageRight(PAGE, "view"), async (req, res) => {
  try { res.json(await require("./sectionRights").sectionRights(req)); }
  catch (err) { console.error("[legal-flow] section rights:", err.message); res.status(500).json({ error: "Could not load the rights" }); }
});

// GET /reviews?kind=verify|approve — "verify" = sent for verification by data entry; "approve" = verified, waiting for the Approver.
router.get("/reviews", requirePageRight(PAGE, "view"), require("./paging").pageable("items"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await reviewReady(pool))) return res.json({ items: [] });
    const approve = req.query.kind === "approve";
    const r = await pool.request().query(approve ? `
      SELECT l.LandId, l.LandCode, l.LandName, l.ProjectId, l.WorkflowStatus, m.MouzaName, r.VersionNo, r.SubmittedAt AS Since, u.name AS ByName
      FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      CROSS APPLY (SELECT TOP 1 * FROM dbo.LegalLandReview x WHERE x.LandId = l.LandId ORDER BY x.ReviewId DESC) r
      LEFT JOIN dbo.users u ON u.id = r.SubmittedBy
      WHERE l.IsActive = 1 AND l.VerificationStatus = N'Verified' AND r.Status = N'Approved'
        AND ISNULL(l.WorkflowStatus, N'') NOT IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered')
      ORDER BY r.SubmittedAt` : `
      SELECT l.LandId, l.LandCode, l.LandName, l.ProjectId, l.WorkflowStatus, m.MouzaName, r.VersionNo, r.EntrySubmittedAt AS Since, u.name AS ByName
      FROM dbo.LegalLandReview r JOIN dbo.LegalLand l ON l.LandId = r.LandId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.users u ON u.id = r.EntrySubmittedBy
      WHERE r.Status = N'Verifying' AND l.IsActive = 1
      ORDER BY r.EntrySubmittedAt, r.ReviewId`);
    res.json({ items: r.recordset, canVerify: await canAct(req, "Verifier", PAGE), canApprove: await canAct(req, "Approver", PAGE) });
  } catch (err) {
    console.error("[legal-flow] reviews:", err.message);
    res.status(500).json({ error: "Could not load the reviews" });
  }
});

module.exports = router;
module.exports.snapshotVersion = snapshotVersion;
module.exports.APPROVAL_ACTIONS = APPROVAL_ACTIONS;
module.exports.reviewState = reviewState;
module.exports.loadLand = loadLand;
module.exports.logDecision = logDecision;
