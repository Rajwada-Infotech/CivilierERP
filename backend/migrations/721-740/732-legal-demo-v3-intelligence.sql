-- Legal demo (TEST RESIDENCE, land TR/00001/2026-27): parcels, family, inheritance cases and a dispute, so the
-- Land intelligence panel shows every feature.
--   A second parcel (RS 442 / LR 1411, 2 Katha) next to the first; Kamal Sarkar's family (wife Rina, daughter Puja,
--   pre-deceased son Ravi with widow Mitu and son Tuku, nephew Tapan — relationship disputed); Kamal's inheritance case
--   filled in (Hindu Succession Act, male, intestate, 50 % available, waiting for the Legal Officer to confirm the
--   framework) and an open dispute by Tapan; Haren's case as an earlier, simple one; current possession.
-- Runs wherever the TEST RESIDENCE demo exists, once.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.LegalFamilyMember', 'U') IS NULL RETURN;
DECLARE @L INT = (SELECT LandId FROM dbo.LegalLand WHERE LandCode = N'TR/00001/2026-27');
IF @L IS NULL RETURN;
IF EXISTS (SELECT 1 FROM dbo.LegalFamilyMember WHERE LandId = @L) RETURN;

BEGIN TRAN;
DECLARE @u INT = (SELECT TOP 1 CreatedBy FROM dbo.LegalLand WHERE LandId = @L);
DECLARE @KATHA INT = (SELECT AreaUnitId FROM dbo.LegalAreaUnit WHERE UnitCode = N'KATHA');
DECLARE @f INT = (SELECT TOP 1 FileId FROM dbo.LegalMasterFile WHERE FileName = N'TR-demo-document.pdf');
DECLARE @P1 INT = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel WHERE LandId = @L ORDER BY ParcelId);
DECLARE @M INT = (SELECT MouzaId FROM dbo.LegalLand WHERE LandId = @L);

-- Parcels: areas on the first, a second portion
UPDATE dbo.LegalLandParcel SET CsDagNo = ISNULL(CsDagNo, N'120'), CsKhatianNo = ISNULL(CsKhatianNo, N'45'), Area = ISNULL(Area, 10), AreaUnitId = ISNULL(AreaUnitId, @KATHA),
  OfferedArea = 5, DeedArea = 5, SurveyedArea = 4.75, OwnershipArea = 5, OfferedOwner = N'Bimal Sarkar, Arup Sarkar, Rina Sarkar, Puja Sarkar', OfferedSharePct = 100
WHERE ParcelId = @P1;
INSERT INTO dbo.LegalLandParcel (ParcelCode, LandId, MouzaId, JLNo, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, Area, AreaUnitId, OfferedArea, DeedArea, SurveyedArea,
  OfferedOwner, OfferedSharePct, OfferedShareFraction, Source, ParcelStatus, Remarks, CreatedBy)
SELECT N'PCL/TR/00001/2026-27/2', @L, @M, N'105', N'442', N'1411', N'221', N'2290', 2, @KATHA, 2, 2, 2, N'Bimal Sarkar', 50, N'1/2', N'Site visit', N'Under Investigation',
  N'Adjoining strip; only Bimal''s half is offered', @u
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLandParcel WHERE ParcelCode = N'PCL/TR/00001/2026-27/2');

-- Kamal's inheritance case
DECLARE @K INT = (SELECT TOP 1 InheritanceId FROM dbo.LegalInheritance WHERE LandId = @L AND DeceasedName = N'Kamal Sarkar' AND IsActive = 1);
DECLARE @H INT = (SELECT TOP 1 InheritanceId FROM dbo.LegalInheritance WHERE LandId = @L AND DeceasedName = N'Haren Sarkar' AND IsActive = 1);
UPDATE dbo.LegalInheritance SET DeceasedGender = N'Male', ParcelId = @P1, AvailableSharePct = 50, AvailableShareFraction = N'1/2', SuccessionType = N'Intestate – No Will',
  PropertyType = N'Non-Agricultural', NatureOfOwnership = N'Inherited Property', PersonalLaw = N'Hindu', ApplicableFramework = N'Hindu Succession Act, 1956',
  ReviewStatus = N'Draft', SpecialCircumstances = N'A pre-deceased son (Ravi) left a widow and a son; a nephew claims a share'
WHERE InheritanceId = @K;
UPDATE dbo.LegalInheritance SET DeceasedGender = N'Male', ParcelId = @P1, AvailableSharePct = 100, AvailableShareFraction = N'1/1', SuccessionType = N'Intestate – No Will',
  PropertyType = N'Agricultural', NatureOfOwnership = N'Self-Acquired / Separate Property', PersonalLaw = N'Hindu', ApplicableFramework = N'Hindu Succession Act, 1956', ReviewStatus = N'Draft'
WHERE InheritanceId = @H;

-- Family (Kamal's)
DECLARE @FM TABLE (k NVARCHAR(10), id INT);
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, IsDeceasedOwner, IsAlive, DateOfDeath, RelationshipStatus, EvidenceFileId, CreatedBy)
OUTPUT N'kamal', INSERTED.MemberId INTO @FM VALUES (@L, @K, N'Kamal Sarkar', N'Male', N'Deceased owner', 1, 0, '2019-12-31', N'Verified', @f, @u);
DECLARE @km INT = (SELECT id FROM @FM WHERE k = N'kamal');
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, DateOfDeath, RelationshipStatus, CreatedBy)
OUTPUT N'x', INSERTED.MemberId INTO @FM
VALUES (@L, @K, N'Rina Sarkar', N'Female', N'Wife', @km, N'Wife of', 1, NULL, N'Verified', @u),
       (@L, @K, N'Puja Sarkar', N'Female', N'Daughter', @km, N'Daughter of', 1, NULL, N'Verified', @u);
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, DateOfDeath, RelationshipStatus, Remarks, CreatedBy)
OUTPUT N'ravi', INSERTED.MemberId INTO @FM
VALUES (@L, @K, N'Ravi Sarkar', N'Male', N'Son', @km, N'Son of', 0, '2012-04-15', N'Verified', N'Pre-deceased son', @u);
DECLARE @rv INT = (SELECT id FROM @FM WHERE k = N'ravi');
INSERT INTO dbo.LegalFamilyMember (LandId, InheritanceId, FullName, Gender, RelationToDeceased, RelatedToMemberId, RelationToRelated, IsAlive, IsMinor, RelationshipStatus, Remarks, CreatedBy)
VALUES (@L, @K, N'Mitu Sarkar', N'Female', N'Son''s widow', @rv, N'Wife of', 1, 0, N'Verified', NULL, @u),
       (@L, @K, N'Tuku Sarkar', N'Male', N'Son''s son', @rv, N'Son of', 1, 1, N'Verified', N'Minor — mother is guardian', @u),
       (@L, @K, N'Tapan Sarkar', N'Male', N'Other legally relevant relation', NULL, NULL, 1, 0, N'Disputed', N'Claims to be a nephew with a share', @u);

-- Dispute by the nephew
INSERT INTO dbo.LegalOwnershipDispute (LandId, ParcelId, InheritanceId, Claimant, OpposingParty, DisputeType, DisputedSharePct, DisputeStatus, Remarks, CreatedBy)
VALUES (@L, @P1, @K, N'Tapan Sarkar', N'Rina Sarkar & Puja Sarkar', N'Heirship / succession', 12.5, N'Under Investigation', N'Claims a share through a relinquishment he says was never signed', @u);

-- Possession now
INSERT INTO dbo.LegalLandPossession (LandId, OccupantName, PossessionType, StartDate, Purpose, AreaOccupied, AreaUnitId, Source, VerificationStatus, Remarks, CreatedBy)
VALUES (@L, N'Bimal Sarkar', N'Owner Occupied', '2004-05-10', N'Cultivation', 4.5, @KATHA, N'Site inspection', N'Verified', NULL, @u),
       (@L, N'Sukumar Das', N'Unauthorized Occupation', '2015-01-01', N'Road-side shop shed', 0.25, @KATHA, N'Field inspection report', N'Disputed', N'No document; claims occupation since 2015', @u);
COMMIT;
