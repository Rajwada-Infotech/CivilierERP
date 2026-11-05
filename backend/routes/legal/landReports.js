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
           CAST(l.Area AS DECIMAL(18,4)) AS Area, u.UnitName AS Unit, l.EntryType AS [Entry type], l.LandStatus AS [Land status],
           CASE WHEN l.IsCancelled = 1 THEN N'Cancelled' WHEN l.IsOnHold = 1 THEN N'On hold' ELSE l.WorkflowStatus END AS [Approval status],
           (SELECT STRING_AGG(r.OwnerName + ' ' + CAST(CAST(r.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + '%', ', ')
              FROM dbo.LegalOwnershipRecord r WHERE r.LandId = l.LandId AND r.IsActive = 1 AND r.ValidTo IS NULL) AS [Current owners]
    FROM dbo.LegalLand l LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId WHERE l.IsActive = 1 ORDER BY l.LandCode` },
  { key: "project-land", group: "Land", title: "Project-wise Land", sql: `
    SELECT ISNULL(p.name, N'(not mapped)') AS Project, ${LAND}, m.MouzaName AS Mouza, CAST(l.Area AS DECIMAL(18,4)) AS Area, u.UnitName AS Unit,
           CASE WHEN l.L2Status = 'Approved' THEN N'Complete' ELSE N'Under process' END AS [Position],
           CASE WHEN l.IsOnHold = 1 THEN N'On hold' ELSE l.WorkflowStatus END AS [Approval status], l.LandStatus AS [Land status],
           (SELECT COUNT(*) FROM dbo.LegalLandDocument x WHERE x.LandId = l.LandId AND x.IsActive = 1) AS Documents
    FROM dbo.LegalLand l LEFT JOIN dbo.enterprise p ON p.id = l.ProjectId LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
    LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
    WHERE l.IsActive = 1 AND ISNULL(l.IsCancelled, 0) = 0 ORDER BY CASE WHEN p.name IS NULL THEN 1 ELSE 0 END, p.name, l.LandCode` },
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
  // Deeds as recorded on each land's Acquisition & Purchase tab (one row per transfer).
  { key: "registered-deeds", group: "Deed & Registration", title: "Deed Register", sql: `
    SELECT ${LAND}, x.EventDate AS [Date], t.Name AS [Transfer], x.PreviousOwnerName AS [From], x.NewOwnerName AS [To],
           ISNULL(x.DeedNo, x.DocumentNo) AS [Deed no.], x.RegistrationDate AS [Registered], o.OfficeName AS Office, x.VerificationStatus AS Verification
    FROM dbo.LegalOwnershipEvent x ${JOIN_LAND} LEFT JOIN dbo.LegalLookupValue t ON t.LookupId = x.TransferTypeId
    LEFT JOIN dbo.LegalRegistrationOffice o ON o.OfficeId = x.RegistrationOfficeId WHERE x.IsActive = 1 ORDER BY x.EventDate DESC` },
  { key: "mutation-pending", group: "Mutation & Closure", title: "Mutation Pending", mutation: false },
  { key: "mutation-completed", group: "Mutation & Closure", title: "Mutation Completed", mutation: true },
  { key: "workflow-status", group: "Mutation & Closure", title: "Approval Status & Waiting Time", sql: `
    SELECT ${LAND}, l.EntryType AS [Entry type], CASE WHEN l.IsOnHold = 1 THEN N'On hold' ELSE l.WorkflowStatus END AS [Approval status],
           l.L1Status AS L1, l.L2Status AS L2, ISNULL(l.UpdatedAt, l.CreatedAt) AS [Last changed],
           DATEDIFF(day, ISNULL(l.UpdatedAt, l.CreatedAt), SYSUTCDATETIME()) AS [Days waiting]
    FROM dbo.LegalLand l WHERE l.IsActive = 1 ORDER BY CASE WHEN l.L2Status = N'Approved' THEN 1 ELSE 0 END, [Days waiting] DESC` },
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
// The date column each report's Day / Range / Financial-year filter applies to.
const DATE_COL = {
  "enquiry-register": "Date", "current-ownership": "Since", "ownership-history": "Date", inheritance: "Date of death",
  "rejected-documents": "Reviewed", "legal-cases": "Next hearing", valuations: "Date", "registered-deeds": "Date",
  "mutation-pending": "Applied", "mutation-completed": "Applied", "workflow-status": "Last changed", audit: "When",
};
router.get("/", requirePageRight(PAGE, "view"), (_req, res) => {
  res.json(REPORTS.map(({ key, group, title }) => ({ key, group, title })));
});
router.get("/:key", requirePageRight(PAGE, "view"), async (req, res) => {
  const rep = REPORTS.find((r) => r.key === req.params.key);
  if (!rep) return res.status(404).json({ error: "Unknown report" });
  try {
    const q = rep.sql || (rep.txn ? txnSql(rep.txn) : mutationSql(rep.mutation));
    const pool = getPool();
    const r = await pool.request().query(q);
    // Reports page filters (Day / Range / Financial year) apply to the report's own date column; reports without one
    // (e.g. the land register) ignore them.
    let { dateFrom, dateTo } = req.query;
    const fyId = parseInt(req.query.finYearId, 10);
    if (fyId) {
      const fy = (await pool.request().input("id", fyId).query("SELECT FStartDate, FEndDate FROM dbo.FinYear WHERE FId = @id")).recordset[0];
      if (fy) { dateFrom = fy.FStartDate.toISOString().slice(0, 10); dateTo = fy.FEndDate.toISOString().slice(0, 10); }
    }
    const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom || "") ? dateFrom : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(dateTo || "") ? dateTo : from; // a single day sends only dateFrom
    let rows = r.recordset;
    const col = DATE_COL[rep.key];
    const landCode = String(req.query.landCode || "");
    if (landCode) rows = rows.filter((x) => x["Land ID"] === landCode);
    if (col && from) rows = rows.filter((x) => { const d = day(x[col]); return d && d >= from && d <= to; });
    res.json({ title: rep.title, columns: r.recordset.columns ? Object.keys(r.recordset.columns) : Object.keys(r.recordset[0] || {}), rows });
  } catch (err) {
    console.error("[legal-reports]", rep.key, err.message);
    res.status(500).json({ error: "Could not run the report" });
  }
});
module.exports = router;
