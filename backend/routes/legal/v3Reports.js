"use strict";
// Legal V3 reports (spec 17.2): ownership & inheritance, legal investigation, acquisition & compliance. Each is a
// { title, run(req, pool) → { columns, rows } } entry merged into verificationReports.js, so the same screen, filters
// and PDF / Excel export apply. Rows carry ProjectId for the project picker / access. Provisional inheritance results
// are always labelled as provisional.
const LAND = `LEFT JOIN dbo.LegalLand l ON l.LandId = x.LandId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict dd ON dd.DistrictId = l.DistrictId`;
const LCOLS = `l.LandCode, l.ProjectId, m.MouzaName, dd.DistrictName`;
const C = (key, label) => ({ key, label });
const L3 = [C("LandCode", "Land"), C("MouzaName", "Mouza")];

const q = async (pool, text) => {
  try { return (await pool.request().query(text)).recordset; } catch (e) { if (/Invalid object name|Invalid column/.test(e.message)) return []; throw e; }
};
const rep = (title, sqlText, columns, dateKey) => ({
  title, dateKey,
  run: async (req, pool, { scoped, inRange }) => ({ columns, rows: scoped(req, await q(pool, sqlText)).filter((r) => !dateKey || inRange(req, r[dateKey])) }),
});

module.exports = {
  // ── Ownership and inheritance ──
  "parcel-register": rep("Land Parcel Register", `
    SELECT p.ParcelCode, e.EnquiryNo, l.LandCode, ISNULL(l.ProjectId, e.ProjectId) AS ProjectId, m.MouzaName, dd.DistrictName, p.JLNo, p.CsDagNo, p.RsDagNo, p.LrDagNo,
           CONCAT_WS(' / ', p.CsKhatianNo, p.RsKhatianNo, p.LrKhatianNo) AS Khatian, CAST(p.Area AS FLOAT) AS Area, u.UnitName, p.OfferedOwner,
           COALESCE(p.OfferedShareFraction, CAST(CAST(p.OfferedSharePct AS DECIMAL(9,4)) AS NVARCHAR(20))) AS OfferedShare, p.ParcelStatus AS Status, p.CreatedAt
    FROM dbo.LegalLandParcel p LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = p.EnquiryId LEFT JOIN dbo.LegalLand l ON l.LandId = p.LandId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = p.MouzaId LEFT JOIN dbo.LegalDistrict dd ON dd.DistrictId = ISNULL(p.DistrictId, ISNULL(l.DistrictId, e.DistrictId))
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = p.AreaUnitId WHERE p.IsActive = 1 ORDER BY p.ParcelCode`,
    [C("ParcelCode", "Parcel"), C("EnquiryNo", "Enquiry"), C("LandCode", "Land"), C("MouzaName", "Mouza"), C("DistrictName", "District"), C("JLNo", "J.L."), C("CsDagNo", "CS Dag"),
      C("RsDagNo", "RS Dag"), C("LrDagNo", "LR Dag"), C("Khatian", "Khatian CS / RS / LR"), C("Area", "Area"), C("UnitName", "Unit"), C("OfferedOwner", "Offered by"), C("OfferedShare", "Offered share"), C("Status", "Status")], "CreatedAt"),
  "ownership-events": rep("Ownership Event Register", `
    SELECT ${LCOLS}, x.EventDate, t.Name AS EventType, p.ParcelCode, x.ApprovalStatus AS Status,
           (SELECT STRING_AGG(y.PersonName + ISNULL(' ' + y.ShareFraction, ISNULL(' ' + CAST(CAST(y.SharePct AS DECIMAL(9,4)) AS NVARCHAR(20)) + '%', '')), ', ') FROM dbo.LegalOwnershipEventParty y WHERE y.EventId = x.EventId AND y.IsActive = 1 AND y.PartyRole = N'Transferor') AS Transferors,
           (SELECT STRING_AGG(y.PersonName + ISNULL(' ' + y.ShareFraction, ISNULL(' ' + CAST(CAST(y.SharePct AS DECIMAL(9,4)) AS NVARCHAR(20)) + '%', '')), ', ') FROM dbo.LegalOwnershipEventParty y WHERE y.EventId = x.EventId AND y.IsActive = 1 AND y.PartyRole = N'Transferee') AS Transferees,
           ISNULL(x.DeedNo, x.DocumentNo) AS Reference, au.name AS VerifiedBy
    FROM dbo.LegalOwnershipEvent x ${LAND} LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.TransferTypeId LEFT JOIN dbo.LegalLandParcel p ON p.ParcelId = x.ParcelId
    LEFT JOIN dbo.users au ON au.id = x.ApprovedBy WHERE x.IsActive = 1 ORDER BY l.LandCode, x.EventDate`,
    [...L3, C("EventDate", "Date"), C("EventType", "Event"), C("ParcelCode", "Parcel"), C("Transferors", "From"), C("Transferees", "To"), C("Reference", "Deed / order"), C("Status", "Status"), C("VerifiedBy", "Decided by")], "EventDate"),
  "owner-holdings": rep("Owner-wise Land Holding", `
    SELECT x.OwnerName, ${LCOLS}, p.ParcelCode, CAST(x.SharePct AS FLOAT) AS SharePct, x.ShareFraction, x.OwnerKind, x.ValidFrom, x.VerificationStatus AS Status
    FROM dbo.LegalOwnershipRecord x ${LAND} LEFT JOIN dbo.LegalLandParcel p ON p.ParcelId = x.ParcelId
    WHERE x.IsActive = 1 AND x.ValidTo IS NULL ORDER BY x.OwnerName, l.LandCode`,
    [C("OwnerName", "Owner"), ...L3, C("ParcelCode", "Parcel"), C("SharePct", "Share %"), C("ShareFraction", "Fraction"), C("OwnerKind", "Kind"), C("ValidFrom", "Since"), C("Status", "Status")], "ValidFrom"),
  "cs-rs-lr-mapping": rep("CS-RS-LR Mapping Report", `
    SELECT e.EnquiryNo, e.ProjectId, mz.MouzaName, RTRIM(x.FromType) + ' ' + ISNULL(f.Dag, '?') + ' / Kh ' + ISNULL(f.Kh, '?') AS FromRecord,
           RTRIM(x.ToType) + ' ' + ISNULL(t.Dag, '?') + ' / Kh ' + ISNULL(t.Kh, '?') AS ToRecord, f.Holder AS FromHolder, t.Holder AS ToHolder,
           CAST(f.Area AS FLOAT) AS FromArea, CAST(t.Area AS FLOAT) AS ToArea, x.MatchStatus AS Status, x.MatchBasis, x.CreatedAt
    FROM dbo.LegalLandRecordMap x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId LEFT JOIN dbo.LegalMouza mz ON mz.MouzaId = e.MouzaId
    OUTER APPLY (SELECT TOP 1 Dag, Kh, Holder, Area FROM (SELECT CsDagNo AS Dag, CsKhatianNo AS Kh, RecordedHolder AS Holder, Area FROM dbo.LegalEnquiryCsRecord WHERE x.FromType = N'CS' AND CsRecordId = x.FromId
      UNION ALL SELECT RsDagNo, RsKhatianNo, RecordedHolder, Area FROM dbo.LegalEnquiryRsRecord WHERE x.FromType = N'RS' AND RsRecordId = x.FromId) a) f
    OUTER APPLY (SELECT TOP 1 Dag, Kh, Holder, Area FROM (SELECT RsDagNo AS Dag, RsKhatianNo AS Kh, RecordedHolder AS Holder, Area FROM dbo.LegalEnquiryRsRecord WHERE x.ToType = N'RS' AND RsRecordId = x.ToId
      UNION ALL SELECT LrDagNo, LrKhatianNo, RecordedHolder, Area FROM dbo.LegalEnquiryLrRecord WHERE x.ToType = N'LR' AND LrRecordId = x.ToId) b) t
    WHERE x.IsActive = 1 ORDER BY e.EnquiryNo`,
    [C("EnquiryNo", "Enquiry"), C("MouzaName", "Mouza"), C("FromRecord", "Older record"), C("ToRecord", "Newer record"), C("FromHolder", "Older holder"), C("ToHolder", "Newer holder"),
      C("FromArea", "Older area"), C("ToArea", "Newer area"), C("Status", "Match"), C("MatchBasis", "Basis")], "CreatedAt"),
  "inheritance-cases": rep("Inheritance Case Register", `
    SELECT ${LCOLS}, x.DeceasedName, x.DateOfDeath, x.DeceasedGender, x.ApplicableFramework, x.SchoolOfLaw, x.PropertyType, x.NatureOfOwnership, x.SuccessionType,
           x.ReviewStatus AS Status, CASE WHEN x.FrameworkConfirmedBy IS NULL THEN N'No' ELSE N'Yes' END AS FrameworkConfirmed, lo.name AS LegalOfficer,
           (SELECT COUNT(*) FROM dbo.LegalOwnershipDispute d WHERE d.InheritanceId = x.InheritanceId AND d.IsActive = 1 AND d.DisputeStatus NOT IN (N'Resolved', N'Closed')) AS OpenDisputes
    FROM dbo.LegalInheritance x ${LAND} LEFT JOIN dbo.users lo ON lo.id = x.LegalOfficerId WHERE x.IsActive = 1 ORDER BY l.LandCode`,
    [...L3, C("DeceasedName", "Deceased"), C("DateOfDeath", "Died"), C("ApplicableFramework", "Framework"), C("SchoolOfLaw", "School"), C("PropertyType", "Property"),
      C("NatureOfOwnership", "Nature"), C("SuccessionType", "Succession"), C("FrameworkConfirmed", "Framework confirmed"), C("LegalOfficer", "Legal officer"), C("OpenDisputes", "Open disputes"), C("Status", "Status")], "DateOfDeath"),
  "legal-heirs": rep("Legal Heir Register", `
    SELECT ${LCOLS}, i.DeceasedName, x.FullName AS Heir, x.RelationToDeceased AS Relation, CASE WHEN x.IsAlive = 1 THEN N'Alive' ELSE N'Deceased' END AS Alive,
           CASE WHEN x.IsMinor = 1 THEN N'Yes' ELSE N'' END AS Minor, CASE WHEN x.IsMissing = 1 THEN N'Yes' ELSE N'' END AS Missing, x.RelationshipStatus AS Status, i.ReviewStatus AS CaseStatus
    FROM dbo.LegalFamilyMember x ${LAND} LEFT JOIN dbo.LegalInheritance i ON i.InheritanceId = x.InheritanceId WHERE x.IsActive = 1 AND x.IsDeceasedOwner = 0 ORDER BY l.LandCode, i.DeceasedName`,
    [...L3, C("DeceasedName", "Deceased"), C("Heir", "Family member / potential heir"), C("Relation", "Relation"), C("Alive", "Alive"), C("Minor", "Minor"), C("Missing", "Missing"), C("Status", "Relationship"), C("CaseStatus", "Case")]),
  "inheritance-calculations": rep("Inheritance Share Calculation", `
    SELECT ${LCOLS}, i.DeceasedName, x.VersionNo, x.Framework, x.Outcome, x.CalcStatus AS Status,
           CASE WHEN x.CalcStatus = N'Approved' THEN N'Approved by Legal Officer' ELSE N'PROVISIONAL — not legally verified' END AS Basis,
           j.name AS Heir, j.ofEstate AS ShareOfEstate, j.ofParcel AS ShareOfParcel, x.RuleVersion, x.CreatedAt, ru.name AS ReviewedBy
    FROM dbo.LegalInheritanceCalc x ${LAND} JOIN dbo.LegalInheritance i ON i.InheritanceId = x.InheritanceId LEFT JOIN dbo.users ru ON ru.id = x.ReviewedBy
    OUTER APPLY OPENJSON(x.ResultJson, '$.lines') WITH (name NVARCHAR(200) '$.name', ofEstate NVARCHAR(40) '$.fractionOfEstate', ofParcel NVARCHAR(40) '$.fractionOfParcel') j
    WHERE x.CalcStatus <> N'Superseded' ORDER BY l.LandCode, i.DeceasedName, x.VersionNo DESC`,
    [...L3, C("DeceasedName", "Deceased"), C("VersionNo", "Version"), C("Framework", "Framework"), C("Outcome", "Outcome"), C("Basis", "Basis"), C("Heir", "Heir"),
      C("ShareOfEstate", "Of estate"), C("ShareOfParcel", "Of parcel"), C("Status", "Status"), C("ReviewedBy", "Reviewed by"), C("RuleVersion", "Rule version")], "CreatedAt"),
  "hindu-succession": rep("Hindu Succession Review", `
    SELECT ${LCOLS}, x.DeceasedName, x.DeceasedGender, x.NatureOfOwnership, x.SuccessionType, x.ReviewStatus AS Status,
           CASE WHEN x.NatureOfOwnership IN (N'Mitakshara Coparcenary Property', N'Undivided Family Property') THEN N'Coparcenary — s.6 review'
                WHEN x.DeceasedGender = N'Female' THEN N'Female intestate — s.15 / s.16' WHEN x.DeceasedGender = N'Male' THEN N'Male intestate — s.8 / s.10' ELSE N'Gender not recorded' END AS Path
    FROM dbo.LegalInheritance x ${LAND} WHERE x.IsActive = 1 AND x.ApplicableFramework = N'Hindu Succession Act, 1956'`,
    [...L3, C("DeceasedName", "Deceased"), C("DeceasedGender", "Gender"), C("NatureOfOwnership", "Nature"), C("SuccessionType", "Succession"), C("Path", "Review path"), C("Status", "Status")]),
  "muslim-succession": rep("Muslim Succession Review", `
    SELECT ${LCOLS}, x.DeceasedName, x.SchoolOfLaw, x.PropertyType, x.WillAvailable, x.ReviewStatus AS Status,
           CASE WHEN x.PropertyType = N'Agricultural' THEN N'Legal Review Required — Shariat Act 1937 s.2' WHEN x.SchoolOfLaw <> N'Sunni (Hanafi)' THEN N'School not configured — legal review' ELSE N'Hanafi basic rules' END AS Path
    FROM dbo.LegalInheritance x ${LAND} WHERE x.IsActive = 1 AND x.ApplicableFramework = N'Muslim Personal Law (Shariat)'`,
    [...L3, C("DeceasedName", "Deceased"), C("SchoolOfLaw", "School"), C("PropertyType", "Property"), C("WillAvailable", "Will"), C("Path", "Review path"), C("Status", "Status")]),
  "agri-inheritance": rep("Agricultural Land Inheritance Review", `
    SELECT ${LCOLS}, x.DeceasedName, x.ApplicableFramework, x.SchoolOfLaw, x.ReviewStatus AS Status, CASE WHEN x.FrameworkConfirmedBy IS NULL THEN N'No' ELSE N'Yes' END AS FrameworkConfirmed
    FROM dbo.LegalInheritance x ${LAND} WHERE x.IsActive = 1 AND x.PropertyType = N'Agricultural'`,
    [...L3, C("DeceasedName", "Deceased"), C("ApplicableFramework", "Framework"), C("SchoolOfLaw", "School"), C("FrameworkConfirmed", "Framework confirmed"), C("Status", "Status")]),
  "ownership-disputes": rep("Ownership Dispute Report", `
    SELECT ${LCOLS}, x.Claimant, x.OpposingParty, x.DisputeType, CAST(x.DisputedSharePct AS FLOAT) AS DisputedShare, x.CourtCaseNo, x.Court, x.FilingDate, x.NextHearingDate,
           x.DisputeStatus AS Status, lo.name AS AssignedName
    FROM dbo.LegalOwnershipDispute x ${LAND} LEFT JOIN dbo.users lo ON lo.id = x.LegalOfficerId WHERE x.IsActive = 1 ORDER BY x.FilingDate DESC`,
    [...L3, C("Claimant", "Claimant"), C("OpposingParty", "Opposing"), C("DisputeType", "Type"), C("DisputedShare", "Share %"), C("CourtCaseNo", "Case"), C("Court", "Court"),
      C("NextHearingDate", "Next hearing"), C("AssignedName", "Legal officer"), C("Status", "Status")], "FilingDate"),
  "unverified-branches": rep("Unverified Ownership Branch Report", `
    SELECT ${LCOLS}, N'Ownership event' AS Kind, CONVERT(NVARCHAR(10), x.EventDate, 23) + ' ' + ISNULL(x.PreviousOwnerName, '?') + N' → ' + ISNULL(x.NewOwnerName, '?') AS Item, x.ApprovalStatus AS Status
    FROM dbo.LegalOwnershipEvent x ${LAND} WHERE x.IsActive = 1 AND x.ApprovalStatus <> N'Verified'
    UNION ALL
    SELECT ${LCOLS}, N'Family relationship', x.FullName + ISNULL(' (' + x.RelationToDeceased + ')', ''), x.RelationshipStatus
    FROM dbo.LegalFamilyMember x ${LAND} WHERE x.IsActive = 1 AND x.RelationshipStatus <> N'Verified'`,
    [...L3, C("Kind", "Kind"), C("Item", "Event / member"), C("Status", "Status")]),
  // ── Legal investigation ──
  "record-discrepancies": rep("Record Discrepancy Report", `
    SELECT e.EnquiryNo, e.ProjectId, mz.MouzaName, x.DiscrepancyType, x.RelatedRecord, x.PreviousInfo, x.CurrentInfo, x.Severity AS RiskLevel, x.InvestigationStatus AS Status, u.name AS AssignedName, x.CreatedAt
    FROM dbo.LegalLandDiscrepancy x JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId LEFT JOIN dbo.LegalMouza mz ON mz.MouzaId = e.MouzaId LEFT JOIN dbo.users u ON u.id = x.AssignedUserId
    WHERE x.IsActive = 1 ORDER BY x.CreatedAt DESC`,
    [C("EnquiryNo", "Enquiry"), C("MouzaName", "Mouza"), C("DiscrepancyType", "Type"), C("RelatedRecord", "Record"), C("PreviousInfo", "Previous"), C("CurrentInfo", "Current"),
      C("RiskLevel", "Severity"), C("AssignedName", "Assigned"), C("Status", "Status")], "CreatedAt"),
  "legal-risk-register": { title: "Legal Risk Register", run: async (req, pool, { scoped }) => {
    const lands = scoped(req, await q(pool, `SELECT l.LandId, l.LandCode, l.ProjectId, m.MouzaName, l.WorkflowStatus FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId WHERE l.IsActive = 1`));
    const { autoFlags } = require("./dueDiligence");
    const rows = [];
    for (const l of lands) for (const f of await autoFlags(pool, l.LandId).catch(() => [])) rows.push({ LandCode: l.LandCode, ProjectId: l.ProjectId, MouzaName: l.MouzaName, Stage: l.WorkflowStatus, RiskLevel: f.level, Status: f.level, Risk: f.text, Rule: f.key });
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return { columns: [...L3, C("Stage", "Stage"), C("RiskLevel", "Level"), C("Risk", "Risk"), C("Rule", "Rule")], rows: rows.sort((a, b) => rank[a.RiskLevel] - rank[b.RiskLevel]) };
  } },
  "mortgage-encumbrance": rep("Mortgage / Encumbrance Report", `
    SELECT ${LCOLS}, x.LenderName, x.BorrowerName, x.LoanType, x.MortgageDeedNo, CAST(x.LoanAmount AS FLOAT) AS LoanAmount, CAST(x.OutstandingAmount AS FLOAT) AS Outstanding,
           x.LoanStartDate, x.LoanClosureDate, ISNULL(x.LoanStatus, x.MortgageStatus) AS Status, x.VerificationStatus
    FROM dbo.LegalMortgage x ${LAND} WHERE x.IsActive = 1`,
    [...L3, C("LenderName", "Lender"), C("BorrowerName", "Borrower"), C("LoanType", "Type"), C("MortgageDeedNo", "Document"), C("LoanAmount", "Amount"), C("Outstanding", "Outstanding"),
      C("LoanStartDate", "Created"), C("LoanClosureDate", "Released"), C("Status", "Status"), C("VerificationStatus", "Verification")], "LoanStartDate"),
  "possession-history": rep("Possession History Report", `
    SELECT ISNULL(l.LandCode, e.EnquiryNo) AS LandCode, ISNULL(l.ProjectId, e.ProjectId) AS ProjectId, m.MouzaName, x.OccupantName, x.PossessionType, x.StartDate, x.EndDate,
           CAST(x.AreaOccupied AS FLOAT) AS AreaOccupied, x.Source, x.VerificationStatus AS Status
    FROM dbo.LegalLandPossession x LEFT JOIN dbo.LegalLand l ON l.LandId = x.LandId LEFT JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = x.EnquiryId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = ISNULL(l.MouzaId, e.MouzaId) WHERE x.IsActive = 1 ORDER BY x.StartDate`,
    [C("LandCode", "Land / enquiry"), C("MouzaName", "Mouza"), C("OccupantName", "Occupant"), C("PossessionType", "Type"), C("StartDate", "From"), C("EndDate", "To"),
      C("AreaOccupied", "Area"), C("Source", "Source"), C("Status", "Status")], "StartDate"),
  "document-verification": rep("Document Verification Report", `
    SELECT ${LCOLS}, d.DocumentCode, d.Title, t.DocTypeName AS DocType, d.DocumentNo, x.VersionNo, x.ReviewStatus AS Status, uu.name AS UploadedBy, x.UploadedAt, ru.name AS VerifiedBy, x.ReviewedAt, x.ReviewRemarks
    FROM dbo.LegalLandDocumentVersion x JOIN dbo.LegalLandDocument d ON d.DocumentId = x.DocumentId AND d.IsActive = 1 LEFT JOIN dbo.LegalLand l ON l.LandId = d.LandId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict dd ON dd.DistrictId = l.DistrictId LEFT JOIN dbo.LegalDocumentType t ON t.DocTypeId = d.DocTypeId
    LEFT JOIN dbo.users uu ON uu.id = x.UploadedBy LEFT JOIN dbo.users ru ON ru.id = x.ReviewedBy ORDER BY x.UploadedAt DESC`,
    [...L3, C("DocumentCode", "Document"), C("Title", "Title"), C("DocType", "Type"), C("DocumentNo", "Number"), C("VersionNo", "Version"), C("UploadedBy", "Uploaded by"),
      C("UploadedAt", "Uploaded"), C("Status", "Status"), C("VerifiedBy", "Verified by"), C("ReviewRemarks", "Remarks")], "UploadedAt"),
  "pending-exceptions": rep("Pending Exceptions Report", `
    SELECT ISNULL(l.LandCode, v.VerificationNo) AS LandCode, ISNULL(l.ProjectId, v.ProjectId) AS ProjectId, m.MouzaName, x.Kind, x.Reason, x.Detail, au.name AS ApprovedBy, x.CreatedAt, N'Recorded' AS Status
    FROM dbo.LegalVerificationException x LEFT JOIN dbo.LegalLand l ON l.LandId = x.LandId LEFT JOIN dbo.LegalVerification v ON v.VerificationId = x.VerificationId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.users au ON au.id = x.ApprovedBy
    UNION ALL
    SELECT e.EnquiryNo, e.ProjectId, mz.MouzaName, N'Search exception · ' + o.OfficeType, o.ExceptionNote, NULL, eu.name, o.ExceptionAt, N'Recorded'
    FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId LEFT JOIN dbo.LegalMouza mz ON mz.MouzaId = e.MouzaId LEFT JOIN dbo.users eu ON eu.id = o.ExceptionBy
    WHERE o.ExceptionNote IS NOT NULL`,
    [C("LandCode", "Land / enquiry"), C("MouzaName", "Mouza"), C("Kind", "Exception"), C("Reason", "Reason"), C("Detail", "Detail"), C("ApprovedBy", "Approved by"), C("CreatedAt", "Date")], "CreatedAt"),
  "missing-documents": rep("Missing Documents Report", `
    SELECT v.VerificationNo AS LandCode, v.ProjectId, mz.MouzaName, e.EnquiryNo, ISNULL(t.DisplayNo, CAST(a.ActivityNo AS NVARCHAR(5))) + '. ' + a.ActivityName AS Activity, a.Finding AS Status,
           a.Remarks, u.name AS AssignedName, a.DueDate
    FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId
    JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = v.EnquiryId LEFT JOIN dbo.LegalMouza mz ON mz.MouzaId = e.MouzaId LEFT JOIN dbo.users u ON u.id = a.AssignedUserId
    WHERE a.Finding IN (N'Document Missing', N'Additional Documents Required', N'Records Not Available') AND a.Status <> N'Closed'`,
    [C("LandCode", "Verification"), C("EnquiryNo", "Enquiry"), C("MouzaName", "Mouza"), C("Activity", "Activity"), C("Status", "Finding"), C("Remarks", "Remarks"), C("AssignedName", "Employee"), C("DueDate", "Target")], "DueDate"),
  // ── Acquisition and compliance ──
  "land-approvals": rep("Land Approval Report", `
    SELECT ${LCOLS}, x.Decision AS Status, CAST(x.OfferedPrice AS FLOAT) AS OfferedPrice, CAST(x.NegotiatedPrice AS FLOAT) AS NegotiatedPrice, CAST(x.ApprovedPrice AS FLOAT) AS ApprovedPrice,
           x.Conditions, x.RiskAcceptance, x.FinalReviewRef, u.name AS DecidedBy, x.DecidedAt
    FROM dbo.LegalLandApproval x ${LAND} LEFT JOIN dbo.users u ON u.id = x.DecidedBy ORDER BY x.DecidedAt DESC`,
    [...L3, C("Status", "Decision"), C("OfferedPrice", "Offered"), C("NegotiatedPrice", "Negotiated"), C("ApprovedPrice", "Approved"), C("Conditions", "Conditions"),
      C("RiskAcceptance", "Risk acceptance"), C("FinalReviewRef", "Final review"), C("DecidedBy", "By"), C("DecidedAt", "Date")], "DecidedAt"),
  "deed-registration-report": rep("Deed Registration Report", `
    SELECT l.LandCode, l.ProjectId, m.MouzaName, dd.DistrictName, l.DeedStage AS Status, l.WorkflowStatus, l.DeedTargetDate, r.RegisteredDeedNo, r.RegistrationDate, o.OfficeName, l.RegCompletedAt
    FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict dd ON dd.DistrictId = l.DistrictId
    OUTER APPLY (SELECT TOP 1 * FROM dbo.LegalRegisteredDeed x WHERE x.LandId = l.LandId AND x.IsActive = 1 ORDER BY x.RegisteredId DESC) r
    LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = r.RegistrationOfficeId
    WHERE l.IsActive = 1 AND l.WorkflowStatus IN (N'Deed Process', N'Deed Completed', N'Deed Registration', N'Registered')`,
    [...L3, C("WorkflowStatus", "Stage"), C("Status", "Deed status"), C("DeedTargetDate", "Target"), C("RegisteredDeedNo", "Registered deed"), C("RegistrationDate", "Registered on"), C("OfficeName", "Office")], "RegistrationDate"),
  "amendment-history": rep("Amendment History Report", `
    SELECT ${LCOLS}, x.AmendmentNo, x.AmendType, x.Reason, x.ReferenceNo, x.Status, ru.name AS RequestedBy, x.RequestedAt, du.name AS DecidedBy, x.DecidedAt, x.DecisionRemarks, x.VersionNo
    FROM dbo.LegalLandAmendment x ${LAND} LEFT JOIN dbo.users ru ON ru.id = x.RequestedBy LEFT JOIN dbo.users du ON du.id = x.DecidedBy ORDER BY x.RequestedAt DESC`,
    [...L3, C("AmendmentNo", "No."), C("AmendType", "Type"), C("Reason", "Reason"), C("ReferenceNo", "Reference"), C("RequestedBy", "Requested by"), C("RequestedAt", "Requested"),
      C("Status", "Status"), C("DecidedBy", "Decided by"), C("DecisionRemarks", "Remarks"), C("VersionNo", "Version")], "RequestedAt"),
  "post-registration-compliance": rep("Post-registration Compliance Report", `
    SELECT ${LCOLS}, x.TaskNo, x.Task, x.Status, x.RefNo, x.DueDate, u.name AS AssignedName, x.CompletedAt,
           CASE WHEN x.Status <> N'Completed' AND x.DueDate < CAST(GETDATE() AS DATE) THEN N'Overdue' ELSE N'' END AS Overdue
    FROM dbo.LegalPostRegTask x ${LAND} LEFT JOIN dbo.users u ON u.id = x.AssignedUserId ORDER BY l.LandCode, x.TaskNo`,
    [...L3, C("TaskNo", "No."), C("Task", "Task"), C("RefNo", "Reference"), C("AssignedName", "Employee"), C("DueDate", "Due"), C("Overdue", "Overdue"), C("Status", "Status"), C("CompletedAt", "Completed")], "DueDate"),
  "la-ulc-expiry": rep("LA / ULC Expiry Report", `
    SELECT ${LCOLS}, x.Kind, x.Status, x.ApplicationNo, x.AppliedOn, x.CertificateNo, x.ObtainedOn, x.ExpiryDate,
           CASE WHEN x.ExpiryDate IS NULL THEN N'' WHEN x.ExpiryDate < CAST(GETDATE() AS DATE) THEN N'Expired' WHEN x.ExpiryDate <= DATEADD(day, 30, CAST(GETDATE() AS DATE)) THEN N'Expires within 30 days' ELSE N'Valid' END AS Validity
    FROM dbo.LegalLandClearance x ${LAND} ORDER BY x.ExpiryDate`,
    [...L3, C("Kind", "Clearance"), C("ApplicationNo", "Application"), C("AppliedOn", "Applied"), C("CertificateNo", "Certificate"), C("ObtainedOn", "Obtained"), C("ExpiryDate", "Expiry"),
      C("Validity", "Validity"), C("Status", "Status")], "ExpiryDate"),
};
