-- 587-legal-module-masters.sql
-- Legal module (Land Deed Registration), part 1: the Setup masters and the menu rights for them.
--   Land records:  Area Unit, Mouza, RS Khatian, RS Plot, LR Record of Rights (Parcha)
--   Registration:  Deed Registration Office, Official Portal Link, Deed Type, Registration Task Type
--   Documents:     Legal Document Type, Document Checklist Template, Checklist Item
--   Workflow:      Approval Workflow (L1 / L2), Status & Reason, Reminder & SLA
--   Parties:       Party
-- The table definitions mirror backend/routes/legal/masterConfig.js, which the API validates against.
-- Starting data: area units, deed types, the 13 standard document types, task statuses and reasons, and a
-- "Land Purchase - Sale Deed" checklist. No registration offices or portal URLs are seeded: those must be
-- entered and verified by the legal team. Idempotent: every table and seed is guarded.

-- Area Unit: Land area units and their conversion to square feet, for consistent area reporting.
IF OBJECT_ID('dbo.LegalAreaUnit', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalAreaUnit (
    AreaUnitId INT IDENTITY(1,1) CONSTRAINT PK_LegalAreaUnit PRIMARY KEY,
    UnitCode NVARCHAR(20) NOT NULL,
    UnitName NVARCHAR(60) NOT NULL,
    SqFtFactor DECIMAL(18,6) NOT NULL,
    DecimalPlaces INT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalAreaUnit_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalAreaUnit_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalAreaUnit UNIQUE (UnitCode),
    CONSTRAINT FK_LegalAreaUnit_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalAreaUnit_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Mouza: The officially recognised revenue village a land parcel sits in.
IF OBJECT_ID('dbo.LegalMouza', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalMouza (
    MouzaId INT IDENTITY(1,1) CONSTRAINT PK_LegalMouza PRIMARY KEY,
    MouzaName NVARCHAR(150) NOT NULL,
    JLNo NVARCHAR(30) NOT NULL,
    District NVARCHAR(100) NOT NULL,
    SubDivision NVARCHAR(100) NULL,
    Block NVARCHAR(100) NULL,
    PoliceStation NVARCHAR(100) NULL,
    Pincode NVARCHAR(10) NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalMouza_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalMouza_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalMouza UNIQUE (MouzaName, JLNo, District),
    CONSTRAINT FK_LegalMouza_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalMouza_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- RS Khatian: Revisional Survey Record of Rights (Khatian): the account number of a landholder's records.
IF OBJECT_ID('dbo.LegalRsKhatian', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalRsKhatian (
    RsKhatianId INT IDENTITY(1,1) CONSTRAINT PK_LegalRsKhatian PRIMARY KEY,
    MouzaId INT NOT NULL,
    KhatianNo NVARCHAR(30) NOT NULL,
    HolderName NVARCHAR(200) NOT NULL,
    GuardianName NVARCHAR(200) NULL,
    HolderAddress NVARCHAR(500) NULL,
    Share NVARCHAR(30) NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRsKhatian_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRsKhatian_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalRsKhatian UNIQUE (MouzaId, KhatianNo),
    CONSTRAINT FK_LegalRsKhatian_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalRsKhatian_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalRsKhatian_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- RS Plot: Revisional Survey plot (Dag) numbers, with their Khatian, land class, area and project.
IF OBJECT_ID('dbo.LegalRsPlot', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalRsPlot (
    RsPlotId INT IDENTITY(1,1) CONSTRAINT PK_LegalRsPlot PRIMARY KEY,
    MouzaId INT NOT NULL,
    PlotNo NVARCHAR(30) NOT NULL,
    RsKhatianId INT NULL,
    LandClass NVARCHAR(60) NULL,
    Area DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    ProjectId INT NULL,
    ParcelStatus NVARCHAR(60) NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRsPlot_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRsPlot_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalRsPlot UNIQUE (MouzaId, PlotNo),
    CONSTRAINT FK_LegalRsPlot_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalRsPlot_RsKhatianId FOREIGN KEY (RsKhatianId) REFERENCES dbo.LegalRsKhatian(RsKhatianId),
    CONSTRAINT FK_LegalRsPlot_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalRsPlot_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalRsPlot_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- LR Record of Rights: Land Reforms Record of Rights (Parcha): the official record of the holder and the parcel.
IF OBJECT_ID('dbo.LegalLrRor', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalLrRor (
    LrRorId INT IDENTITY(1,1) CONSTRAINT PK_LegalLrRor PRIMARY KEY,
    MouzaId INT NOT NULL,
    LrKhatianNo NVARCHAR(30) NOT NULL,
    LrPlotNo NVARCHAR(30) NOT NULL,
    RsPlotId INT NULL,
    HolderName NVARCHAR(200) NOT NULL,
    GuardianName NVARCHAR(200) NULL,
    LandClass NVARCHAR(60) NULL,
    Area DECIMAL(18,6) NULL,
    AreaUnitId INT NULL,
    Share NVARCHAR(30) NULL,
    RorDate DATE NULL,
    CopyType NVARCHAR(60) NULL,
    Source NVARCHAR(200) NULL,
    Remarks NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalLrRor_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLrRor_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalLrRor UNIQUE (MouzaId, LrKhatianNo, LrPlotNo),
    CONSTRAINT FK_LegalLrRor_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
    CONSTRAINT FK_LegalLrRor_RsPlotId FOREIGN KEY (RsPlotId) REFERENCES dbo.LegalRsPlot(RsPlotId),
    CONSTRAINT FK_LegalLrRor_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
    CONSTRAINT FK_LegalLrRor_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalLrRor_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Deed Registration Office: Government offices where deeds and other registrable documents are registered.
IF OBJECT_ID('dbo.LegalRegistrationOffice', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalRegistrationOffice (
    OfficeId INT IDENTITY(1,1) CONSTRAINT PK_LegalRegistrationOffice PRIMARY KEY,
    OfficeCode NVARCHAR(30) NOT NULL,
    OfficeName NVARCHAR(200) NOT NULL,
    OfficeType NVARCHAR(60) NOT NULL,
    State NVARCHAR(100) NOT NULL,
    District NVARCHAR(100) NOT NULL,
    Jurisdiction NVARCHAR(500) NULL,
    Address NVARCHAR(500) NULL,
    Phone NVARCHAR(30) NULL,
    Email NVARCHAR(150) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalRegistrationOffice_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRegistrationOffice_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalRegistrationOffice UNIQUE (OfficeCode),
    CONSTRAINT FK_LegalRegistrationOffice_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalRegistrationOffice_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Official Portal Link: Maintained official URLs per office and service. Links not tested for 90 days are flagged.
IF OBJECT_ID('dbo.LegalPortalLink', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalPortalLink (
    LinkId INT IDENTITY(1,1) CONSTRAINT PK_LegalPortalLink PRIMARY KEY,
    OfficeId INT NULL,
    ServiceType NVARCHAR(60) NOT NULL,
    LinkLabel NVARCHAR(150) NOT NULL,
    Url NVARCHAR(500) NOT NULL,
    LastTestedDate DATE NULL,
    VerifiedBy INT NULL,
    FallbackInstructions NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalPortalLink_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalPortalLink_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalPortalLink_OfficeId FOREIGN KEY (OfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
    CONSTRAINT FK_LegalPortalLink_VerifiedBy FOREIGN KEY (VerifiedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalPortalLink_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalPortalLink_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Deed Type: Controlled deed categories, so every deed is classified the same way.
IF OBJECT_ID('dbo.LegalDeedType', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalDeedType (
    DeedTypeId INT IDENTITY(1,1) CONSTRAINT PK_LegalDeedType PRIMARY KEY,
    DeedTypeCode NVARCHAR(20) NOT NULL,
    DeedTypeName NVARCHAR(150) NOT NULL,
    TransactionType NVARCHAR(60) NOT NULL,
    Description NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDeedType_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDeedType_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDeedType UNIQUE (DeedTypeCode),
    CONSTRAINT FK_LegalDeedType_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalDeedType_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Legal Document Type: The catalogue of evidence a deed file can hold, with sensitivity and retention.
IF OBJECT_ID('dbo.LegalDocumentType', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalDocumentType (
    DocTypeId INT IDENTITY(1,1) CONSTRAINT PK_LegalDocumentType PRIMARY KEY,
    DocTypeCode NVARCHAR(20) NOT NULL,
    DocTypeName NVARCHAR(150) NOT NULL,
    Category NVARCHAR(60) NOT NULL,
    Sensitivity NVARCHAR(60) NOT NULL,
    RetentionClass NVARCHAR(60) NOT NULL,
    ExpiryDays INT NULL,
    Description NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalDocumentType_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalDocumentType_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalDocumentType UNIQUE (DocTypeCode),
    CONSTRAINT FK_LegalDocumentType_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalDocumentType_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Document Checklist Template: Versioned sets of required documents for a deed type. Items are added in Checklist Items.
IF OBJECT_ID('dbo.LegalChecklistTemplate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalChecklistTemplate (
    TemplateId INT IDENTITY(1,1) CONSTRAINT PK_LegalChecklistTemplate PRIMARY KEY,
    TemplateName NVARCHAR(150) NOT NULL,
    VersionNo INT NOT NULL,
    DeedTypeId INT NULL,
    Jurisdiction NVARCHAR(150) NULL,
    EffectiveFrom DATE NOT NULL,
    EffectiveTo DATE NULL,
    ApprovedBy INT NULL,
    Remarks NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalChecklistTemplate_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalChecklistTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalChecklistTemplate UNIQUE (TemplateName, VersionNo),
    CONSTRAINT FK_LegalChecklistTemplate_DeedTypeId FOREIGN KEY (DeedTypeId) REFERENCES dbo.LegalDeedType(DeedTypeId),
    CONSTRAINT FK_LegalChecklistTemplate_ApprovedBy FOREIGN KEY (ApprovedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalChecklistTemplate_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalChecklistTemplate_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Checklist Item: Each document a template asks for: required or not, the stage it is needed at, N/A and waiver rules.
IF OBJECT_ID('dbo.LegalChecklistItem', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalChecklistItem (
    ItemId INT IDENTITY(1,1) CONSTRAINT PK_LegalChecklistItem PRIMARY KEY,
    TemplateId INT NOT NULL,
    DocTypeId INT NOT NULL,
    Requirement NVARCHAR(60) NOT NULL,
    StageNeeded NVARCHAR(60) NOT NULL,
    SortOrder INT NOT NULL,
    ReminderDays INT NULL,
    AllowNA BIT NOT NULL CONSTRAINT DF_LegalChecklistItem_AllowNA DEFAULT 1,
    Waivable BIT NOT NULL CONSTRAINT DF_LegalChecklistItem_Waivable DEFAULT 0,
    Instructions NVARCHAR(1000) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalChecklistItem_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalChecklistItem_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalChecklistItem UNIQUE (TemplateId, DocTypeId),
    CONSTRAINT FK_LegalChecklistItem_TemplateId FOREIGN KEY (TemplateId) REFERENCES dbo.LegalChecklistTemplate(TemplateId),
    CONSTRAINT FK_LegalChecklistItem_DocTypeId FOREIGN KEY (DocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId),
    CONSTRAINT FK_LegalChecklistItem_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalChecklistItem_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Approval Workflow: The two-level approval route: who reviews at L1 and L2, their SLAs and escalation.
IF OBJECT_ID('dbo.LegalApprovalWorkflow', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalApprovalWorkflow (
    WorkflowId INT IDENTITY(1,1) CONSTRAINT PK_LegalApprovalWorkflow PRIMARY KEY,
    WorkflowName NVARCHAR(150) NOT NULL,
    L1RoleId INT NOT NULL,
    L1SlaDays INT NOT NULL,
    L2RoleId INT NOT NULL,
    L2SlaDays INT NOT NULL,
    EscalationRoleId INT NULL,
    EffectiveFrom DATE NOT NULL,
    EffectiveTo DATE NULL,
    SeparationOfDuties BIT NOT NULL CONSTRAINT DF_LegalApprovalWorkflow_SeparationOfDuties DEFAULT 1,
    AllowDelegation BIT NOT NULL CONSTRAINT DF_LegalApprovalWorkflow_AllowDelegation DEFAULT 0,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalApprovalWorkflow_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalApprovalWorkflow_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalApprovalWorkflow UNIQUE (WorkflowName),
    CONSTRAINT FK_LegalApprovalWorkflow_L1RoleId FOREIGN KEY (L1RoleId) REFERENCES dbo.Role(RId),
    CONSTRAINT FK_LegalApprovalWorkflow_L2RoleId FOREIGN KEY (L2RoleId) REFERENCES dbo.Role(RId),
    CONSTRAINT FK_LegalApprovalWorkflow_EscalationRoleId FOREIGN KEY (EscalationRoleId) REFERENCES dbo.Role(RId),
    CONSTRAINT FK_LegalApprovalWorkflow_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalApprovalWorkflow_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Registration Task Type: A registration process: its deed type, document checklist and approval route.
IF OBJECT_ID('dbo.LegalTaskType', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalTaskType (
    TaskTypeId INT IDENTITY(1,1) CONSTRAINT PK_LegalTaskType PRIMARY KEY,
    TaskTypeCode NVARCHAR(20) NOT NULL,
    TaskTypeName NVARCHAR(150) NOT NULL,
    DeedTypeId INT NOT NULL,
    ChecklistTemplateId INT NOT NULL,
    WorkflowId INT NOT NULL,
    Jurisdiction NVARCHAR(150) NULL,
    Description NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalTaskType_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalTaskType_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalTaskType UNIQUE (TaskTypeCode),
    CONSTRAINT FK_LegalTaskType_DeedTypeId FOREIGN KEY (DeedTypeId) REFERENCES dbo.LegalDeedType(DeedTypeId),
    CONSTRAINT FK_LegalTaskType_ChecklistTemplateId FOREIGN KEY (ChecklistTemplateId) REFERENCES dbo.LegalChecklistTemplate(TemplateId),
    CONSTRAINT FK_LegalTaskType_WorkflowId FOREIGN KEY (WorkflowId) REFERENCES dbo.LegalApprovalWorkflow(WorkflowId),
    CONSTRAINT FK_LegalTaskType_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalTaskType_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Status & Reason: Status codes and the reasons used for missing documents, returns, rejections and holds.
IF OBJECT_ID('dbo.LegalStatusReason', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalStatusReason (
    ReasonId INT IDENTITY(1,1) CONSTRAINT PK_LegalStatusReason PRIMARY KEY,
    Category NVARCHAR(60) NOT NULL,
    ReasonCode NVARCHAR(40) NOT NULL,
    ReasonLabel NVARCHAR(150) NOT NULL,
    SortOrder INT NULL,
    Description NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalStatusReason_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalStatusReason_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalStatusReason UNIQUE (Category, ReasonCode),
    CONSTRAINT FK_LegalStatusReason_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalStatusReason_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Reminder & SLA: How often a pending status is followed up and when it escalates, and to whom.
IF OBJECT_ID('dbo.LegalReminderSla', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalReminderSla (
    ReminderId INT IDENTITY(1,1) CONSTRAINT PK_LegalReminderSla PRIMARY KEY,
    AppliesTo NVARCHAR(60) NOT NULL,
    RemindEveryDays INT NOT NULL,
    EscalateAfterDays INT NOT NULL,
    RecipientRoleId INT NULL,
    EscalationRoleId INT NULL,
    WorkingDaysOnly BIT NOT NULL CONSTRAINT DF_LegalReminderSla_WorkingDaysOnly DEFAULT 1,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalReminderSla_IsActive DEFAULT 1,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalReminderSla_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_LegalReminderSla UNIQUE (AppliesTo),
    CONSTRAINT FK_LegalReminderSla_RecipientRoleId FOREIGN KEY (RecipientRoleId) REFERENCES dbo.Role(RId),
    CONSTRAINT FK_LegalReminderSla_EscalationRoleId FOREIGN KEY (EscalationRoleId) REFERENCES dbo.Role(RId),
    CONSTRAINT FK_LegalReminderSla_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalReminderSla_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Party: Buyers, sellers, POA holders and witnesses, linked to deeds with a role.
IF OBJECT_ID('dbo.LegalParty', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalParty (
    PartyId INT IDENTITY(1,1) CONSTRAINT PK_LegalParty PRIMARY KEY,
    PartyType NVARCHAR(60) NOT NULL,
    LegalName NVARCHAR(200) NOT NULL,
    GuardianName NVARCHAR(200) NULL,
    Pan NVARCHAR(10) NULL,
    Phone NVARCHAR(30) NULL,
    Email NVARCHAR(150) NULL,
    Address NVARCHAR(500) NULL,
    VerificationStatus NVARCHAR(60) NOT NULL,
    PrivacyClass NVARCHAR(60) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LegalParty_IsActive DEFAULT 1,
    NormalizedName AS UPPER(LTRIM(RTRIM(LegalName))) PERSISTED,
    CreatedBy INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalParty_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy INT NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT FK_LegalParty_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_LegalParty_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- ── Menu rights ───────────────────────────────────────────────────────────────────────────────────
DECLARE @pages TABLE (PageKey NVARCHAR(100), Label NVARCHAR(200), GroupName NVARCHAR(150), SortOrder INT);
INSERT INTO @pages VALUES (N'legal-dashboard', N'Legal Dashboard', N'Legal', 5)
  , (N'legal-area-unit-master', N'Area Unit Master', N'Legal Masters - Land records', 10)
  , (N'legal-mouza-master', N'Mouza Master', N'Legal Masters - Land records', 20)
  , (N'legal-rs-khatian-master', N'RS Khatian Master', N'Legal Masters - Land records', 30)
  , (N'legal-rs-plot-master', N'RS Plot Master', N'Legal Masters - Land records', 40)
  , (N'legal-lr-ror-master', N'LR Record of Rights Master', N'Legal Masters - Land records', 50)
  , (N'legal-registration-office-master', N'Deed Registration Office Master', N'Legal Masters - Registration', 60)
  , (N'legal-portal-link-master', N'Official Portal Link Master', N'Legal Masters - Registration', 70)
  , (N'legal-deed-type-master', N'Deed Type Master', N'Legal Masters - Registration', 80)
  , (N'legal-document-type-master', N'Legal Document Type Master', N'Legal Masters - Documents', 90)
  , (N'legal-checklist-template-master', N'Document Checklist Template Master', N'Legal Masters - Documents', 100)
  , (N'legal-checklist-item-master', N'Checklist Item Master', N'Legal Masters - Documents', 110)
  , (N'legal-approval-workflow-master', N'Approval Workflow Master', N'Legal Masters - Workflow', 120)
  , (N'legal-task-type-master', N'Registration Task Type Master', N'Legal Masters - Registration', 130)
  , (N'legal-status-reason-master', N'Status & Reason Master', N'Legal Masters - Workflow', 140)
  , (N'legal-reminder-sla-master', N'Reminder & SLA Master', N'Legal Masters - Workflow', 150)
  , (N'legal-party-master', N'Party Master', N'Legal Masters - Parties', 160)
;

UPDATE pd SET Label = p.Label, Module = N'Legal', GroupName = p.GroupName, Actions = N'view,create,edit,delete,print,export',
              SortOrder = p.SortOrder, IsActive = 1, UpdatedAt = SYSDATETIME()
FROM dbo.PageDefinitions pd JOIN @pages p ON p.PageKey = pd.PageKey;

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, N'Legal', p.GroupName, N'view,create,edit,delete,print,export', p.SortOrder, 1, N'migration-587', SYSDATETIME()
FROM @pages p WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey);
GO

-- ── Starting data ─────────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.LegalAreaUnit)
  INSERT INTO dbo.LegalAreaUnit (UnitCode, UnitName, SqFtFactor, DecimalPlaces) VALUES
    (N'SQFT', N'Square Feet', 1, 2),
    (N'SQM', N'Square Metre', 10.763910, 2),
    (N'CHATAK', N'Chatak', 45, 4),
    (N'DEC', N'Decimal (Satak)', 435.6, 4),
    (N'KATHA', N'Katha', 720, 4),
    (N'BIGHA', N'Bigha', 14400, 4),
    (N'ACRE', N'Acre', 43560, 4),
    (N'HECTARE', N'Hectare', 107639.104, 4);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalDeedType)
  INSERT INTO dbo.LegalDeedType (DeedTypeCode, DeedTypeName, TransactionType, Description) VALUES
    (N'SALE', N'Sale Deed (Deed of Conveyance)', N'Purchase', N'Transfer of ownership for a price.'),
    (N'GIFT', N'Gift Deed', N'Gift', N'Transfer without consideration.'),
    (N'EXCH', N'Exchange Deed', N'Exchange', N'Mutual transfer of property.'),
    (N'LEASE', N'Lease Deed', N'Lease', N'Transfer of the right to use for a term.'),
    (N'POA', N'Power of Attorney', N'Power of Attorney', N'Authority to act for the owner.'),
    (N'DA', N'Development Agreement', N'Development Agreement', N'Landowner and developer agreement.'),
    (N'RECT', N'Rectification Deed', N'Rectification', N'Corrects an error in a registered deed.');
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalDocumentType)
  INSERT INTO dbo.LegalDocumentType (DocTypeCode, DocTypeName, Category, Sensitivity, RetentionClass, Description) VALUES
    (N'DEED-DRAFT', N'Sale Deed Draft', N'Draft', N'Confidential', N'Permanent', N'Draft instrument reviewed before registration; the final registered deed is linked separately.'),
    (N'SELLER-ID', N'Seller Identity Proof', N'Identity', N'Personal Data', N'10 Years', N'Identity check of the seller under the applicable rules.'),
    (N'BUYER-ID', N'Buyer Identity Proof', N'Identity', N'Personal Data', N'10 Years', N'Identity check of the buyer under the applicable rules.'),
    (N'PAN', N'PAN / Tax Identifier Evidence', N'Tax', N'Personal Data', N'10 Years', N'Tax and transaction compliance where applicable.'),
    (N'PARENT-DEED', N'Previous / Parent Deed(s)', N'Title', N'Confidential', N'Permanent', N'Supports the title-chain review; there may be several.'),
    (N'KHATIAN-DAG', N'Khatian and Dag / Plot Details', N'Land Record', N'Internal', N'Permanent', N'Land identity and record cross-check.'),
    (N'ROR', N'Parcha / Record of Rights (RoR)', N'Land Record', N'Internal', N'Permanent', N'Record verification; note the source, date and copy type.'),
    (N'MUTATION', N'Mutation Record / Certificate', N'Land Record', N'Internal', N'Permanent', N'Name mutation in the revenue record, where applicable.'),
    (N'KHAJNA', N'Khajna / Land Revenue Receipt', N'Revenue', N'Internal', N'8 Years', N'Land revenue payment / dues evidence, where applicable.'),
    (N'STAMP-FEE', N'Stamp Duty / Registration Fee Proof', N'Payment', N'Confidential', N'8 Years', N'Receipt, challan or reference of the duty and fee paid.'),
    (N'PHOTO-WITNESS', N'Photographs and Witness ID Evidence', N'Photograph', N'Personal Data', N'10 Years', N'Only as the current process requires; access restricted.'),
    (N'REG-DEED', N'Final Registered Deed Copy', N'Registration', N'Confidential', N'Permanent', N'Core completion evidence; while missing the task stays Awaiting Registered Deed.'),
    (N'OFFICE-EXTRA', N'Additional Office-Specific Documents', N'Other', N'Internal', N'10 Years', N'Added per case; record the reason or rule for adding.');
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalStatusReason)
  INSERT INTO dbo.LegalStatusReason (Category, ReasonCode, ReasonLabel, SortOrder, Description) VALUES
    (N'Task Status', N'DRAFT', N'Draft', 1, N'Task started but minimum fields are incomplete.'),
    (N'Task Status', N'READY_TO_SEARCH', N'Ready to Search', 2, N'Required search fields are entered.'),
    (N'Task Status', N'SEARCH_PENDING', N'Search Pending', 3, N'Search outcome has not been recorded.'),
    (N'Task Status', N'SEARCH_COMPLETED', N'Search Completed', 4, N'Outcome / reference and search date recorded.'),
    (N'Task Status', N'AWAITING_DEED', N'Awaiting Registered Deed', 5, N'Final registered deed copy has not been uploaded.'),
    (N'Task Status', N'PENDING_DOCS', N'Pending Documents', 6, N'One or more required checklist items are missing or rejected.'),
    (N'Task Status', N'READY_L1', N'Ready for L1', 7, N'Required fields and checklist checks pass.'),
    (N'Task Status', N'L1_PENDING', N'L1 Pending', 8, N'Waiting for the L1 reviewer.'),
    (N'Task Status', N'L1_RETURNED', N'L1 Returned', 9, N'Correction or more evidence required at L1.'),
    (N'Task Status', N'L2_PENDING', N'L2 Pending', 10, N'Waiting for the L2 approver.'),
    (N'Task Status', N'L2_RETURNED', N'L2 Returned', 11, N'Correction or more evidence required at L2.'),
    (N'Task Status', N'REJECTED', N'Rejected', 12, N'Case stopped with a reason.'),
    (N'Task Status', N'CANCELLED', N'Cancelled', 13, N'Case cancelled with a reason.'),
    (N'Task Status', N'ON_HOLD', N'On Hold', 14, N'Temporarily blocked with a reason.'),
    (N'Task Status', N'COMPLETED', N'Completed', 15, N'L2 approved and closure checks passed.'),
    (N'Missing Document', N'AWAIT_SELLER', N'Awaiting from seller', 1, NULL),
    (N'Missing Document', N'AWAIT_OFFICE', N'Awaiting from registration office', 2, NULL),
    (N'Missing Document', N'PORTAL_DOWN', N'Official portal unavailable', 3, NULL),
    (N'Missing Document', N'NOT_YET_ISSUED', N'Not yet issued', 4, NULL),
    (N'Return', N'METADATA_MISMATCH', N'Deed details do not match the uploaded deed', 1, NULL),
    (N'Return', N'UNREADABLE', N'File unreadable / incomplete', 2, NULL),
    (N'Return', N'PARTY_MISMATCH', N'Party name or role mismatch', 3, NULL),
    (N'Return', N'LAND_MISMATCH', N'Plot / Khatian / Mouza mismatch', 4, NULL),
    (N'Rejection', N'TITLE_DEFECT', N'Defect in title chain', 1, NULL),
    (N'Cancellation', N'DEAL_DROPPED', N'Purchase dropped', 1, NULL),
    (N'On Hold', N'DISPUTE', N'Dispute / litigation on the land', 1, NULL),
    (N'Discrepancy', N'AREA_DIFF', N'Area differs between records', 1, NULL),
    (N'Waiver', N'APPROVER_WAIVED', N'Waived by authorised approver', 1, NULL);
GO

-- A starting checklist for land purchase; the legal / compliance administrator should review and approve it.
IF NOT EXISTS (SELECT 1 FROM dbo.LegalChecklistTemplate)
BEGIN
  INSERT INTO dbo.LegalChecklistTemplate (TemplateName, VersionNo, DeedTypeId, Jurisdiction, EffectiveFrom, Remarks)
  SELECT N'Land Purchase - Sale Deed', 1, DeedTypeId, N'West Bengal', CAST(SYSDATETIME() AS DATE),
         N'Starting template. Applicability depends on the transaction, land, parties and the registration office.'
  FROM dbo.LegalDeedType WHERE DeedTypeCode = N'SALE';

  INSERT INTO dbo.LegalChecklistItem (TemplateId, DocTypeId, Requirement, StageNeeded, SortOrder, AllowNA, Waivable)
  SELECT t.TemplateId, d.DocTypeId, v.Requirement, v.StageNeeded, v.SortOrder, v.AllowNA, v.Waivable
  FROM (VALUES
    (N'DEED-DRAFT', N'Required', N'Deed Details', 1, 0, 0),
    (N'SELLER-ID', N'Conditional', N'Before L1', 2, 1, 0),
    (N'BUYER-ID', N'Conditional', N'Before L1', 3, 1, 0),
    (N'PAN', N'Conditional', N'Before L1', 4, 1, 1),
    (N'PARENT-DEED', N'Required', N'Before L1', 5, 1, 0),
    (N'KHATIAN-DAG', N'Required', N'Deed Details', 6, 0, 0),
    (N'ROR', N'Required', N'Before L1', 7, 0, 0),
    (N'MUTATION', N'Conditional', N'Before L2', 8, 1, 1),
    (N'KHAJNA', N'Conditional', N'Before L1', 9, 1, 1),
    (N'STAMP-FEE', N'Required', N'Before L1', 10, 0, 0),
    (N'PHOTO-WITNESS', N'Conditional', N'Before L1', 11, 1, 0),
    (N'REG-DEED', N'Required', N'Before L1', 12, 0, 0),
    (N'OFFICE-EXTRA', N'Optional', N'Before L2', 13, 1, 1)
  ) v (DocTypeCode, Requirement, StageNeeded, SortOrder, AllowNA, Waivable)
  JOIN dbo.LegalDocumentType d ON d.DocTypeCode = v.DocTypeCode
  CROSS JOIN dbo.LegalChecklistTemplate t
  WHERE t.TemplateName = N'Land Purchase - Sale Deed' AND t.VersionNo = 1;
END
GO

PRINT '587-legal-module-masters applied successfully.';
GO
