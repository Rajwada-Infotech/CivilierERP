-- 601 · Legal module, Phase 6 (Mutation & Closure) of the Legal & Land Management document v2.0
--   Ownership transfer from the registered deed (a new event; earlier owners end-dated, partial transfers keep the
--   remaining share), mutation applications with hearings and the decision, the new Khatian / RoR (old records stay),
--   the final verification checklist, financial settlement, land register snapshots, and cancellation of a land
--   (records are never deleted).
-- Additive only.
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.LegalOwnershipEvent', 'RegisteredDeedId') IS NULL ALTER TABLE dbo.LegalOwnershipEvent ADD RegisteredDeedId INT NULL;
IF COL_LENGTH('dbo.LegalLand', 'IsCancelled') IS NULL
  ALTER TABLE dbo.LegalLand ADD IsCancelled BIT NOT NULL CONSTRAINT DF_LegalLand_IsCancelled DEFAULT 0,
    CancelReason NVARCHAR(1000) NULL, CancelledBy INT NULL, CancelledAt DATETIME2 NULL;
GO
IF OBJECT_ID('dbo.FK_LegalOwnershipEvent_RegisteredDeedId', 'F') IS NULL
  ALTER TABLE dbo.LegalOwnershipEvent ADD CONSTRAINT FK_LegalOwnershipEvent_RegisteredDeedId FOREIGN KEY (RegisteredDeedId) REFERENCES dbo.LegalRegisteredDeed(RegisteredId);
GO

IF OBJECT_ID('dbo.LegalMutation', 'U') IS NULL
  CREATE TABLE dbo.LegalMutation (
    MutationId INT IDENTITY(1,1) CONSTRAINT PK_LegalMutation PRIMARY KEY,
    LandId INT NOT NULL,
    RegisteredDeedId INT NULL,
    ApplicationNo NVARCHAR(80) NULL,
    ApplicationDate DATE NULL,
    OfficeName NVARCHAR(200) NOT NULL,
    MouzaId INT NULL,
    DagNo NVARCHAR(60) NULL,
    PreviousKhatian NVARCHAR(60) NULL,
    PreviousOwner NVARCHAR(300) NULL,
    NewOwner NVARCHAR(300) NOT NULL,
    ApplicationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalMutation_ApplicationStatus DEFAULT N'Draft',
    DecidedBy INT NULL,
    DecidedAt DATETIME2 NULL,
    HearingDate DATE NULL,
    ObjectionDetails NVARCHAR(1000) NULL,
    OrderNo NVARCHAR(80) NULL,
    OrderDate DATE NULL,
    DocFileId INT NULL,
    OrderFileId INT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMutation_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMutation_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalMutation_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalMutation_RegisteredDeedId FOREIGN KEY (RegisteredDeedId) REFERENCES dbo.LegalRegisteredDeed(RegisteredId),
    CONSTRAINT FK_LegalMutation_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalMutation_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId),
    CONSTRAINT FK_LegalMutation_OrderFileId FOREIGN KEY (OrderFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalMutationHearing', 'U') IS NULL
  CREATE TABLE dbo.LegalMutationHearing (
    HearingId INT IDENTITY(1,1) CONSTRAINT PK_LegalMutationHearing PRIMARY KEY,
    LandId INT NOT NULL,
    MutationId INT NOT NULL,
    HearingDate DATE NOT NULL,
    ObjectionRaised NVARCHAR(3) NOT NULL CONSTRAINT DF_LegalMutationHearing_Objection DEFAULT N'No',
    Outcome NVARCHAR(1000) NULL,
    NextDate DATE NULL,
    DocFileId INT NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMutationHearing_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMutationHearing_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalMutationHearing_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalMutationHearing_MutationId FOREIGN KEY (MutationId) REFERENCES dbo.LegalMutation(MutationId),
    CONSTRAINT FK_LegalMutationHearing_DocFileId FOREIGN KEY (DocFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalMutationRecord', 'U') IS NULL
  CREATE TABLE dbo.LegalMutationRecord (
    RecordId INT IDENTITY(1,1) CONSTRAINT PK_LegalMutationRecord PRIMARY KEY,
    LandId INT NOT NULL,
    MutationId INT NOT NULL,
    NewLrKhatianNo NVARCHAR(30) NOT NULL,
    NewLrDagNo NVARCHAR(30) NOT NULL,
    RecordedHolder NVARCHAR(300) NOT NULL,
    NewSharePct DECIMAL(7,4) NULL,
    LandTypeId INT NULL,
    UpdatedArea DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    RorDate DATE NULL,
    MutationOrderNo NVARCHAR(80) NULL,
    MutationOrderDate DATE NULL,
    RorFileId INT NULL,
    VerificationStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalMutationRecord_VerificationStatus DEFAULT N'Pending',
    VerifiedBy INT NULL,
    VerifiedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMutationRecord_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMutationRecord_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalMutationRecord_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalMutationRecord_MutationId FOREIGN KEY (MutationId) REFERENCES dbo.LegalMutation(MutationId),
    CONSTRAINT FK_LegalMutationRecord_LandTypeId FOREIGN KEY (LandTypeId) REFERENCES dbo.LegalLandType(LandTypeId),
    CONSTRAINT FK_LegalMutationRecord_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalMutationRecord_RorFileId FOREIGN KEY (RorFileId) REFERENCES dbo.LegalMasterFile(FileId)
  );
GO

IF OBJECT_ID('dbo.LegalFinalCheck', 'U') IS NULL
  CREATE TABLE dbo.LegalFinalCheck (
    CheckId INT IDENTITY(1,1) CONSTRAINT PK_LegalFinalCheck PRIMARY KEY,
    LandId INT NOT NULL,
    CheckItem NVARCHAR(80) NOT NULL,
    Result NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalFinalCheck_Result DEFAULT N'Pending',
    CheckedBy INT NULL,
    CheckedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalFinalCheck_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalFinalCheck_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalFinalCheck UNIQUE (LandId, CheckItem),
    CONSTRAINT FK_LegalFinalCheck_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId)
  );
GO

IF OBJECT_ID('dbo.LegalSettlement', 'U') IS NULL
  CREATE TABLE dbo.LegalSettlement (
    SettlementId INT IDENTITY(1,1) CONSTRAINT PK_LegalSettlement PRIMARY KEY,
    LandId INT NOT NULL,
    TransactionId INT NOT NULL,
    AgreementValue DECIMAL(18,2) NOT NULL,
    TotalReceived DECIMAL(18,2) NULL,
    TotalPaid DECIMAL(18,2) NULL,
    RemainingBalance DECIMAL(18,2) NULL,
    BrokerCommission DECIMAL(18,2) NULL,
    AdvocateFees DECIMAL(18,2) NULL,
    RegistrationCharges DECIMAL(18,2) NULL,
    OtherExpenses DECIMAL(18,2) NULL,
    Refunds DECIMAL(18,2) NULL,
    SettlementDate DATE NOT NULL,
    SettlementStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalSettlement_SettlementStatus DEFAULT N'Draft',
    ApprovedBy INT NULL,
    ApprovedAt DATETIME2 NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalSettlement_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalSettlement_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalSettlement_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId),
    CONSTRAINT FK_LegalSettlement_TransactionId FOREIGN KEY (TransactionId) REFERENCES dbo.LegalLandTransaction(TransactionId)
  );
GO

IF OBJECT_ID('dbo.LegalLandRegisterSnapshot', 'U') IS NULL
  CREATE TABLE dbo.LegalLandRegisterSnapshot (
    SnapshotId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandRegisterSnapshot PRIMARY KEY,
    LandId INT NOT NULL,
    SnapshotJson NVARCHAR(MAX) NOT NULL,
    Remarks NVARCHAR(500) NULL,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandRegisterSnapshot_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LegalLandRegisterSnapshot_LandId FOREIGN KEY (LandId) REFERENCES dbo.LegalLand(LandId)
  );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalMutation_Land') CREATE INDEX IX_LegalMutation_Land ON dbo.LegalMutation (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalMutationRecord_Land') CREATE INDEX IX_LegalMutationRecord_Land ON dbo.LegalMutationRecord (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalSettlement_Land') CREATE INDEX IX_LegalSettlement_Land ON dbo.LegalSettlement (LandId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalLandRegisterSnapshot_Land') CREATE INDEX IX_LegalLandRegisterSnapshot_Land ON dbo.LegalLandRegisterSnapshot (LandId, SnapshotId DESC);
GO

-- Land Management reports page.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-land-reports')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'legal-land-reports', N'Land Reports', N'Legal', N'Legal - Land Management', N'view,export', 120, 1, N'migration-601', SYSDATETIME());
GO

PRINT '601-legal-phase6-mutation-closure applied successfully.';
GO
