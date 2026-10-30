-- 588-legal-deed-registration-transactions.sql
-- Legal Module (Land Deed Registration Tracking)
-- Conforms strictly to Functional Specification Version 2.0:
--   1. dbo.LegalSearchSession   - Search sessions (Date + Office + criteria)
--   2. dbo.LegalSearchCandidate - Candidates found during search with human match verification
--   3. dbo.LegalDeedDossier     - Deed dossiers with distinct RS Dag, LR Dag, RS Khatian, LR Khatian
--   4. dbo.LegalDossierParty    - Multi-party mapping (Seller, Buyer, Confirming, GPA, Witness)
--   5. dbo.LegalDossierDocument - Versioned checklist items with Requirement & Applicability rules
--   6. dbo.LegalApprovalTask    - L1 & L2 approval route tasks
--   7. dbo.LegalAuditEvent      - Comprehensive event & decision history audit log

-- Safely drop old/unused temporary tables if previously created
IF OBJECT_ID('dbo.LegalDeedApprovalLog', 'U') IS NOT NULL DROP TABLE dbo.LegalDeedApprovalLog;
IF OBJECT_ID('dbo.LegalDeedDocument', 'U') IS NOT NULL DROP TABLE dbo.LegalDeedDocument;
IF OBJECT_ID('dbo.LegalDeedRecord', 'U') IS NOT NULL DROP TABLE dbo.LegalDeedRecord;
IF OBJECT_ID('dbo.LegalRegistrationSearch', 'U') IS NOT NULL DROP TABLE dbo.LegalRegistrationSearch;
IF OBJECT_ID('dbo.LegalAuditEvent', 'U') IS NOT NULL DROP TABLE dbo.LegalAuditEvent;
IF OBJECT_ID('dbo.LegalApprovalTask', 'U') IS NOT NULL DROP TABLE dbo.LegalApprovalTask;
IF OBJECT_ID('dbo.LegalDossierDocument', 'U') IS NOT NULL DROP TABLE dbo.LegalDossierDocument;
IF OBJECT_ID('dbo.LegalDossierParty', 'U') IS NOT NULL DROP TABLE dbo.LegalDossierParty;
IF OBJECT_ID('dbo.LegalDeedDossier', 'U') IS NOT NULL DROP TABLE dbo.LegalDeedDossier;
IF OBJECT_ID('dbo.LegalSearchCandidate', 'U') IS NOT NULL DROP TABLE dbo.LegalSearchCandidate;
IF OBJECT_ID('dbo.LegalSearchSession', 'U') IS NOT NULL DROP TABLE dbo.LegalSearchSession;
GO

-- 1. Search Session
CREATE TABLE dbo.LegalSearchSession (
  SessionId INT IDENTITY(1,1) CONSTRAINT PK_LegalSearchSession PRIMARY KEY,
  SessionNumber NVARCHAR(50) NOT NULL,
  RegistrationDate DATE NOT NULL,
  OfficeId INT NOT NULL,
  SourceType NVARCHAR(30) NOT NULL CONSTRAINT DF_LSS_Source DEFAULT 'Manual Portal',
  
  -- Search Status: Draft, In Progress, Deed Found, No Matching Deed, Multiple Matches, Portal Unavailable, Search Incomplete
  SearchStatus NVARCHAR(50) NOT NULL CONSTRAINT DF_LSS_Status DEFAULT 'In Progress',
  
  -- Optional search criteria
  MouzaId INT NULL,
  RsPlotNo NVARCHAR(50) NULL,
  LrPlotNo NVARCHAR(50) NULL,
  RsKhatianNo NVARCHAR(50) NULL,
  LrKhatianNo NVARCHAR(50) NULL,
  PartyName NVARCHAR(200) NULL,
  DeedNo NVARCHAR(100) NULL,
  DeedYear INT NULL,
  PropertyDescription NVARCHAR(500) NULL,

  -- Manual Assisted Evidence & Notes
  EvidenceRef NVARCHAR(100) NULL,
  EvidenceAmount DECIMAL(18,2) NULL,
  Notes NVARCHAR(MAX) NULL,

  PerformedBy INT NULL,
  PerformedAt DATETIME2 NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_LSS_IsActive DEFAULT 1,
  CreatedBy INT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LSS_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL,
  UpdatedAt DATETIME2 NULL,

  CONSTRAINT UQ_LegalSearchSession_Num UNIQUE (SessionNumber),
  CONSTRAINT FK_LSS_OfficeId FOREIGN KEY (OfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
  CONSTRAINT FK_LSS_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
  CONSTRAINT FK_LSS_PerformedBy FOREIGN KEY (PerformedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LSS_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LSS_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LSS_Date ON dbo.LegalSearchSession(RegistrationDate);
CREATE INDEX IX_LSS_Office ON dbo.LegalSearchSession(OfficeId);
CREATE INDEX IX_LSS_Status ON dbo.LegalSearchSession(SearchStatus);
GO

-- 2. Search Candidates
CREATE TABLE dbo.LegalSearchCandidate (
  CandidateId INT IDENTITY(1,1) CONSTRAINT PK_LegalSearchCandidate PRIMARY KEY,
  SessionId INT NOT NULL,
  CandidateRef NVARCHAR(50) NOT NULL,
  DeedNo NVARCHAR(100) NOT NULL,
  DeedYear INT NOT NULL,
  DeedDate DATE NULL,
  OfficeId INT NOT NULL,
  PartySummary NVARCHAR(500) NULL,
  PropertySummary NVARCHAR(500) NULL,

  -- Verification Status: Unverified, Verified, Rejected
  VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LSC_VerStatus DEFAULT 'Unverified',
  VerificationNotes NVARCHAR(1000) NULL,
  VerifiedBy INT NULL,
  VerifiedAt DATETIME2 NULL,

  IsActive BIT NOT NULL CONSTRAINT DF_LSC_IsActive DEFAULT 1,
  CreatedBy INT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LSC_CreatedAt DEFAULT SYSUTCDATETIME(),

  CONSTRAINT FK_LSC_SessionId FOREIGN KEY (SessionId) REFERENCES dbo.LegalSearchSession(SessionId),
  CONSTRAINT FK_LSC_OfficeId FOREIGN KEY (OfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
  CONSTRAINT FK_LSC_VerifiedBy FOREIGN KEY (VerifiedBy) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LSC_Session ON dbo.LegalSearchCandidate(SessionId);
GO

-- 3. Deed Dossier
CREATE TABLE dbo.LegalDeedDossier (
  DossierId INT IDENTITY(1,1) CONSTRAINT PK_LegalDeedDossier PRIMARY KEY,
  DossierNumber NVARCHAR(50) NOT NULL,
  SearchSessionId INT NULL,
  CandidateId INT NULL,

  -- Deed Metadata
  DeedNumber NVARCHAR(100) NULL,
  DeedYear INT NULL,
  DeedDate DATE NULL,
  RegistrationOfficeId INT NOT NULL,
  DeedTypeId INT NOT NULL,
  TransactionType NVARCHAR(50) NOT NULL CONSTRAINT DF_LDD_TxType DEFAULT 'Purchase',
  ProjectId INT NULL,

  -- Property Identifiers (Separate RS & LR Dags / Khatians)
  MouzaId INT NULL,
  RsDag NVARCHAR(50) NULL,
  LrDag NVARCHAR(50) NULL,
  RsKhatian NVARCHAR(50) NULL,
  LrKhatian NVARCHAR(50) NULL,
  PurchasedArea DECIMAL(18,6) NULL,
  AreaUnitId INT NULL,
  PropertyDescription NVARCHAR(1000) NULL,

  -- Financials
  ConsiderationAmount DECIMAL(18,2) NULL,
  MarketValue DECIMAL(18,2) NULL,
  StampDutyAmount DECIMAL(18,2) NULL,
  RegistrationFee DECIMAL(18,2) NULL,

  -- Ownership & Next Action
  AssignedOwnerId INT NULL,
  NextAction NVARCHAR(200) NULL,
  NextActionOwnerId INT NULL,
  TargetCompletionDate DATE NULL,

  -- Status Hierarchy
  VerificationStatus NVARCHAR(30) NOT NULL CONSTRAINT DF_LDD_VerStatus DEFAULT 'Unverified',
  ApprovalStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LDD_ApprStatus DEFAULT 'Draft',
  OverallStatus NVARCHAR(50) NOT NULL CONSTRAINT DF_LDD_OverallStatus DEFAULT 'Dossier Created',

  -- Approver Sign-offs
  L1ReviewerId INT NULL,
  L1ReviewedAt DATETIME2 NULL,
  L1Remarks NVARCHAR(1000) NULL,
  L2ApproverId INT NULL,
  L2ApprovedAt DATETIME2 NULL,
  L2Remarks NVARCHAR(1000) NULL,

  CompletionDate DATE NULL,
  BlockingExceptionNotes NVARCHAR(500) NULL,

  IsActive BIT NOT NULL CONSTRAINT DF_LDD_IsActive DEFAULT 1,
  CreatedBy INT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LDD_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL,
  UpdatedAt DATETIME2 NULL,

  CONSTRAINT UQ_LegalDeedDossier_Num UNIQUE (DossierNumber),
  CONSTRAINT FK_LDD_SessionId FOREIGN KEY (SearchSessionId) REFERENCES dbo.LegalSearchSession(SessionId),
  CONSTRAINT FK_LDD_CandidateId FOREIGN KEY (CandidateId) REFERENCES dbo.LegalSearchCandidate(CandidateId),
  CONSTRAINT FK_LDD_OfficeId FOREIGN KEY (RegistrationOfficeId) REFERENCES dbo.LegalRegistrationOffice(OfficeId),
  CONSTRAINT FK_LDD_DeedTypeId FOREIGN KEY (DeedTypeId) REFERENCES dbo.LegalDeedType(DeedTypeId),
  CONSTRAINT FK_LDD_ProjectId FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id),
  CONSTRAINT FK_LDD_MouzaId FOREIGN KEY (MouzaId) REFERENCES dbo.LegalMouza(MouzaId),
  CONSTRAINT FK_LDD_AreaUnitId FOREIGN KEY (AreaUnitId) REFERENCES dbo.LegalAreaUnit(AreaUnitId),
  CONSTRAINT FK_LDD_AssignedOwnerId FOREIGN KEY (AssignedOwnerId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDD_NextActionOwnerId FOREIGN KEY (NextActionOwnerId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDD_L1ReviewerId FOREIGN KEY (L1ReviewerId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDD_L2ApproverId FOREIGN KEY (L2ApproverId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDD_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDD_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LDD_Status ON dbo.LegalDeedDossier(OverallStatus);
CREATE INDEX IX_LDD_Office ON dbo.LegalDeedDossier(RegistrationOfficeId);
CREATE INDEX IX_LDD_DeedYear ON dbo.LegalDeedDossier(DeedNumber, DeedYear);
GO

-- 4. Dossier Parties
CREATE TABLE dbo.LegalDossierParty (
  DossierPartyId INT IDENTITY(1,1) CONSTRAINT PK_LegalDossierParty PRIMARY KEY,
  DossierId INT NOT NULL,
  PartyId INT NOT NULL,
  PartyRole NVARCHAR(50) NOT NULL, -- 'Seller / Landowner', 'Buyer (Company)', 'Confirming Party', 'GPA Holder', 'Witness'
  IsPrimary BIT NOT NULL CONSTRAINT DF_LDP_IsPrimary DEFAULT 0,
  Remarks NVARCHAR(500) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_LDP_IsActive DEFAULT 1,

  CONSTRAINT FK_LDP_DossierId FOREIGN KEY (DossierId) REFERENCES dbo.LegalDeedDossier(DossierId),
  CONSTRAINT FK_LDP_PartyId FOREIGN KEY (PartyId) REFERENCES dbo.LegalParty(PartyId)
);
CREATE INDEX IX_LDP_Dossier ON dbo.LegalDossierParty(DossierId);
GO

-- 5. Dossier Documents (Checklist & Versions)
CREATE TABLE dbo.LegalDossierDocument (
  DocumentId INT IDENTITY(1,1) CONSTRAINT PK_LegalDossierDocument PRIMARY KEY,
  DossierId INT NOT NULL,
  DocTypeId INT NOT NULL,
  ChecklistItemId INT NULL,
  VersionNo INT NOT NULL CONSTRAINT DF_LDDoc_Version DEFAULT 1,
  FileName NVARCHAR(250) NULL,
  FilePath NVARCHAR(500) NULL,
  FileSize INT NULL,
  MimeType NVARCHAR(100) NULL,

  -- Status: Not Started, Requested, Uploaded, Under Review, Accepted, Rejected, Needs Clarification, Waived
  DocumentStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_LDDoc_Status DEFAULT 'Not Started',
  RequirementType NVARCHAR(30) NOT NULL CONSTRAINT DF_LDDoc_ReqType DEFAULT 'Required',
  Applicability NVARCHAR(30) NOT NULL CONSTRAINT DF_LDDoc_Applicability DEFAULT 'Applicable',
  NAReason NVARCHAR(500) NULL,

  IsWaived BIT NOT NULL CONSTRAINT DF_LDDoc_IsWaived DEFAULT 0,
  WaiverReason NVARCHAR(500) NULL,
  WaivedBy INT NULL,
  WaivedAt DATETIME2 NULL,

  VerifiedBy INT NULL,
  VerifiedAt DATETIME2 NULL,
  RejectionReason NVARCHAR(500) NULL,
  ReviewNotes NVARCHAR(1000) NULL,

  ResponsibleUserId INT NULL,
  DueDate DATE NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_LDDoc_IsActive DEFAULT 1,
  CreatedBy INT NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LDDoc_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL,
  UpdatedAt DATETIME2 NULL,

  CONSTRAINT FK_LDDoc_DossierId FOREIGN KEY (DossierId) REFERENCES dbo.LegalDeedDossier(DossierId),
  CONSTRAINT FK_LDDoc_DocTypeId FOREIGN KEY (DocTypeId) REFERENCES dbo.LegalDocumentType(DocTypeId),
  CONSTRAINT FK_LDDoc_ChecklistItemId FOREIGN KEY (ChecklistItemId) REFERENCES dbo.LegalChecklistItem(ItemId),
  CONSTRAINT FK_LDDoc_WaivedBy FOREIGN KEY (WaivedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDDoc_VerifiedBy FOREIGN KEY (VerifiedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDDoc_ResponsibleUser FOREIGN KEY (ResponsibleUserId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDDoc_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
  CONSTRAINT FK_LDDoc_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LDDoc_Dossier ON dbo.LegalDossierDocument(DossierId);
CREATE INDEX IX_LDDoc_Status ON dbo.LegalDossierDocument(DocumentStatus);
GO

-- 6. Approval Tasks
CREATE TABLE dbo.LegalApprovalTask (
  TaskId INT IDENTITY(1,1) CONSTRAINT PK_LegalApprovalTask PRIMARY KEY,
  DossierId INT NOT NULL,
  ApprovalStage NVARCHAR(20) NOT NULL, -- 'L1', 'L2'
  AssignedRoleId INT NULL,
  AssignedUserId INT NULL,
  Status NVARCHAR(30) NOT NULL CONSTRAINT DF_LAT_Status DEFAULT 'Pending', -- 'Pending', 'Approved', 'Returned', 'Rejected'
  ActionTakenBy INT NULL,
  ActionTakenAt DATETIME2 NULL,
  Comments NVARCHAR(MAX) NULL,
  CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LAT_CreatedAt DEFAULT SYSUTCDATETIME(),

  CONSTRAINT FK_LAT_DossierId FOREIGN KEY (DossierId) REFERENCES dbo.LegalDeedDossier(DossierId),
  CONSTRAINT FK_LAT_AssignedRoleId FOREIGN KEY (AssignedRoleId) REFERENCES dbo.Role(RId),
  CONSTRAINT FK_LAT_AssignedUserId FOREIGN KEY (AssignedUserId) REFERENCES dbo.users(id),
  CONSTRAINT FK_LAT_ActionTakenBy FOREIGN KEY (ActionTakenBy) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LAT_Dossier ON dbo.LegalApprovalTask(DossierId);
GO

-- 7. Audit Event History
CREATE TABLE dbo.LegalAuditEvent (
  EventId INT IDENTITY(1,1) CONSTRAINT PK_LegalAuditEvent PRIMARY KEY,
  EntityName NVARCHAR(50) NOT NULL,
  EntityId INT NOT NULL,
  Action NVARCHAR(50) NOT NULL,
  PreviousState NVARCHAR(100) NULL,
  NewState NVARCHAR(100) NULL,
  ActorId INT NOT NULL,
  Timestamp DATETIME2 NOT NULL CONSTRAINT DF_LAE_Timestamp DEFAULT SYSUTCDATETIME(),
  Comments NVARCHAR(MAX) NULL,

  CONSTRAINT FK_LAE_ActorId FOREIGN KEY (ActorId) REFERENCES dbo.users(id)
);
CREATE INDEX IX_LAE_Entity ON dbo.LegalAuditEvent(EntityName, EntityId);
GO

-- ── Menu rights for new Operational Pages ──────────────────────────────────────────
DECLARE @pages TABLE (PageKey NVARCHAR(100), Label NVARCHAR(200), GroupName NVARCHAR(150), SortOrder INT);
INSERT INTO @pages VALUES 
    (N'legal-registration-search', N'Registration Search', N'Legal Operations', 10),
    (N'legal-deed-registrations', N'Deed Dossiers', N'Legal Operations', 20),
    (N'legal-approvals', N'Legal Approval Inbox', N'Legal Operations', 30),
    (N'legal-pending-queue', N'Legal Pending & Overdue', N'Legal Operations', 40);

UPDATE pd SET Label = p.Label, Module = N'Legal', GroupName = p.GroupName, Actions = N'view,create,edit,delete,print,export,approve,reject',
              SortOrder = p.SortOrder, IsActive = 1, UpdatedAt = SYSDATETIME()
FROM dbo.PageDefinitions pd
JOIN @pages p ON p.PageKey = pd.PageKey;

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, N'Legal', p.GroupName, N'view,create,edit,delete,print,export,approve,reject', p.SortOrder, 1, 'migration-588', SYSDATETIME()
FROM @pages p
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = p.PageKey);
GO

PRINT '588-legal-deed-registration-transactions applied successfully.';
GO
