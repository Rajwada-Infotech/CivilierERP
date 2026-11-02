-- 596 · Legal module, Phase 3 (Legal Verification) of the Legal & Land Management document v2.0
--   Court cases with hearings, mortgages & loans, legal verification checks (encumbrance, title, acquisition…
--   where "Not Found" is kept apart from "Not Checked" and "Search Failed"), the 12-point due diligence
--   checklist, advocate assignments, legal opinions and the legal clearance decision.
-- Additive only.
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.LegalCase', 'U') IS NULL
  CREATE TABLE dbo.LegalCase (
    CaseId INT IDENTITY(1,1) CONSTRAINT PK_LegalCase PRIMARY KEY,
    LandId INT NOT NULL,
    CaseNumber NVARCHAR(80) NOT NULL,
    CaseTypeId INT NOT NULL,
    CourtName NVARCHAR(200) NOT NULL,
    FilingDate DATE NULL,
    Plaintiff NVARCHAR(500) NULL,
    Defendant NVARCHAR(500) NULL,
    CaseSubject NVARCHAR(1000) NOT NULL,
    AdvocateId INT NULL,
    LegalStatusId INT NOT NULL,
    NextHearingDate DATE NULL,
    CaseResult NVARCHAR(1000) NULL,
    DocFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalCase_VerificationStatus DEFAULT N'Pending'
      CONSTRAINT CK_LegalCase_VerificationStatus CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalCase_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalCase_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalCase UNIQUE (LandId, CaseNumber),
    CONSTRAINT FK_LegalCase_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalCase_CaseTypeId FOREIGN KEY (CaseTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalCase_LegalStatusId FOREIGN KEY (LegalStatusId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalCase_AdvocateId FOREIGN KEY (AdvocateId) REFERENCES dbo.LegalAdvocate(AdvocateId),
    CONSTRAINT FK_LegalCase_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalCaseHearing', 'U') IS NULL
  CREATE TABLE dbo.LegalCaseHearing (
    HearingId INT IDENTITY(1,1) CONSTRAINT PK_LegalCaseHearing PRIMARY KEY,
    LandId INT NOT NULL,
    CaseId INT NOT NULL,
    HearingDate DATE NOT NULL,
    Purpose NVARCHAR(300) NULL,
    Outcome NVARCHAR(1000) NULL,
    NextDate DATE NULL,
    DocFileId INT NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalCaseHearing_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalCaseHearing_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalCaseHearing_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalCaseHearing_CaseId FOREIGN KEY (CaseId) REFERENCES dbo.LegalCase(CaseId),
    CONSTRAINT FK_LegalCaseHearing_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalMortgage', 'U') IS NULL
  CREATE TABLE dbo.LegalMortgage (
    MortgageId INT IDENTITY(1,1) CONSTRAINT PK_LegalMortgage PRIMARY KEY,
    LandId INT NOT NULL,
    LenderName NVARCHAR(200) NOT NULL,
    BorrowerName NVARCHAR(200) NULL,
    MortgageTypeId INT NOT NULL,
    LoanAccountRef NVARCHAR(80) NULL,
    LoanAmount DECIMAL(18,2) NULL,
    OutstandingAmount DECIMAL(18,2) NULL,
    LoanStartDate DATE NULL,
    LoanEndDate DATE NULL,
    RegistrationDetails NVARCHAR(500) NULL,
    ChargeDetails NVARCHAR(500) NULL,
    ReleaseDocFileId INT NULL,
    ClearanceDate DATE NULL,
    MortgageStatus NVARCHAR(40) NOT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalMortgage_VerificationStatus DEFAULT N'Pending'
      CONSTRAINT CK_LegalMortgage_VerificationStatus CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMortgage_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMortgage_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalMortgage_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalMortgage_MortgageTypeId FOREIGN KEY (MortgageTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalMortgage_ReleaseDocFileId FOREIGN KEY (ReleaseDocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalVerificationCheck', 'U') IS NULL
  CREATE TABLE dbo.LegalVerificationCheck (
    CheckId INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationCheck PRIMARY KEY,
    LandId INT NOT NULL,
    CheckType NVARCHAR(60) NOT NULL,
    SearchDate DATE NULL,
    PeriodFrom DATE NULL,
    PeriodTo DATE NULL,
    SearchSource NVARCHAR(300) NULL,
    Result NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalVerificationCheck_Result DEFAULT N'Not Checked'
      CONSTRAINT CK_LegalVerificationCheck_Result CHECK (Result IN (N'Not Checked', N'Not Found', N'Found - Clear', N'Found - Issue', N'Search Failed')),
    DocFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalVerificationCheck_VerificationStatus DEFAULT N'Pending'
      CONSTRAINT CK_LegalVerificationCheck_VerificationStatus CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalVerificationCheck_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationCheck_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalVerificationCheck_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalVerificationCheck_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalDueDiligence', 'U') IS NULL
  CREATE TABLE dbo.LegalDueDiligence (
    DiligenceId INT IDENTITY(1,1) CONSTRAINT PK_LegalDueDiligence PRIMARY KEY,
    LandId INT NOT NULL,
    CheckItem NVARCHAR(60) NOT NULL,
    Result NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalDueDiligence_Result DEFAULT N'Pending'
      CONSTRAINT CK_LegalDueDiligence_Result CHECK (Result IN (N'Pending', N'Clear', N'Issue Found')),
    ReviewedBy INT NULL,
    ReviewedAt DATETIME2 NULL,
    Findings NVARCHAR(1000) NULL,
    DocFileId INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDueDiligence_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDueDiligence_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDueDiligence UNIQUE (LandId, CheckItem),
    CONSTRAINT FK_LegalDueDiligence_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalDueDiligence_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalAdvocateAssignment', 'U') IS NULL
  CREATE TABLE dbo.LegalAdvocateAssignment (
    AssignmentId INT IDENTITY(1,1) CONSTRAINT PK_LegalAdvocateAssignment PRIMARY KEY,
    LandId INT NOT NULL,
    AdvocateId INT NOT NULL,
    Purpose NVARCHAR(40) NOT NULL,
    AssignedDate DATE NOT NULL,
    DueDate DATE NULL,
    AssignmentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalAdvocateAssignment_Status DEFAULT N'Assigned',
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalAdvocateAssignment_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalAdvocateAssignment_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalAdvocateAssignment_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalAdvocateAssignment_AdvocateId FOREIGN KEY (AdvocateId) REFERENCES dbo.LegalAdvocate(AdvocateId)
  );
GO

IF OBJECT_ID('dbo.LegalOpinion', 'U') IS NULL
  CREATE TABLE dbo.LegalOpinion (
    OpinionId INT IDENTITY(1,1) CONSTRAINT PK_LegalOpinion PRIMARY KEY,
    OpinionNo NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalOpinion_No UNIQUE,
    LandId INT NOT NULL,
    AdvocateId INT NOT NULL,
    OpinionDate DATE NOT NULL,
    ReviewedFrom DATE NULL,
    ReviewedTo DATE NULL,
    Findings NVARCHAR(2000) NOT NULL,
    IdentifiedRisks NVARCHAR(2000) NULL,
    MissingDocuments NVARCHAR(1000) NULL,
    Recommendations NVARCHAR(2000) NULL,
    Conditions NVARCHAR(2000) NULL,
    FinalOpinion NVARCHAR(40) NOT NULL,
    DocFileId INT NULL,
    SignatureRef NVARCHAR(100) NULL,
    OpinionStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalOpinion_OpinionStatus DEFAULT N'Draft'
      CONSTRAINT CK_LegalOpinion_OpinionStatus CHECK (OpinionStatus IN (N'Draft', N'Under Review', N'Approved', N'Rejected', N'Revised')),
    ApprovedBy INT NULL,
    ApprovedAt DATETIME2 NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOpinion_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOpinion_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalOpinion_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalOpinion_AdvocateId FOREIGN KEY (AdvocateId) REFERENCES dbo.LegalAdvocate(AdvocateId),
    CONSTRAINT FK_LegalOpinion_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalClearance', 'U') IS NULL
  CREATE TABLE dbo.LegalClearance (
    ClearanceId INT IDENTITY(1,1) CONSTRAINT PK_LegalClearance PRIMARY KEY,
    ClearanceNo NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalClearance_No UNIQUE,
    LandId INT NOT NULL,
    OpinionId INT NOT NULL,
    Decision NVARCHAR(40) NOT NULL
      CONSTRAINT CK_LegalClearance_Decision CHECK (Decision IN (N'Pending Decision', N'Cleared', N'Cleared with Conditions', N'Not Cleared', N'On Hold', N'Further Verification Required')),
    DecidedBy INT NULL,
    DecidedAt DATETIME2 NULL,
    Conditions NVARCHAR(2000) NULL,
    ConditionsMet BIT NOT NULL CONSTRAINT DF_LegalClearance_ConditionsMet DEFAULT 0,
    BlockingIssues NVARCHAR(2000) NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalClearance_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalClearance_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalClearance_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalClearance_OpinionId FOREIGN KEY (OpinionId) REFERENCES dbo.LegalOpinion(OpinionId)
  );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalCase_Land') CREATE INDEX IX_LegalCase_Land ON dbo.LegalCase (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalMortgage_Land') CREATE INDEX IX_LegalMortgage_Land ON dbo.LegalMortgage (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalVerificationCheck_Land') CREATE INDEX IX_LegalVerificationCheck_Land ON dbo.LegalVerificationCheck (LandId, CheckType);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalOpinion_Land') CREATE INDEX IX_LegalOpinion_Land ON dbo.LegalOpinion (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalClearance_Land') CREATE INDEX IX_LegalClearance_Land ON dbo.LegalClearance (LandId);
GO

PRINT '596-legal-phase3-legal-verification applied successfully.';
GO
