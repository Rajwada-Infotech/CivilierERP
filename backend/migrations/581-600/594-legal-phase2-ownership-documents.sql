-- 594 · Legal module, Phase 2 (Ownership & Documents) of the Legal & Land Management document v2.0
--   Ownership: transfer history (sale, inheritance, gift…), ownership periods with shares, inheritance with heirs,
--              partitions, and the per-record verification checklist.
--   Documents: per-land documents with append-only versions; every review is tied to one version; required
--              documents come from the land's checklist template, and an approver can mark one Not Applicable.
-- Additive only. RS / LR records gain VerifiedBy / VerifiedAt like the new tables.
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.LegalLand', 'ChecklistTemplateId') IS NULL ALTER TABLE dbo.LegalLand ADD ChecklistTemplateId INT NULL;
IF COL_LENGTH('dbo.LegalLandRsRecord', 'VerifiedBy') IS NULL ALTER TABLE dbo.LegalLandRsRecord ADD VerifiedBy INT NULL, VerifiedAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalLandLrRecord', 'VerifiedBy') IS NULL ALTER TABLE dbo.LegalLandLrRecord ADD VerifiedBy INT NULL, VerifiedAt DATETIME2 NULL;
GO
IF OBJECT_ID('dbo.FK_LegalLand_ChecklistTemplateId', 'F') IS NULL
  ALTER TABLE dbo.LegalLand ADD CONSTRAINT FK_LegalLand_ChecklistTemplateId FOREIGN KEY (ChecklistTemplateId) REFERENCES dbo.LegalChecklistTemplate(TemplateId);
GO

IF OBJECT_ID('dbo.LegalOwnershipEvent', 'U') IS NULL
  CREATE TABLE dbo.LegalOwnershipEvent (
    EventId INT IDENTITY(1,1) CONSTRAINT PK_LegalOwnershipEvent PRIMARY KEY,
    LandId INT NOT NULL,
    TransferTypeId INT NOT NULL,
    EventDate DATE NOT NULL,
    PreviousOwnerId INT NULL,
    NewOwnerId INT NOT NULL,
    DeedNo NVARCHAR(60) NULL,
    RegistrationOfficeId INT NULL,
    RegistrationDate DATE NULL,
    TransferArea DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    TransferSharePct DECIMAL(7,4) NULL,
    TransferValue DECIMAL(18,2) NULL,
    DocFileId INT NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipEvent_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalOwnershipEvent_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOwnershipEvent_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOwnershipEvent_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalOwnershipEvent_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalOwnershipEvent_TransferTypeId FOREIGN KEY (TransferTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalOwnershipEvent_PreviousOwnerId FOREIGN KEY (PreviousOwnerId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalOwnershipEvent_NewOwnerId FOREIGN KEY (NewOwnerId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalOwnershipEvent_RegistrationOfficeId FOREIGN KEY (RegistrationOfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
    CONSTRAINT FK_LegalOwnershipEvent_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalOwnershipEvent_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalOwnershipRecord', 'U') IS NULL
  CREATE TABLE dbo.LegalOwnershipRecord (
    RecordId INT IDENTITY(1,1) CONSTRAINT PK_LegalOwnershipRecord PRIMARY KEY,
    LandId INT NOT NULL,
    PersonId INT NOT NULL,
    OwnershipTypeId INT NOT NULL,
    RelationshipTypeId INT NULL,
    SharePct DECIMAL(7,4) NOT NULL CONSTRAINT CK_LegalOwnershipRecord_Share CHECK (SharePct >= 0 AND SharePct <= 100),
    ValidFrom DATE NOT NULL,
    ValidTo DATE NULL,
    EventId INT NULL,
    PreviousPersonId INT NULL,
    TransferDocFileId INT NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipRecord_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalOwnershipRecord_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    VerificationRemarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOwnershipRecord_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOwnershipRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT CK_LegalOwnershipRecord_Dates CHECK (ValidTo IS NULL OR ValidTo >= ValidFrom),
    CONSTRAINT FK_LegalOwnershipRecord_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalOwnershipRecord_PersonId FOREIGN KEY (PersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalOwnershipRecord_OwnershipTypeId FOREIGN KEY (OwnershipTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalOwnershipRecord_RelationshipTypeId FOREIGN KEY (RelationshipTypeId) REFERENCES dbo.LegalLookupValue(LookupId),
    CONSTRAINT FK_LegalOwnershipRecord_EventId FOREIGN KEY (EventId) REFERENCES dbo.LegalOwnershipEvent(EventId),
    CONSTRAINT FK_LegalOwnershipRecord_PreviousPersonId FOREIGN KEY (PreviousPersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalOwnershipRecord_TransferDocFileId FOREIGN KEY (TransferDocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalOwnershipCheck', 'U') IS NULL
  CREATE TABLE dbo.LegalOwnershipCheck (
    CheckId INT IDENTITY(1,1) CONSTRAINT PK_LegalOwnershipCheck PRIMARY KEY,
    LandId INT NOT NULL,
    RecordId INT NOT NULL,
    CheckItem NVARCHAR(60) NOT NULL,
    Result NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalOwnershipCheck_Result DEFAULT N'Pending'
      CONSTRAINT CK_LegalOwnershipCheck_Result CHECK (Result IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction', N'Reattachment Required', N'Not Applicable')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalOwnershipCheck_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalOwnershipCheck_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalOwnershipCheck UNIQUE (RecordId, CheckItem),
    CONSTRAINT FK_LegalOwnershipCheck_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalOwnershipCheck_RecordId FOREIGN KEY (RecordId) REFERENCES dbo.LegalOwnershipRecord(RecordId)
  );
GO

IF OBJECT_ID('dbo.LegalInheritance', 'U') IS NULL
  CREATE TABLE dbo.LegalInheritance (
    InheritanceId INT IDENTITY(1,1) CONSTRAINT PK_LegalInheritance PRIMARY KEY,
    LandId INT NOT NULL,
    DeceasedPersonId INT NOT NULL,
    DateOfDeath DATE NULL,
    DeathCertFileId INT NULL,
    HeirCertFileId INT NULL,
    SupportingType NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalInheritance_Supporting DEFAULT N'None',
    SupportingFileId INT NULL,
    MutationRecordNo NVARCHAR(60) NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalInheritance_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalInheritance_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalInheritance_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalInheritance_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalInheritance_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalInheritance_DeceasedPersonId FOREIGN KEY (DeceasedPersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalInheritance_DeathCertFileId FOREIGN KEY (DeathCertFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalInheritance_HeirCertFileId FOREIGN KEY (HeirCertFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalInheritance_SupportingFileId FOREIGN KEY (SupportingFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalInheritanceHeir', 'U') IS NULL
  CREATE TABLE dbo.LegalInheritanceHeir (
    HeirId INT IDENTITY(1,1) CONSTRAINT PK_LegalInheritanceHeir PRIMARY KEY,
    LandId INT NOT NULL,
    InheritanceId INT NOT NULL,
    PersonId INT NOT NULL,
    RelationshipTypeId INT NULL,
    SharePct DECIMAL(7,4) NOT NULL CONSTRAINT CK_LegalInheritanceHeir_Share CHECK (SharePct >= 0 AND SharePct <= 100),
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalInheritanceHeir_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalInheritanceHeir_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalInheritanceHeir UNIQUE (InheritanceId, PersonId),
    CONSTRAINT FK_LegalInheritanceHeir_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalInheritanceHeir_InheritanceId FOREIGN KEY (InheritanceId) REFERENCES dbo.LegalInheritance(InheritanceId),
    CONSTRAINT FK_LegalInheritanceHeir_PersonId FOREIGN KEY (PersonId) REFERENCES dbo.LegalPerson(PersonId),
    CONSTRAINT FK_LegalInheritanceHeir_RelationshipTypeId FOREIGN KEY (RelationshipTypeId) REFERENCES dbo.LegalLookupValue(LookupId)
  );
GO

IF OBJECT_ID('dbo.LegalPartition', 'U') IS NULL
  CREATE TABLE dbo.LegalPartition (
    PartitionId INT IDENTITY(1,1) CONSTRAINT PK_LegalPartition PRIMARY KEY,
    LandId INT NOT NULL,
    PartitionType NVARCHAR(40) NOT NULL,
    PartitionDate DATE NOT NULL,
    PartiesInvolved NVARCHAR(1000) NOT NULL,
    ShareDetails NVARCHAR(1000) NULL,
    NewReferences NVARCHAR(300) NULL,
    DeedFileId INT NULL,
    VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalPartition_Verification DEFAULT N'Pending'
      CONSTRAINT CK_LegalPartition_Verification CHECK (VerificationStatus IN (N'Pending', N'Verified', N'Rejected', N'Needs Correction')),
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPartition_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPartition_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalPartition_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalPartition_DeedFileId FOREIGN KEY (DeedFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalLandDocument', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDocument (
    DocumentId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandDocument PRIMARY KEY,
    DocumentCode NVARCHAR(30) NOT NULL CONSTRAINT UQ_LegalLandDocument_Code UNIQUE,
    LandId INT NOT NULL,
    DocTypeId INT NOT NULL,
    RelatedSection NVARCHAR(30) NOT NULL,
    Title NVARCHAR(200) NOT NULL,
    DocumentNo NVARCHAR(100) NULL,
    DocumentDate DATE NULL,
    IssuingAuthority NVARCHAR(200) NULL,
    CurrentVersionNo INT NOT NULL CONSTRAINT DF_LegalLandDocument_Version DEFAULT 1,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLandDocument_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDocument_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalLandDocument_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandDocument_DocTypeId FOREIGN KEY (DocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId)
  );
GO

IF OBJECT_ID('dbo.LegalLandDocumentVersion', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDocumentVersion (
    VersionId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandDocumentVersion PRIMARY KEY,
    DocumentId INT NOT NULL,
    VersionNo INT NOT NULL,
    FileId INT NOT NULL,
    UploadRemarks NVARCHAR(500) NULL,
    UploadedBy INT NULL,
    UploadedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDocumentVersion_UploadedAt DEFAULT SYSUTCDATETIME(),
    ReviewStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalLandDocumentVersion_Review DEFAULT N'Pending'
      CONSTRAINT CK_LegalLandDocumentVersion_Review CHECK (ReviewStatus IN (N'Pending', N'Verified', N'Rejected', N'Reattachment Required')),
    ReviewedBy INT NULL,
    ReviewedAt DATETIME2 NULL,
    ReviewRemarks NVARCHAR(1000) NULL,
    CONSTRAINT UQ_LegalLandDocumentVersion UNIQUE (DocumentId, VersionNo),
    CONSTRAINT FK_LegalLandDocumentVersion_DocumentId FOREIGN KEY (DocumentId) REFERENCES dbo.LegalLandDocument(DocumentId),
    CONSTRAINT FK_LegalLandDocumentVersion_FileId FOREIGN KEY (FileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalLandDocumentNA', 'U') IS NULL
  CREATE TABLE dbo.LegalLandDocumentNA (
    NaId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandDocumentNA PRIMARY KEY,
    LandId INT NOT NULL,
    DocTypeId INT NOT NULL,
    Reason NVARCHAR(500) NOT NULL,
    MarkedBy INT NULL,
    MarkedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandDocumentNA_MarkedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_LegalLandDocumentNA UNIQUE (LandId, DocTypeId),
    CONSTRAINT FK_LegalLandDocumentNA_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalLandDocumentNA_DocTypeId FOREIGN KEY (DocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId)
  );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalOwnershipRecord_Land') CREATE INDEX IX_LegalOwnershipRecord_Land ON dbo.LegalOwnershipRecord (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalOwnershipEvent_Land') CREATE INDEX IX_LegalOwnershipEvent_Land ON dbo.LegalOwnershipEvent (LandId, EventDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalOwnershipCheck_Land') CREATE INDEX IX_LegalOwnershipCheck_Land ON dbo.LegalOwnershipCheck (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalInheritanceHeir_Land') CREATE INDEX IX_LegalInheritanceHeir_Land ON dbo.LegalInheritanceHeir (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandDocument_Land') CREATE INDEX IX_LegalLandDocument_Land ON dbo.LegalLandDocument (LandId);
GO

PRINT '594-legal-phase2-ownership-documents applied successfully.';
GO
