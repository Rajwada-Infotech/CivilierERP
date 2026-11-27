"use strict";
// Legal V3 land intelligence (mounted at /api/legal/intel):
//   B  parcel area reconciliation (record / CS / RS / LR / offered / deed / surveyed / ownership areas, one unit);
//   C  ownership events with all their parties, and the verify / dispute / reject decision (maker-checker);
//   D  family tree data, inheritance case workflow, framework confirmation, versioned provisional calculations and
//      their legal-officer review; an approved case writes a verified inheritance event with its heirs.
// Nothing here concludes title: verified events and approved calculations are decisions of authorised users.
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { writeAudit } = require("./legalAudit");
const { canAct, isAdmin, userOf } = require("./approvalAuthority");
const engine = require("../../services/inheritanceEngine");
const router = express.Router();
const LAND = "legal-land-master", ENQ = "legal-land-enquiry";
const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const fail = (res, where, err) => { console.error(`[legal-intel] ${where}:`, err.message); res.status(500).json({ error: "Something went wrong — please try again" }); };
const legalOfficer = async (req) => isAdmin(req) || (await canAct(req, "Legal Officer", null)) || (await canAct(req, "Legal Reviewer", null));
const verifier = async (req) => isAdmin(req) || (await canAct(req, "Verifier", null)) || (await legalOfficer(req));

// ── B. Parcel area reconciliation ──────────────────────────────────────────────────────────────────
router.get("/reconciliation", async (req, res, next) => {
  const page = req.query.landId ? LAND : ENQ;
  return requirePageRight(page, "view")(req, res, next);
}, async (req, res) => {
  try {
    const pool = getPool();
    const landId = idOf(req.query.landId), enquiryId = idOf(req.query.enquiryId);
    if (!landId && !enquiryId) return res.status(400).json({ error: "Give landId or enquiryId" });
    const parcels = (await pool.request().input("L", sql.Int, landId).input("E", sql.Int, enquiryId).query(`
      SELECT p.ParcelId, p.ParcelCode, p.RsDagNo, p.LrDagNo, p.CsDagNo, p.Area, p.OfferedArea, p.DeedArea, p.SurveyedArea, p.OwnershipArea, p.ParcelStatus,
             u.UnitName, ISNULL(u.SqFtFactor, 1) AS F, m.MouzaName
      FROM dbo.LegalLandParcel p LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = p.AreaUnitId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = p.MouzaId
      WHERE p.IsActive = 1 AND ((@L IS NOT NULL AND p.LandId = @L) OR (@L IS NULL AND p.EnquiryId = @E)) ORDER BY p.ParcelCode`)).recordset;
    const rec = async (table) => (await pool.request().query(`SELECT r.ParcelId, r.Area, ISNULL(u.SqFtFactor, 1) AS F FROM dbo.${table} r
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = r.AreaUnitId WHERE r.IsActive = 1 AND r.Area IS NOT NULL AND r.ParcelId IN (${parcels.map((p) => p.ParcelId).join(",") || 0})`)).recordset;
    const sources = landId
      ? { RS: await rec("LegalLandRsRecord"), LR: await rec("LegalLandLrRecord"), CS: await rec("LegalEnquiryCsRecord") }
      : { CS: await rec("LegalEnquiryCsRecord"), RS: await rec("LegalEnquiryRsRecord"), LR: await rec("LegalEnquiryLrRecord") };
    const out = parcels.map((p) => {
      const toUnit = (sqft) => (sqft == null ? null : Math.round((sqft / Number(p.F)) * 10000) / 10000);
      const sum = (rows) => { const r = rows.filter((x) => x.ParcelId === p.ParcelId); return r.length ? r.reduce((a, x) => a + Number(x.Area) * Number(x.F), 0) : null; };
      const areas = {
        "Record (parcel)": p.Area, "CS record": toUnit(sum(sources.CS)), "RS record": toUnit(sum(sources.RS)), "LR record": toUnit(sum(sources.LR)),
        Offered: p.OfferedArea, Deed: p.DeedArea, Surveyed: p.SurveyedArea, "Current ownership": p.OwnershipArea,
      };
      const vals = Object.values(areas).filter((v) => v != null).map(Number);
      const min = vals.length ? Math.min(...vals) : null, max = vals.length ? Math.max(...vals) : null;
      const diffPct = min ? Math.round(((max - min) / min) * 10000) / 100 : 0;
      const flags = [];
      if (diffPct > 1) flags.push(`Areas differ by up to ${diffPct}% (${min} → ${max} ${p.UnitName ?? ""}) — investigate`);
      if (p.SurveyedArea != null && p.OfferedArea != null && Number(p.SurveyedArea) < Number(p.OfferedArea)) flags.push("Surveyed area is less than the offered area");
      if (p.OwnershipArea != null && p.OfferedArea != null && Number(p.OwnershipArea) < Number(p.OfferedArea)) flags.push("Offered area is more than the current ownership area");
      return { ...p, areas, diffPct, flags };
    });
    res.json({ parcels: out });
  } catch (err) { fail(res, "reconciliation", err); }
});

// ── C. Ownership events ────────────────────────────────────────────────────────────────────────────
router.get("/land/:landId/events", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = idOf(req.params.landId);
    const events = (await pool.request().input("L", sql.Int, id).query(`
      SELECT e.EventId, CONVERT(char(10), e.EventDate, 23) AS EventDate, CONVERT(char(10), e.EffectiveDate, 23) AS EffectiveDate, t.Name AS EventType,
             e.ApprovalStatus, e.DeedNo, e.DocumentNo, e.TransferSharePct, e.TransferArea, e.ParcelId, p.ParcelCode, e.PreviousOwnerName, e.NewOwnerName,
             e.InheritanceId, e.ApprovalRemarks, au.name AS ApprovedByName, e.ApprovedAt, cu.name AS CreatedByName
      FROM dbo.LegalOwnershipEvent e LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = e.TransferTypeId LEFT JOIN dbo.LegalLandParcel p ON p.ParcelId = e.ParcelId
      LEFT JOIN dbo.users au ON au.id = e.ApprovedBy LEFT JOIN dbo.users cu ON cu.id = e.CreatedBy
      WHERE e.LandId = @L AND e.IsActive = 1 ORDER BY e.EventDate, e.EventId`)).recordset;
    const parties = (await pool.request().input("L", sql.Int, id).query(`SELECT x.PartyId, x.EventId, x.PartyRole, x.PersonName, x.OwnerKind, x.SharePct, x.ShareFraction, r.Name AS Relationship
      FROM dbo.LegalOwnershipEventParty x LEFT JOIN dbo.LegalLookupValue r ON r.LookupId = x.RelationshipTypeId WHERE x.LandId = @L AND x.IsActive = 1 ORDER BY x.EventId, x.PartyId`)).recordset;
    const disputes = (await pool.request().input("L", sql.Int, id).query(`SELECT Claimant, DisputeType, DisputeStatus, InheritanceId FROM dbo.LegalOwnershipDispute
      WHERE LandId = @L AND IsActive = 1 AND DisputeStatus NOT IN (N'Resolved', N'Closed')`)).recordset;
    res.json({ events: events.map((e) => ({ ...e, parties: parties.filter((p) => p.EventId === e.EventId) })), openDisputes: disputes });
  } catch (err) { fail(res, "events", err); }
});

// POST /event/:id/decision { decision: Verified | Disputed | Rejected | Pending Verification, remarks }
router.post("/event/:id/decision", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const decision = req.body?.decision, remarks = txt(req.body?.remarks, 1000);
    if (!["Verified", "Disputed", "Rejected", "Pending Verification"].includes(decision)) return res.status(400).json({ error: "Choose the decision" });
    if (decision !== "Verified" && !remarks) return res.status(400).json({ error: "Give the reason" });
    const e = (await pool.request().input("E", sql.Int, idOf(req.params.id)).query("SELECT EventId, LandId, CreatedBy, ApprovalStatus FROM dbo.LegalOwnershipEvent WHERE EventId = @E AND IsActive = 1")).recordset[0];
    if (!e) return res.status(404).json({ error: "Event not found" });
    if (e.ApprovalStatus === "Verified" && decision !== "Disputed") return res.status(409).json({ error: "This event is verified — change it through an amendment" });
    if (decision !== "Pending Verification" && !(await verifier(req))) return res.status(403).json({ error: "Only a Verifier or Legal Officer can decide on an ownership event" });
    if (decision === "Verified" && !isAdmin(req) && Number(e.CreatedBy) === Number(userOf(req))) return res.status(409).json({ error: "You entered this event — another user must verify it" });
    if (decision === "Verified") {
      const n = (await pool.request().input("E", sql.Int, e.EventId).query("SELECT SUM(CASE WHEN PartyRole = N'Transferee' THEN 1 ELSE 0 END) AS t, SUM(CASE WHEN PartyRole = N'Transferor' THEN 1 ELSE 0 END) AS f FROM dbo.LegalOwnershipEventParty WHERE EventId = @E AND IsActive = 1")).recordset[0];
      if (!n.t) return res.status(409).json({ error: "Add the transferee(s) before verifying" });
    }
    await pool.request().input("E", sql.Int, e.EventId).input("S", sql.NVarChar(30), decision).input("R", sql.NVarChar(1000), remarks).input("U", sql.Int, userOf(req))
      .query(`UPDATE dbo.LegalOwnershipEvent SET ApprovalStatus = @S, ApprovalRemarks = @R, ApprovedBy = CASE WHEN @S = N'Pending Verification' THEN NULL ELSE @U END,
                ApprovedAt = CASE WHEN @S = N'Pending Verification' THEN NULL ELSE SYSUTCDATETIME() END,
                VerificationStatus = CASE @S WHEN N'Verified' THEN N'Verified' WHEN N'Rejected' THEN N'Rejected' ELSE N'Pending' END, UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME()
              WHERE EventId = @E`);
    await writeAudit(pool, req, { action: `Ownership event ${decision.toLowerCase()}`, entityType: "Ownership Event", entityId: e.EventId, landId: e.LandId, oldValue: { status: e.ApprovalStatus }, newValue: { status: decision }, remarks });
    res.json({ message: `Ownership event: ${decision}` });
  } catch (err) { fail(res, "event decision", err); }
});

// ── D. Family and inheritance ──────────────────────────────────────────────────────────────────────
router.get("/land/:landId/family", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const rows = (await getPool().request().input("L", sql.Int, idOf(req.params.landId)).query(`SELECT MemberId, InheritanceId, FullName, Gender, RelatedToMemberId, RelationToRelated,
        RelationToDeceased, IsDeceasedOwner, IsAlive, CONVERT(char(10), DateOfDeath, 23) AS DateOfDeath, IsMinor, IsMissing, RelationshipStatus
      FROM dbo.LegalFamilyMember WHERE LandId = @L AND IsActive = 1 ORDER BY InheritanceId, MemberId`)).recordset;
    res.json({ members: rows });
  } catch (err) { fail(res, "family", err); }
});

async function loadCase(pool, id) {
  const c = (await pool.request().input("I", sql.Int, id).query(`SELECT i.*, CONVERT(char(10), i.DateOfDeath, 23) AS DeathDay, fu.name AS FrameworkConfirmedByName, lo.name AS LegalOfficerName,
      p.ParcelCode, p.Area AS ParcelArea, u.UnitName AS ParcelUnit
    FROM dbo.LegalInheritance i LEFT JOIN dbo.users fu ON fu.id = i.FrameworkConfirmedBy LEFT JOIN dbo.users lo ON lo.id = i.LegalOfficerId
    LEFT JOIN dbo.LegalLandParcel p ON p.ParcelId = i.ParcelId LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = p.AreaUnitId WHERE i.InheritanceId = @I AND i.IsActive = 1`)).recordset[0];
  if (!c) return null;
  const members = (await pool.request().input("I", sql.Int, id).input("L", sql.Int, c.LandId).query(`SELECT * FROM dbo.LegalFamilyMember
    WHERE LandId = @L AND IsActive = 1 AND (InheritanceId = @I OR InheritanceId IS NULL)`)).recordset;
  return { c, members };
}

router.get("/inheritance/:id", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadCase(pool, idOf(req.params.id));
    if (!got) return res.status(404).json({ error: "Inheritance case not found" });
    const calcs = (await pool.request().input("I", sql.Int, got.c.InheritanceId).query(`SELECT k.CalcId, k.VersionNo, k.Framework, k.RuleVersion, k.Outcome, k.ResultJson, k.Explanation, k.CalcStatus,
        k.CreatedAt, cu.name AS CreatedByName, k.ReviewedAt, ru.name AS ReviewedByName, k.ReviewRemarks
      FROM dbo.LegalInheritanceCalc k LEFT JOIN dbo.users cu ON cu.id = k.CreatedBy LEFT JOIN dbo.users ru ON ru.id = k.ReviewedBy WHERE k.InheritanceId = @I ORDER BY k.VersionNo DESC`)).recordset
      .map((k) => ({ ...k, result: k.ResultJson ? JSON.parse(k.ResultJson) : null, ResultJson: undefined }));
    const disputes = (await pool.request().input("I", sql.Int, got.c.InheritanceId).query(`SELECT Claimant, DisputeType, DisputeStatus FROM dbo.LegalOwnershipDispute
      WHERE InheritanceId = @I AND IsActive = 1 AND DisputeStatus NOT IN (N'Resolved', N'Closed')`)).recordset;
    const c = got.c;
    const flags = [];
    if (c.ApplicableFramework === "Muslim Personal Law (Shariat)" && c.PropertyType === "Agricultural") flags.push("Agricultural land under Muslim law — Legal Review Required (Shariat Act 1937 s.2); no automatic calculation");
    if (["Mitakshara Coparcenary Property", "Undivided Family Property"].includes(c.NatureOfOwnership)) flags.push("Coparcenary / undivided property — s.6 review required");
    if (c.WillAvailable) flags.push("Will available — testamentary rules (differ by personal law) need legal review");
    if (disputes.length) flags.push(`${disputes.length} open dispute(s) — the case cannot be approved while they are open`);
    res.json({ case: { InheritanceId: c.InheritanceId, LandId: c.LandId, DeceasedName: c.DeceasedName, DateOfDeath: c.DeathDay, DeceasedGender: c.DeceasedGender, ApplicableFramework: c.ApplicableFramework,
      PersonalLaw: c.PersonalLaw, SchoolOfLaw: c.SchoolOfLaw, PropertyType: c.PropertyType, NatureOfOwnership: c.NatureOfOwnership, SuccessionType: c.SuccessionType,
      AvailableSharePct: c.AvailableSharePct, AvailableShareFraction: c.AvailableShareFraction, ParcelCode: c.ParcelCode, ParcelArea: c.ParcelArea, ParcelUnit: c.ParcelUnit,
      FrameworkConfirmedByName: c.FrameworkConfirmedByName, FrameworkConfirmedAt: c.FrameworkConfirmedAt, LegalOfficerName: c.LegalOfficerName, ReviewStatus: c.ReviewStatus, ReviewRemarks: c.ReviewRemarks },
      members: got.members.map((m) => ({ MemberId: m.MemberId, FullName: m.FullName, RelationToDeceased: m.RelationToDeceased, IsAlive: m.IsAlive, IsMinor: m.IsMinor, IsMissing: m.IsMissing, RelationshipStatus: m.RelationshipStatus, IsDeceasedOwner: m.IsDeceasedOwner })),
      calcs, disputes, flags, ruleVersion: engine.RULE_VERSION });
  } catch (err) { fail(res, "inheritance", err); }
});

// POST /inheritance/:id/confirm-framework { remarks } — the Legal Officer confirms the framework (never from religion alone).
router.post("/inheritance/:id/confirm-framework", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await legalOfficer(req))) return res.status(403).json({ error: "Only a Legal Officer / Legal Reviewer can confirm the legal framework" });
    const got = await loadCase(pool, idOf(req.params.id));
    if (!got) return res.status(404).json({ error: "Inheritance case not found" });
    if (!got.c.ApplicableFramework) return res.status(400).json({ error: "Set the applicable succession framework on the case first" });
    if (!got.c.DateOfDeath || !got.c.PropertyType) return res.status(400).json({ error: "Record the date of death and the property type first — the framework depends on them" });
    await pool.request().input("I", sql.Int, got.c.InheritanceId).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), txt(req.body?.remarks, 1000))
      .query("UPDATE dbo.LegalInheritance SET FrameworkConfirmedBy = @U, FrameworkConfirmedAt = SYSUTCDATETIME(), ReviewRemarks = ISNULL(@R, ReviewRemarks), LegalOfficerId = ISNULL(LegalOfficerId, @U) WHERE InheritanceId = @I");
    await writeAudit(pool, req, { action: "Succession framework confirmed", entityType: "Inheritance", entityId: got.c.InheritanceId, landId: got.c.LandId, newValue: { framework: got.c.ApplicableFramework }, remarks: txt(req.body?.remarks, 1000) });
    res.json({ message: `Framework confirmed: ${got.c.ApplicableFramework}` });
  } catch (err) { fail(res, "confirm framework", err); }
});

// POST /inheritance/:id/calculate — a new provisional version (earlier provisional versions are superseded, all kept).
router.post("/inheritance/:id/calculate", requirePageRight(LAND, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const got = await loadCase(pool, idOf(req.params.id));
    if (!got) return res.status(404).json({ error: "Inheritance case not found" });
    if (got.c.ReviewStatus === "Approved") return res.status(409).json({ error: "This case is approved — reopen it first" });
    const caseIn = { ...got.c, DateOfDeath: got.c.DeathDay };
    const r = engine.calculate(caseIn, got.members.filter((m) => !m.IsDeceasedOwner));
    const area = got.c.ParcelArea != null ? Number(got.c.ParcelArea) : null;
    if (area != null) r.lines.forEach((l) => { l.area = Math.round(area * (l.pctOfParcel / 100) * 10000) / 10000; l.areaUnit = got.c.ParcelUnit; });
    const ver = (await pool.request().input("I", sql.Int, got.c.InheritanceId).query("SELECT ISNULL(MAX(VersionNo), 0) + 1 AS v FROM dbo.LegalInheritanceCalc WHERE InheritanceId = @I")).recordset[0].v;
    const inputs = { case: { framework: caseIn.ApplicableFramework, school: caseIn.SchoolOfLaw, gender: caseIn.DeceasedGender, death: caseIn.DateOfDeath, propertyType: caseIn.PropertyType,
      nature: caseIn.NatureOfOwnership, succession: caseIn.SuccessionType, will: !!caseIn.WillAvailable, courtOrder: !!caseIn.CourtOrderAvailable,
      available: caseIn.AvailableShareFraction ?? caseIn.AvailableSharePct, frameworkConfirmedBy: caseIn.FrameworkConfirmedBy },
      members: got.members.map((m) => ({ id: m.MemberId, name: m.FullName, relation: m.RelationToDeceased, alive: m.IsAlive, died: m.DateOfDeath, minor: m.IsMinor, status: m.RelationshipStatus, branchOf: m.RelatedToMemberId, rel: m.RelationToRelated })) };
    await pool.request().input("I", sql.Int, got.c.InheritanceId).query("UPDATE dbo.LegalInheritanceCalc SET CalcStatus = N'Superseded' WHERE InheritanceId = @I AND CalcStatus = N'Provisional'");
    await pool.request().input("I", sql.Int, got.c.InheritanceId).input("L", sql.Int, got.c.LandId).input("V", sql.Int, ver).input("F", sql.NVarChar(60), caseIn.ApplicableFramework)
      .input("RV", sql.NVarChar(60), r.ruleVersion.slice(0, 60)).input("O", sql.NVarChar(30), r.outcome).input("IN", sql.NVarChar(sql.MAX), JSON.stringify(inputs))
      .input("RE", sql.NVarChar(sql.MAX), JSON.stringify({ lines: r.lines, total: r.total, reasons: r.reasons })).input("EX", sql.NVarChar(sql.MAX), [...r.reasons.map((x) => `Review: ${x}`), ...r.explanation].join("\n"))
      .input("U", sql.Int, userOf(req))
      .query(`INSERT INTO dbo.LegalInheritanceCalc (InheritanceId, LandId, VersionNo, Framework, RuleVersion, Outcome, InputsJson, ResultJson, Explanation, CreatedBy)
              VALUES (@I, @L, @V, @F, @RV, @O, @IN, @RE, @EX, @U)`);
    await writeAudit(pool, req, { action: "Inheritance shares calculated (provisional)", entityType: "Inheritance", entityId: got.c.InheritanceId, landId: got.c.LandId, newValue: { version: ver, outcome: r.outcome } });
    res.status(201).json({ message: r.outcome === "Calculated" ? `Version ${ver}: provisional shares calculated — a Legal Officer must review them` : `Version ${ver}: Requires Legal Review — ${r.reasons[0]}`, outcome: r.outcome });
  } catch (err) { fail(res, "calculate", err); }
});

// POST /calc/:id/review { decision: Approved | Rejected, remarks } — Legal Officer, not the one who calculated.
router.post("/calc/:id/review", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const decision = req.body?.decision, remarks = txt(req.body?.remarks, 1000);
    if (!["Approved", "Rejected"].includes(decision)) return res.status(400).json({ error: "Choose Approve or Reject" });
    if (decision === "Rejected" && !remarks) return res.status(400).json({ error: "Give the reason" });
    if (!(await legalOfficer(req))) return res.status(403).json({ error: "Only a Legal Officer / Legal Reviewer can review a calculation" });
    const k = (await pool.request().input("K", sql.Int, idOf(req.params.id)).query("SELECT CalcId, InheritanceId, LandId, Outcome, CalcStatus, CreatedBy, VersionNo FROM dbo.LegalInheritanceCalc WHERE CalcId = @K")).recordset[0];
    if (!k) return res.status(404).json({ error: "Calculation not found" });
    if (k.CalcStatus !== "Provisional") return res.status(409).json({ error: `This version is ${k.CalcStatus.toLowerCase()}` });
    if (decision === "Approved" && k.Outcome !== "Calculated") return res.status(409).json({ error: "A 'Requires Legal Review' result cannot be approved — record the heirs and shares by legal decision" });
    if (!isAdmin(req) && Number(k.CreatedBy) === Number(userOf(req))) return res.status(409).json({ error: "You ran this calculation — another Legal Officer must review it" });
    if (decision === "Approved") await pool.request().input("I", sql.Int, k.InheritanceId).query("UPDATE dbo.LegalInheritanceCalc SET CalcStatus = N'Superseded' WHERE InheritanceId = @I AND CalcStatus = N'Approved'");
    await pool.request().input("K", sql.Int, k.CalcId).input("S", sql.NVarChar(30), decision).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), remarks)
      .query("UPDATE dbo.LegalInheritanceCalc SET CalcStatus = @S, ReviewedBy = @U, ReviewedAt = SYSUTCDATETIME(), ReviewRemarks = @R WHERE CalcId = @K");
    await writeAudit(pool, req, { action: `Inheritance calculation ${decision.toLowerCase()}`, entityType: "Inheritance", entityId: k.InheritanceId, landId: k.LandId, newValue: { version: k.VersionNo }, remarks });
    res.json({ message: `Version ${k.VersionNo} ${decision.toLowerCase()}` });
  } catch (err) { fail(res, "calc review", err); }
});

// POST /inheritance/:id/workflow { action, remarks }
//   submit (Draft / Returned / Further Investigation → Verifier Review) · verify (→ Legal Officer Review) ·
//   approve (Legal Officer; approved calculation or recorded heirs; no open dispute → Approved + verified event) ·
//   return · reject · dispute · investigate · reopen (Approved → Returned, Legal Officer, reason)
const FLOW = {
  submit: { from: ["Draft", "Returned", "Further Investigation"], to: "Verifier Review", who: "edit" },
  verify: { from: ["Verifier Review"], to: "Legal Officer Review", who: "verifier" },
  approve: { from: ["Legal Officer Review"], to: "Approved", who: "officer" },
  return: { from: ["Verifier Review", "Legal Officer Review"], to: "Returned", who: "verifier", reason: true },
  reject: { from: ["Legal Officer Review"], to: "Rejected", who: "officer", reason: true },
  dispute: { from: ["Verifier Review", "Legal Officer Review", "Draft"], to: "Disputed", who: "verifier", reason: true },
  investigate: { from: ["Verifier Review", "Legal Officer Review"], to: "Further Investigation", who: "verifier", reason: true },
  reopen: { from: ["Approved", "Rejected", "Disputed"], to: "Returned", who: "officer", reason: true },
};
router.post("/inheritance/:id/workflow", requirePageRight(LAND, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const f = FLOW[req.body?.action];
    if (!f) return res.status(400).json({ error: "Unknown action" });
    const remarks = txt(req.body?.remarks, 1000);
    if (f.reason && !remarks) return res.status(400).json({ error: "Give the reason" });
    const got = await loadCase(pool, idOf(req.params.id));
    if (!got) return res.status(404).json({ error: "Inheritance case not found" });
    const c = got.c;
    if (!f.from.includes(c.ReviewStatus)) return res.status(409).json({ error: `The case is ${c.ReviewStatus} — this action is not possible now` });
    const { hasAnyPageAction } = require("../../middleware/requirePageRight");
    if (f.who === "edit" && !(await hasAnyPageAction(req, LAND, ["edit"]))) return res.status(403).json({ error: "You cannot submit this case" });
    if (f.who === "verifier" && !(await verifier(req))) return res.status(403).json({ error: "Only a Verifier or Legal Officer can do this" });
    if (f.who === "officer" && !(await legalOfficer(req))) return res.status(403).json({ error: "Only a Legal Officer / Legal Reviewer can do this" });
    if (req.body.action === "verify" && !isAdmin(req) && Number(c.UpdatedBy ?? c.CreatedBy) === Number(userOf(req))) return res.status(409).json({ error: "You prepared this case — another user must verify it" });
    let approvedCalc = null;
    if (req.body.action === "submit" && !got.members.some((m) => !m.IsDeceasedOwner)) return res.status(400).json({ error: "Record the family members first" });
    if (req.body.action === "approve") {
      if (!c.FrameworkConfirmedBy) return res.status(409).json({ error: "Confirm the legal framework first" });
      const open = (await pool.request().input("I", sql.Int, c.InheritanceId).query("SELECT COUNT(*) AS n FROM dbo.LegalOwnershipDispute WHERE InheritanceId = @I AND IsActive = 1 AND DisputeStatus NOT IN (N'Resolved', N'Closed')")).recordset[0].n;
      if (open) return res.status(409).json({ error: `${open} open dispute(s) on this case — resolve them first` });
      approvedCalc = (await pool.request().input("I", sql.Int, c.InheritanceId).query("SELECT TOP 1 ResultJson FROM dbo.LegalInheritanceCalc WHERE InheritanceId = @I AND CalcStatus = N'Approved' ORDER BY VersionNo DESC")).recordset[0];
      const heirs = (await pool.request().input("I", sql.Int, c.InheritanceId).query("SELECT COUNT(*) AS n FROM dbo.LegalInheritanceHeir WHERE InheritanceId = @I AND IsActive = 1")).recordset[0].n;
      if (!approvedCalc && !heirs) return res.status(409).json({ error: "Approve a calculation, or record the heirs and their shares by legal decision, first" });
    }
    await pool.request().input("I", sql.Int, c.InheritanceId).input("S", sql.NVarChar(40), f.to).input("R", sql.NVarChar(1000), remarks).input("U", sql.Int, userOf(req))
      .query("UPDATE dbo.LegalInheritance SET ReviewStatus = @S, ReviewRemarks = ISNULL(@R, ReviewRemarks), UpdatedBy = @U, UpdatedAt = SYSUTCDATETIME() WHERE InheritanceId = @I");
    // Approved: the verified ownership event of the inheritance (deceased → heirs), so the event tree shows it.
    if (req.body.action === "approve") {
      const typeId = (await pool.request().query("SELECT TOP 1 LookupId FROM dbo.LegalLookupValue WHERE Category = N'transfer-type' AND Name = N'Inheritance'")).recordset[0]?.LookupId;
      const lines = approvedCalc ? JSON.parse(approvedCalc.ResultJson).lines.map((l) => ({ name: l.name, pct: l.pctOfParcel, frac: l.fractionOfParcel }))
        : (await pool.request().input("I", sql.Int, c.InheritanceId).query("SELECT HeirName AS name, SharePct AS pct FROM dbo.LegalInheritanceHeir WHERE InheritanceId = @I AND IsActive = 1 AND ISNULL(Relinquished, N'No') <> N'Yes'")).recordset;
      if (typeId && lines.length && !(await pool.request().input("I", sql.Int, c.InheritanceId).query("SELECT 1 AS x FROM dbo.LegalOwnershipEvent WHERE InheritanceId = @I AND IsActive = 1")).recordset[0]) {
        const ev = (await pool.request().input("L", sql.Int, c.LandId).input("T", sql.Int, typeId).input("D", sql.Date, c.DateOfDeath ?? new Date()).input("P", sql.NVarChar(200), c.DeceasedName)
          .input("N", sql.NVarChar(200), lines.map((l) => l.name).join(", ").slice(0, 200)).input("S", sql.Decimal(9, 4), c.AvailableSharePct ?? null).input("PA", sql.Int, c.ParcelId ?? null)
          .input("I", sql.Int, c.InheritanceId).input("U", sql.Int, userOf(req)).input("R", sql.NVarChar(1000), `From approved inheritance case${remarks ? `: ${remarks}` : ""}`)
          .query(`INSERT INTO dbo.LegalOwnershipEvent (LandId, TransferTypeId, EventDate, EffectiveDate, PreviousOwnerName, NewOwnerName, TransferSharePct, ParcelId, InheritanceId,
                    ApprovalStatus, ApprovedBy, ApprovedAt, ApprovalRemarks, VerificationStatus, IsActive, CreatedBy)
                  OUTPUT INSERTED.EventId VALUES (@L, @T, @D, @D, @P, @N, @S, @PA, @I, N'Verified', @U, SYSUTCDATETIME(), @R, N'Verified', 1, @U)`)).recordset[0].EventId;
        await pool.request().input("E", sql.Int, ev).input("L", sql.Int, c.LandId).input("N", sql.NVarChar(200), c.DeceasedName).input("S", sql.Decimal(9, 6), c.AvailableSharePct ?? null)
          .input("F", sql.NVarChar(20), c.AvailableShareFraction ?? null).input("U", sql.Int, userOf(req))
          .query("INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, SharePct, ShareFraction, CreatedBy) VALUES (@E, @L, N'Transferor', @N, @S, @F, @U)");
        for (const l of lines) await pool.request().input("E", sql.Int, ev).input("L", sql.Int, c.LandId).input("N", sql.NVarChar(200), l.name).input("S", sql.Decimal(9, 6), l.pct ?? null)
          .input("F", sql.NVarChar(20), l.frac ?? null).input("U", sql.Int, userOf(req))
          .query("INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, OwnerKind, SharePct, ShareFraction, CreatedBy) VALUES (@E, @L, N'Transferee', @N, N'Legal Heir / Successor', @S, @F, @U)");
      }
    }
    await writeAudit(pool, req, { action: `Inheritance case: ${req.body.action}`, entityType: "Inheritance", entityId: c.InheritanceId, landId: c.LandId, oldValue: { status: c.ReviewStatus }, newValue: { status: f.to }, remarks });
    res.json({ message: `Case ${f.to.toLowerCase()}${req.body.action === "approve" ? " — verified inheritance event added to the ownership history" : ""}` });
  } catch (err) { fail(res, "workflow", err); }
});

module.exports = router;
