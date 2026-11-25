-- Legal V2 phase 1: the Legal Verification workspace.
--   LegalActivityTemplate      the verification activities (17 seeded), editable in Setup
--   LegalActivityDependency    activity -> prerequisite activity
--   LegalActivityReminderRule  days before the due date when the assignee is reminded (7, 3, 1, 0 seeded)
--   LegalVerification          one workspace per land enquiry
--   LegalVerificationActivity  one row per activity per workspace (status, finding, assignee, dates…)
--   LegalActivityHistory       every change to an activity (never updated or deleted)
--   LegalActivityDocument      files attached to an activity
--   LegalActivityReminderLog   which due-date reminders were sent
-- Reference data only (activity list, dependencies, reminder days); no sample records.

IF OBJECT_ID('dbo.LegalActivityTemplate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityTemplate (
    TemplateId   INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityTemplate PRIMARY KEY,
    ActivityNo   INT NOT NULL,
    ActivityCode NVARCHAR(20) NOT NULL,
    ActivityName NVARCHAR(150) NOT NULL,
    Department   NVARCHAR(80) NULL,
    DefaultDays  INT NULL,
    Stage        NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalActivityTemplate_Stage DEFAULT N'Verification'
                 CONSTRAINT CK_LegalActivityTemplate_Stage CHECK (Stage IN (N'Verification', N'Post-registration')),
    IsMandatory  BIT NOT NULL CONSTRAINT DF_LegalActivityTemplate_Mandatory DEFAULT 1,
    Description  NVARCHAR(500) NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_LegalActivityTemplate_IsActive DEFAULT 1,
    CreatedBy    INT NULL,
    CreatedAt    DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityTemplate_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy    INT NULL,
    UpdatedAt    DATETIME2 NULL,
    CONSTRAINT UQ_LegalActivityTemplate_No UNIQUE (ActivityNo),
    CONSTRAINT UQ_LegalActivityTemplate_Code UNIQUE (ActivityCode)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalActivityTemplate)
  INSERT INTO dbo.LegalActivityTemplate (ActivityNo, ActivityCode, ActivityName, Department, DefaultDays, Stage, IsMandatory, Description) VALUES
   (1,  N'ONLINE-SEARCH', N'Online search (2009–2026)', N'Search', 7, N'Verification', 1, N'Online registry search by name and by date, owner-wise, 2009 to 2026'),
   (2,  N'RS-PANCHA', N'R.S. Pancha / Panchayat application', N'Legal', 5, N'Verification', 0, N'Only when the RS record is not available'),
   (3,  N'BANGLA-BHUMI', N'Bangla Bhumi search (RS Dag → LR Dag)', N'Search', 2, N'Verification', 1, N'One RS Dag may map to several LR Dags'),
   (4,  N'PLOT-INFO', N'Plot information application', N'Legal', 3, N'Verification', 1, NULL),
   (5,  N'OWNER-MATCH', N'RS owner ↔ LR owner matching', N'Legal', 3, N'Verification', 1, N'Matched through available deeds; name match alone is not proof'),
   (6,  N'DEED-CHAIN', N'Link deed and mother deed verification', N'Legal', NULL, N'Verification', 1, N'Historical deed chain behind the current ownership'),
   (7,  N'MOUZA-MAP', N'Mouza map cutting', N'Survey', 2, N'Verification', 1, N'Needs the updated Dag sketch; mark On Hold until it is available'),
   (8,  N'OWNERSHIP-FLOW', N'Historical ownership flowchart (1956–2006)', N'Legal', 21, N'Verification', 1, NULL),
   (9,  N'OFFLINE-SEARCH', N'Offline search', N'Search', NULL, N'Verification', 1, N'Physical searches at registry and government offices'),
   (10, N'COURT-SEARCH', N'Court search (30 years)', N'Legal', 21, N'Verification', 1, N'No record found means none in the sources searched'),
   (11, N'LA-ULC', N'LA and ULC application and report receipt', N'Legal', 60, N'Verification', 1, N'LA and ULC are tracked separately'),
   (12, N'KHAJNA', N'Khajna last paid receipt check', N'Legal', 2, N'Verification', 1, NULL),
   (13, N'LEGAL-HEIR', N'Legal heir / inheritance / Farznama verification', N'Legal', 7, N'Verification', 1, N'Death certificate, heirs and shares, Farznama where applicable'),
   (14, N'MOTHER-DEED-ORIGINAL', N'Original mother deed availability check', N'Legal', 1, N'Verification', 1, NULL),
   (15, N'CERTIFIED-COPY', N'Certified copy of link and mother deed', N'Legal', 3, N'Verification', 1, NULL),
   (16, N'MUTATION-CONVERSION', N'Mutation and conversion', N'Legal', 210, N'Post-registration', 0, N'Mutation and conversion are tracked separately'),
   (17, N'LAND-SURVEY', N'Land survey (plenty / machine)', N'Survey', NULL, N'Verification', 1, NULL);
GO

IF OBJECT_ID('dbo.LegalActivityDependency', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityDependency (
    DependencyId        INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityDependency PRIMARY KEY,
    TemplateId          INT NOT NULL CONSTRAINT FK_LegalActivityDependency_Template REFERENCES dbo.LegalActivityTemplate (TemplateId),
    DependsOnTemplateId INT NOT NULL CONSTRAINT FK_LegalActivityDependency_DependsOn REFERENCES dbo.LegalActivityTemplate (TemplateId),
    IsMandatory         BIT NOT NULL CONSTRAINT DF_LegalActivityDependency_Mandatory DEFAULT 1,
    Remarks             NVARCHAR(300) NULL,
    IsActive            BIT NOT NULL CONSTRAINT DF_LegalActivityDependency_IsActive DEFAULT 1,
    CreatedBy           INT NULL,
    CreatedAt           DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityDependency_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy           INT NULL,
    UpdatedAt           DATETIME2 NULL,
    CONSTRAINT UQ_LegalActivityDependency UNIQUE (TemplateId, DependsOnTemplateId),
    CONSTRAINT CK_LegalActivityDependency_Self CHECK (TemplateId <> DependsOnTemplateId)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.LegalActivityDependency)
  INSERT INTO dbo.LegalActivityDependency (TemplateId, DependsOnTemplateId, Remarks)
  SELECT a.TemplateId, b.TemplateId, d.Remarks
  FROM (VALUES (5, 3, N'Needs the RS and LR records'), (8, 6, N'Needs the deed chain'), (8, 13, N'Needs the inheritance records'),
               (14, 6, N'Needs the mother deed reference'), (15, 6, N'Needs the deed references'), (17, 7, N'Needs the marked Mouza map')) d(A, B, Remarks)
  JOIN dbo.LegalActivityTemplate a ON a.ActivityNo = d.A
  JOIN dbo.LegalActivityTemplate b ON b.ActivityNo = d.B;
GO

IF OBJECT_ID('dbo.LegalActivityReminderRule', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityReminderRule (
    RuleId     INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityReminderRule PRIMARY KEY,
    DaysBefore INT NOT NULL CONSTRAINT CK_LegalActivityReminderRule_Days CHECK (DaysBefore BETWEEN 0 AND 90),
    IsActive   BIT NOT NULL CONSTRAINT DF_LegalActivityReminderRule_IsActive DEFAULT 1,
    CreatedBy  INT NULL,
    CreatedAt  DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityReminderRule_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT NULL,
    UpdatedAt  DATETIME2 NULL,
    CONSTRAINT UQ_LegalActivityReminderRule UNIQUE (DaysBefore)
  );
  INSERT INTO dbo.LegalActivityReminderRule (DaysBefore) VALUES (7), (3), (1), (0);
END
GO

IF OBJECT_ID('dbo.LegalVerification', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerification (
    VerificationId INT IDENTITY(1,1) CONSTRAINT PK_LegalVerification PRIMARY KEY,
    VerificationNo NVARCHAR(30) NOT NULL,
    EnquiryId      INT NOT NULL CONSTRAINT FK_LegalVerification_Enquiry REFERENCES dbo.LegalLandEnquiry (EnquiryId),
    ProjectId      INT NULL,
    Status         NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalVerification_Status DEFAULT N'In Progress'
                   CONSTRAINT CK_LegalVerification_Status CHECK (Status IN (N'In Progress', N'Ready for Review', N'On Hold', N'Closed')),
    StartDate      DATE NOT NULL,
    TargetDate     DATE NULL,
    LeadUserId     INT NULL,
    Remarks        NVARCHAR(1000) NULL,
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalVerification_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2 NULL,
    CONSTRAINT UQ_LegalVerification_No UNIQUE (VerificationNo),
    CONSTRAINT UQ_LegalVerification_Enquiry UNIQUE (EnquiryId)
  );
END
GO

IF OBJECT_ID('dbo.LegalVerificationActivity', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerificationActivity (
    ActivityId     INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationActivity PRIMARY KEY,
    VerificationId INT NOT NULL CONSTRAINT FK_LegalVerificationActivity_Verification REFERENCES dbo.LegalVerification (VerificationId),
    TemplateId     INT NOT NULL CONSTRAINT FK_LegalVerificationActivity_Template REFERENCES dbo.LegalActivityTemplate (TemplateId),
    ActivityNo     INT NOT NULL,
    ActivityName   NVARCHAR(150) NOT NULL,
    IsMandatory    BIT NOT NULL,
    Status         NVARCHAR(30) NOT NULL CONSTRAINT DF_LegalVerificationActivity_Status DEFAULT N'Not Started'
                   CONSTRAINT CK_LegalVerificationActivity_Status CHECK (Status IN (N'Not Started', N'Pending', N'In Progress', N'Applied', N'Report Pending', N'On Hold', N'Completed', N'Not Applicable', N'Rejected')),
    Finding        NVARCHAR(40) NULL
                   CONSTRAINT CK_LegalVerificationActivity_Finding CHECK (Finding IS NULL OR Finding IN (N'Found', N'Not Found', N'Matched', N'Mismatched', N'Discrepancy Found', N'Additional Documents Required', N'Unable to Verify')),
    AssignedUserId INT NULL,
    Department     NVARCHAR(80) NULL,
    Priority       NVARCHAR(10) NOT NULL CONSTRAINT DF_LegalVerificationActivity_Priority DEFAULT N'Normal'
                   CONSTRAINT CK_LegalVerificationActivity_Priority CHECK (Priority IN (N'Low', N'Normal', N'High', N'Urgent')),
    ExpectedDays   INT NULL,
    StartDate      DATE NULL,
    DueDate        DATE NULL,
    CompletedDate  DATE NULL,
    Findings       NVARCHAR(MAX) NULL,
    Remarks        NVARCHAR(1000) NULL,
    HoldReason     NVARCHAR(500) NULL,
    NextAction     NVARCHAR(500) NULL,
    ReviewedBy     INT NULL,
    ReviewedAt     DATETIME2 NULL,
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationActivity_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2 NULL,
    CONSTRAINT UQ_LegalVerificationActivity UNIQUE (VerificationId, TemplateId)
  );
  CREATE INDEX IX_LegalVerificationActivity_Assignee ON dbo.LegalVerificationActivity (AssignedUserId, Status, DueDate);
END
GO

IF OBJECT_ID('dbo.LegalActivityHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityHistory (
    HistoryId   BIGINT IDENTITY(1,1) CONSTRAINT PK_LegalActivityHistory PRIMARY KEY,
    ActivityId  INT NOT NULL CONSTRAINT FK_LegalActivityHistory_Activity REFERENCES dbo.LegalVerificationActivity (ActivityId),
    Action      NVARCHAR(30) NOT NULL,           -- Created / Updated / Override / Document
    OldStatus   NVARCHAR(30) NULL,
    NewStatus   NVARCHAR(30) NULL,
    OldFinding  NVARCHAR(40) NULL,
    NewFinding  NVARCHAR(40) NULL,
    OldAssignee INT NULL,
    NewAssignee INT NULL,
    Remarks     NVARCHAR(1000) NULL,
    FileId      INT NULL,
    ChangedBy   INT NULL,
    ChangedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityHistory_At DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_LegalActivityHistory_Activity ON dbo.LegalActivityHistory (ActivityId, HistoryId);
END
GO

-- History is permanent (as migration 713 does for the other Legal history tables).
IF OBJECT_ID('dbo.TR_LegalActivityHistory_NoChange', 'TR') IS NULL
  EXEC (N'CREATE TRIGGER dbo.TR_LegalActivityHistory_NoChange ON dbo.LegalActivityHistory AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF CAST(SESSION_CONTEXT(N''legal_reset'') AS INT) = 1 RETURN;
  THROW 51000, ''Activity history cannot be changed or deleted'', 1;
END');
GO

IF OBJECT_ID('dbo.LegalActivityDocument', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityDocument (
    DocId      INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityDocument PRIMARY KEY,
    ActivityId INT NOT NULL CONSTRAINT FK_LegalActivityDocument_Activity REFERENCES dbo.LegalVerificationActivity (ActivityId),
    FileId     INT NOT NULL,
    Title      NVARCHAR(200) NULL,
    UploadedBy INT NULL,
    UploadedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityDocument_At DEFAULT SYSUTCDATETIME(),
    IsActive   BIT NOT NULL CONSTRAINT DF_LegalActivityDocument_IsActive DEFAULT 1
  );
  CREATE INDEX IX_LegalActivityDocument_Activity ON dbo.LegalActivityDocument (ActivityId);
END
GO

IF OBJECT_ID('dbo.LegalActivityReminderLog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityReminderLog (
    LogId      BIGINT IDENTITY(1,1) CONSTRAINT PK_LegalActivityReminderLog PRIMARY KEY,
    ActivityId INT NOT NULL,
    DueDate    DATE NOT NULL,
    Kind       NVARCHAR(20) NOT NULL,            -- D7 / D3 / D1 / D0 / overdue
    SentOn     DATE NOT NULL CONSTRAINT DF_LegalActivityReminderLog_SentOn DEFAULT CAST(GETDATE() AS DATE)
  );
  CREATE INDEX IX_LegalActivityReminderLog ON dbo.LegalActivityReminderLog (ActivityId, DueDate, Kind, SentOn);
END
GO

-- ── Setup pages (admin) ───────────────────────────────────────────────────────────────────────────
DECLARE @pages TABLE (PageKey NVARCHAR(100), Label NVARCHAR(150), SortOrder INT);
INSERT INTO @pages VALUES
  (N'legal-verification-activity-master', N'Verification Activities', 152),
  (N'legal-activity-dependency-master', N'Activity Dependencies', 153),
  (N'legal-activity-reminder-master', N'Activity Reminder Days', 154);
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.PageKey, p.Label, N'Legal', N'Legal Masters - Workflow', N'view,export', p.SortOrder, 1, N'migration-715', SYSDATETIME()
FROM @pages p WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions d WHERE d.PageKey = p.PageKey);
GO
