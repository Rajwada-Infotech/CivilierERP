-- Legal demo (TEST RESIDENCE): pre-registration classification & conversion on every case.
--   TR/00001  Shali → Bastu, conversion before registration, approved; application submitted (blocked) · 2nd parcel Bastu, no conversion.
--   TR/00002  (Deed Process) Shali → Bastu before registration; order received, waiting to be sent for verification (blocked).
--   TR/00003  (Deed Registration) Bastu — no conversion, approved (clear to register).
--   TR/00004  (Registered) Doba → Bastu permitted after registration — its conversion is in Post-registration.
--   TR-ENQ-0001 (enquiry) Danga — legal review required.
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.LegalPreRegConversion', 'U') IS NULL RETURN;
DECLARE @L1 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00001/2026-27'), @L2 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00002/2026-27'),
        @L3 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00003/2026-27'), @L4 INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00004/2026-27');
IF @L1 IS NULL OR @L2 IS NULL OR @L3 IS NULL OR @L4 IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalPreRegConversion WHERE LandId IN (@L1, @L2, @L3, @L4)) RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLand WHERE LandId = @L1);
DECLARE @u2 INT = ISNULL((SELECT TOP 1 id FROM dbo.users WHERE id <> @u ORDER BY id), @u);
DECLARE @f INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'TR-demo-document.pdf');
DECLARE @today DATE = CAST(GETDATE() AS DATE);
DECLARE @SHALI INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'SHALI'), @BASTU INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'BASTU'),
        @DOBA INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'DOBA'), @DANGA INT = (SELECT LandTypeId FROM dbo.LegalLandType WHERE LandTypeCode = N'DANGA');
DECLARE @P1 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L1 ORDER BY ParcelId), @P1b INT = (SELECT ParcelId FROM dbo.LegalLandParcel WHERE ParcelCode = N'PCL/TR/00001/2026-27/2'),
        @P2 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L2 ORDER BY ParcelId), @P3 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L3 ORDER BY ParcelId),
        @P4 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L4 ORDER BY ParcelId);

UPDATE dbo.LegalLandParcel SET LandTypeId = @SHALI, ProposedLandTypeId = @BASTU, ProposedLandUse = N'Residential housing', ConversionRequired = N'Yes', ConversionStage = N'Pre-registration',
  AssessmentRemarks = N'Shali; WB Land Reforms Act s.4C conversion needed before the transfer for housing', AssessmentStatus = N'Approved', AssessedBy = @u2, AssessedAt = SYSUTCDATETIME()
WHERE ParcelId IN (@P1, @P2);
UPDATE dbo.LegalLandParcel SET LandTypeId = @BASTU, ProposedLandTypeId = NULL, ProposedLandUse = N'Residential housing', ConversionRequired = N'No', ConversionStage = N'Not Applicable',
  AssessmentRemarks = N'Recorded as Bastu in the LR RoR — no conversion needed', AssessmentStatus = N'Approved', AssessedBy = @u2, AssessedAt = SYSUTCDATETIME()
WHERE ParcelId IN (@P1b, @P3);
UPDATE dbo.LegalLandParcel SET LandTypeId = @DOBA, ProposedLandTypeId = @BASTU, ProposedLandUse = N'Residential housing', ConversionRequired = N'Yes', ConversionStage = N'Post-registration',
  AssessmentRemarks = N'Conversion permitted after transfer in this block; to be applied by the company after mutation', AssessmentStatus = N'Approved', AssessedBy = @u2, AssessedAt = SYSUTCDATETIME()
WHERE ParcelId = @P4;
UPDATE p SET LandTypeId = @DANGA, ProposedLandTypeId = @BASTU, ProposedLandUse = N'Residential housing', ConversionRequired = N'Legal Review Required',
  AssessmentRemarks = N'RS shows Danga, LR shows Bastu — classification to be confirmed', AssessmentStatus = N'Pending'
FROM dbo.LegalLandParcel p JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = p.EnquiryId WHERE e.EnquiryNo = N'TR-ENQ-0001';

INSERT INTO dbo.LegalPreRegConversion (LandId, ParcelId, ApplicationNo, ApplicationDate, OfficeName, AssignedUserId, TargetDate, ConversionStatus, HearingDate, QueryDate, QueryDetails,
  FeeAmount, FeeRef, ApplicationFileId, Remarks, CreatedBy)
VALUES (@L1, @P1, N'CONV/RJH/2026/0412', DATEADD(day, -25, @today), N'BL&LRO Rajarhat', @u, DATEADD(day, 20, @today), N'Query Received', DATEADD(day, 9, @today), DATEADD(day, -5, @today),
  N'Submit the up-to-date LR RoR and the site plan', 12500, N'GRIPS 2026-11-0412', @f, N'Hearing fixed; RoR to be filed', @u);
INSERT INTO dbo.LegalPreRegConversion (LandId, ParcelId, ApplicationNo, ApplicationDate, OfficeName, AssignedUserId, TargetDate, ConversionStatus, FeeAmount, FeeRef,
  OrderNo, OrderDate, ApplicationFileId, OrderFileId, Remarks, CreatedBy)
VALUES (@L2, @P2, N'CONV/RJH/2026/0377', DATEADD(day, -60, @today), N'BL&LRO Rajarhat', @u, DATEADD(day, -3, @today), N'Order Received', 9800, N'GRIPS 2026-09-0377',
  N'CO/RJH/2026/219', DATEADD(day, -6, @today), @f, @f, N'Order received — send for legal verification', @u);

INSERT INTO dbo.LegalMutation (LandId, OfficeName, Kind, ConversionStage, ParcelId, MouzaId, DagNo, CurrentClass, RequestedClass, ApplicationStatus, AssignedUserId, DueDate, Remarks, IsActive, CreatedBy)
SELECT @L4, N'BL&LRO Rajarhat', N'Conversion', N'Post-registration', @P4, l.MouzaId, LEFT(p.RsDagNo, 60), N'Doba (low-lying / water-logged)', N'Bastu (homestead)', N'Not Applied', @u, DATEADD(day, 45, @today),
  N'Opened by the pre-registration assessment — conversion permitted after registration', 1, @u
FROM dbo.LegalLand l JOIN dbo.LegalLandParcel p ON p.ParcelId = @P4 WHERE l.LandId = @L4
  AND NOT EXISTS (SELECT 1 FROM dbo.LegalMutation x WHERE x.ParcelId = @P4 AND x.Kind = N'Conversion');
COMMIT;
