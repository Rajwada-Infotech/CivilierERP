-- Land Records Search, phase 1 (extends the existing search; nothing is rebuilt):
--  1. Sources are classified: Survey record (CS / RS / LR) · Registry office (deeds: ADSR, DSR, RA…) ·
--     Land record office (BL&LRO — not a deed registry) · Other. Each source can be mandatory or optional, and its
--     period is configurable (start year, optional end year, optional district).
--  2. Detailed CS / RS / LR record entries on the enquiry (new CS table; RS / LR tables get the record details).
--  3. Year results get the search method, reference, search date, evidence file and four more outcomes
--     (Unable to Access, Record Not Digitised, Certified Copy Requested, Awaiting Office Response).
--  4. Record mapping: CS ↔ RS ↔ LR links (one-to-many / many-to-one) with match status, basis and evidence.
--  5. A search may be completed with an authorised exception (years that could not be accessed).

-- 1. Sources
IF COL_LENGTH('dbo.LegalRegistrationOfficeType', 'SourceKind') IS NULL
  ALTER TABLE dbo.LegalRegistrationOfficeType ADD
    SourceKind NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalRegOfficeType_SourceKind DEFAULT N'Registry office',
    IsMandatory BIT NOT NULL CONSTRAINT DF_LegalRegOfficeType_Mandatory DEFAULT 1,
    ToYear INT NULL,
    DistrictId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalRegOfficeType_SourceKind')
  ALTER TABLE dbo.LegalRegistrationOfficeType ADD CONSTRAINT CK_LegalRegOfficeType_SourceKind
    CHECK (SourceKind IN (N'Survey record', N'Registry office', N'Land record office', N'Other'));
GO
UPDATE dbo.LegalRegistrationOfficeType SET SourceKind = N'Survey record' WHERE Code IN (N'CS', N'RS', N'LR') OR TypeName IN (N'CS Record', N'RS Record', N'LR Record');
UPDATE dbo.LegalRegistrationOfficeType SET SourceKind = N'Land record office' WHERE Code = N'BLRO' OR TypeName LIKE N'%BL%LRO%' OR TypeName = N'BLRO';
UPDATE dbo.LegalRegistrationOfficeType SET SourceKind = N'Other' WHERE TypeName = N'Other' OR Description = N'Added from an enquiry search';
GO
IF COL_LENGTH('dbo.LegalEnquiryOfficeSearch', 'Mandatory') IS NULL
  ALTER TABLE dbo.LegalEnquiryOfficeSearch ADD
    Mandatory BIT NOT NULL CONSTRAINT DF_LegalEnquiryOfficeSearch_Mandatory DEFAULT 1,
    ToYear INT NULL,
    ExceptionNote NVARCHAR(1000) NULL, ExceptionBy INT NULL, ExceptionAt DATETIME2 NULL;
GO

-- 2. Record entries
IF OBJECT_ID('dbo.LegalEnquiryCsRecord', 'U') IS NULL
  CREATE TABLE dbo.LegalEnquiryCsRecord (
    CsRecordId INT IDENTITY(1,1) CONSTRAINT PK_LegalEnquiryCsRecord PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalEnquiryCsRecord_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    MouzaId INT NULL, JLNo NVARCHAR(30) NULL,
    CsKhatianNo NVARCHAR(30) NOT NULL, CsDagNo NVARCHAR(30) NOT NULL,
    RecordedHolder NVARCHAR(200) NULL, GuardianName NVARCHAR(200) NULL,
    Area DECIMAL(18,4) NULL, AreaUnitId INT NULL, LandClass NVARCHAR(100) NULL, Share NVARCHAR(30) NULL,
    RecordYear INT NULL, RecordOffice NVARCHAR(200) NULL, SourceMethod NVARCHAR(30) NULL, SourceRef NVARCHAR(200) NULL,
    RecordStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalEnquiryCsRecord_Status DEFAULT N'Found',
    DocFileId INT NULL, Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalEnquiryCsRecord_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalEnquiryCsRecord_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL);
GO
IF COL_LENGTH('dbo.LegalEnquiryRsRecord', 'RecordStatus') IS NULL
  ALTER TABLE dbo.LegalEnquiryRsRecord ADD JLNo NVARCHAR(30) NULL, GuardianName NVARCHAR(200) NULL, LandClass NVARCHAR(100) NULL,
    RecordYear INT NULL, RecordOffice NVARCHAR(200) NULL, SourceMethod NVARCHAR(30) NULL, SourceRef NVARCHAR(200) NULL,
    RecordStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalEnquiryRsRecord_Status DEFAULT N'Found', DocFileId INT NULL,
    PrevCsDagNo NVARCHAR(60) NULL, PrevCsKhatianNo NVARCHAR(60) NULL;
GO
IF COL_LENGTH('dbo.LegalEnquiryLrRecord', 'RecordStatus') IS NULL
  ALTER TABLE dbo.LegalEnquiryLrRecord ADD JLNo NVARCHAR(30) NULL, GuardianName NVARCHAR(200) NULL, LandClass NVARCHAR(100) NULL,
    RecordYear INT NULL, RecordOffice NVARCHAR(200) NULL, SourceMethod NVARCHAR(30) NULL, SourceRef NVARCHAR(200) NULL,
    RecordStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalEnquiryLrRecord_Status DEFAULT N'Found', DocFileId INT NULL,
    PrevRsDagNo NVARCHAR(60) NULL, PrevRsKhatianNo NVARCHAR(60) NULL;
GO

-- 3. Year results
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalEnquiryDeedSearch_Status')
  ALTER TABLE dbo.LegalEnquiryDeedSearch DROP CONSTRAINT CK_LegalEnquiryDeedSearch_Status;
GO
ALTER TABLE dbo.LegalEnquiryDeedSearch ADD CONSTRAINT CK_LegalEnquiryDeedSearch_Status CHECK (Status IN (N'Requested', N'Under Review', N'Not Applicable',
  N'Not Found', N'Found', N'Unable to Access', N'Record Not Digitised', N'Certified Copy Requested', N'Awaiting Office Response'));
GO
IF COL_LENGTH('dbo.LegalEnquiryDeedSearch', 'SearchMethod') IS NULL
  ALTER TABLE dbo.LegalEnquiryDeedSearch ADD SearchMethod NVARCHAR(40) NULL, ReferenceNo NVARCHAR(100) NULL, SearchDate DATE NULL, EvidenceFileId INT NULL;
GO

-- 4. Record mapping
IF OBJECT_ID('dbo.LegalLandRecordMap', 'U') IS NULL
  CREATE TABLE dbo.LegalLandRecordMap (
    MapId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandRecordMap PRIMARY KEY,
    EnquiryId INT NOT NULL CONSTRAINT FK_LegalLandRecordMap_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    FromType NCHAR(2) NOT NULL, FromId INT NOT NULL, ToType NCHAR(2) NOT NULL, ToId INT NOT NULL,
    MatchStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandRecordMap_Status DEFAULT N'Requires Legal Review',
    MatchBasis NVARCHAR(500) NULL, Remarks NVARCHAR(1000) NULL, EvidenceFileId INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandRecordMap_Active DEFAULT 1,
    CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandRecordMap_At DEFAULT SYSUTCDATETIME(), UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalLandRecordMap_Types CHECK ((FromType = N'CS' AND ToType = N'RS') OR (FromType = N'RS' AND ToType = N'LR') OR (FromType = N'CS' AND ToType = N'LR')),
    CONSTRAINT CK_LegalLandRecordMap_Status CHECK (MatchStatus IN (N'Not Matched', N'Partially Matched', N'Matched', N'Disputed', N'Requires Legal Review')));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LegalLandRecordMap_Link')
  CREATE UNIQUE INDEX UX_LegalLandRecordMap_Link ON dbo.LegalLandRecordMap (FromType, FromId, ToType, ToId) WHERE IsActive = 1;
GO
