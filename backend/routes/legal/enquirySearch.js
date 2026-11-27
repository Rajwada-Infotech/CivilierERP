"use strict";
// Deed Registry Search on enquiry land (mounted at /api/legal/enquiry-search).
// When an enquiry is saved it gets a timeline for every registration office type that applies to its state
// (Setup → Registration Office Types, "Timeline on every new enquiry"): due = enquiry date + that type's time limit. Per office the user searches the government site year by
// year (the type's first year → this year), records what was found for each year (or a whole range as not found),
// then marks that office's search complete.
// An office still open past its due date shows on the Legal dashboard and its people are notified (worker, daily).
// Land Conversion waits until every office's search is complete.
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { writeAudit } = require("./legalAudit");
const apiRateLimit = require("../../middleware/apiRateLimit");

const { pageable } = require("./paging");
const router = express.Router();
router.use(apiRateLimit);
// Project access (User / Role Project Access): a restricted user reaches only lands / enquiries of their projects.
const projectGuard = require("./projectGuard");
router.use(async (req, _res, next) => { try { req.legalScope = await projectGuard.getProjectScope(req.user); } catch { /* unrestricted */ } next(); });
router.param("enquiryId", projectGuard.landParam("enquiry"));
const PAGE = "legal-land-enquiry";
const FIRST_YEAR = 1956;
// A year's result for one office. No row = Pending (not searched). "Under Review" is not final: an office cannot be
// completed while any year is under review or not searched.
const RESULTS = ["Found", "Not Found", "Not Applicable", "Under Review", "Certified Copy Requested", "Awaiting Office Response", "Unable to Access", "Record Not Digitised"];
// Still waiting for an answer: blocks completion. Could not be searched: never a "not found" — needs an authorised exception.
const WAITING = ["Under Review", "Requested", "Certified Copy Requested", "Awaiting Office Response"];
const NO_ACCESS = ["Unable to Access", "Record Not Digitised"];
const METHODS = ["Online portal", "Certified copy", "Office inspection", "Manual entry"];
const RECORD_TYPES = { CS: { t: "LegalEnquiryCsRecord", pk: "CsRecordId", dag: "CsDagNo", kh: "CsKhatianNo" },
  RS: { t: "LegalEnquiryRsRecord", pk: "RsRecordId", dag: "RsDagNo", kh: "RsKhatianNo" }, LR: { t: "LegalEnquiryLrRecord", pk: "LrRecordId", dag: "LrDagNo", kh: "LrKhatianNo" } };
const MATCH = ["Not Matched", "Partially Matched", "Matched", "Disputed", "Requires Legal Review"];
const inList = (q) => q.map((x) => `N'${x}'`).join(", ");
const FINAL = ["Found", "Not Found", "Not Applicable"];
const EARLIEST = 1800;

const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const thisYear = () => new Date().getFullYear();

async function ready(pool) {
  const r = (await pool.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryOfficeSearch','U') AS t, OBJECT_ID('dbo.LegalRegistrationOfficeType','U') AS m")).recordset[0];
  return !!(r.t && r.m);
}
const notReady = (res) => res.status(503).json({ error: "Deed Registry Search is not set up yet — run the database migrations (655–658)" });

/**
 * Gives an enquiry its office timelines: one per office type that applies to its state. A pending timeline with nothing
 * recorded whose type no longer applies (the enquiry moved to another state, or the type was switched off) is removed.
 */
async function ensureOfficeTimelines(pool, enquiryId) {
  if (!(await ready(pool))) return;
  await pool.request().input("id", sql.Int, enquiryId).query(`
    DELETE o FROM dbo.LegalEnquiryOfficeSearch o
    JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId AND e.LandId IS NULL
    LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
    WHERE o.EnquiryId = @id AND o.Status = N'Pending' AND o.ManualAdd = 0
      AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch r WHERE r.EnquiryId = o.EnquiryId AND r.OfficeType = o.OfficeType)
      AND NOT EXISTS (SELECT 1 FROM dbo.LegalRegistrationOfficeType t WHERE t.OfficeTypeId = o.OfficeTypeId AND t.IsActive = 1 AND t.OnEnquiry = 1
                      AND (t.StateName IS NULL OR t.StateName = d.State) AND (t.DistrictId IS NULL OR t.DistrictId = e.DistrictId));
    INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate, Mandatory, ToYear)
    -- A type set up after the enquiry was raised counts its time limit from the day it was set up.
    SELECT e.EnquiryId, t.OfficeTypeId, t.TypeName, t.SlaDays, t.FromYear,
      DATEADD(day, t.SlaDays, CASE WHEN CAST(t.CreatedAt AS DATE) > e.EnquiryDate THEN CAST(t.CreatedAt AS DATE) ELSE e.EnquiryDate END), t.IsMandatory, t.ToYear
    FROM dbo.LegalLandEnquiry e
    LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
    JOIN dbo.LegalRegistrationOfficeType t ON t.IsActive = 1 AND t.OnEnquiry = 1 AND (t.StateName IS NULL OR t.StateName = d.State) AND (t.DistrictId IS NULL OR t.DistrictId = e.DistrictId)
    WHERE e.EnquiryId = @id AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected'
      AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch x WHERE x.EnquiryId = e.EnquiryId AND x.OfficeType = t.TypeName)`);
  // (A converted enquiry's search is finished — it never gets new timelines; a rejected one is not searched.)
}

// Per enquiry: offices total / complete, the nearest open due date, the worst overdue.
// A rejected enquiry is not waiting for anyone: never pending or overdue.
const PENDING = "e.EnquiryStatus <> N'Rejected' AND EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending')";
const ENQ_STATE = `
  (SELECT COUNT(*) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId) AS OfficesTotal,
  (SELECT COUNT(*) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Completed') AS OfficesDone,
  (SELECT CONVERT(char(10), MIN(o.DueDate), 23) FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending') AS NextDue,
  CASE WHEN e.EnquiryStatus = N'Rejected' THEN 0 ELSE ISNULL((SELECT MAX(DATEDIFF(day, o.DueDate, CAST(GETDATE() AS DATE))) FROM dbo.LegalEnquiryOfficeSearch o
    WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE)), 0) END AS DaysOver`;

const OFFICE_COLS = `o.OfficeSearchId, o.EnquiryId, o.OfficeTypeId, o.OfficeType, o.ManualAdd, o.Mandatory, o.ToYear, o.ExceptionNote, ISNULL(st.SourceKind, N'Registry office') AS SourceKind, o.OfficeId, r.OfficeName, o.SlaDays, o.FromYear, CONVERT(char(10), o.DueDate, 23) AS DueDate,
  o.Status, o.Remarks, o.CompletedAt, cu.name AS CompletedByName,
  CASE WHEN o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) THEN DATEDIFF(day, o.DueDate, CAST(GETDATE() AS DATE)) ELSE 0 END AS DaysOver`;
const OFFICE_FROM = `FROM dbo.LegalEnquiryOfficeSearch o
  LEFT JOIN dbo.LegalRegistrationOfficeType st ON st.OfficeTypeId = o.OfficeTypeId
  LEFT JOIN dbo.LegalRegistrationOffice r ON r.OfficeId = o.OfficeId
  LEFT JOIN dbo.users cu ON cu.id = o.CompletedBy`;

/** A year result's extra rules: Not Applicable needs its reason; the search method must be a known one. */
function extraErr(body, result) {
  if (result === "Not Applicable" && !txt(body?.details, 2000)) return "Give the reason this year is not applicable";
  if (body?.searchMethod && !METHODS.includes(body.searchMethod)) return "Unknown search method";
  return null;
}

// GET /:enquiryId/records — the enquiry's CS / RS / LR record entries, their mappings, and the differences between
// mapped records (holder, area, Dag, Khatian) to look into. A difference is an alert, never a conclusion.
router.get("/:enquiryId/records", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = idOf(req.params.enquiryId);
    const out = {};
    for (const [k, m] of Object.entries(RECORD_TYPES)) {
      out[k] = (await pool.request().input("e", sql.Int, id).query(`SELECT r.${m.pk} AS Id, r.${m.dag} AS Dag, r.${m.kh} AS Khatian, r.RecordedHolder, r.GuardianName,
          r.Area, u.UnitName AS Unit, r.LandClass, r.RecordYear, r.RecordStatus, r.SourceMethod, r.DocFileId
        FROM dbo.${m.t} r LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = r.AreaUnitId WHERE r.EnquiryId = @e AND r.IsActive = 1 ORDER BY r.${m.kh}, r.${m.dag}`)).recordset;
    }
    const maps = (await pool.request().input("e", sql.Int, id).query(`SELECT m.MapId, RTRIM(m.FromType) AS FromType, m.FromId, RTRIM(m.ToType) AS ToType, m.ToId, m.MatchStatus, m.MatchBasis,
        m.Remarks, m.EvidenceFileId, f.FileName AS EvidenceFileName, uu.name AS ByName, ISNULL(m.UpdatedAt, m.CreatedAt) AS At
      FROM dbo.LegalLandRecordMap m LEFT JOIN dbo.LegalMasterFile f ON f.FileId = m.EvidenceFileId LEFT JOIN dbo.users uu ON uu.id = ISNULL(m.UpdatedBy, m.CreatedBy)
      WHERE m.EnquiryId = @e AND m.IsActive = 1 ORDER BY m.FromType, m.FromId`)).recordset;
    const find = (t, i) => out[t].find((x) => x.Id === i);
    const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    for (const m of maps) {
      const a = find(m.FromType, m.FromId), b = find(m.ToType, m.ToId), d = [];
      if (a && b) {
        if (a.RecordedHolder && b.RecordedHolder && norm(a.RecordedHolder) !== norm(b.RecordedHolder)) d.push({ kind: "Holder", from: a.RecordedHolder, to: b.RecordedHolder });
        if (a.Area != null && b.Area != null && (Number(a.Area) !== Number(b.Area) || norm(a.Unit) !== norm(b.Unit))) d.push({ kind: "Area", from: `${a.Area} ${a.Unit ?? ""}`.trim(), to: `${b.Area} ${b.Unit ?? ""}`.trim() });
        if (a.LandClass && b.LandClass && norm(a.LandClass) !== norm(b.LandClass)) d.push({ kind: "Classification", from: a.LandClass, to: b.LandClass });
      }
      m.differences = d;
      // How many links each side has (one-to-many / many-to-one).
      m.fromLinks = maps.filter((x) => x.FromType === m.FromType && x.FromId === m.FromId && x.ToType === m.ToType).length;
      m.toLinks = maps.filter((x) => x.ToType === m.ToType && x.ToId === m.ToId && x.FromType === m.FromType).length;
    }
    // Records not linked to the next / previous survey yet (a missing link is not a dead end — it is listed to follow up).
    const linked = (t, i) => maps.some((m) => (m.FromType === t && m.FromId === i) || (m.ToType === t && m.ToId === i));
    const unlinked = Object.entries(out).flatMap(([t, l]) => l.filter((x) => !linked(t, x.Id)).map((x) => ({ type: t, id: x.Id, dag: x.Dag, khatian: x.Khatian })));
    res.json({ ...out, maps, unlinked, matchStatuses: MATCH });
  } catch (err) {
    console.error("[legal-enquiry-search] records:", err.message);
    res.status(500).json({ error: "Could not load the records" });
  }
});

// GET /:enquiryId/summary — the consolidated Land Records Summary (sources, records, mapping, alternative history,
// possession, discrepancies, latest legal review, observations, overall status). GET /:enquiryId/snapshot — frozen copy.
router.get("/:enquiryId/summary", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const s = await require("./landRecordsReview").buildSummary(getPool(), idOf(req.params.enquiryId));
    if (!s) return res.status(404).json({ error: "Enquiry not found" });
    res.json(s);
  } catch (err) {
    console.error("[legal-enquiry-search] summary:", err.message);
    res.status(500).json({ error: "Could not build the summary" });
  }
});
router.get("/:enquiryId/snapshot", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const r = (await getPool().request().input("e", sql.Int, idOf(req.params.enquiryId))
      .query("SELECT TOP 1 SnapshotJson, SnapshotHash, CreatedAt FROM dbo.LegalEnquirySearchSnapshot WHERE EnquiryId = @e ORDER BY SnapshotId DESC")).recordset[0];
    if (!r) return res.status(404).json({ error: "No snapshot — the enquiry is not converted yet" });
    res.json({ hash: r.SnapshotHash, at: r.CreatedAt, data: JSON.parse(r.SnapshotJson) });
  } catch (err) {
    console.error("[legal-enquiry-search] snapshot:", err.message);
    res.status(500).json({ error: "Could not load the snapshot" });
  }
});

// POST /map/:id/discrepancy — turns the differences shown on a link (holder, area, classification) into discrepancy
// entries to investigate (area / holder: High, classification: Medium). Ones already raised from this link are skipped.
router.post("/map/:id/discrepancy", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const m = (await pool.request().input("i", sql.Int, idOf(req.params.id)).query(`SELECT m.*, e.LandId FROM dbo.LegalLandRecordMap m JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = m.EnquiryId WHERE m.MapId = @i AND m.IsActive = 1`)).recordset[0];
    if (!m) return res.status(404).json({ error: "Link not found" });
    if (m.LandId) return res.status(409).json({ error: "This enquiry is converted — its records are frozen" });
    const one = async (t, id) => { const k = RECORD_TYPES[t.trim()]; return (await pool.request().input("i", sql.Int, id).query(`SELECT r.${k.dag} AS Dag, r.${k.kh} AS Kh, r.RecordedHolder, r.Area, u.UnitName AS Unit, r.LandClass
      FROM dbo.${k.t} r LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = r.AreaUnitId WHERE r.${k.pk} = @i`)).recordset[0]; };
    const a = await one(m.FromType, m.FromId), b = await one(m.ToType, m.ToId);
    if (!a || !b) return res.status(400).json({ error: "A linked record is missing" });
    const n = (v) => String(v ?? "").trim().toLowerCase();
    const rows = [];
    if (a.RecordedHolder && b.RecordedHolder && n(a.RecordedHolder) !== n(b.RecordedHolder)) rows.push(["Holder name change", a.RecordedHolder, b.RecordedHolder, "High"]);
    if (a.Area != null && b.Area != null && (Number(a.Area) !== Number(b.Area) || n(a.Unit) !== n(b.Unit))) rows.push(["Area difference", `${Number(a.Area)} ${a.Unit ?? ""}`.trim(), `${Number(b.Area)} ${b.Unit ?? ""}`.trim(), "High"]);
    if (a.LandClass && b.LandClass && n(a.LandClass) !== n(b.LandClass)) rows.push(["Classification change", a.LandClass, b.LandClass, "Medium"]);
    const related = `${m.FromType.trim()} Dag ${a.Dag} / Kh ${a.Kh} → ${m.ToType.trim()} Dag ${b.Dag} / Kh ${b.Kh}`;
    let added = 0;
    for (const [type, prev, cur, sev] of rows) {
      const dup = (await pool.request().input("m", sql.Int, m.MapId).input("t", sql.NVarChar(60), type).query("SELECT 1 AS x FROM dbo.LegalLandDiscrepancy WHERE SourceMapId = @m AND DiscrepancyType = @t AND IsActive = 1")).recordset[0];
      if (dup) continue;
      await pool.request().input("e", sql.Int, m.EnquiryId).input("t", sql.NVarChar(60), type).input("r", sql.NVarChar(200), related).input("p", sql.NVarChar(500), prev).input("c", sql.NVarChar(500), cur)
        .input("s", sql.NVarChar(20), sev).input("m", sql.Int, m.MapId).input("u", sql.Int, req.user?.userId ?? null)
        .query(`INSERT INTO dbo.LegalLandDiscrepancy (EnquiryId, DiscrepancyType, RelatedRecord, PreviousInfo, CurrentInfo, Description, Severity, InvestigationStatus, SourceMapId, CreatedBy)
                VALUES (@e, @t, @r, @p, @c, N'Raised from the record mapping — to investigate', @s, N'Open', @m, @u)`);
      added++;
    }
    if (added) await writeAudit(pool, req, { action: "Discrepancies raised from mapping", entityType: "Land Enquiry", entityId: m.EnquiryId, newValue: { mapId: m.MapId, added } }).catch(() => {});
    res.status(added ? 201 : 200).json({ message: added ? `${added} discrepanc${added === 1 ? "y" : "ies"} raised — see the Discrepancies tab` : rows.length ? "Already raised from this link" : "No differences on this link" });
  } catch (err) {
    console.error("[legal-enquiry-search] map discrepancy:", err.message);
    res.status(500).json({ error: "Could not raise the discrepancies" });
  }
});

// POST /:enquiryId/map { fromType, fromId, toType, toId, matchStatus, matchBasis, remarks, evidenceFileId } — link two
// records (CS → RS, RS → LR, CS → LR). A record can link to several (one-to-many / many-to-one).
router.post("/:enquiryId/map", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = idOf(req.params.enquiryId);
    const b = req.body || {};
    const ok = (b.fromType === "CS" && b.toType === "RS") || (b.fromType === "RS" && b.toType === "LR") || (b.fromType === "CS" && b.toType === "LR");
    if (!ok) return res.status(400).json({ error: "Link an older record to a newer one: CS → RS, RS → LR or CS → LR" });
    const conv = (await pool.request().input("e", sql.Int, id).query("SELECT LandId FROM dbo.LegalLandEnquiry WHERE EnquiryId = @e")).recordset[0];
    if (!conv) return res.status(404).json({ error: "Enquiry not found" });
    if (conv.LandId) return res.status(409).json({ error: "This enquiry is converted — its records are frozen" });
    for (const [t, i] of [[b.fromType, idOf(b.fromId)], [b.toType, idOf(b.toId)]]) {
      const m = RECORD_TYPES[t];
      const hit = (await pool.request().input("e", sql.Int, id).input("i", sql.Int, i).query(`SELECT 1 AS x FROM dbo.${m.t} WHERE ${m.pk} = @i AND EnquiryId = @e AND IsActive = 1`)).recordset[0];
      if (!hit) return res.status(400).json({ error: `Pick a ${t} record of this enquiry` });
    }
    const st = MATCH.includes(b.matchStatus) ? b.matchStatus : "Requires Legal Review";
    const dup = (await pool.request().input("ft", sql.NChar(2), b.fromType).input("fi", sql.Int, idOf(b.fromId)).input("tt", sql.NChar(2), b.toType).input("ti", sql.Int, idOf(b.toId))
      .query("SELECT 1 AS x FROM dbo.LegalLandRecordMap WHERE FromType = @ft AND FromId = @fi AND ToType = @tt AND ToId = @ti AND IsActive = 1")).recordset[0];
    if (dup) return res.status(409).json({ error: "These two records are already linked" });
    const r = await pool.request().input("e", sql.Int, id).input("ft", sql.NChar(2), b.fromType).input("fi", sql.Int, idOf(b.fromId)).input("tt", sql.NChar(2), b.toType).input("ti", sql.Int, idOf(b.toId))
      .input("st", sql.NVarChar(30), st).input("ba", sql.NVarChar(500), txt(b.matchBasis, 500)).input("re", sql.NVarChar(1000), txt(b.remarks, 1000)).input("ev", sql.Int, idOf(b.evidenceFileId))
      .input("u", sql.Int, req.user?.userId ?? null)
      .query(`INSERT INTO dbo.LegalLandRecordMap (EnquiryId, FromType, FromId, ToType, ToId, MatchStatus, MatchBasis, Remarks, EvidenceFileId, CreatedBy)
              OUTPUT INSERTED.MapId VALUES (@e, @ft, @fi, @tt, @ti, @st, @ba, @re, @ev, @u)`);
    await writeAudit(pool, req, { action: "Record mapping added", entityType: "Land Enquiry", entityId: id, newValue: { ...b, matchStatus: st } }).catch(() => {});
    res.status(201).json({ id: r.recordset[0].MapId, message: `${b.fromType} → ${b.toType} link saved (${st})` });
  } catch (err) {
    console.error("[legal-enquiry-search] map add:", err.message);
    res.status(500).json({ error: "Could not save the link" });
  }
});
// PUT /map/:id { matchStatus, matchBasis, remarks, evidenceFileId } · DELETE /map/:id (kept, deactivated, audited)
router.put("/map/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body || {};
    if (!MATCH.includes(b.matchStatus)) return res.status(400).json({ error: "Choose the match status" });
    const old = (await pool.request().input("i", sql.Int, idOf(req.params.id)).query(`SELECT m.*, e.LandId FROM dbo.LegalLandRecordMap m JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = m.EnquiryId WHERE m.MapId = @i AND m.IsActive = 1`)).recordset[0];
    if (!old) return res.status(404).json({ error: "Link not found" });
    if (old.LandId) return res.status(409).json({ error: "This enquiry is converted — its records are frozen" });
    await pool.request().input("i", sql.Int, old.MapId).input("st", sql.NVarChar(30), b.matchStatus).input("ba", sql.NVarChar(500), txt(b.matchBasis, 500)).input("re", sql.NVarChar(1000), txt(b.remarks, 1000))
      .input("ev", sql.Int, idOf(b.evidenceFileId)).input("u", sql.Int, req.user?.userId ?? null)
      .query("UPDATE dbo.LegalLandRecordMap SET MatchStatus = @st, MatchBasis = @ba, Remarks = @re, EvidenceFileId = ISNULL(@ev, EvidenceFileId), UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE MapId = @i");
    await writeAudit(pool, req, { action: "Record mapping changed", entityType: "Land Enquiry", entityId: old.EnquiryId, oldValue: { matchStatus: old.MatchStatus, matchBasis: old.MatchBasis }, newValue: b }).catch(() => {});
    res.json({ message: "Link updated" });
  } catch (err) {
    console.error("[legal-enquiry-search] map edit:", err.message);
    res.status(500).json({ error: "Could not update the link" });
  }
});
router.delete("/map/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const old = (await pool.request().input("i", sql.Int, idOf(req.params.id)).query(`SELECT m.MapId, m.EnquiryId, e.LandId FROM dbo.LegalLandRecordMap m JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = m.EnquiryId WHERE m.MapId = @i AND m.IsActive = 1`)).recordset[0];
    if (!old) return res.status(404).json({ error: "Link not found" });
    if (old.LandId) return res.status(409).json({ error: "This enquiry is converted — its records are frozen" });
    await pool.request().input("i", sql.Int, old.MapId).input("u", sql.Int, req.user?.userId ?? null).query("UPDATE dbo.LegalLandRecordMap SET IsActive = 0, UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE MapId = @i");
    await writeAudit(pool, req, { action: "Record mapping removed", entityType: "Land Enquiry", entityId: old.EnquiryId, oldValue: { mapId: old.MapId } }).catch(() => {});
    res.json({ message: "Link removed" });
  } catch (err) {
    console.error("[legal-enquiry-search] map delete:", err.message);
    res.status(500).json({ error: "Could not remove the link" });
  }
});

// GET /options — offices in the master, office types with limits, calendar years 1956 → this year.
router.get("/options", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const sla = (await pool.request().query(`SELECT OfficeTypeId, TypeName AS OfficeType, SlaDays AS Days, FromYear, ToYear, StateName, SourceKind, IsMandatory
      FROM dbo.LegalRegistrationOfficeType WHERE IsActive = 1 ORDER BY SortOrder, TypeName`)).recordset;
    const offices = (await pool.request().query(`SELECT o.OfficeId, o.OfficeName, o.OfficeTypeId, o.OfficeType, d.DistrictName, ISNULL(d.State, o.State) AS StateName FROM dbo.LegalRegistrationOffice o
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = o.DistrictId WHERE ISNULL(o.IsActive, 1) = 1 ORDER BY d.DistrictName, o.OfficeName`)).recordset;
    const years = [];
    const first = Math.min(FIRST_YEAR, ...sla.map((t) => t.FromYear));
    for (let y = thisYear(); y >= first; y--) years.push(y);
    res.json({ officeTypes: sla, offices, years });
  } catch (err) {
    console.error("[legal-enquiry-search] options:", err.message);
    res.status(500).json({ error: "Could not load the search options" });
  }
});

// POST /offices { officeName, officeType, enquiryId } — an office typed in the search that is not in the master yet is
// added to Setup → Deed Registration Office (district from the enquiry), so it is offered next time.
router.post("/offices", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const name = txt(req.body?.officeName, 200);
    const typeId = idOf(req.body?.officeTypeId);
    const enquiryId = idOf(req.body?.enquiryId);
    if (!name) return res.status(400).json({ error: "Enter the office name" });
    const tRow = (await pool.request().input("t", sql.Int, typeId).query("SELECT TypeName FROM dbo.LegalRegistrationOfficeType WHERE OfficeTypeId = @t")).recordset[0];
    if (!tRow) return res.status(400).json({ error: "Select the registration office type" });
    const type = tRow.TypeName;
    const same = (await pool.request().input("n", sql.NVarChar(200), name).input("t", sql.NVarChar(60), type)
      .query("SELECT OfficeId, OfficeName, OfficeType FROM dbo.LegalRegistrationOffice WHERE OfficeName = @n AND (OfficeType = @t)")).recordset[0];
    if (same) return res.json({ ...same, message: "Office already in the master" });
    const d = (await pool.request().input("e", sql.Int, enquiryId).query(`SELECT d.DistrictId, d.DistrictName, d.State FROM dbo.LegalLandEnquiry e
      JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId WHERE e.EnquiryId = @e`)).recordset[0];
    if (!d) return res.status(400).json({ error: "Select the enquiry land first" });
    const prefix = type.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
    const row = (await pool.request().input("n", sql.NVarChar(200), name).input("t", sql.NVarChar(60), type).input("p", sql.NVarChar(10), prefix)
      .input("d", sql.Int, d.DistrictId).input("dn", sql.NVarChar(200), d.DistrictName).input("st", sql.NVarChar(100), d.State || "West Bengal")
      .input("u", sql.Int, (req.user?.userId ?? req.user?.id ?? null))
      .input("ti", sql.Int, typeId)
      .query(`INSERT INTO dbo.LegalRegistrationOffice (OfficeCode, OfficeName, OfficeType, OfficeTypeId, State, District, DistrictId, IsActive, CreatedBy)
        OUTPUT INSERTED.OfficeId, INSERTED.OfficeName, INSERTED.OfficeType
        SELECT @p + '-' + RIGHT('0000' + CAST(ISNULL(MAX(OfficeId), 0) + 1 AS VARCHAR(10)), 4), @n, @t, @ti, @st, @dn, @d, 1, @u
        FROM dbo.LegalRegistrationOffice WITH (UPDLOCK, HOLDLOCK)`)).recordset[0];
    await writeAudit(pool, req, { action: "Created", entityType: "Deed Registration Office", entityId: row.OfficeId, newValue: row }).catch(() => {});
    res.status(201).json({ ...row, DistrictName: d.DistrictName, message: `${name} added to the office master` });
  } catch (err) {
    console.error("[legal-enquiry-search] add office:", err.message);
    res.status(500).json({ error: "Could not add the office" });
  }
});

// POST /:enquiryId/add-search { officeTypeId } or { name, fromYear, slaDays } — one more search for this enquiry
// (e.g. an old CS record, a municipality register). A typed name not in Setup → Registration Office Types is added
// there (not on every enquiry), so it is offered next time.
router.post("/:enquiryId/add-search", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.enquiryId);
    const e = (await pool.request().input("e", sql.Int, id).query(`SELECT e.EnquiryId, e.LandId, e.EnquiryStatus, d.State FROM dbo.LegalLandEnquiry e
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId WHERE e.EnquiryId = @e`)).recordset[0];
    if (!e) return res.status(404).json({ error: "Enquiry not found" });
    if (e.LandId) return res.status(400).json({ error: "This enquiry is converted — its search is finished" });
    let typeId = idOf(req.body?.officeTypeId);
    const name = txt(req.body?.name, 60);
    let added = false;
    if (!typeId) {
      if (!name) return res.status(400).json({ error: "Pick a search or type its name" });
      const fromYear = Number(req.body?.fromYear) || FIRST_YEAR;
      const days = Number(req.body?.slaDays) || 7;
      if (fromYear < EARLIEST || fromYear > thisYear()) return res.status(400).json({ error: `Start year must be ${EARLIEST}–${thisYear()}` });
      if (days < 1 || days > 365) return res.status(400).json({ error: "Time limit must be 1–365 days" });
      const found = (await pool.request().input("n", sql.NVarChar(60), name).input("st", sql.NVarChar(100), e.State ?? null)
        .query("SELECT TOP 1 OfficeTypeId FROM dbo.LegalRegistrationOfficeType WHERE LTRIM(RTRIM(TypeName)) = @n AND (StateName IS NULL OR StateName = @st) ORDER BY IsActive DESC")).recordset[0];
      if (found) typeId = found.OfficeTypeId;
      else {
        typeId = (await pool.request().input("n", sql.NVarChar(60), name).input("st", sql.NVarChar(100), e.State ?? null).input("y", sql.Int, fromYear).input("d", sql.Int, days)
          .input("u", sql.Int, req.user?.userId ?? null)
          .query(`INSERT INTO dbo.LegalRegistrationOfficeType (TypeName, Code, StateName, SlaDays, FromYear, OnEnquiry, Description, SortOrder, IsActive, CreatedBy, SourceKind)
                  OUTPUT INSERTED.OfficeTypeId VALUES (@n, UPPER(LEFT(REPLACE(@n, N' ', N''), 10)), @st, @d, @y, 0, N'Added from an enquiry search', 50, 1, @u, N'Other')`)).recordset[0].OfficeTypeId;
        added = true;
      }
    }
    const t = (await pool.request().input("t", sql.Int, typeId).query("SELECT OfficeTypeId, TypeName, SlaDays, FromYear, ToYear, IsMandatory, IsActive FROM dbo.LegalRegistrationOfficeType WHERE OfficeTypeId = @t")).recordset[0];
    if (!t) return res.status(400).json({ error: "Unknown search" });
    const dup = (await pool.request().input("e", sql.Int, id).input("n", sql.NVarChar(60), t.TypeName)
      .query("SELECT 1 AS x FROM dbo.LegalEnquiryOfficeSearch WHERE EnquiryId = @e AND OfficeType = @n")).recordset[0];
    if (dup) return res.status(409).json({ error: `${t.TypeName} is already searched for this enquiry` });
    await pool.request().input("e", sql.Int, id).input("t", sql.Int, t.OfficeTypeId).input("n", sql.NVarChar(60), t.TypeName).input("d", sql.Int, t.SlaDays).input("y", sql.Int, t.FromYear)
      .input("m", sql.Bit, t.IsMandatory ? 1 : 0).input("ty", sql.Int, t.ToYear ?? null)
      .query(`INSERT INTO dbo.LegalEnquiryOfficeSearch (EnquiryId, OfficeTypeId, OfficeType, SlaDays, FromYear, DueDate, ManualAdd, Mandatory, ToYear)
              VALUES (@e, @t, @n, @d, @y, DATEADD(day, @d, CAST(GETDATE() AS DATE)), 1, @m, @ty)`);
    await writeAudit(pool, req, { action: "Search added", entityType: "Land Enquiry", entityId: id, newValue: { search: t.TypeName, addedToMaster: added } }).catch(() => {});
    res.status(201).json({ message: `${t.TypeName} search added${added ? " (and saved in Setup → Registration Office Types)" : ""}` });
  } catch (err) {
    console.error("[legal-enquiry-search] add search:", err.message);
    res.status(500).json({ error: "Could not add the search" });
  }
});

// GET /find?projectId=&tab=pending|done|all&q= — enquiries of a project, by enquiry no, Land ID, RS / LR Dag or Khatian.
const searchDone = (h) => !!h.LandId || h.EnquiryStatus === "Rejected" || Number(h.OfficesDone) >= Number(h.OfficesTotal);
router.get("/find", requirePageRight(PAGE, "view"), pageable(null, { kinds: {
  pending: (h) => !searchDone(h), overdue: (h) => !searchDone(h) && Number(h.DaysOver) > 0,
  ontime: (h) => !searchDone(h) && !Number(h.DaysOver), done: searchDone,
} }), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    // ?projectId=all — every project (dashboard "All projects").
    // ?projectId=all — every project; ?projectId=none — enquiries without a project (raised before projects were required).
    const allProjects = req.query.projectId === "all";
    const noProject = req.query.projectId === "none";
    const projectId = idOf(req.query.projectId);
    if (!projectId && !allProjects && !noProject) return res.status(400).json({ error: "Select the project first" });
    const q = txt(req.query.q, 60);
    const tab = ["pending", "done"].includes(req.query.tab) ? req.query.tab : "all";
    const tabSql = tab === "pending" ? `AND e.LandId IS NULL AND ${PENDING}` : tab === "done" ? `AND NOT (e.LandId IS NULL AND ${PENDING})` : "";
    const rows = (await pool.request().input("p", sql.Int, projectId).input("q", sql.NVarChar(80), q ? `%${q}%` : null).query(`
      SELECT TOP 100 e.EnquiryId, e.EnquiryNo, e.LandLocation, e.EnquiryStatus, e.FinYear, e.JLNo, e.RsDagNo, e.LrDagNo, e.RsKhatianNo, e.LrKhatianNo,
             e.ProjectId, (SELECT name FROM dbo.enterprise p WHERE p.id = e.ProjectId) AS ProjectName,
             e.LandId, l.LandCode, d.DistrictName, d.State AS StateName, m.MouzaName, CONVERT(char(10), e.EnquiryDate, 23) AS EnquiryDate, ${ENQ_STATE},
             (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = e.EnquiryId AND s.Status = N'Found') AS Found
      FROM dbo.LegalLandEnquiry e
      LEFT JOIN dbo.LegalLand l ON l.LandId = e.LandId
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId
      WHERE e.IsActive = 1 ${allProjects ? "" : noProject ? "AND e.ProjectId IS NULL" : "AND e.ProjectId = @p"} ${tabSql} AND (@q IS NULL
        OR e.EnquiryNo LIKE @q OR l.LandCode LIKE @q OR e.LandLocation LIKE @q OR m.MouzaName LIKE @q OR e.RsDagNo LIKE @q OR e.LrDagNo LIKE @q OR e.RsKhatianNo LIKE @q OR e.LrKhatianNo LIKE @q
        OR EXISTS (SELECT 1 FROM dbo.LegalLandRsRecord x WHERE x.LandId = e.LandId AND x.IsActive = 1 AND (x.RsDagNo LIKE @q OR x.RsKhatianNo LIKE @q))
        OR EXISTS (SELECT 1 FROM dbo.LegalLandLrRecord x WHERE x.LandId = e.LandId AND x.IsActive = 1 AND (x.LrDagNo LIKE @q OR x.LrKhatianNo LIKE @q)))
      ORDER BY CASE WHEN e.LandId IS NULL AND ${PENDING} THEN 0 ELSE 1 END, e.EnquiryDate DESC, e.EnquiryId DESC`)).recordset;
    res.json(rows);
  } catch (err) {
    console.error("[legal-enquiry-search] find:", err.message);
    res.status(500).json({ error: "Could not search the enquiries" });
  }
});

// GET /overdue — office searches still open past their due date (dashboard).
router.get("/overdue", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json([]);
    const rows = (await pool.request().query(`SELECT ${OFFICE_COLS}, e.EnquiryNo, e.ProjectId, p.name AS ProjectName ${OFFICE_FROM}
      JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId AND e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected'
      LEFT JOIN dbo.enterprise p ON p.id = e.ProjectId
      WHERE o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) ORDER BY o.DueDate, e.EnquiryNo`)).recordset;
    // Follows the project picker (?project=) and the user's project access.
    const pj = String(req.query.project ?? "all");
    const scoped = (await projectGuard.filterRows(req, rows)).filter((r) => pj === "all" || (pj === "none" ? r.ProjectId == null : Number(r.ProjectId) === Number(pj)));
    res.json(scoped);
  } catch (err) {
    console.error("[legal-enquiry-search] overdue:", err.message);
    res.status(500).json({ error: "Could not load overdue searches" });
  }
});

// GET /report — Deed Registry Search figures for the dashboard: per project and for all projects, plus per office type.
// Counted per office search (one per office type per enquiry). Rejected enquiries are left out.
router.get("/report", requirePageRight(PAGE, "view"), async (_req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return res.json({ projects: [], offices: [], total: null });
    const FIG = `COUNT(DISTINCT e.EnquiryId) AS Enquiries, COUNT(*) AS Searches,
      SUM(CASE WHEN o.Status = N'Completed' THEN 1 ELSE 0 END) AS Completed,
      SUM(CASE WHEN o.Status = N'Pending' THEN 1 ELSE 0 END) AS NotCompleted,
      SUM(CASE WHEN o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS Overdue,
      SUM(CASE WHEN o.Status = N'Pending' AND o.DueDate >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS OnTime,
      SUM(f.n) AS DeedsFound`;
    const FROM = `FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId AND e.IsActive = 1 AND e.EnquiryStatus <> N'Rejected'
      OUTER APPLY (SELECT COUNT(*) AS n FROM dbo.LegalEnquiryDeedSearch d WHERE d.EnquiryId = o.EnquiryId AND d.OfficeType = o.OfficeType AND d.Status = N'Found') f`;
    // Enquiries with every office complete (ready for conversion or already converted).
    const READY = `(SELECT COUNT(*) FROM dbo.LegalLandEnquiry x WHERE x.IsActive = 1 AND x.EnquiryStatus <> N'Rejected' AND %P%
      AND EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch y WHERE y.EnquiryId = x.EnquiryId)
      AND NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch y WHERE y.EnquiryId = x.EnquiryId AND y.Status = N'Pending'))`;
    const projects = (await pool.request().query(`SELECT e.ProjectId, ISNULL(p.name, N'No project') AS ProjectName, ${FIG},
        ${READY.replace("%P%", "ISNULL(x.ProjectId, 0) = ISNULL(e.ProjectId, 0)")} AS EnquiriesDone
      ${FROM} LEFT JOIN dbo.enterprise p ON p.id = e.ProjectId GROUP BY e.ProjectId, p.name ORDER BY p.name`)).recordset;
    const total = (await pool.request().query(`SELECT ${FIG}, ${READY.replace("%P%", "1 = 1")} AS EnquiriesDone ${FROM}`)).recordset[0];
    const offices = (await pool.request().query(`SELECT o.OfficeType, ${FIG} ${FROM}
      LEFT JOIN dbo.LegalRegistrationOfficeType t ON t.OfficeTypeId = o.OfficeTypeId GROUP BY o.OfficeType, t.SortOrder ORDER BY t.SortOrder, o.OfficeType`)).recordset;
    // Investigation figures (phases 1–3): records found by survey, discrepancies, legal reviews (latest per enquiry).
    let investigation = null;
    if ((await pool.request().query("SELECT OBJECT_ID('dbo.LegalLandSearchReview','U') AS t")).recordset[0].t) {
      investigation = (await pool.request().query(`SELECT
        (SELECT COUNT(*) FROM dbo.LegalEnquiryCsRecord WHERE IsActive = 1 AND RecordStatus <> N'Not Found') AS CsFound,
        (SELECT COUNT(*) FROM dbo.LegalEnquiryRsRecord WHERE IsActive = 1 AND RecordStatus <> N'Not Found') AS RsFound,
        (SELECT COUNT(*) FROM dbo.LegalEnquiryLrRecord WHERE IsActive = 1 AND RecordStatus <> N'Not Found') AS LrFound,
        (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch d JOIN dbo.LegalEnquiryOfficeSearch o ON o.EnquiryId = d.EnquiryId AND o.OfficeType = d.OfficeType
           JOIN dbo.LegalRegistrationOfficeType t ON t.OfficeTypeId = o.OfficeTypeId WHERE d.Status = N'Found' AND t.SourceKind = N'Registry office') AS DeedsFound,
        (SELECT COUNT(*) FROM dbo.LegalLandAltHistory WHERE IsActive = 1) AS OtherFound,
        (SELECT COUNT(*) FROM dbo.LegalLandDiscrepancy WHERE IsActive = 1 AND InvestigationStatus IN (N'Open', N'Under Investigation', N'Unresolved', N'Referred to Legal Team')) AS OpenDiscrepancies,
        (SELECT COUNT(*) FROM dbo.LegalLandDiscrepancy WHERE IsActive = 1 AND Severity IN (N'High', N'Critical') AND InvestigationStatus IN (N'Open', N'Under Investigation', N'Unresolved', N'Referred to Legal Team')) AS SeriousDiscrepancies,
        (SELECT COUNT(*) FROM dbo.LegalLandDiscrepancy WHERE IsActive = 1 AND DiscrepancyType = N'Holder name change' AND InvestigationStatus <> N'Resolved') AS OwnerDifferences,
        (SELECT COUNT(*) FROM dbo.LegalLandDiscrepancy WHERE IsActive = 1 AND DiscrepancyType = N'Area difference' AND InvestigationStatus <> N'Resolved') AS AreaMismatches,
        (SELECT COUNT(*) FROM dbo.LegalLandRecordMap WHERE IsActive = 1 AND MatchStatus = N'Requires Legal Review') AS MappingPending,
        (SELECT COUNT(*) FROM dbo.LegalLandEnquiry e WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected'
           AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandSearchReview r WHERE r.EnquiryId = e.EnquiryId AND r.IsActive = 1 AND r.Recommendation <> N'Pending Legal Review')) AS ReviewsPending,
        x.Proceed, x.OnHold, x.NotRecommended
        FROM (SELECT SUM(CASE WHEN Recommendation IN (N'Recommended to Proceed', N'Proceed with Conditions') THEN 1 ELSE 0 END) AS Proceed,
                     SUM(CASE WHEN Recommendation = N'Hold for Further Investigation' THEN 1 ELSE 0 END) AS OnHold,
                     SUM(CASE WHEN Recommendation = N'Not Recommended' THEN 1 ELSE 0 END) AS NotRecommended
              FROM (SELECT r.Recommendation, ROW_NUMBER() OVER (PARTITION BY r.EnquiryId ORDER BY r.ReviewDate DESC, r.ReviewId DESC) AS rn
                    FROM dbo.LegalLandSearchReview r WHERE r.IsActive = 1) z WHERE z.rn = 1) x`)).recordset[0];
    }
    res.json({ projects, offices, total, investigation });
  } catch (err) {
    console.error("[legal-enquiry-search] report:", err.message);
    res.status(500).json({ error: "Could not load the Deed Registry Search report" });
  }
});

// GET /:enquiryId — the enquiry's office timelines and the year results under them.
router.get("/:enquiryId", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.enquiryId);
    if (!id) return res.status(400).json({ error: "Invalid enquiry" });
    await ensureOfficeTimelines(pool, id);
    const offices = (await pool.request().input("id", sql.Int, id).query(`SELECT ${OFFICE_COLS} ${OFFICE_FROM}
      LEFT JOIN dbo.LegalRegistrationOfficeType s ON s.OfficeTypeId = o.OfficeTypeId WHERE o.EnquiryId = @id ORDER BY s.SortOrder, o.OfficeType`)).recordset;
    const years = (await pool.request().input("id", sql.Int, id).query(`
      SELECT s.SearchId, s.OfficeType, s.CalendarYear, s.Status, s.DeedNo, CONVERT(char(10), s.DeedDate, 23) AS DeedDate, s.Parties, s.Details, s.SiteName,
             s.SearchMethod, s.ReferenceNo, CONVERT(char(10), s.SearchDate, 23) AS SearchDate, s.EvidenceFileId, f.FileName AS EvidenceFileName,
             ISNULL(s.CompletedAt, s.RequestedAt) AS RecordedAt, ISNULL(cu.name, ru.name) AS RecordedByName
      FROM dbo.LegalEnquiryDeedSearch s LEFT JOIN dbo.users cu ON cu.id = s.CompletedBy LEFT JOIN dbo.users ru ON ru.id = s.RequestedBy
      LEFT JOIN dbo.LegalMasterFile f ON f.FileId = s.EvidenceFileId
      WHERE s.EnquiryId = @id ORDER BY s.CalendarYear DESC, s.SearchId DESC`)).recordset;
    res.json({ offices, years });
  } catch (err) {
    console.error("[legal-enquiry-search] list:", err.message);
    res.status(500).json({ error: "Could not load the searches" });
  }
});

const officeRow = async (pool, osid) => (await pool.request().input("o", sql.Int, osid)
  .query("SELECT o.*, CONVERT(char(10), o.DueDate, 23) AS Due FROM dbo.LegalEnquiryOfficeSearch o WHERE o.OfficeSearchId = @o")).recordset[0];

// PUT /office/:id { officeId } — the specific office (from the master) searched for this office type.
router.put("/office/:id", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const officeId = idOf(req.body?.officeId);
    if (officeId) {
      const r = (await pool.request().input("i", sql.Int, officeId).query("SELECT OfficeType FROM dbo.LegalRegistrationOffice WHERE OfficeId = @i")).recordset[0];
      // (matched by name: offices and timelines both keep the type's name)
      if (!r) return res.status(400).json({ error: "Registration office not found" });
      if (r.OfficeType !== o.OfficeType) return res.status(400).json({ error: `That office is not a ${o.OfficeType}` });
    }
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("i", sql.Int, officeId).query("UPDATE dbo.LegalEnquiryOfficeSearch SET OfficeId = @i WHERE OfficeSearchId = @o");
    res.json({ message: "Office set" });
  } catch (err) {
    console.error("[legal-enquiry-search] set office:", err.message);
    res.status(500).json({ error: "Could not set the office" });
  }
});

// POST /office/:id/year { calendarYear, result, deedNo, deedDate, parties, details, siteName } — a year's result at this office.
router.post("/office/:id/year", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const year = idOf(req.body?.calendarYear);
    const result = RESULTS.includes(req.body?.result) ? req.body.result : null;
    const from = o.FromYear || FIRST_YEAR;
    if (!year || year < from || year > thisYear()) return res.status(400).json({ error: `Calendar year must be ${from} to ${thisYear()}` });
    if (!result) return res.status(400).json({ error: "Choose the result" });
    const deedNo = txt(req.body?.deedNo, 100);
    if (result === "Found" && !deedNo) return res.status(400).json({ error: "Enter the deed / record number found" });
    const bad = extraErr(req.body, result);
    if (bad) return res.status(400).json({ error: bad });
    if (o.ToYear && year > o.ToYear) return res.status(400).json({ error: `This search covers ${from}–${o.ToYear}` });
    const dup = (await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("y", sql.Int, year)
      .query("SELECT 1 AS x FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @e AND OfficeType = @t AND CalendarYear = @y")).recordset[0];
    if (dup) return res.status(409).json({ error: `${year} is already recorded for ${o.OfficeType} — edit it instead` });
    const u = (req.user?.userId ?? req.user?.id ?? null);
    await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("oi", sql.Int, o.OfficeId).input("y", sql.Int, year)
      .input("st", sql.NVarChar(20), result).input("sd", sql.Int, o.SlaDays).input("due", sql.Date, o.Due)
      .input("dn", sql.NVarChar(100), result === "Found" ? deedNo : null).input("dd", sql.Date, result === "Found" ? dateOf(req.body?.deedDate) : null)
      .input("pa", sql.NVarChar(500), result === "Found" ? txt(req.body?.parties, 500) : null)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200)).input("u", sql.Int, u)
      .input("sm", sql.NVarChar(40), METHODS.includes(req.body?.searchMethod) ? req.body.searchMethod : null).input("rn", sql.NVarChar(100), txt(req.body?.referenceNo, 100))
      .input("sdt", sql.Date, dateOf(req.body?.searchDate)).input("ev", sql.Int, idOf(req.body?.evidenceFileId))
      .query(`INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, DeedNo, DeedDate, Parties, Details, SiteName,
          RequestedBy, CompletedBy, CompletedAt, SearchMethod, ReferenceNo, SearchDate, EvidenceFileId)
          VALUES (@e, @t, @oi, @y, @st, @sd, @due, @dn, @dd, @pa, @de, @si, @u, @u, SYSUTCDATETIME(), @sm, @rn, ISNULL(@sdt, CAST(GETDATE() AS DATE)), @ev)`);
    await writeAudit(pool, req, { action: "Deed search recorded", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, year, result, deedNo } }).catch(() => {});
    res.status(201).json({ message: result === "Found" ? `Deed ${deedNo} (${year}) stored on the enquiry` : `${o.OfficeType} ${year}: ${result.toLowerCase()}` });
  } catch (err) {
    console.error("[legal-enquiry-search] year:", err.message);
    res.status(500).json({ error: "Could not save the result" });
  }
});

// PUT /item/:searchId — correct a year's result. DELETE /item/:searchId — remove a wrong one.
router.put("/item/:searchId", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const sid = idOf(req.params.searchId);
    const result = RESULTS.includes(req.body?.result) ? req.body.result : null;
    if (!sid) return res.status(400).json({ error: "Invalid search" });
    if (!result) return res.status(400).json({ error: "Choose the result" });
    const deedNo = txt(req.body?.deedNo, 100);
    if (result === "Found" && !deedNo) return res.status(400).json({ error: "Enter the deed / record number found" });
    const bad = extraErr(req.body, result);
    if (bad) return res.status(400).json({ error: bad });
    const r = await pool.request().input("s", sql.Int, sid).input("st", sql.NVarChar(20), result)
      .input("dn", sql.NVarChar(100), result === "Found" ? deedNo : null)
      .input("dd", sql.Date, result === "Found" ? dateOf(req.body?.deedDate) : null)
      .input("pa", sql.NVarChar(500), result === "Found" ? txt(req.body?.parties, 500) : null)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200))
      .input("u", sql.Int, (req.user?.userId ?? req.user?.id ?? null))
      .input("sm", sql.NVarChar(40), METHODS.includes(req.body?.searchMethod) ? req.body.searchMethod : null).input("rn", sql.NVarChar(100), txt(req.body?.referenceNo, 100))
      .input("sdt", sql.Date, dateOf(req.body?.searchDate)).input("ev", sql.Int, idOf(req.body?.evidenceFileId))
      .query(`UPDATE dbo.LegalEnquiryDeedSearch SET Status = @st, DeedNo = @dn, DeedDate = @dd, Parties = @pa, Details = @de, SiteName = @si,
          SearchMethod = @sm, ReferenceNo = @rn, SearchDate = ISNULL(@sdt, SearchDate), EvidenceFileId = ISNULL(@ev, EvidenceFileId),
          CompletedBy = @u, CompletedAt = SYSUTCDATETIME() OUTPUT INSERTED.EnquiryId WHERE SearchId = @s`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Result not found" });
    await writeAudit(pool, req, { action: "Deed search corrected", entityType: "Land Enquiry", entityId: row.EnquiryId, newValue: { searchId: sid, result, deedNo } }).catch(() => {});
    res.json({ message: "Result updated" });
  } catch (err) {
    console.error("[legal-enquiry-search] edit:", err.message);
    res.status(500).json({ error: "Could not save the result" });
  }
});
router.delete("/item/:searchId", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().input("s", sql.Int, idOf(req.params.searchId))
      .query("DELETE FROM dbo.LegalEnquiryDeedSearch OUTPUT DELETED.EnquiryId, DELETED.OfficeType, DELETED.CalendarYear WHERE SearchId = @s");
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Result not found" });
    await writeAudit(pool, req, { action: "Deed search deleted", entityType: "Land Enquiry", entityId: row.EnquiryId, oldValue: row }).catch(() => {});
    res.json({ message: "Result removed" });
  } catch (err) {
    console.error("[legal-enquiry-search] delete:", err.message);
    res.status(500).json({ error: "Could not remove the result" });
  }
});

// POST /office/:id/range { from, to, siteName, details } — every year in the range not recorded yet is stored as
// "Not Found" (a whole stretch checked on the site in one go). Years already recorded are left as they are.
router.post("/office/:id/range", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const first = o.FromYear || FIRST_YEAR;
    const from = idOf(req.body?.from), to = idOf(req.body?.to);
    const st = RESULTS.filter((x) => x !== "Found").includes(req.body?.status) ? req.body.status : "Not Found";
    if (st === "Not Applicable" && !txt(req.body?.details, 2000)) return res.status(400).json({ error: "Give the reason these years are not applicable" });
    const last = o.ToYear || thisYear();
    if (!from || !to || from > to || from < first || to > last) return res.status(400).json({ error: `Choose years between ${first} and ${last}` });
    const u = (req.user?.userId ?? req.user?.id ?? null);
    const r = await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("oi", sql.Int, o.OfficeId)
      .input("f", sql.Int, from).input("to", sql.Int, to).input("st", sql.NVarChar(20), st).input("sd", sql.Int, o.SlaDays).input("due", sql.Date, o.Due)
      .input("de", sql.NVarChar(2000), txt(req.body?.details, 2000)).input("si", sql.NVarChar(200), txt(req.body?.siteName, 200)).input("u", sql.Int, u)
      .query(`WITH y AS (SELECT @f AS Y UNION ALL SELECT Y + 1 FROM y WHERE Y < @to)
        INSERT INTO dbo.LegalEnquiryDeedSearch (EnquiryId, OfficeType, OfficeId, CalendarYear, Status, SlaDays, DueDate, Details, SiteName, RequestedBy, CompletedBy, CompletedAt)
        SELECT @e, @t, @oi, y.Y, @st, @sd, @due, @de, @si, @u, @u, SYSUTCDATETIME() FROM y
        WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalEnquiryDeedSearch x WHERE x.EnquiryId = @e AND x.OfficeType = @t AND x.CalendarYear = y.Y)
        OPTION (MAXRECURSION 400)`);
    const n = r.rowsAffected[0] || 0;
    await writeAudit(pool, req, { action: "Deed search range recorded", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, from, to, years: n, status: st } }).catch(() => {});
    res.status(201).json({ message: n ? `${o.OfficeType}: ${n} year${n > 1 ? "s" : ""} (${from}–${to}) recorded as ${st.toLowerCase()}` : "Every year in that range is already recorded" });
  } catch (err) {
    console.error("[legal-enquiry-search] range:", err.message);
    res.status(500).json({ error: "Could not save the range" });
  }
});

// PUT /office/:id/from-year { fromYear, reason } — records before the usual start year are needed: the office's search starts
// earlier (down to 1800). Those years must then be searched too before the office can be completed.
router.put("/office/:id/from-year", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    if (o.Status === "Completed") return res.status(409).json({ error: "Reopen the search first" });
    const y = idOf(req.body?.fromYear);
    const reason = txt(req.body?.reason, 500);
    if (!y || y < EARLIEST || y > thisYear()) return res.status(400).json({ error: `Choose a year from ${EARLIEST} to ${thisYear()}` });
    if (!reason) return res.status(400).json({ error: "Give the reason (why earlier records are needed)" });
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("y", sql.Int, y).query("UPDATE dbo.LegalEnquiryOfficeSearch SET FromYear = @y WHERE OfficeSearchId = @o");
    await writeAudit(pool, req, { action: "Office search start year changed", entityType: "Land Enquiry", entityId: o.EnquiryId, oldValue: { fromYear: o.FromYear }, newValue: { office: o.OfficeType, fromYear: y }, remarks: reason }).catch(() => {});
    res.json({ message: `${o.OfficeType}: search now covers ${y}–${thisYear()}` });
  } catch (err) {
    console.error("[legal-enquiry-search] from-year:", err.message);
    res.status(500).json({ error: "Could not change the start year" });
  }
});

// POST /office/:id/complete { remarks } — this office's search is done (stops its timeline). POST /office/:id/reopen.
router.post("/office/:id/complete", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    // Every year from the office's start year to this year needs a final result (Found / Not Found / Not Applicable).
    const first = o.FromYear || FIRST_YEAR, last = o.ToYear || thisYear();
    const c = (await pool.request().input("e", sql.Int, o.EnquiryId).input("t", sql.NVarChar(60), o.OfficeType).input("f", sql.Int, first).input("l", sql.Int, last).query(`
      SELECT SUM(CASE WHEN Status IN (N'Found', N'Not Found', N'Not Applicable') THEN 1 ELSE 0 END) AS fin,
             SUM(CASE WHEN Status IN (${inList(WAITING)}) THEN 1 ELSE 0 END) AS rev,
             SUM(CASE WHEN Status IN (${inList(NO_ACCESS)}) THEN 1 ELSE 0 END) AS noAccess
      FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @e AND OfficeType = @t AND CalendarYear BETWEEN @f AND @l`)).recordset[0];
    const need = last - first + 1, fin = Number(c.fin || 0), rev = Number(c.rev || 0), noAccess = Number(c.noAccess || 0);
    if (rev) return res.status(409).json({ error: `${rev} year${rev > 1 ? "s are" : " is"} still waiting (under review, certified copy or office reply) — record the final result first` });
    if (fin + noAccess < need) return res.status(409).json({ error: `${need - fin - noAccess} of ${need} years (${first}–${last}) are not searched yet — every year needs a result` });
    const remarks = txt(req.body?.remarks, 1000);
    // Years that could not be accessed / are not digitised are not "not found": completing needs an exception with its reason,
    // given by a user who can approve Land Enquiries.
    const exception = noAccess ? txt(req.body?.exception, 1000) : null;
    if (noAccess && !exception) return res.status(409).json({ error: `${noAccess} year${noAccess > 1 ? "s" : ""} could not be accessed or are not digitised — give an exception reason to complete`, needsException: noAccess });
    if (noAccess) {
      const { hasAnyPageAction } = require("../../middleware/requirePageRight");
      if (typeof hasAnyPageAction === "function" && !(await hasAnyPageAction(req, PAGE, ["approve"]))) return res.status(403).json({ error: "Only a user who can approve Land Enquiries can complete a search with an exception" });
    }
    const u = (req.user?.userId ?? req.user?.id ?? null);
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("r", sql.NVarChar(1000), remarks).input("u", sql.Int, u).input("x", sql.NVarChar(1000), exception)
      .query(`UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Completed', Remarks = @r, CompletedBy = @u, CompletedAt = SYSUTCDATETIME(),
                ExceptionNote = @x, ExceptionBy = CASE WHEN @x IS NULL THEN NULL ELSE @u END, ExceptionAt = CASE WHEN @x IS NULL THEN NULL ELSE SYSUTCDATETIME() END
              WHERE OfficeSearchId = @o`);
    await writeAudit(pool, req, { action: noAccess ? "Office search completed with exception" : "Office search completed", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType, remarks, exception } }).catch(() => {});
    res.json({ message: `${o.OfficeType} search complete` });
  } catch (err) {
    console.error("[legal-enquiry-search] complete:", err.message);
    res.status(500).json({ error: "Could not complete the search" });
  }
});
router.post("/office/:id/reopen", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const o = await officeRow(pool, idOf(req.params.id));
    if (!o) return res.status(404).json({ error: "Office search not found" });
    const reason = txt(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: "Give the reason for reopening" });
    const conv = (await pool.request().input("e", sql.Int, o.EnquiryId).query("SELECT LandId FROM dbo.LegalLandEnquiry WHERE EnquiryId = @e")).recordset[0];
    if (conv?.LandId) return res.status(409).json({ error: "This enquiry is already converted to a land — its search cannot be reopened" });
    await pool.request().input("o", sql.Int, o.OfficeSearchId).input("r", sql.NVarChar(1000), `Reopened: ${reason}`)
      .query("UPDATE dbo.LegalEnquiryOfficeSearch SET Status = N'Pending', CompletedBy = NULL, CompletedAt = NULL, AlertOn = NULL, Remarks = @r, ExceptionNote = NULL, ExceptionBy = NULL, ExceptionAt = NULL WHERE OfficeSearchId = @o");
    await writeAudit(pool, req, { action: "Office search reopened", entityType: "Land Enquiry", entityId: o.EnquiryId, newValue: { office: o.OfficeType }, remarks: reason }).catch(() => {});
    res.json({ message: `${o.OfficeType} search reopened` });
  } catch (err) {
    console.error("[legal-enquiry-search] reopen:", err.message);
    res.status(500).json({ error: "Could not reopen" });
  }
});

module.exports = router;
module.exports.ensureOfficeTimelines = ensureOfficeTimelines;
