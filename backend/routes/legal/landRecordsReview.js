"use strict";
// Land Records Search — the consolidated summary of one enquiry's investigation, the Land Conversion gate built on it,
// and the frozen snapshot taken at conversion. Works with a pool or a transaction (anything with .request()).
// Nothing here concludes ownership: the summary lists what was found, what differs and what the legal team decided.
const crypto = require("crypto");
const { sql } = require("../../db");

const OPEN = ["Open", "Under Investigation", "Unresolved", "Referred to Legal Team"];
const PROCEED = ["Recommended to Proceed", "Proceed with Conditions"];
const STOP = ["Hold for Further Investigation", "Not Recommended"];

async function has(db, table) {
  return !!(await db.request().input("t", sql.NVarChar(128), `dbo.${table}`).query("SELECT OBJECT_ID(@t, 'U') AS id")).recordset[0].id;
}

/** Everything about one enquiry's land records investigation, in one object. */
async function buildSummary(db, enquiryId) {
  const q = async (text) => (await db.request().input("e", sql.Int, enquiryId).query(text)).recordset;
  const [enquiry] = await q(`SELECT e.EnquiryId, e.EnquiryNo, e.LandLocation, e.JLNo, e.RsDagNo, e.LrDagNo, e.RsKhatianNo, e.LrKhatianNo, e.ApproxArea, u.UnitName AS AreaUnit,
      e.EnquiryStatus, e.LandId, m.MouzaName, d.DistrictName, p.name AS ProjectName
    FROM dbo.LegalLandEnquiry e LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = e.DistrictId
    LEFT JOIN dbo.enterprise p ON p.id = e.ProjectId LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = e.AreaUnitId WHERE e.EnquiryId = @e`);
  if (!enquiry) return null;
  const sources = await q(`SELECT o.OfficeType, ISNULL(t.SourceKind, N'Registry office') AS SourceKind, o.Mandatory, o.Status, o.FromYear, o.ToYear, CONVERT(char(10), o.DueDate, 23) AS DueDate,
      o.ExceptionNote, r.OfficeName,
      (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType) AS Years,
      (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.Status = N'Found') AS Found,
      (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.Status = N'Not Found') AS NotFound,
      (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType AND s.Status = N'Not Applicable') AS NotApplicable,
      (SELECT COUNT(*) FROM dbo.LegalEnquiryDeedSearch s WHERE s.EnquiryId = o.EnquiryId AND s.OfficeType = o.OfficeType
        AND s.Status IN (N'Under Review', N'Requested', N'Certified Copy Requested', N'Awaiting Office Response')) AS Waiting,
      CASE WHEN o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS Overdue
    FROM dbo.LegalEnquiryOfficeSearch o LEFT JOIN dbo.LegalRegistrationOfficeType t ON t.OfficeTypeId = o.OfficeTypeId
    LEFT JOIN dbo.LegalRegistrationOffice r ON r.OfficeId = o.OfficeId WHERE o.EnquiryId = @e ORDER BY t.SortOrder, o.OfficeType`);
  const found = await q(`SELECT OfficeType, CalendarYear, DeedNo, CONVERT(char(10), DeedDate, 23) AS DeedDate, Parties, Details, SearchMethod, ReferenceNo
    FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @e AND Status = N'Found' ORDER BY OfficeType, CalendarYear`);
  const rec = async (t, dag, kh) => q(`SELECT ${kh} AS Khatian, ${dag} AS Dag, r.RecordedHolder, r.Area, u.UnitName AS Unit, r.LandClass, r.RecordYear, r.RecordStatus, r.SourceMethod
    FROM dbo.${t} r LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = r.AreaUnitId WHERE r.EnquiryId = @e AND r.IsActive = 1`);
  const records = {
    CS: (await has(db, "LegalEnquiryCsRecord")) ? await rec("LegalEnquiryCsRecord", "CsDagNo", "CsKhatianNo") : [],
    RS: await rec("LegalEnquiryRsRecord", "RsDagNo", "RsKhatianNo"),
    LR: await rec("LegalEnquiryLrRecord", "LrDagNo", "LrKhatianNo"),
  };
  const maps = (await has(db, "LegalLandRecordMap")) ? await q(`SELECT RTRIM(FromType) AS FromType, FromId, RTRIM(ToType) AS ToType, ToId, MatchStatus, MatchBasis
    FROM dbo.LegalLandRecordMap WHERE EnquiryId = @e AND IsActive = 1`) : [];
  const p2 = await has(db, "LegalLandDiscrepancy");
  const discrepancies = p2 ? await q(`SELECT x.DiscrepancyType, x.RelatedRecord, x.PreviousInfo, x.CurrentInfo, x.Severity, x.InvestigationStatus, x.ResolutionRemarks, u.name AS AssignedTo
    FROM dbo.LegalLandDiscrepancy x LEFT JOIN dbo.users u ON u.id = x.AssignedUserId WHERE x.EnquiryId = @e AND x.IsActive = 1 ORDER BY x.CreatedAt`) : [];
  const alternative = p2 ? await q(`SELECT a.Category, s.Name AS Subcategory, a.ReferenceNo, a.HolderClaimant, a.IssuingAuthority, CONVERT(char(10), a.RelevantDate, 23) AS RelevantDate, a.VerificationStatus
    FROM dbo.LegalLandAltHistory a LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = a.SubcategoryId WHERE a.EnquiryId = @e AND a.IsActive = 1 ORDER BY a.RelevantDate`) : [];
  const possession = p2 ? await q(`SELECT OccupantName, PossessionType, CONVERT(char(10), StartDate, 23) AS StartDate, CONVERT(char(10), EndDate, 23) AS EndDate, VerificationStatus
    FROM dbo.LegalLandPossession WHERE EnquiryId = @e AND IsActive = 1 ORDER BY StartDate`) : [];
  const [review] = p2 ? await q(`SELECT TOP 1 r.RiskLevel, r.Recommendation, r.Remarks, r.Conditions, CONVERT(char(10), r.ReviewDate, 23) AS ReviewDate, u.name AS Reviewer,
      r.OverallSearchStatus, r.OwnershipChainStatus, r.RecordMatchingStatus, r.RegistryDeedStatus, r.PossessionStatus, r.DiscrepancyStatus
    FROM dbo.LegalLandSearchReview r LEFT JOIN dbo.users u ON u.id = r.ReviewedBy WHERE r.EnquiryId = @e AND r.IsActive = 1 ORDER BY r.ReviewDate DESC, r.ReviewId DESC`) : [];
  const docs = await q(`SELECT N'Year result' AS Kind, s.OfficeType + N' ' + CAST(s.CalendarYear AS NVARCHAR(10)) AS RelatedTo, f.FileName
    FROM dbo.LegalEnquiryDeedSearch s JOIN dbo.LegalMasterFile f ON f.FileId = s.EvidenceFileId WHERE s.EnquiryId = @e`);

  const mandatory = sources.filter((s) => s.Mandatory !== false && s.Mandatory !== 0);
  const figures = {
    totalSources: sources.length, completed: sources.filter((s) => s.Status === "Completed").length,
    pending: sources.filter((s) => s.Status === "Pending").length, overdue: sources.filter((s) => s.Overdue).length,
    mandatoryOpen: mandatory.filter((s) => s.Status === "Pending").length,
    found: sources.reduce((a, s) => a + s.Found, 0), notFound: sources.reduce((a, s) => a + s.NotFound, 0),
    notApplicable: sources.reduce((a, s) => a + s.NotApplicable, 0), waiting: sources.reduce((a, s) => a + s.Waiting, 0),
    exceptions: sources.filter((s) => s.ExceptionNote).length,
    openDiscrepancies: discrepancies.filter((d) => OPEN.includes(d.InvestigationStatus)).length,
    seriousOpen: discrepancies.filter((d) => OPEN.includes(d.InvestigationStatus) && ["High", "Critical"].includes(d.Severity)).length,
    mappingPending: maps.filter((m) => m.MatchStatus === "Requires Legal Review").length,
  };
  // Observations: plain facts the legal team should look at (never conclusions).
  const observations = [];
  const areas = ["CS", "RS", "LR"].flatMap((t) => records[t].filter((r) => r.Area != null).map((r) => `${t} ${Number(r.Area)} ${r.Unit ?? ""}`.trim()));
  if (new Set(areas.map((a) => a.slice(3))).size > 1) observations.push(`Land area differs between records: ${areas.join(" · ")}`);
  const holders = ["CS", "RS", "LR"].flatMap((t) => records[t].filter((r) => r.RecordedHolder).map((r) => `${t} ${r.RecordedHolder}`));
  if (new Set(holders.map((h) => h.slice(3).toLowerCase())).size > 1) observations.push(`Recorded holder changes: ${holders.join(" → ")}`);
  ["CS", "RS", "LR"].forEach((t) => { if (!records[t].length) observations.push(`No ${t} record entered`); });
  if (alternative.length) observations.push(`${alternative.length} alternative history entr${alternative.length === 1 ? "y" : "ies"} (${[...new Set(alternative.map((a) => a.Subcategory ?? a.Category))].join(", ")})`);
  const unauthorised = possession.filter((p) => ["Unauthorized Occupation", "Disputed Possession"].includes(p.PossessionType) && !p.EndDate);
  if (unauthorised.length) observations.push(`Current possession concern: ${unauthorised.map((p) => `${p.OccupantName} (${p.PossessionType})`).join(", ")}`);
  if (figures.exceptions) observations.push(`${figures.exceptions} source${figures.exceptions > 1 ? "s" : ""} completed with an exception`);
  const overall = figures.mandatoryOpen ? "Search in progress"
    : review && STOP.includes(review.Recommendation) ? review.Recommendation
    : figures.seriousOpen || figures.exceptions || figures.openDiscrepancies ? (review && PROCEED.includes(review.Recommendation) ? review.Recommendation : "Further verification required")
    : review && PROCEED.includes(review.Recommendation) ? review.Recommendation : "Search complete — legal review pending";
  return { enquiry, sources, found, records, maps, discrepancies, alternative, possession, review: review ?? null, documents: docs, figures, observations, overall };
}

/**
 * Land Conversion gate beyond the searches themselves: a latest review of Hold / Not Recommended stops it; open
 * discrepancies or exceptions need a latest review that recommends proceeding. Returns an error message or null.
 */
async function gateError(db, enquiryId) {
  if (!(await has(db, "LegalLandSearchReview"))) return null;
  const s = await buildSummary(db, enquiryId);
  if (!s) return null;
  if (s.review && STOP.includes(s.review.Recommendation)) return `The latest legal review says "${s.review.Recommendation}" — record a new review before converting.`;
  const needs = [];
  if (s.figures.openDiscrepancies) needs.push(`${s.figures.openDiscrepancies} open discrepanc${s.figures.openDiscrepancies === 1 ? "y" : "ies"}`);
  if (s.figures.exceptions) needs.push(`${s.figures.exceptions} search exception${s.figures.exceptions === 1 ? "" : "s"}`);
  if (needs.length && !(s.review && PROCEED.includes(s.review.Recommendation)))
    return `${needs.join(" and ")} — a legal review recommending to proceed (Land Records Search → Legal review) is needed before conversion.`;
  return null;
}

/** Freezes the whole investigation at conversion (JSON + SHA-256). */
async function snapshot(db, enquiryId, landId, userId) {
  if (!(await has(db, "LegalEnquirySearchSnapshot"))) return;
  const s = await buildSummary(db, enquiryId);
  const json = JSON.stringify({ takenAt: new Date().toISOString(), ...s });
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  await db.request().input("e", sql.Int, enquiryId).input("l", sql.Int, landId).input("j", sql.NVarChar(sql.MAX), json).input("h", sql.Char(64), hash).input("u", sql.Int, userId || null)
    .query("INSERT INTO dbo.LegalEnquirySearchSnapshot (EnquiryId, LandId, SnapshotJson, SnapshotHash, CreatedBy) VALUES (@e, @l, @j, @h, @u)");
}

module.exports = { buildSummary, gateError, snapshot, OPEN };
