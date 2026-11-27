-- Legal demo (TEST RESIDENCE): detailed CS / RS / LR record entries and their mapping, so Land Records Search shows
-- record entries, CS → RS → LR links and the difference alerts.
--   Every open TR enquiry: one CS record (10 Katha, recorded raiyat), its RS records get the record details and the
--   previous CS reference, its LR records get the record details; CS → RS links "Matched", RS → LR links
--   "Partially Matched" with half the area on the LR record (a partial transfer to look into).
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.LegalLandRecordMap', 'U') IS NULL RETURN;
IF NOT EXISTS (SELECT 1 FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%') RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalEnquiryCsRecord c JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = c.EnquiryId WHERE e.EnquiryNo LIKE N'TR-ENQ-%') RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLandEnquiry WHERE EnquiryNo LIKE N'TR-ENQ-%' AND CreatedBy IS NOT NULL);
DECLARE @KATHA INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @f INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'TR-demo-document.pdf');
DECLARE @E TABLE (EnquiryId INT PRIMARY KEY, MouzaId INT, JLNo NVARCHAR(30), n INT);
INSERT INTO @E SELECT EnquiryId, MouzaId, JLNo, ROW_NUMBER() OVER (ORDER BY EnquiryNo) FROM dbo.LegalLandEnquiry
WHERE EnquiryNo LIKE N'TR-ENQ-%' AND LandId IS NULL AND EnquiryStatus <> N'Rejected';

-- CS records
INSERT INTO dbo.LegalEnquiryCsRecord (EnquiryId, MouzaId, JLNo, CsKhatianNo, CsDagNo, RecordedHolder, GuardianName, Area, AreaUnitId, LandClass, Share,
  RecordYear, RecordOffice, SourceMethod, SourceRef, RecordStatus, DocFileId, Remarks, CreatedBy)
SELECT x.EnquiryId, x.MouzaId, x.JLNo, CAST(40 + x.n AS NVARCHAR(10)), CAST(115 + x.n * 5 AS NVARCHAR(10)), N'Gopal Sarkar', N'Late Ramesh Sarkar', 10, @KATHA, N'Agricultural (Sali)', N'1.00',
  1928, N'Collectorate record room, Barasat', N'Certified copy', N'CC/1928/' + CAST(x.n AS NVARCHAR(10)), N'Found', @f, N'Oldest record of the plot', @u
FROM @E x;

-- RS / LR record details
UPDATE r SET JLNo = x.JLNo, GuardianName = N'Late Gopal Sarkar', LandClass = N'Agricultural (Sali)', RecordYear = 1962, RecordOffice = N'BL&LRO Rajarhat',
  SourceMethod = N'Certified copy', SourceRef = N'RS/CC/1962/' + r.RsDagNo, RecordStatus = N'Found', DocFileId = ISNULL(r.DocFileId, @f),
  RecordedHolder = ISNULL(r.RecordedHolder, N'Haren Sarkar'), Area = ISNULL(r.Area, 10), AreaUnitId = ISNULL(r.AreaUnitId, @KATHA),
  PrevCsDagNo = c.CsDagNo, PrevCsKhatianNo = c.CsKhatianNo
FROM dbo.LegalEnquiryRsRecord r JOIN @E x ON x.EnquiryId = r.EnquiryId JOIN dbo.LegalEnquiryCsRecord c ON c.EnquiryId = r.EnquiryId;
UPDATE l SET JLNo = x.JLNo, GuardianName = N'Late Nitai Sarkar', LandClass = N'Bastu', RecordYear = 1992, RecordOffice = N'Banglarbhumi',
  SourceMethod = N'Online portal', SourceRef = N'RoR print ' + l.LrDagNo, RecordStatus = N'Partially Matched',
  RecordedHolder = ISNULL(l.RecordedHolder, N'Bimal Sarkar'), Area = 5, AreaUnitId = @KATHA,
  PrevRsDagNo = (SELECT TOP 1 RsDagNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = l.EnquiryId AND IsActive = 1 ORDER BY RsRecordId),
  PrevRsKhatianNo = (SELECT TOP 1 RsKhatianNo FROM dbo.LegalEnquiryRsRecord WHERE EnquiryId = l.EnquiryId AND IsActive = 1 ORDER BY RsRecordId)
FROM dbo.LegalEnquiryLrRecord l JOIN @E x ON x.EnquiryId = l.EnquiryId;

-- Links: CS → every RS (one-to-many where there are several), every RS → its LR records
INSERT INTO dbo.LegalLandRecordMap (EnquiryId, FromType, FromId, ToType, ToId, MatchStatus, MatchBasis, Remarks, EvidenceFileId, CreatedBy)
SELECT c.EnquiryId, N'CS', c.CsRecordId, N'RS', r.RsRecordId, N'Matched', N'RS record names CS Dag ' + c.CsDagNo + N' as its previous Dag; same boundaries on the mouza map',
  N'Holder changed from Gopal to his son Haren (succession)', @f, @u
FROM dbo.LegalEnquiryCsRecord c JOIN dbo.LegalEnquiryRsRecord r ON r.EnquiryId = c.EnquiryId AND r.IsActive = 1 JOIN @E x ON x.EnquiryId = c.EnquiryId;
INSERT INTO dbo.LegalLandRecordMap (EnquiryId, FromType, FromId, ToType, ToId, MatchStatus, MatchBasis, Remarks, CreatedBy)
SELECT r.EnquiryId, N'RS', r.RsRecordId, N'LR', l.LrRecordId, N'Partially Matched', N'LR RoR shows previous RS Dag ' + r.RsDagNo,
  N'LR area is 5 Katha against 10 Katha in RS — part may have been transferred; check the deeds', @u
FROM dbo.LegalEnquiryRsRecord r JOIN dbo.LegalEnquiryLrRecord l ON l.EnquiryId = r.EnquiryId AND l.IsActive = 1 JOIN @E x ON x.EnquiryId = r.EnquiryId
WHERE r.IsActive = 1 AND (l.MatchingRsRecordId IS NULL OR l.MatchingRsRecordId = r.RsRecordId);
COMMIT;
