-- Legal V3 phases B, C, D (3.0 specification). Existing tables are extended; nothing is rebuilt.
-- B  Land parcels: LegalLandParcel — one row per parcel / portion, under an enquiry and (after conversion) the same row
--    under its land (one source of truth). CS / RS / LR records, ownership records, events and inheritances can name
--    their parcel. Possession and alternative history follow the enquiry to the land. Every existing enquiry / land
--    gets one parcel built from its own Mouza / J.L. / Dag / Khatian / area.
-- C  Ownership events: LegalOwnershipEvent gains an approval status (Draft → Pending Verification → Verified, or
--    Disputed / Rejected), effective and document dates; LegalOwnershipEventParty holds every transferor / transferee
--    with kind, relationship and share (decimal + exact fraction text). Owner records get the owner kind and fraction.
--    LegalOwnershipDispute: the ownership dispute register.
-- D  Inheritance: LegalInheritance gains the case fields (succession type, property type, nature of ownership,
--    will / court order / partition, applicable framework, school, available share, review status, legal officer);
--    LegalFamilyMember (family relationships, separate from ownership), LegalInheritanceWill, and
--    LegalInheritanceCalc (versioned provisional calculations with the rule version and explanation).
--    Roles: Legal Officer, Land Approver, Auditor.
-- Nothing here concludes ownership: verified events and approved calculations are decisions of authorised users.

-- ── B. Parcels ─────────────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.LegalLandParcel', 'U') IS NULL
  CREATE TABLE dbo.LegalLandParcel (
    ParcelId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandParcel PRIMARY KEY,
    ParcelCode NVARCHAR(40) NOT NULL CONSTRAINT UQ_LegalLandParcel_Code UNIQUE,
    EnquiryId INT NULL, LandId INT NULL,
    DistrictId INT NULL, BlockId INT NULL, MouzaId INT NULL, JLNo NVARCHAR(30) NULL,
    CsDagNo NVARCHAR(100) NULL, RsDagNo NVARCHAR(100) NULL, LrDagNo NVARCHAR(100) NULL,
    CsKhatianNo NVARCHAR(100) NULL, RsKhatianNo NVARCHAR(100) NULL, LrKhatianNo NVARCHAR(100) NULL,
    Area DECIMAL(18,4) NULL, AreaUnitId INT NULL, LandTypeId INT NULL,
    OfferedOwner NVARCHAR(300) NULL, OfferedSharePct DECIMAL(9,6) NULL, OfferedShareFraction NVARCHAR(20) NULL,
    OfferedArea DECIMAL(18,4) NULL, DeedArea DECIMAL(18,4) NULL, SurveyedArea DECIMAL(18,4) NULL, OwnershipArea DECIMAL(18,4) NULL,
    Source NVARCHAR(200) NULL, ParcelStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandParcel_Status DEFAULT N'Under Investigation',
    Remarks NVARCHAR(1000) NULL, IsActive BIT NOT NULL CONSTRAINT DF_LegalLandParcel_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandParcel_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalLandParcel_Owner CHECK (EnquiryId IS NOT NULL OR LandId IS NOT NULL),
    CONSTRAINT CK_LegalLandParcel_Status CHECK (ParcelStatus IN (N'Under Investigation', N'Verified', N'Disputed', N'Excluded', N'Acquired')));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandParcel_Enquiry') CREATE INDEX IX_LegalLandParcel_Enquiry ON dbo.LegalLandParcel (EnquiryId) WHERE EnquiryId IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandParcel_Land') CREATE INDEX IX_LegalLandParcel_Land ON dbo.LegalLandParcel (LandId) WHERE LandId IS NOT NULL;
GO
DECLARE @t TABLE (n SYSNAME);
INSERT INTO @t VALUES (N'LegalEnquiryCsRecord'), (N'LegalEnquiryRsRecord'), (N'LegalEnquiryLrRecord'), (N'LegalLandRsRecord'), (N'LegalLandLrRecord'),
  (N'LegalOwnershipRecord'), (N'LegalOwnershipEvent'), (N'LegalInheritance'), (N'LegalLandDiscrepancy');
DECLARE @n SYSNAME, @s NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT n FROM @t;
OPEN c; FETCH NEXT FROM c INTO @n;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'dbo.' + @n, 'U') IS NOT NULL AND COL_LENGTH(N'dbo.' + @n, 'ParcelId') IS NULL
  BEGIN SET @s = N'ALTER TABLE dbo.' + QUOTENAME(@n) + N' ADD ParcelId INT NULL'; EXEC (@s); END
  FETCH NEXT FROM c INTO @n;
END
CLOSE c; DEALLOCATE c;
GO
IF COL_LENGTH('dbo.LegalLandPossession', 'LandId') IS NULL ALTER TABLE dbo.LegalLandPossession ADD LandId INT NULL;
IF COL_LENGTH('dbo.LegalLandAltHistory', 'LandId') IS NULL ALTER TABLE dbo.LegalLandAltHistory ADD LandId INT NULL;
GO
ALTER TABLE dbo.LegalLandPossession ALTER COLUMN EnquiryId INT NULL;
ALTER TABLE dbo.LegalLandAltHistory ALTER COLUMN EnquiryId INT NULL;
GO
UPDATE p SET LandId = e.LandId FROM dbo.LegalLandPossession p JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = p.EnquiryId WHERE e.LandId IS NOT NULL AND p.LandId IS NULL;
UPDATE a SET LandId = e.LandId FROM dbo.LegalLandAltHistory a JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = a.EnquiryId WHERE e.LandId IS NOT NULL AND a.LandId IS NULL;
GO
-- One parcel for every existing enquiry (and its land), then for lands without an enquiry.
INSERT INTO dbo.LegalLandParcel (ParcelCode, EnquiryId, LandId, DistrictId, MouzaId, JLNo, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, Area, AreaUnitId, OfferedArea, DeedArea, OfferedOwner, Source, ParcelStatus, CreatedBy)
SELECT LEFT(N'PCL/' + e.EnquiryNo + N'/1', 40), e.EnquiryId, e.LandId, e.DistrictId, e.MouzaId, e.JLNo, LEFT(e.RsDagNo, 100), LEFT(e.LrDagNo, 100), LEFT(e.RsKhatianNo, 100), LEFT(e.LrKhatianNo, 100),
  e.ApproxArea, e.AreaUnitId, e.ApproxArea, e.DeedArea, LEFT(e.ContactPerson, 300), N'From the enquiry', CASE WHEN e.LandId IS NULL THEN N'Under Investigation' ELSE N'Verified' END, e.CreatedBy
FROM dbo.LegalLandEnquiry e
WHERE e.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandParcel p WHERE p.EnquiryId = e.EnquiryId);
INSERT INTO dbo.LegalLandParcel (ParcelCode, LandId, DistrictId, MouzaId, RsDagNo, LrDagNo, RsKhatianNo, LrKhatianNo, Area, AreaUnitId, Source, ParcelStatus, CreatedBy)
SELECT LEFT(N'PCL/' + l.LandCode + N'/1', 40), l.LandId, l.DistrictId, l.MouzaId, LEFT(l.RsDagNo, 100), LEFT(l.LrDagNo, 100), LEFT(l.RsKhatianNo, 100), LEFT(l.LrKhatianNo, 100),
  l.Area, l.AreaUnitId, N'From the land record', N'Verified', l.CreatedBy
FROM dbo.LegalLand l
WHERE l.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandParcel p WHERE p.LandId = l.LandId)
  AND NOT EXISTS (SELECT 1 FROM dbo.LegalLandParcel p WHERE p.ParcelCode = LEFT(N'PCL/' + l.LandCode + N'/1', 40));
GO
-- Single-parcel enquiries / lands: their records point at that parcel.
UPDATE r SET ParcelId = p.ParcelId FROM dbo.LegalEnquiryRsRecord r JOIN dbo.LegalLandParcel p ON p.EnquiryId = r.EnquiryId WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = p.ParcelId FROM dbo.LegalEnquiryLrRecord r JOIN dbo.LegalLandParcel p ON p.EnquiryId = r.EnquiryId WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = p.ParcelId FROM dbo.LegalEnquiryCsRecord r JOIN dbo.LegalLandParcel p ON p.EnquiryId = r.EnquiryId WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel p WHERE p.LandId = r.LandId ORDER BY ParcelId) FROM dbo.LegalLandRsRecord r WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel p WHERE p.LandId = r.LandId ORDER BY ParcelId) FROM dbo.LegalLandLrRecord r WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel p WHERE p.LandId = r.LandId ORDER BY ParcelId) FROM dbo.LegalOwnershipRecord r WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel p WHERE p.LandId = r.LandId ORDER BY ParcelId) FROM dbo.LegalOwnershipEvent r WHERE r.ParcelId IS NULL;
UPDATE r SET ParcelId = (SELECT TOP 1 ParcelId FROM dbo.LegalLandParcel p WHERE p.LandId = r.LandId ORDER BY ParcelId) FROM dbo.LegalInheritance r WHERE r.ParcelId IS NULL;
GO

-- ── C. Ownership events ────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.LegalOwnershipEvent', 'ApprovalStatus') IS NULL
  ALTER TABLE dbo.LegalOwnershipEvent ADD ApprovalStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipEvent_Approval DEFAULT N'Draft',
    EffectiveDate DATE NULL, DocumentDate DATE NULL, ApprovedBy INT NULL, ApprovedAt DATETIME2 NULL, ApprovalRemarks NVARCHAR(1000) NULL, InheritanceId INT NULL;
GO
UPDATE dbo.LegalOwnershipEvent SET ApprovalStatus = CASE WHEN VerificationStatus = N'Verified' THEN N'Verified' ELSE N'Pending Verification' END, EffectiveDate = ISNULL(EffectiveDate, EventDate)
WHERE ApprovalStatus = N'Draft';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalOwnershipEvent_Approval')
  ALTER TABLE dbo.LegalOwnershipEvent ADD CONSTRAINT CK_LegalOwnershipEvent_Approval CHECK (ApprovalStatus IN (N'Draft', N'Pending Verification', N'Verified', N'Disputed', N'Rejected'));
GO
IF OBJECT_ID('dbo.LegalOwnershipEventParty', 'U') IS NULL
  CREATE TABLE dbo.LegalOwnershipEventParty (
    PartyId INT IDENTITY(1,1) CONSTRAINT PK_LegalOwnershipEventParty PRIMARY KEY,
    EventId INT NOT NULL CONSTRAINT FK_LegalOwnershipEventParty_Event REFERENCES dbo.LegalOwnershipEvent (EventId),
    LandId INT NOT NULL, PartyRole NVARCHAR(30) NOT NULL, PersonName NVARCHAR(200) NOT NULL, GuardianName NVARCHAR(200) NULL, PersonId INT NULL,
    OwnerKind NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipEventParty_Kind DEFAULT N'Individual', RelationshipTypeId INT NULL,
    SharePct DECIMAL(9,6) NULL, ShareFraction NVARCHAR(20) NULL, Area DECIMAL(18,4) NULL, AreaUnitId INT NULL, Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOwnershipEventParty_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOwnershipEventParty_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalOwnershipEventParty_Role CHECK (PartyRole IN (N'Transferor', N'Transferee', N'Consenting party', N'Witness')),
    CONSTRAINT CK_LegalOwnershipEventParty_Share CHECK (SharePct IS NULL OR (SharePct >= 0 AND SharePct <= 100)));
GO
-- Existing one-to-one events get their two parties.
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, GuardianName, PersonId, SharePct, CreatedBy)
SELECT e.EventId, e.LandId, N'Transferor', e.PreviousOwnerName, e.PreviousOwnerGuardian, e.PreviousOwnerId, e.TransferSharePct, e.CreatedBy
FROM dbo.LegalOwnershipEvent e WHERE e.PreviousOwnerName IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalOwnershipEventParty p WHERE p.EventId = e.EventId);
INSERT INTO dbo.LegalOwnershipEventParty (EventId, LandId, PartyRole, PersonName, GuardianName, PersonId, SharePct, CreatedBy)
SELECT e.EventId, e.LandId, N'Transferee', e.NewOwnerName, e.NewOwnerGuardian, e.NewOwnerId, e.TransferSharePct, e.CreatedBy
FROM dbo.LegalOwnershipEvent e WHERE e.NewOwnerName IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalOwnershipEventParty p WHERE p.EventId = e.EventId AND p.PartyRole = N'Transferee');
GO
IF COL_LENGTH('dbo.LegalOwnershipRecord', 'OwnerKind') IS NULL
  ALTER TABLE dbo.LegalOwnershipRecord ADD OwnerKind NVARCHAR(30) NULL, ShareFraction NVARCHAR(20) NULL;
GO
INSERT INTO dbo.LegalLookupValue (Category, Name, SortOrder, IsActive)
SELECT N'transfer-type', v.n, v.s, 1 FROM (VALUES (N'Original Acquisition', 1), (N'Relinquishment / Release', 60), (N'Exchange', 61), (N'Government Grant / Patta', 62),
  (N'Family Arrangement', 63), (N'Correction / Rectification', 64)) v(n, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLookupValue x WHERE x.Category = N'transfer-type' AND x.Name = v.n);
GO
IF OBJECT_ID('dbo.LegalOwnershipDispute', 'U') IS NULL
  CREATE TABLE dbo.LegalOwnershipDispute (
    DisputeId INT IDENTITY(1,1) CONSTRAINT PK_LegalOwnershipDispute PRIMARY KEY,
    LandId INT NOT NULL, ParcelId INT NULL, InheritanceId INT NULL, CaseId INT NULL,
    Claimant NVARCHAR(200) NOT NULL, OpposingParty NVARCHAR(200) NULL, DisputeType NVARCHAR(60) NOT NULL,
    DisputedSharePct DECIMAL(9,6) NULL, DisputedArea DECIMAL(18,4) NULL, AreaUnitId INT NULL, CourtCaseNo NVARCHAR(100) NULL, Court NVARCHAR(200) NULL,
    FilingDate DATE NULL, NextHearingDate DATE NULL, DisputeStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipDispute_St DEFAULT N'Open',
    EvidenceFileId INT NULL, LegalOfficerId INT NULL, Remarks NVARCHAR(2000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOwnershipDispute_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOwnershipDispute_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalOwnershipDispute_St CHECK (DisputeStatus IN (N'Open', N'Under Investigation', N'Court Pending', N'Temporarily Resolved', N'Resolved', N'Closed')));
GO

-- ── D. Inheritance ─────────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.LegalInheritance', 'SuccessionType') IS NULL
  ALTER TABLE dbo.LegalInheritance ADD
    DeceasedGender NVARCHAR(10) NULL, SuccessionType NVARCHAR(40) NULL, PropertyType NVARCHAR(30) NULL, NatureOfOwnership NVARCHAR(50) NULL,
    WillAvailable BIT NOT NULL CONSTRAINT DF_LegalInheritance_Will DEFAULT 0, CourtOrderAvailable BIT NOT NULL CONSTRAINT DF_LegalInheritance_Court DEFAULT 0,
    PreviousPartition BIT NOT NULL CONSTRAINT DF_LegalInheritance_Partition DEFAULT 0,
    PersonalLaw NVARCHAR(60) NULL, ApplicableFramework NVARCHAR(60) NULL, SchoolOfLaw NVARCHAR(40) NULL,
    AvailableSharePct DECIMAL(9,6) NULL, AvailableShareFraction NVARCHAR(20) NULL, PrevEventId INT NULL,
    SpecialCircumstances NVARCHAR(1000) NULL, FrameworkConfirmedBy INT NULL, FrameworkConfirmedAt DATETIME2 NULL,
    LegalOfficerId INT NULL, ReviewStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalInheritance_Review DEFAULT N'Draft', ReviewRemarks NVARCHAR(1000) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalInheritance_Review')
  ALTER TABLE dbo.LegalInheritance ADD CONSTRAINT CK_LegalInheritance_Review CHECK (ReviewStatus IN (N'Draft', N'Verifier Review', N'Legal Officer Review',
    N'Approved', N'Returned', N'Rejected', N'Disputed', N'Further Investigation'));
GO
IF OBJECT_ID('dbo.LegalFamilyMember', 'U') IS NULL
  CREATE TABLE dbo.LegalFamilyMember (
    MemberId INT IDENTITY(1,1) CONSTRAINT PK_LegalFamilyMember PRIMARY KEY,
    LandId INT NOT NULL, InheritanceId INT NULL, FullName NVARCHAR(200) NOT NULL, Gender NVARCHAR(10) NULL,
    RelatedToMemberId INT NULL, RelationToRelated NVARCHAR(40) NULL, RelationToDeceased NVARCHAR(60) NULL,
    IsDeceasedOwner BIT NOT NULL CONSTRAINT DF_LegalFamilyMember_Deceased DEFAULT 0,
    IsAlive BIT NOT NULL CONSTRAINT DF_LegalFamilyMember_Alive DEFAULT 1, DateOfDeath DATE NULL, DateOfBirth DATE NULL,
    IsMinor BIT NOT NULL CONSTRAINT DF_LegalFamilyMember_Minor DEFAULT 0, IsMissing BIT NOT NULL CONSTRAINT DF_LegalFamilyMember_Missing DEFAULT 0,
    RelationshipStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalFamilyMember_RelSt DEFAULT N'Verified',
    EvidenceFileId INT NULL, Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalFamilyMember_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalFamilyMember_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalFamilyMember_RelSt CHECK (RelationshipStatus IN (N'Verified', N'Claimed', N'Disputed', N'Unknown')));
GO
IF OBJECT_ID('dbo.LegalInheritanceWill', 'U') IS NULL
  CREATE TABLE dbo.LegalInheritanceWill (
    WillId INT IDENTITY(1,1) CONSTRAINT PK_LegalInheritanceWill PRIMARY KEY,
    LandId INT NOT NULL, InheritanceId INT NOT NULL, WillDate DATE NULL, Testator NVARCHAR(200) NOT NULL, Beneficiaries NVARCHAR(1000) NULL,
    PropertyCovered NVARCHAR(1000) NULL, Executor NVARCHAR(200) NULL, Witnesses NVARCHAR(500) NULL, ProbateRef NVARCHAR(200) NULL,
    ValidityStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalInheritanceWill_St DEFAULT N'Under Review', DocFileId INT NULL, Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalInheritanceWill_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalInheritanceWill_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalInheritanceWill_St CHECK (ValidityStatus IN (N'Under Review', N'Valid', N'Disputed', N'Invalid', N'Probate Pending')));
GO
IF OBJECT_ID('dbo.LegalInheritanceCalc', 'U') IS NULL
  CREATE TABLE dbo.LegalInheritanceCalc (
    CalcId INT IDENTITY(1,1) CONSTRAINT PK_LegalInheritanceCalc PRIMARY KEY,
    InheritanceId INT NOT NULL, LandId INT NOT NULL, VersionNo INT NOT NULL, Framework NVARCHAR(60) NULL, RuleVersion NVARCHAR(60) NOT NULL,
    Outcome NVARCHAR(30) NOT NULL, InputsJson NVARCHAR(MAX) NOT NULL, ResultJson NVARCHAR(MAX) NULL, Explanation NVARCHAR(MAX) NULL,
    CalcStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalInheritanceCalc_St DEFAULT N'Provisional',
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalInheritanceCalc_At DEFAULT SYSUTCDATETIME(),
    ReviewedBy INT NULL, ReviewedAt DATETIME2 NULL, ReviewRemarks NVARCHAR(1000) NULL,
    CONSTRAINT UQ_LegalInheritanceCalc_Version UNIQUE (InheritanceId, VersionNo),
    CONSTRAINT CK_LegalInheritanceCalc_Outcome CHECK (Outcome IN (N'Calculated', N'Requires Legal Review')),
    CONSTRAINT CK_LegalInheritanceCalc_St CHECK (CalcStatus IN (N'Provisional', N'Approved', N'Rejected', N'Superseded')));
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalApprovalAuthority_Stage')
  ALTER TABLE dbo.LegalApprovalAuthority DROP CONSTRAINT CK_LegalApprovalAuthority_Stage;
GO
ALTER TABLE dbo.LegalApprovalAuthority ADD CONSTRAINT CK_LegalApprovalAuthority_Stage
  CHECK (Stage IN (N'Verifier', N'Approver', N'L1 Approver', N'L2 Approver', N'Legal Reviewer', N'Amendment Approver', N'Legal Admin', N'Search Executive',
                   N'Legal Officer', N'Land Approver', N'Auditor'));
GO
