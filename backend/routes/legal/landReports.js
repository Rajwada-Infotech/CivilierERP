"use strict";

// Land Management reports (pipeline step 30). One read-only query per report; the page shows them as tables
// with export. Report keys come from this list, never from SQL in the request.
//   GET /           the report list
//   GET /:key       one report's rows

const express = require("express");
const { getPool } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);

const PAGE = "legal-land-reports";
const LAND = "l.LandCode AS [Land ID], l.LandName AS [Land]";
const JOIN_LAND = "JOIN dbo.LegalLand l ON l.LandId = x.LandId";

const REPORTS = [
  { key: "land-register", group: "Land", title: "Land Property Register", sql: `
    SELECT ${LAND}, m.MouzaName + ' (J.L. ' + ISNULL(m.JLNo, '-') + ')' AS Mouza, d.DistrictName AS District,
           CAST(l.Area AS DECIMAL(18,4)) AS Area, u.UnitName AS Unit, l.LandStatus AS [Land status],
           CASE WHEN l.IsCancelled = 1 THEN N'Cancelled' WHEN l.IsOnHold = 1 THEN N'On hold' ELSE l.WorkflowStatus END AS [Workflow],
           (SELECT STRING_AGG(r.OwnerName + ' ' + CAST(CAST(r.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '%', ', ')
              FROM dbo.LegalOwnershipRecord r WHERE r.LandId = l.LandId AND r.IsActive = 1 AND r.ValidTo IS NULL) AS [Current owners]
    FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId WHERE l.IsActive = 1 ORDER BY l.LandCode` },
  { key: "enquiry-register", group: "Land", title: "Land Enquiry Register", sql: `
    SELECT e.EnquiryNo AS [Enquiry], e.EnquiryDate AS [Date], s.Name AS Source, e.LandLocation AS Location, m.MouzaName AS Mouza,
           e.ContactPerson AS Contact, e.ExpectedPrice AS [Expected price], e.EnquiryStatus AS Status, l.LandCode AS [Land ID]
    FROM dbo.LegalLandEnquiry e LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = e.EnquirySourceId
    LEFT JOIN dbo.LegalMouza m ON m.MouzaId = e.MouzaId LEFT JOIN dbo.LegalLand l ON l.LandId = e.LandId
    WHERE e.IsActive = 1 ORDER BY e.EnquiryDate DESC` },
  { key: "current-ownership", group: "Ownership", title: "Current Ownership", sql: `
    SELECT ${LAND}, x.OwnerName AS Owner, x.OwnerGuardian AS [Father / husband], CAST(x.SharePct AS DECIMAL(7,4)) AS [Share %],
           x.ValidFrom AS Since, x.VerificationStatus AS Verification
    FROM dbo.LegalOwnershipRecord x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.ValidTo IS NULL ORDER BY l.LandCode, x.SharePct DESC` },
  { key: "ownership-history", group: "Ownership", title: "Complete Ownership History", sql: `
    SELECT ${LAND}, x.EventDate AS [Date], t.Name AS [Transfer], ISNULL(x.PreviousOwnerName, N'(earliest)') AS [From], x.NewOwnerName AS [To],
           CAST(x.TransferSharePct AS DECIMAL(7,4)) AS [Share %], ISNULL(x.DocumentNo, x.DeedNo) AS [Document no.], x.VerificationStatus AS Verification
    FROM dbo.LegalOwnershipEvent x ${JOIN_LAND} LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.TransferTypeId
    WHERE x.IsActive = 1 ORDER BY l.LandCode, x.EventDate` },
  { key: "joint-ownership", group: "Ownership", title: "Joint Ownership", sql: `
    SELECT ${LAND}, COUNT(*) AS [Current owners], CAST(SUM(x.SharePct) AS DECIMAL(9,4)) AS [Total share %],
           STRING_AGG(x.OwnerName + ' ' + CAST(CAST(x.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '%', ', ') AS Owners
    FROM dbo.LegalOwnershipRecord x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.ValidTo IS NULL
    GROUP BY l.LandCode, l.LandName HAVING COUNT(*) > 1 ORDER BY l.LandCode` },
  { key: "inheritance", group: "Ownership", title: "Inheritance", sql: `
    SELECT ${LAND}, x.DeceasedName AS Deceased, x.DateOfDeath AS [Date of death], x.SupportingType AS [Supporting record],
           (SELECT STRING_AGG(h.HeirName + ' ' + CAST(CAST(h.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '%', ', ') FROM dbo.LegalInheritanceHeir h WHERE h.InheritanceId = x.InheritanceId AND h.IsActive = 1) AS Heirs,
           x.VerificationStatus AS Verification
    FROM dbo.LegalInheritance x ${JOIN_LAND} WHERE x.IsActive = 1 ORDER BY l.LandCode` },
  { key: "pending-ownership", group: "Ownership", title: "Pending Ownership Verification", sql: `
    SELECT ${LAND}, N'Ownership record' AS [Record], x.OwnerName AS [Detail], x.VerificationStatus AS Status FROM dbo.LegalOwnershipRecord x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.VerificationStatus <> N'Verified'
    UNION ALL SELECT ${LAND}, N'Transfer', ISNULL(x.PreviousOwnerName, '?') + N' → ' + x.NewOwnerName, x.VerificationStatus FROM dbo.LegalOwnershipEvent x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.VerificationStatus <> N'Verified'
    UNION ALL SELECT ${LAND}, N'Check: ' + x.CheckItem, (SELECT r.OwnerName FROM dbo.LegalOwnershipRecord r WHERE r.RecordId = x.RecordId), x.Result FROM dbo.LegalOwnershipCheck x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.Result NOT IN (N'Verified', N'Not Applicable')
    ORDER BY [Land ID]` },
  { key: "pending-documents", group: "Documents", title: "Pending Documents", sql: `
    SELECT ${LAND}, dt.DocTypeName AS Document, i.Requirement, i.StageNeeded AS [Needed by],
           ISNULL((SELECT TOP 1 v.ReviewStatus FROM dbo.LegalLandDocument d JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
                   WHERE d.LandId = l.LandId AND d.DocTypeId = i.DocTypeId AND d.IsActive = 1), N'Missing') AS State
    FROM dbo.LegalLand l JOIN dbo.LegalChecklistItem i ON i.TemplateId = l.ChecklistTemplateId AND i.IsActive = 1
    JOIN dbo.LegalDocumentType dt ON dt.DocTypeId = i.DocTypeId
    WHERE l.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocumentNA na WHERE na.LandId = l.LandId AND na.DocTypeId = i.DocTypeId)
      AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandDocument d JOIN dbo.LegalLandDocumentVersion v ON v.DocumentId = d.DocumentId AND v.VersionNo = d.CurrentVersionNo
                      WHERE d.LandId = l.LandId AND d.DocTypeId = i.DocTypeId AND d.IsActive = 1 AND v.ReviewStatus = N'Verified')
    ORDER BY l.LandCode, i.SortOrder` },
  { key: "rejected-documents", group: "Documents", title: "Rejected Documents", sql: `
    SELECT ${LAND}, d.DocumentCode AS [Document], d.Title, v.VersionNo AS Version, v.ReviewStatus AS Review, v.ReviewRemarks AS Remarks, v.ReviewedAt AS [Reviewed]
    FROM dbo.LegalLandDocumentVersion v JOIN dbo.LegalLandDocument d ON d.DocumentId = v.DocumentId JOIN dbo.LegalLand l ON l.LandId = d.LandId
    WHERE v.ReviewStatus IN (N'Rejected', N'Reattachment Required') ORDER BY v.ReviewedAt DESC` },
  { key: "legal-cases", group: "Legal", title: "Legal Case Register", sql: `
    SELECT ${LAND}, x.CaseNumber AS [Case], t.Name AS Type, x.CourtName AS Court, s.Name AS Status, x.NextHearingDate AS [Next hearing], x.VerificationStatus AS Verification
    FROM dbo.LegalCase x ${JOIN_LAND} LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.CaseTypeId LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = x.LegalStatusId
    WHERE x.IsActive = 1 ORDER BY x.NextHearingDate` },
  { key: "mortgages", group: "Legal", title: "Mortgage & Loan Register", sql: `
    SELECT ${LAND}, x.LenderName AS Lender, t.Name AS Type, x.LoanAmount AS [Loan], x.OutstandingAmount AS Outstanding, x.MortgageStatus AS Status, x.VerificationStatus AS Verification
    FROM dbo.LegalMortgage x ${JOIN_LAND} LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.MortgageTypeId WHERE x.IsActive = 1 ORDER BY l.LandCode` },
  { key: "due-diligence", group: "Legal", title: "Legal Due Diligence", sql: `
    SELECT ${LAND}, SUM(CASE WHEN x.Result = N'Clear' THEN 1 ELSE 0 END) AS Clear, SUM(CASE WHEN x.Result = N'Issue Found' THEN 1 ELSE 0 END) AS [Issues],
           SUM(CASE WHEN x.Result = N'Pending' THEN 1 ELSE 0 END) AS Pending,
           (SELECT TOP 1 o.FinalOpinion + ' (' + o.OpinionStatus + ')' FROM dbo.LegalOpinion o WHERE o.LandId = l.LandId AND o.IsActive = 1 ORDER BY o.OpinionId DESC) AS [Latest opinion],
           (SELECT TOP 1 c.Decision FROM dbo.LegalClearance c WHERE c.LandId = l.LandId AND c.IsActive = 1 ORDER BY c.ClearanceId DESC) AS Clearance
    FROM dbo.LegalDueDiligence x ${JOIN_LAND} WHERE x.IsActive = 1 GROUP BY l.LandId, l.LandCode, l.LandName ORDER BY l.LandCode` },
  { key: "legal-hold", group: "Legal", title: "Legal Hold / Dispute", sql: `
    SELECT ${LAND}, x.HoldCategory AS Category, x.HoldReason AS Reason, x.HoldDate AS [Since], x.ExpectedReviewDate AS [Review by],
           CASE WHEN x.ResumedAt IS NULL THEN N'On hold' ELSE N'Resumed ' + CONVERT(NVARCHAR(10), x.ResumedAt, 105) END AS Status
    FROM dbo.LegalHold x ${JOIN_LAND} ORDER BY x.HoldDate DESC` },
  { key: "purchases", group: "Purchase & Sale", title: "Purchase Register", txn: "Purchase" },
  { key: "sales", group: "Purchase & Sale", title: "Sale Register", txn: "Sale" },
  { key: "valuations", group: "Purchase & Sale", title: "Land Valuation", sql: `
    SELECT ${LAND}, x.ValuationDate AS [Date], x.MarketRate AS [Market rate], x.EstimatedMarketValue AS [Market value], x.GovernmentValuation AS [Govt. value],
           x.ValuationSource AS Source, x.VerificationStatus AS Verification
    FROM dbo.LegalValuation x ${JOIN_LAND} WHERE x.IsActive = 1 ORDER BY x.ValuationDate DESC` },
  { key: "deed-preparation", group: "Deed & Registration", title: "Deed Preparation", sql: `
    SELECT ${LAND}, x.DeedCode AS Deed, t.DeedTypeName AS Type, x.ConsiderationAmount AS Consideration, x.DeedWriter AS Writer,
           (SELECT TOP 1 'v' + CAST(d.VersionNo AS NVARCHAR(10)) + ' ' + d.ReviewStatus FROM dbo.LegalDeedDraft d WHERE d.DeedId = x.DeedId AND d.IsActive = 1 ORDER BY d.VersionNo DESC) AS [Latest draft],
           x.RegistrationStatus AS Status
    FROM dbo.LegalLandDeed x ${JOIN_LAND} LEFT JOIN dbo.LegalDeedType t ON t.DeedTypeId = x.DeedTypeId WHERE x.IsActive = 1 ORDER BY l.LandCode` },
  { key: "registration-pending", group: "Deed & Registration", title: "Registration Pending", sql: `
    SELECT ${LAND}, x.DeedCode AS Deed, o.OfficeName AS Office, x.RegistrationStatus AS Status,
           (SELECT TOP 1 a.AppointmentDate FROM dbo.LegalRegAppointment a WHERE a.DeedId = x.DeedId AND a.IsActive = 1 AND a.AppointmentStatus IN (N'Scheduled', N'Rescheduled') ORDER BY a.AppointmentDate) AS [Appointment],
           (SELECT TOP 1 r.Result FROM dbo.LegalRegAttempt r WHERE r.DeedId = x.DeedId AND r.IsActive = 1 ORDER BY r.AttemptDate DESC, r.AttemptId DESC) AS [Last attempt]
    FROM dbo.LegalLandDeed x ${JOIN_LAND} LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = x.RegistrationOfficeId
    WHERE x.IsActive = 1 AND x.RegistrationStatus NOT IN (N'Successfully Registered', N'Registered Deed Awaiting', N'Completed') ORDER BY l.LandCode` },
  { key: "registered-deeds", group: "Deed & Registration", title: "Registered Deeds", sql: `
    SELECT ${LAND}, x.RegisteredDeedNo AS [Deed no.], x.RegistrationDate AS [Registered], o.OfficeName AS Office, x.CertifiedCopyStatus AS [Certified copy], x.ApprovalStatus AS Approval
    FROM dbo.LegalRegisteredDeed x ${JOIN_LAND} LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = x.RegistrationOfficeId WHERE x.IsActive = 1 ORDER BY x.RegistrationDate DESC` },
  { key: "mutation-pending", group: "Mutation & Closure", title: "Mutation Pending", mutation: false },
  { key: "mutation-completed", group: "Mutation & Closure", title: "Mutation Completed", mutation: true },
  { key: "settlements", group: "Mutation & Closure", title: "Financial Settlement", sql: `
    SELECT ${LAND}, t.TransactionNo AS [Transaction], x.AgreementValue AS [Agreement value], x.TotalReceived AS Received, x.TotalPaid AS Paid,
           x.RemainingBalance AS Balance, x.SettlementDate AS [Date], x.SettlementStatus AS Status
    FROM dbo.LegalSettlement x ${JOIN_LAND} LEFT JOIN dbo.LegalLandTransaction t ON t.TransactionId = x.TransactionId WHERE x.IsActive = 1 ORDER BY x.SettlementDate DESC` },
  { key: "workflow-status", group: "Mutation & Closure", title: "Workflow Status & Waiting Time", sql: `
    SELECT ${LAND}, CASE WHEN l.IsCancelled = 1 THEN N'Cancelled' WHEN l.IsOnHold = 1 THEN N'On hold' ELSE l.WorkflowStatus END AS [Current step],
           (SELECT MAX(s.UpdatedAt) FROM dbo.LegalWorkflowStepState s WHERE s.LandId = l.LandId) AS [Last moved],
           DATEDIFF(day, ISNULL((SELECT MAX(s.UpdatedAt) FROM dbo.LegalWorkflowStepState s WHERE s.LandId = l.LandId), l.CreatedAt), SYSUTCDATETIME()) AS [Days waiting]
    FROM dbo.LegalLand l WHERE l.IsActive = 1 ORDER BY [Days waiting] DESC` },
  { key: "audit", group: "Mutation & Closure", title: "User Activity / Audit", sql: `
    SELECT TOP 500 a.CreatedAt AS [When], u.name AS [User], a.Action, a.EntityType AS [Record], a.EntityId AS [Id], l.LandCode AS [Land ID], a.Remarks
    FROM dbo.LegalRecordAudit a LEFT JOIN dbo.users u ON u.id = a.UserId LEFT JOIN dbo.LegalLand l ON l.LandId = a.LandId ORDER BY a.EventId DESC` },
];

const txnSql = (type) => `
  SELECT ${LAND}, x.TransactionNo AS [Transaction], x.BuyerName AS Buyer, x.SellerNames AS [Seller(s)], CAST(x.TxnArea AS DECIMAL(18,4)) AS Area, u.UnitName AS Unit,
         x.TotalValue AS Value, ISNULL((SELECT SUM(p.Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = x.TransactionId AND p.IsActive = 1 AND p.VerificationStatus = N'Verified'), 0) AS [Verified paid],
         x.TotalValue - ISNULL((SELECT SUM(p.Amount) FROM dbo.LegalPayment p WHERE p.TransactionId = x.TransactionId AND p.IsActive = 1 AND p.VerificationStatus = N'Verified'), 0) AS Balance,
         x.TxnStatus AS Status
  FROM dbo.LegalLandTransaction x ${JOIN_LAND} LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = x.AreaUnitId
  WHERE x.IsActive = 1 AND x.TxnType = N'${type}' ORDER BY x.TransactionId DESC`;
const mutationSql = (done) => `
  SELECT ${LAND}, x.ApplicationNo AS [Application], x.ApplicationDate AS [Applied], x.OfficeName AS Office, x.NewOwner AS [New owner(s)], x.ApplicationStatus AS Status,
         x.HearingDate AS [Hearing], x.OrderNo AS [Order no.], x.OrderDate AS [Order date]
  FROM dbo.LegalMutation x ${JOIN_LAND} WHERE x.IsActive = 1 AND x.ApplicationStatus ${done ? "=" : "<>"} N'Approved' ORDER BY x.MutationId DESC`;

router.get("/", requirePageRight(PAGE, "view"), (_req, res) => {
  res.json(REPORTS.map(({ key, group, title }) => ({ key, group, title })));
});

router.get("/:key", requirePageRight(PAGE, "view"), async (req, res) => {
  const rep = REPORTS.find((r) => r.key === req.params.key);
  if (!rep) return res.status(404).json({ error: "Unknown report" });
  try {
    const q = rep.sql || (rep.txn ? txnSql(rep.txn) : mutationSql(rep.mutation));
    const r = await getPool().request().query(q);
    res.json({ title: rep.title, columns: r.recordset.columns ? Object.keys(r.recordset.columns) : Object.keys(r.recordset[0] || {}), rows: r.recordset });
  } catch (err) {
    console.error("[legal-reports]", rep.key, err.message);
    res.status(500).json({ error: "Could not run the report" });
  }
});

module.exports = router;
