-- Legal demo (TEST RESIDENCE): the investigation sections of Land Records Search filled in —
--   discrepancies raised from the RS → LR area difference (every open TR enquiry), a government patta and an
--   unauthorised occupation on the first enquiry, a bargadar on the second, owner possession everywhere, and legal
--   reviews: "Hold for Further Investigation" on the first, "Recommended to Proceed" (with the area difference
--   resolved) on enquiries whose search is complete.
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.LegalLandSearchReview', 'U') IS NULL OR OBJECT_ID('dbo.LegalLandRecordMap', 'U') IS NULL RETURN;
IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%') RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalLandSearchReview r JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = r.EnquiryId WHERE e.EnquiryNo LIKE N'TR-ENQ-%') RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%' AND CreatedBy IS NOT NULL);
DECLARE @KATHA INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @f INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'TR-demo-document.pdf');
DECLARE @E TABLE (EnquiryId INT PRIMARY KEY, n INT, done BIT);
INSERT INTO @E SELECT e.EnquiryId, ROW_NUMBER() OVER (ORDER BY e.EnquiryNo),
  CASE WHEN EXISTS (SELECT 1 FROM dbo.LegalEnquiryOfficeSearch o WHERE o.EnquiryId = e.EnquiryId AND o.Status = N'Pending') THEN 0 ELSE 1 END
FROM dbo.LegalLandEnquiry e WHERE e.EnquiryNo LIKE N'TR-ENQ-%' AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected';
DECLARE @first INT = (SELECT EnquiryId FROM @E WHERE n = 1), @second INT = (SELECT EnquiryId FROM @E WHERE n = 2);

-- Discrepancies from each RS → LR link (area halves); resolved where the search is complete
INSERT INTO dbo.LegalLandDiscrepancy (EnquiryId, DiscrepancyType, RelatedRecord, PreviousInfo, CurrentInfo, Description, Severity, InvestigationStatus, AssignedUserId, ResolutionRemarks, SourceMapId, CreatedBy)
SELECT m.EnquiryId, N'Area difference', N'RS Dag ' + r.RsDagNo + N' → LR Dag ' + l.LrDagNo, N'10 Katha (RS 1962)', N'5 Katha (LR 1992)',
  N'LR shows half the RS area — a partial transfer is likely; trace the deed that took the other half', N'High',
  CASE WHEN x.done = 1 THEN N'Resolved' ELSE N'Under Investigation' END, @u,
  CASE WHEN x.done = 1 THEN N'Sale deed I-0418/1994 (ADSR) transfers the east 5 Katha; the remaining 5 Katha is this plot' ELSE NULL END, m.MapId, @u
FROM dbo.LegalLandRecordMap m JOIN @E x ON x.EnquiryId = m.EnquiryId
JOIN dbo.LegalEnquiryRsRecord r ON r.RsRecordId = m.FromId JOIN dbo.LegalEnquiryLrRecord l ON l.LrRecordId = m.ToId
WHERE m.FromType = N'RS' AND m.ToType = N'LR' AND m.IsActive = 1;
INSERT INTO dbo.LegalLandDiscrepancy (EnquiryId, DiscrepancyType, RelatedRecord, PreviousInfo, CurrentInfo, Description, Severity, InvestigationStatus, AssignedUserId, CreatedBy)
VALUES (@first, N'Holder name change', N'RS → LR', N'Haren Sarkar', N'Bimal Sarkar', N'No inheritance or sale record found yet between the RS and LR holders', N'Medium', N'Open', @u, @u);

-- Alternative land history
INSERT INTO dbo.LegalLandAltHistory (EnquiryId, Category, SubcategoryId, ReferenceNo, HolderClaimant, IssuingAuthority, RelevantDate, Area, AreaUnitId, DagKhatianRef, DocFileId, Source, VerificationStatus, Remarks, CreatedBy)
SELECT @first, N'Government land / settlement', (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'alt-land-subcategory' AND Name = N'Government Patta'),
  N'PT-105', N'Haren Sarkar', N'BL&LRO Rajarhat', '1985-03-10', 5, @KATHA, N'LR Dag (part)', @f, N'Patta certificate shown by the seller', N'Pending', N'Patta for the vested part; check the settlement register', @u
UNION ALL
SELECT @second, N'Tenancy / occupancy', (SELECT LookupId FROM dbo.LegalLookupValue WHERE Category = N'alt-land-subcategory' AND Name = N'Bargadar / Sharecropper'),
  N'BRG/RJH/1979/22', N'Madan Mondal', N'BL&LRO Rajarhat', '1979-07-01', 3, @KATHA, NULL, NULL, N'Bargadar register', N'Disputed', N'Recorded bargadar — surrender or compensation needed before purchase', @u
WHERE @second IS NOT NULL;

-- Possession
INSERT INTO dbo.LegalLandPossession (EnquiryId, OccupantName, PossessionType, StartDate, Purpose, AreaOccupied, AreaUnitId, Source, VerificationStatus, Remarks, CreatedBy)
SELECT x.EnquiryId, N'Bimal Sarkar', N'Owner Occupied', '2004-05-10', N'Cultivation', 5, @KATHA, N'Site inspection', N'Verified', N'Seller in possession', @u FROM @E x;
INSERT INTO dbo.LegalLandPossession (EnquiryId, OccupantName, PossessionType, StartDate, Purpose, AreaOccupied, AreaUnitId, Source, VerificationStatus, DocFileId, Remarks, CreatedBy)
VALUES (@first, N'Sukumar Das', N'Unauthorized Occupation', '2015-01-01', N'Shop shed on the road side', 0.5, @KATHA, N'Field inspection report', N'Disputed', @f, N'Claims occupation since 2015 without a registered document', @u);

-- Legal reviews
INSERT INTO dbo.LegalLandSearchReview (EnquiryId, OverallSearchStatus, OwnershipChainStatus, RecordMatchingStatus, RegistryDeedStatus, PossessionStatus, DiscrepancyStatus,
  RiskLevel, Recommendation, Remarks, Conditions, ReviewedBy, ReviewDate, CreatedBy)
SELECT x.EnquiryId, N'Satisfactory', N'Satisfactory', N'Satisfactory', N'Satisfactory', N'Satisfactory', N'Satisfactory', N'Low', N'Recommended to Proceed',
  N'CS → RS → LR traced; the area difference is explained by the 1994 sale of the east half.', NULL, @u, CAST(GETDATE() AS DATE), @u
FROM @E x WHERE x.done = 1;
INSERT INTO dbo.LegalLandSearchReview (EnquiryId, OverallSearchStatus, OwnershipChainStatus, RecordMatchingStatus, RegistryDeedStatus, PossessionStatus, DiscrepancyStatus,
  RiskLevel, Recommendation, Remarks, ReviewedBy, ReviewDate, CreatedBy)
VALUES (@first, N'In Progress', N'Concerns Found', N'In Progress', N'In Progress', N'Concerns Found', N'Concerns Found', N'High', N'Hold for Further Investigation',
  N'Holder changes from Haren to Bimal without a traced deed; an unauthorised occupant on the road side; patta to be checked.', @u, CAST(GETDATE() AS DATE), @u);
COMMIT;
