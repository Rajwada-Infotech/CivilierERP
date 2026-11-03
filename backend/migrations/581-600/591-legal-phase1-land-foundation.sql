-- 591 · Legal module, Phase 1 (Foundation) of the Legal & Land Management document v2.0
--   Setup:   Sub-Division, Block; short lists (ownership / relationship / transfer types, case & mortgage types,
--            payment modes, fee types, copy types…) as rows of LegalLookupValue by Category.
--            Mouza, Village, Party get master-linked columns (the old text columns stay and are kept filled).
--   Land:    Land Enquiry; LegalLand becomes the Land Property Master (boundaries, GPS, map, workflow, hold);
--            per-land RS records, LR records (optional RS match) and land-party links.
--   Workflow: the 31 pipeline steps, per-land step status and history, holds, and the Legal audit trail.
-- Additive only: nothing is dropped or rewritten. Existing RS Khatian / RS Plot / LR RoR masters stay as they are.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.LegalSubDivision', 'U') IS NULL
  CREATE TABLE dbo.LegalSubDivision (
    SubDivisionId INT IDENTITY(1,1) CONSTRAINT PK_LegalSubDivision PRIMARY KEY,
    DistrictId INT NOT NULL,
    SubDivisionName NVARCHAR(150) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalSubDivision_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalSubDivision_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalSubDivision UNIQUE (DistrictId, SubDivisionName),
    CONSTRAINT FK_LegalSubDivision_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId)
  );
GO
IF OBJECT_ID('dbo.LegalBlock', 'U') IS NULL
  CREATE TABLE dbo.LegalBlock (
    BlockId INT IDENTITY(1,1) CONSTRAINT PK_LegalBlock PRIMARY KEY,
    DistrictId INT NOT NULL,
    SubDivisionId INT NULL,
    BlockName NVARCHAR(150) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalBlock_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalBlock_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalBlock UNIQUE (DistrictId, BlockName),
    CONSTRAINT FK_LegalBlock_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalBlock_SubDivisionId FOREIGN KEY (SubDivisionId) REFERENCES dbo.LegalSubDivision(SubDivisionId)
  );
GO
IF OBJECT_ID('dbo.LegalLookupValue', 'U') IS NULL
  CREATE TABLE dbo.LegalLookupValue (
    LookupId INT IDENTITY(1,1) CONSTRAINT PK_LegalLookupValue PRIMARY KEY,
    Category NVARCHAR(40) NOT NULL,
    Code NVARCHAR(30) NULL,
    Name NVARCHAR(150) NOT NULL,
    Description NVARCHAR(500) NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_LegalLookupValue_SortOrder DEFAULT 0,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLookupValue_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLookupValue_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLookupValue UNIQUE (Category, Name)
  );
GO
-- ── Master-linked columns on existing masters ──
IF COL_LENGTH('dbo.LegalMouza', 'DistrictId') IS NULL ALTER TABLE dbo.LegalMouza ADD DistrictId INT NULL;
IF COL_LENGTH('dbo.LegalMouza', 'SubDivisionId') IS NULL ALTER TABLE dbo.LegalMouza ADD SubDivisionId INT NULL;
IF COL_LENGTH('dbo.LegalMouza', 'BlockId') IS NULL ALTER TABLE dbo.LegalMouza ADD BlockId INT NULL;
IF COL_LENGTH('dbo.LegalMouza', 'PoliceStationId') IS NULL ALTER TABLE dbo.LegalMouza ADD PoliceStationId INT NULL;
IF COL_LENGTH('dbo.LegalVillage', 'BlockId') IS NULL ALTER TABLE dbo.LegalVillage ADD BlockId INT NULL;
IF COL_LENGTH('dbo.LegalPerson', 'PartyType') IS NULL ALTER TABLE dbo.LegalPerson ADD PartyType NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalPerson_PartyType DEFAULT N'Individual';
IF COL_LENGTH('dbo.LegalPerson', 'DateOfBirth') IS NULL ALTER TABLE dbo.LegalPerson ADD DateOfBirth DATE NULL;
IF COL_LENGTH('dbo.LegalPerson', 'Gender') IS NULL ALTER TABLE dbo.LegalPerson ADD Gender NVARCHAR(10) NULL;
GO
IF OBJECT_ID('dbo.FK_LegalMouza_DistrictId', 'F') IS NULL ALTER TABLE dbo.LegalMouza ADD CONSTRAINT FK_LegalMouza_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId);
IF OBJECT_ID('dbo.FK_LegalMouza_SubDivisionId', 'F') IS NULL ALTER TABLE dbo.LegalMouza ADD CONSTRAINT FK_LegalMouza_SubDivisionId FOREIGN KEY (SubDivisionId) REFERENCES dbo.LegalSubDivision(SubDivisionId);
IF OBJECT_ID('dbo.FK_LegalMouza_BlockId', 'F') IS NULL ALTER TABLE dbo.LegalMouza ADD CONSTRAINT FK_LegalMouza_BlockId FOREIGN KEY (BlockId) REFERENCES dbo.LegalBlock(BlockId);
IF OBJECT_ID('dbo.FK_LegalMouza_PoliceStationId', 'F') IS NULL ALTER TABLE dbo.LegalMouza ADD CONSTRAINT FK_LegalMouza_PoliceStationId FOREIGN KEY (PoliceStationId) REFERENCES dbo.LegalPoliceStation(PoliceStationId);
IF OBJECT_ID('dbo.FK_LegalVillage_BlockId', 'F') IS NULL ALTER TABLE dbo.LegalVillage ADD CONSTRAINT FK_LegalVillage_BlockId FOREIGN KEY (BlockId) REFERENCES dbo.LegalBlock(BlockId);
-- Existing Mouzas: link the district by its name, so the new District pick is already filled.
UPDATE m SET DistrictId = d.DistrictId
FROM dbo.LegalMouza m JOIN dbo.LegalDistrict d ON LTRIM(RTRIM(d.DistrictName)) = LTRIM(RTRIM(m.District))
WHERE m.DistrictId IS NULL;
GO

IF OBJECT_ID('dbo.LegalLandEnquiry', 'U') IS NULL
  CREATE TABLE dbo.LegalLandEnquiry (
    EnquiryId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandEnquiry PRIMARY KEY,
    EnquiryNo NVARCHAR(30) NOT NULL,
    EnquiryDate DATE NOT NULL,
    EnquirySourceId INT NOT NULL,
    LandLocation NVARCHAR(300) NOT NULL,
    DistrictId INT NOT NULL,
    MouzaId INT NOT NULL,
    JLNo NVARCHAR(30) NULL,
    ApproxArea DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    ContactPerson NVARCHAR(200) NULL,
    ContactNumber NVARCHAR(15) NULL,
    ExpectedPrice DECIMAL(18,6) NULL,
    AssignedUserId INT NOT NULL,
    EnquiryStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalLandEnquiry_Status DEFAULT N'New'
      CONSTRAINT CK_LegalLandEnquiry_Status CHECK (EnquiryStatus IN (N'New', N'Under Review', N'Interested', N'Rejected', N'On Hold', N'Converted to Land Record')),
    InitialDocFileId INT NULL,
    InitialNotes NVARCHAR(2000) NULL,
    LandId INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandEnquiry_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandEnquiry_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLandEnquiry UNIQUE (EnquiryNo),
    CONSTRAINT FK_LegalLandEnquiry_EnquirySourceId FOREIGN KEY (EnquirySourceId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalLandEnquiry_DistrictId FOREIGN KEY (DistrictId) REFERENCES dbo.LegalDistrict(DistrictId),
    CONSTRAINT FK_LegalLandEnquiry_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalLandEnquiry_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLandEnquiry_InitialDocFileId FOREIGN KEY (InitialDocFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalLandEnquiry_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId)
  );
GO
-- ── LegalLand becomes the Land Property Master ──
IF COL_LENGTH('dbo.LegalLand', 'SubDivisionId') IS NULL ALTER TABLE dbo.LegalLand ADD SubDivisionId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'BlockId') IS NULL ALTER TABLE dbo.LegalLand ADD BlockId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'LocationTypeId') IS NULL ALTER TABLE dbo.LegalLand ADD LocationTypeId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'LocationAddress') IS NULL ALTER TABLE dbo.LegalLand ADD LocationAddress NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.LegalLand', 'NorthBoundary') IS NULL ALTER TABLE dbo.LegalLand ADD NorthBoundary NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.LegalLand', 'SouthBoundary') IS NULL ALTER TABLE dbo.LegalLand ADD SouthBoundary NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.LegalLand', 'EastBoundary') IS NULL ALTER TABLE dbo.LegalLand ADD EastBoundary NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.LegalLand', 'WestBoundary') IS NULL ALTER TABLE dbo.LegalLand ADD WestBoundary NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.LegalLand', 'GpsLatitude') IS NULL ALTER TABLE dbo.LegalLand ADD GpsLatitude DECIMAL(10,7) NULL;
IF COL_LENGTH('dbo.LegalLand', 'GpsLongitude') IS NULL ALTER TABLE dbo.LegalLand ADD GpsLongitude DECIMAL(10,7) NULL;
IF COL_LENGTH('dbo.LegalLand', 'MapFileId') IS NULL ALTER TABLE dbo.LegalLand ADD MapFileId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'EnquiryId') IS NULL ALTER TABLE dbo.LegalLand ADD EnquiryId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'WorkflowStatus') IS NULL ALTER TABLE dbo.LegalLand ADD WorkflowStatus NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.LegalLand', 'IsOnHold') IS NULL ALTER TABLE dbo.LegalLand ADD IsOnHold BIT NOT NULL CONSTRAINT DF_LegalLand_IsOnHold DEFAULT 0;
GO
IF OBJECT_ID('dbo.FK_LegalLand_SubDivisionId', 'F') IS NULL ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_SubDivisionId FOREIGN KEY (SubDivisionId) REFERENCES dbo.LegalSubDivision(SubDivisionId);
IF OBJECT_ID('dbo.FK_LegalLand_BlockId', 'F') IS NULL ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_BlockId FOREIGN KEY (BlockId) REFERENCES dbo.LegalBlock(BlockId);
IF OBJECT_ID('dbo.FK_LegalLand_LocationTypeId', 'F') IS NULL ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_LocationTypeId FOREIGN KEY (LocationTypeId) REFERENCES dbo.LegalLookupValue(LookupId);
IF OBJECT_ID('dbo.FK_LegalLand_MapFileId', 'F') IS NULL ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_MapFileId FOREIGN KEY (MapFileId) REFERENCES dbo.LegalMasterFile(FileId);
IF OBJECT_ID('dbo.FK_LegalLand_EnquiryId', 'F') IS NULL ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_EnquiryId FOREIGN KEY (EnquiryId) REFERENCES dbo.LegalLandEnquiry(EnquiryId);
GO

IF OBJECT_ID('dbo.LegalLandRsRecord', 'U') IS NULL
  CREATE TABLE dbo.LegalLandRsRecord (
    RsRecordId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandRsRecord PRIMARY KEY,
    LandId INT NOT NULL,
    MouzaId INT NOT NULL,
    RsKhatianNo NVARCHAR(30) NOT NULL,
    RsDagNo NVARCHAR(30) NOT NULL,
    RecordDate DATE NULL,
    RecordedHolder NVARCHAR(200) NULL,
    LandTypeId INT NULL,
    Area DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    Share NVARCHAR(30) NULL,
    CopyTypeId INT NULL,
    Source NVARCHAR(200) NULL,
    DocFileId INT NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandRsRecord_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalLandRsRecord_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandRsRecord_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandRsRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLandRsRecord UNIQUE (LandId, MouzaId, RsKhatianNo, RsDagNo),
    CONSTRAINT FK_LegalLandRsRecord_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandRsRecord_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalLandRsRecord_LandTypeId FOREIGN KEY (LandTypeId) REFERENCES dbo.LegalLandType(LandTypeId),
    CONSTRAINT FK_LegalLandRsRecord_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLandRsRecord_CopyTypeId FOREIGN KEY (CopyTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalLandRsRecord_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO
IF OBJECT_ID('dbo.LegalLandLrRecord', 'U') IS NULL
  CREATE TABLE dbo.LegalLandLrRecord (
    LrRecordId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandLrRecord PRIMARY KEY,
    LandId INT NOT NULL,
    MouzaId INT NOT NULL,
    LrKhatianNo NVARCHAR(30) NOT NULL,
    LrDagNo NVARCHAR(30) NOT NULL,
    MatchingRsRecordId INT NULL
      CONSTRAINT FK_LegalLandLrRecord_MatchingRsRecordId FOREIGN KEY REFERENCES dbo.LegalLandRsRecord(RsRecordId),
    GuardianName NVARCHAR(200) NULL,
    RorDate DATE NULL,
    RecordedHolder NVARCHAR(200) NULL,
    LandTypeId INT NULL,
    Area DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    Share NVARCHAR(30) NULL,
    CopyTypeId INT NULL,
    Source NVARCHAR(200) NULL,
    DocFileId INT NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandLrRecord_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalLandLrRecord_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandLrRecord_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandLrRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLandLrRecord UNIQUE (LandId, MouzaId, LrKhatianNo, LrDagNo),
    CONSTRAINT FK_LegalLandLrRecord_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandLrRecord_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalLandLrRecord_LandTypeId FOREIGN KEY (LandTypeId) REFERENCES dbo.LegalLandType(LandTypeId),
    CONSTRAINT FK_LegalLandLrRecord_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLandLrRecord_CopyTypeId FOREIGN KEY (CopyTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalLandLrRecord_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO
IF OBJECT_ID('dbo.LegalLandParty', 'U') IS NULL
  CREATE TABLE dbo.LegalLandParty (
    LandPartyId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandParty PRIMARY KEY,
    LandId INT NOT NULL,
    PersonId INT NOT NULL,
    LandRole NVARCHAR(30) NOT NULL CONSTRAINT CK_LegalLandParty_LandRole CHECK (LandRole IN (N'Owner', N'Joint Owner', N'Legal Heir', N'Previous Owner', N'Seller', N'Buyer', N'Representative', N'Authorized Signatory')),
    RelationshipTypeId INT NULL,
    SharePct DECIMAL(7,4) NULL CONSTRAINT CK_LegalLandParty_Share CHECK (SharePct IS NULL OR (SharePct >= 0 AND SharePct <= 100)),
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandParty_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandParty_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLandParty UNIQUE (LandId, PersonId, LandRole),
    CONSTRAINT FK_LegalLandParty_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandParty_PersonId FOREIGN KEY (PersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalLandParty_RelationshipTypeId FOREIGN KEY (RelationshipTypeId) REFERENCES dbo.LegalLookupValue(LookupId)
  );
GO
IF OBJECT_ID('dbo.LegalWorkflowStep', 'U') IS NULL
  CREATE TABLE dbo.LegalWorkflowStep (
    StepCode NVARCHAR(40) NOT NULL CONSTRAINT PK_LegalWorkflowStep PRIMARY KEY,
    StepNo INT NOT NULL CONSTRAINT UQ_LegalWorkflowStep_StepNo UNIQUE,
    StepName NVARCHAR(100) NOT NULL,
    Phase INT NOT NULL,
    IsSkippable BIT NOT NULL CONSTRAINT DF_LegalWorkflowStep_IsSkippable DEFAULT 0,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalWorkflowStep_IsActive DEFAULT 1
  );
GO
IF OBJECT_ID('dbo.LegalWorkflowStepState', 'U') IS NULL
  CREATE TABLE dbo.LegalWorkflowStepState (
    StepStateId INT IDENTITY(1,1) CONSTRAINT PK_LegalWorkflowStepState PRIMARY KEY,
    LandId INT NOT NULL,
    StepCode NVARCHAR(40) NOT NULL,
    Status NVARCHAR(30) NOT NULL,
    ResponsibleUserId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    SkipReason NVARCHAR(500) NULL,
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalWorkflowStepState_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_LegalWorkflowStepState UNIQUE (LandId, StepCode),
    CONSTRAINT FK_LegalWorkflowStepState_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalWorkflowStepState_StepCode FOREIGN KEY (StepCode) REFERENCES dbo.LegalWorkflowStep(StepCode)
  );
GO
IF OBJECT_ID('dbo.LegalWorkflowStepHistory', 'U') IS NULL
  CREATE TABLE dbo.LegalWorkflowStepHistory (
    HistoryId BIGINT IDENTITY(1,1) CONSTRAINT PK_LegalWorkflowStepHistory PRIMARY KEY,
    LandId INT NOT NULL,
    StepCode NVARCHAR(40) NOT NULL,
    PreviousStatus NVARCHAR(30) NULL,
    NewStatus NVARCHAR(30) NOT NULL,
    Remarks NVARCHAR(1000) NULL,
    ChangedBy INT NULL,
    ChangedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalWorkflowStepHistory_ChangedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LegalWorkflowStepHistory_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId)
  );
GO
IF OBJECT_ID('dbo.LegalHold', 'U') IS NULL
  CREATE TABLE dbo.LegalHold (
    HoldId INT IDENTITY(1,1) CONSTRAINT PK_LegalHold PRIMARY KEY,
    LandId INT NOT NULL,
    HoldCategory NVARCHAR(60) NOT NULL,
    HoldReason NVARCHAR(1000) NOT NULL,
    HoldDate DATE NOT NULL,
    HeldBy INT NULL,
    ExpectedReviewDate DATE NULL,
    FileId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    ResumedBy INT NULL,
    ResumedAt DATETIME2 NULL,
    ResumeRemarks NVARCHAR(1000) NULL,
    CONSTRAINT FK_LegalHold_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalHold_FileId FOREIGN KEY (FileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO
IF OBJECT_ID('dbo.LegalRecordAudit', 'U') IS NULL
  CREATE TABLE dbo.LegalRecordAudit (
    EventId BIGINT IDENTITY(1,1) CONSTRAINT PK_LegalRecordAudit PRIMARY KEY,
    UserId INT NULL,
    Action NVARCHAR(60) NOT NULL,
    EntityType NVARCHAR(60) NOT NULL,
    EntityId INT NULL,
    LandId INT NULL,
    OldValue NVARCHAR(MAX) NULL,
    NewValue NVARCHAR(MAX) NULL,
    Remarks NVARCHAR(1000) NULL,
    IpAddress NVARCHAR(64) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRecordAudit_CreatedAt DEFAULT SYSUTCDATETIME()
  );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalRecordAudit_Land')
  CREATE INDEX IX_LegalRecordAudit_Land ON dbo.LegalRecordAudit (LandId, EventId DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalRecordAudit_Entity')
  CREATE INDEX IX_LegalRecordAudit_Entity ON dbo.LegalRecordAudit (EntityType, EntityId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalWorkflowStepHistory_Land')
  CREATE INDEX IX_LegalWorkflowStepHistory_Land ON dbo.LegalWorkflowStepHistory (LandId, StepCode);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandRsRecord_Land')
  CREATE INDEX IX_LegalLandRsRecord_Land ON dbo.LegalLandRsRecord (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandLrRecord_Land')
  CREATE INDEX IX_LegalLandLrRecord_Land ON dbo.LegalLandLrRecord (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandParty_Land')
  CREATE INDEX IX_LegalLandParty_Land ON dbo.LegalLandParty (LandId);
GO

-- ── The 31 pipeline steps (Phase = the build phase that brings the step's screen) ──
INSERT INTO dbo.LegalWorkflowStep (StepCode, StepNo, StepName, Phase, IsSkippable)
SELECT v.c, v.n, v.name, v.p, v.k FROM (VALUES
    (N'ENQUIRY', 1, N'Land Enquiry / New Land Entry', 1, 1)
  , (N'PROPERTY', 2, N'Land Property Master', 1, 0)
  , (N'PARTIES', 3, N'Owner & Seller Details', 1, 0)
  , (N'RECORD_MAPPING', 4, N'Land Details & Record Mapping', 1, 0)
  , (N'OWNERSHIP', 5, N'Ownership History & Verification', 2, 0)
  , (N'DOCUMENTS', 6, N'Document Collection & Upload', 2, 0)
  , (N'CASE_MORTGAGE', 7, N'Legal Case & Mortgage Verification', 3, 0)
  , (N'PURCHASE_SALE', 8, N'Purchase / Sale Details', 4, 0)
  , (N'DUE_DILIGENCE', 9, N'Legal Due Diligence', 3, 0)
  , (N'CLEARANCE', 10, N'Legal Clearance', 3, 0)
  , (N'VALUATION', 11, N'Land Valuation & Survey', 4, 1)
  , (N'AGREEMENT', 12, N'Purchase / Sale Agreement', 4, 0)
  , (N'PARTY_APPROVAL', 13, N'Buyer & Seller Approval', 4, 0)
  , (N'PAYMENT', 14, N'Payment & Advance Receipt', 4, 0)
  , (N'DEED_PREP', 15, N'Deed Preparation', 5, 0)
  , (N'DRAFT_VERIFY', 16, N'Deed Draft Verification', 5, 0)
  , (N'STAMP_DUTY', 17, N'Stamp Duty & Registration Fee', 5, 0)
  , (N'APPOINTMENT', 18, N'Registration Appointment', 5, 0)
  , (N'SRO_REGISTRATION', 19, N'Sub-Registrar Office Registration', 5, 0)
  , (N'REGISTRATION_RESULT', 20, N'Registration Successful?', 5, 0)
  , (N'REGISTERED_DEED', 21, N'Registered Deed Upload', 5, 0)
  , (N'DEED_APPROVAL', 22, N'Deed Approval', 5, 0)
  , (N'OWNERSHIP_TRANSFER', 23, N'Ownership Transfer Entry', 6, 0)
  , (N'MUTATION_APPLY', 24, N'Mutation Application', 6, 0)
  , (N'MUTATION_RESULT', 25, N'Mutation Approved?', 6, 0)
  , (N'NEW_KHATIAN', 26, N'New Khatian / Mutation Record', 6, 0)
  , (N'FINAL_VERIFY', 27, N'Final Document Verification', 6, 0)
  , (N'SETTLEMENT', 28, N'Financial Settlement', 6, 0)
  , (N'REGISTER_UPDATE', 29, N'Land Register Update', 6, 0)
  , (N'AUDIT_REPORTS', 30, N'Audit Trail & Reports', 6, 1)
  , (N'CLOSED', 31, N'Transaction Closed', 6, 0)
) v (c, n, name, p, k)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalWorkflowStep s WHERE s.StepCode = v.c);
GO

-- ── Starting values for the short lists (edit them in Setup) ──
INSERT INTO dbo.LegalLookupValue (Category, Name, SortOrder)
SELECT v.c, v.n, v.s FROM (VALUES
    (N'location-type', N'Rural', 10)
  , (N'location-type', N'Urban', 20)
  , (N'location-type', N'Municipal', 30)
  , (N'location-type', N'Industrial', 40)
  , (N'location-type', N'Other', 50)
  , (N'copy-type', N'Certified Copy', 10)
  , (N'copy-type', N'Online Copy', 20)
  , (N'copy-type', N'Office Copy', 30)
  , (N'copy-type', N'Photocopy', 40)
  , (N'copy-type', N'Other', 50)
  , (N'enquiry-source', N'Broker', 10)
  , (N'enquiry-source', N'Direct Owner', 20)
  , (N'enquiry-source', N'Website', 30)
  , (N'enquiry-source', N'Reference', 40)
  , (N'enquiry-source', N'Advertisement', 50)
  , (N'enquiry-source', N'Walk-in', 60)
  , (N'enquiry-source', N'Other', 70)
  , (N'ownership-type', N'Individual', 10)
  , (N'ownership-type', N'Joint', 20)
  , (N'ownership-type', N'Inherited', 30)
  , (N'ownership-type', N'Company', 40)
  , (N'ownership-type', N'Trust', 50)
  , (N'ownership-type', N'Government', 60)
  , (N'ownership-type', N'Other', 70)
  , (N'relationship-type', N'Self', 10)
  , (N'relationship-type', N'Father', 20)
  , (N'relationship-type', N'Mother', 30)
  , (N'relationship-type', N'Son', 40)
  , (N'relationship-type', N'Daughter', 50)
  , (N'relationship-type', N'Husband', 60)
  , (N'relationship-type', N'Wife', 70)
  , (N'relationship-type', N'Brother', 80)
  , (N'relationship-type', N'Sister', 90)
  , (N'relationship-type', N'Legal Heir', 100)
  , (N'relationship-type', N'Other', 110)
  , (N'transfer-type', N'Sale', 10)
  , (N'transfer-type', N'Inheritance', 20)
  , (N'transfer-type', N'Gift', 30)
  , (N'transfer-type', N'Partition', 40)
  , (N'transfer-type', N'Settlement', 50)
  , (N'transfer-type', N'Court Order', 60)
  , (N'transfer-type', N'Other', 70)
  , (N'ownership-status', N'Current', 10)
  , (N'ownership-status', N'Previous', 20)
  , (N'ownership-status', N'Disputed', 30)
  , (N'ownership-status', N'Pending Verification', 40)
  , (N'identity-doc-type', N'Aadhaar', 10)
  , (N'identity-doc-type', N'PAN', 20)
  , (N'identity-doc-type', N'Voter ID', 30)
  , (N'identity-doc-type', N'Passport', 40)
  , (N'identity-doc-type', N'Other', 50)
  , (N'case-type', N'Civil', 10)
  , (N'case-type', N'Criminal', 20)
  , (N'case-type', N'Land Dispute', 30)
  , (N'case-type', N'Boundary Dispute', 40)
  , (N'case-type', N'Ownership Dispute', 50)
  , (N'case-type', N'Acquisition', 60)
  , (N'case-type', N'Other', 70)
  , (N'mortgage-type', N'Bank Loan', 10)
  , (N'mortgage-type', N'Private Loan', 20)
  , (N'mortgage-type', N'Mortgage', 30)
  , (N'mortgage-type', N'Charge', 40)
  , (N'mortgage-type', N'Other', 50)
  , (N'legal-status', N'Open', 10)
  , (N'legal-status', N'Pending', 20)
  , (N'legal-status', N'Resolved', 30)
  , (N'legal-status', N'Closed', 40)
  , (N'legal-status', N'Appealed', 50)
  , (N'txn-type', N'Advance', 10)
  , (N'txn-type', N'Purchase Payment', 20)
  , (N'txn-type', N'Sale Receipt', 30)
  , (N'txn-type', N'Refund', 40)
  , (N'txn-type', N'Expense', 50)
  , (N'txn-type', N'Other', 60)
  , (N'expense-type', N'Advocate Fee', 10)
  , (N'expense-type', N'Broker Commission', 20)
  , (N'expense-type', N'Survey Fee', 30)
  , (N'expense-type', N'Government Fee', 40)
  , (N'expense-type', N'Other', 50)
  , (N'payment-mode', N'Cash', 10)
  , (N'payment-mode', N'Bank Transfer', 20)
  , (N'payment-mode', N'Cheque', 30)
  , (N'payment-mode', N'UPI', 40)
  , (N'payment-mode', N'Other', 50)
  , (N'fee-type', N'Stamp Duty', 10)
  , (N'fee-type', N'Registration Fee', 20)
  , (N'fee-type', N'Scanning Fee', 30)
  , (N'fee-type', N'Other', 40)
) v (c, n, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalLookupValue x WHERE x.Category = v.c AND x.Name = v.n);
GO

-- ── Pages (rights) ──
DECLARE @pages TABLE (PageKey NVARCHAR(100), Label NVARCHAR(200), GroupName NVARCHAR(150), SortOrder INT, Actions NVARCHAR(200));
INSERT INTO @pages VALUES
    (N'legal-land-enquiry', N'Land Enquiry', N'Legal - Land Management', 100, N'view,create,edit,delete,approve,print,export')
  , (N'legal-land-master', N'Land Property Master', N'Legal - Land Management', 110, N'view,create,edit,delete,approve,print,export')
  , (N'legal-sub-division-master', N'Sub-Division Master', N'Legal Masters - Locations', 232, N'view,create,edit,delete,print,export')
  , (N'legal-block-master', N'Block Master', N'Legal Masters - Locations', 234, N'view,create,edit,delete,print,export')
  , (N'legal-location-type-master', N'Land Location Type Master', N'Legal Masters - Locations', 262, N'view,create,edit,delete,print,export')
  , (N'legal-copy-type-master', N'Document Copy Type Master', N'Legal Masters - Land records', 215, N'view,create,edit,delete,print,export')
  , (N'legal-enquiry-source-master', N'Enquiry Source Master', N'Legal Masters - Land records', 216, N'view,create,edit,delete,print,export')
  , (N'legal-ownership-type-master', N'Ownership Type Master', N'Legal Masters - Ownership', 330, N'view,create,edit,delete,print,export')
  , (N'legal-relationship-type-master', N'Relationship Type Master', N'Legal Masters - Ownership', 331, N'view,create,edit,delete,print,export')
  , (N'legal-transfer-type-master', N'Ownership Transfer Type Master', N'Legal Masters - Ownership', 332, N'view,create,edit,delete,print,export')
  , (N'legal-ownership-status-master', N'Ownership Status Master', N'Legal Masters - Ownership', 333, N'view,create,edit,delete,print,export')
  , (N'legal-identity-doc-type-master', N'Identity Document Type Master', N'Legal Masters - Ownership', 334, N'view,create,edit,delete,print,export')
  , (N'legal-case-type-master', N'Legal Case Type Master', N'Legal Masters - Legal & Financial', 340, N'view,create,edit,delete,print,export')
  , (N'legal-mortgage-type-master', N'Mortgage Type Master', N'Legal Masters - Legal & Financial', 341, N'view,create,edit,delete,print,export')
  , (N'legal-legal-status-master', N'Legal Status Master', N'Legal Masters - Legal & Financial', 342, N'view,create,edit,delete,print,export')
  , (N'legal-txn-type-master', N'Financial Transaction Type Master', N'Legal Masters - Legal & Financial', 343, N'view,create,edit,delete,print,export')
  , (N'legal-expense-type-master', N'Expense Type Master', N'Legal Masters - Legal & Financial', 344, N'view,create,edit,delete,print,export')
  , (N'legal-payment-mode-master', N'Payment Mode Master', N'Legal Masters - Legal & Financial', 345, N'view,create,edit,delete,print,export')
  , (N'legal-fee-type-master', N'Registration Fee Type Master', N'Legal Masters - Registration', 350, N'view,create,edit,delete,print,export');

UPDATE pd SET Label = p.Label, Module = N'Legal', GroupName = p.GroupName, Actions = p.Actions,
              SortOrder = p.SortOrder, IsActive = 1, UpdatedAt = SYSDATETIME()
FROM dbo.PageDefinitions pd JOIN @pages p ON p.PageKey = pd.PageKey;

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, N'Legal', p.GroupName, p.Actions, p.SortOrder, 1, N'migration-591', SYSDATETIME()
FROM @pages p WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey);
GO

-- Existing lands: open the pipeline on their first step.
UPDATE dbo.LegalLand SET WorkflowStatus = N'Land Enquiry / New Land Entry' WHERE WorkflowStatus IS NULL;
GO

PRINT '591-legal-phase1-land-foundation applied successfully.';
GO
