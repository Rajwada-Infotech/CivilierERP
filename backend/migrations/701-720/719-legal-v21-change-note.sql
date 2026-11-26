-- Legal V2.1 (final developer change note). Extends the V2 tables; no record is deleted.
--  1. Activity: Work Status (Status) and Verification Status (VerifyStatus) kept apart; verifier assignment; N/A
--     request and approval; government dates; escalation.
--  2. Activity setup: display no. (6A / 6B), order, search period, escalation days; 6B added; 16 moved out of
--     verification (mutation and conversion live under Post-Registration).
--  3. Central verification documents with links to activities and entries (ownership events…), copy type, physical
--     original, verification status and versions. Existing activity documents are carried over.
--  4. Activity comments; exceptions (dependency overrides, map-sketch and land-approval exceptions).
--  5. Final legal review: Rejected decision, recorded risks; workspace status Rejected.
--  6. LegalMutation reused for mutation AND conversion (Kind) with assignee, due date, fees and conversion fields;
--     query / response history.
--  7. View of structured ownership events (from the Activity 8 entries).
-- Rollback: backend/migrations/rollback/719-legal-v21-change-note.down.sql

-- ── 1. Activity: work vs verification status ────────────────────────────────────────────────────
IF COL_LENGTH('dbo.LegalVerificationActivity', 'VerifyStatus') IS NULL
  ALTER TABLE dbo.LegalVerificationActivity ADD
    VerifyStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalVerificationActivity_VerifyStatus DEFAULT N'Not Reviewed',
    VerifierUserId INT NULL, VerifyRemarks NVARCHAR(1000) NULL,
    SubmittedBy INT NULL, SubmittedAt DATETIME2 NULL,
    NaReason NVARCHAR(500) NULL, NaRequestedBy INT NULL, NaRequestedAt DATETIME2 NULL, NaApprovedBy INT NULL, NaApprovedAt DATETIME2 NULL,
    GovSubmissionDate DATE NULL, AckDate DATE NULL, QueryDate DATE NULL, QueryResponseDate DATE NULL, HearingDate DATE NULL,
    ReportReceiptDate DATE NULL, OrderDate DATE NULL, EscalatedOn DATE NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_Status')
  ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_Status;
GO
-- Old single status → work status + verification status.
UPDATE dbo.LegalVerificationActivity SET VerifyStatus = N'Verified', Status = N'Closed' WHERE Status = N'Completed';
UPDATE dbo.LegalVerificationActivity SET VerifyStatus = N'N/A', Status = N'Closed', NaReason = ISNULL(NaReason, Remarks), NaApprovedBy = ReviewedBy, NaApprovedAt = ReviewedAt WHERE Status = N'Not Applicable';
UPDATE dbo.LegalVerificationActivity SET VerifyStatus = N'Returned', Status = N'In Progress' WHERE Status = N'Rejected';
UPDATE dbo.LegalVerificationActivity SET Status = N'In Progress' WHERE Status = N'Pending';
GO
ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_Status
  CHECK (Status IN (N'Not Started', N'In Progress', N'Applied', N'Report Pending', N'On Hold', N'Submitted for Review', N'Closed'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_VerifyStatus')
  ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_VerifyStatus
    CHECK (VerifyStatus IN (N'Not Reviewed', N'Under Review', N'Verified', N'Returned', N'Rejected', N'N/A'));
GO
-- Findings: negative search results are "in the sources searched", never proof of absence.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_Finding')
  ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_Finding;
GO
UPDATE dbo.LegalVerificationActivity SET Finding = N'Not Found in Sources Searched' WHERE Finding = N'Not Found';
ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_Finding CHECK (Finding IS NULL OR Finding IN (
  N'Found', N'Not Found in Sources Searched', N'Incomplete', N'Records Not Available', N'Matched', N'Mismatched', N'Discrepancy Found',
  N'Additional Documents Required', N'Unable to Verify', N'Case Found'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalVerificationActivity_Verifier')
  CREATE INDEX IX_LegalVerificationActivity_Verifier ON dbo.LegalVerificationActivity (VerifierUserId, VerifyStatus);
GO

-- ── 2. Activity setup ───────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('dbo.LegalActivityTemplate', 'DisplayNo') IS NULL
  ALTER TABLE dbo.LegalActivityTemplate ADD DisplayNo NVARCHAR(5) NULL, SortOrder INT NULL,
    PeriodFromYear INT NULL, PeriodToYear INT NULL, PeriodYears INT NULL,
    EscalateAfterDays INT NULL CONSTRAINT DF_LegalActivityTemplate_Escalate DEFAULT 3;
GO
UPDATE dbo.LegalActivityTemplate SET SortOrder = ActivityNo * 10 WHERE SortOrder IS NULL;
UPDATE dbo.LegalActivityTemplate SET EscalateAfterDays = 3 WHERE EscalateAfterDays IS NULL;
UPDATE dbo.LegalActivityTemplate SET DisplayNo = N'6A', ActivityName = N'Initial deed chain identification (link and mother deed)',
       Description = N'6A: identify the link deeds and the mother deed, their parties and the missing links' WHERE ActivityCode = N'DEED-CHAIN' AND DisplayNo IS NULL;
UPDATE dbo.LegalActivityTemplate SET PeriodFromYear = 2009, PeriodToYear = 2026 WHERE ActivityCode = N'ONLINE-SEARCH' AND PeriodFromYear IS NULL;
UPDATE dbo.LegalActivityTemplate SET PeriodFromYear = 1956, PeriodToYear = 2006 WHERE ActivityCode = N'OWNERSHIP-FLOW' AND PeriodFromYear IS NULL;
UPDATE dbo.LegalActivityTemplate SET PeriodYears = 30 WHERE ActivityCode = N'COURT-SEARCH' AND PeriodYears IS NULL;
UPDATE dbo.LegalActivityTemplate SET IsActive = 0, Stage = N'Post-registration',
       Description = N'Moved to Post-Registration: mutation and conversion are tracked there, each on its own' WHERE ActivityCode = N'MUTATION-CONVERSION';
UPDATE dbo.LegalActivityTemplate SET ActivityName = N'Legal commission check / death certificate / Farznama', IsMandatory = 1
  WHERE ActivityCode = N'LEGAL-HEIR' AND ActivityName NOT LIKE N'Legal commission%';
IF NOT EXISTS (SELECT 1 FROM dbo.LegalActivityTemplate WHERE ActivityCode = N'DEED-CHAIN-FINAL')
  INSERT INTO dbo.LegalActivityTemplate (ActivityNo, ActivityCode, ActivityName, Department, DefaultDays, Stage, IsMandatory, Description, DisplayNo, SortOrder, EscalateAfterDays)
  VALUES (18, N'DEED-CHAIN-FINAL', N'Final deed chain verification', N'Legal', 5, N'Verification', 1,
          N'6B: verify the identified chain against originals or certified copies; continuity, missing links, discrepancies', N'6B', 65, 3);
GO
-- 6B waits for 6A and for the certified copies (or an authorised exception).
INSERT INTO dbo.LegalActivityDependency (TemplateId, DependsOnTemplateId, Remarks)
SELECT a.TemplateId, b.TemplateId, d.R
FROM (VALUES (N'DEED-CHAIN-FINAL', N'DEED-CHAIN', N'Needs the identified deed chain (6A)'),
             (N'DEED-CHAIN-FINAL', N'CERTIFIED-COPY', N'Needs the supporting copies')) d(A, B, R)
JOIN dbo.LegalActivityTemplate a ON a.ActivityCode = d.A JOIN dbo.LegalActivityTemplate b ON b.ActivityCode = d.B
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalActivityDependency x WHERE x.TemplateId = a.TemplateId AND x.DependsOnTemplateId = b.TemplateId);
GO

-- ── 3. Central verification documents ───────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.LegalVerificationDocument', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerificationDocument (
    DocId            INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationDocument PRIMARY KEY,
    VerificationId   INT NOT NULL CONSTRAINT FK_LegalVerificationDocument_Verification REFERENCES dbo.LegalVerification (VerificationId),
    FileId           INT NOT NULL,
    DocType          NVARCHAR(80) NOT NULL,
    DocNo            NVARCHAR(80) NULL,
    DocDate          DATE NULL,
    Authority        NVARCHAR(200) NULL,
    OwnerRef         NVARCHAR(200) NULL,
    DagRef           NVARCHAR(200) NULL,
    KhatianRef       NVARCHAR(200) NULL,
    CopyType         NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalVerificationDocument_Copy DEFAULT N'Scan'
                     CONSTRAINT CK_LegalVerificationDocument_Copy CHECK (CopyType IN (N'Original', N'Certified Copy', N'Photocopy', N'Scan')),
    OriginalAvailable NVARCHAR(10) NULL,
    OriginalHolder   NVARCHAR(200) NULL,
    Condition        NVARCHAR(20) NULL,
    VerifyStatus     NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalVerificationDocument_Verify DEFAULT N'Not Reviewed'
                     CONSTRAINT CK_LegalVerificationDocument_Verify CHECK (VerifyStatus IN (N'Not Reviewed', N'Verified', N'Rejected')),
    VerifiedBy       INT NULL,
    VerifiedAt       DATETIME2 NULL,
    RejectionReason  NVARCHAR(500) NULL,
    VersionNo        INT NOT NULL CONSTRAINT DF_LegalVerificationDocument_Version DEFAULT 1,
    PreviousDocId    INT NULL,
    Remarks          NVARCHAR(1000) NULL,
    IsActive         BIT NOT NULL CONSTRAINT DF_LegalVerificationDocument_IsActive DEFAULT 1,
    UploadedBy       INT NULL,
    UploadedAt       DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationDocument_At DEFAULT SYSUTCDATETIME(),
    UpdatedBy        INT NULL,
    UpdatedAt        DATETIME2 NULL
  );
  CREATE INDEX IX_LegalVerificationDocument_Verification ON dbo.LegalVerificationDocument (VerificationId, IsActive);
END
GO
IF OBJECT_ID('dbo.LegalVerificationDocumentLink', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerificationDocumentLink (
    LinkId     INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationDocumentLink PRIMARY KEY,
    DocId      INT NOT NULL CONSTRAINT FK_LegalVerificationDocumentLink_Doc REFERENCES dbo.LegalVerificationDocument (DocId),
    ActivityId INT NULL CONSTRAINT FK_LegalVerificationDocumentLink_Activity REFERENCES dbo.LegalVerificationActivity (ActivityId),
    EntryId    INT NULL CONSTRAINT FK_LegalVerificationDocumentLink_Entry REFERENCES dbo.LegalActivityEntry (EntryId),
    LinkedBy   INT NULL,
    LinkedAt   DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationDocumentLink_At DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_LegalVerificationDocumentLink_Target CHECK (ActivityId IS NOT NULL OR EntryId IS NOT NULL)
  );
  CREATE INDEX IX_LegalVerificationDocumentLink_Doc ON dbo.LegalVerificationDocumentLink (DocId);
  CREATE INDEX IX_LegalVerificationDocumentLink_Activity ON dbo.LegalVerificationDocumentLink (ActivityId);
  CREATE INDEX IX_LegalVerificationDocumentLink_Entry ON dbo.LegalVerificationDocumentLink (EntryId);
END
GO
-- Carry the V2 activity documents over (kept in their old table too).
IF COL_LENGTH('dbo.LegalVerificationDocument', 'LegacyDocId') IS NULL
  ALTER TABLE dbo.LegalVerificationDocument ADD LegacyDocId INT NULL;
GO
INSERT INTO dbo.LegalVerificationDocument (VerificationId, FileId, DocType, Remarks, UploadedBy, UploadedAt, LegacyDocId)
SELECT a.VerificationId, d.FileId, N'Other supporting document', d.Title, d.UploadedBy, d.UploadedAt, d.DocId
FROM dbo.LegalActivityDocument d JOIN dbo.LegalVerificationActivity a ON a.ActivityId = d.ActivityId
WHERE d.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM dbo.LegalVerificationDocument x WHERE x.LegacyDocId = d.DocId);
INSERT INTO dbo.LegalVerificationDocumentLink (DocId, ActivityId, LinkedBy, LinkedAt)
SELECT x.DocId, d.ActivityId, d.UploadedBy, d.UploadedAt
FROM dbo.LegalVerificationDocument x JOIN dbo.LegalActivityDocument d ON d.DocId = x.LegacyDocId
WHERE NOT EXISTS (SELECT 1 FROM dbo.LegalVerificationDocumentLink l WHERE l.DocId = x.DocId AND l.ActivityId = d.ActivityId);
GO

-- ── 4. Comments and exceptions ──────────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.LegalActivityComment', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalActivityComment (
    CommentId  INT IDENTITY(1,1) CONSTRAINT PK_LegalActivityComment PRIMARY KEY,
    ActivityId INT NOT NULL CONSTRAINT FK_LegalActivityComment_Activity REFERENCES dbo.LegalVerificationActivity (ActivityId),
    Comment    NVARCHAR(2000) NOT NULL,
    CreatedBy  INT NULL,
    CreatedAt  DATETIME2 NOT NULL CONSTRAINT DF_LegalActivityComment_At DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_LegalActivityComment_Activity ON dbo.LegalActivityComment (ActivityId);
END
GO
IF OBJECT_ID('dbo.LegalVerificationException', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalVerificationException (
    ExceptionId    INT IDENTITY(1,1) CONSTRAINT PK_LegalVerificationException PRIMARY KEY,
    Kind           NVARCHAR(40) NOT NULL CONSTRAINT CK_LegalVerificationException_Kind
                   CHECK (Kind IN (N'Dependency override', N'Map sketch exception', N'Land approval exception', N'N/A approval')),
    VerificationId INT NULL,
    ActivityId     INT NULL,
    LandId         INT NULL,
    Reason         NVARCHAR(1000) NOT NULL,
    Remarks        NVARCHAR(1000) NULL,
    Detail         NVARCHAR(1000) NULL,
    ApprovedBy     INT NULL,
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_LegalVerificationException_At DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_LegalVerificationException_Verification ON dbo.LegalVerificationException (VerificationId);
  CREATE INDEX IX_LegalVerificationException_Land ON dbo.LegalVerificationException (LandId);
END
GO
IF OBJECT_ID('dbo.TR_LegalVerificationException_NoChange', 'TR') IS NULL
  EXEC (N'CREATE TRIGGER dbo.TR_LegalVerificationException_NoChange ON dbo.LegalVerificationException AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF CAST(SESSION_CONTEXT(N''legal_reset'') AS INT) = 1 RETURN;
  THROW 51000, ''A recorded exception cannot be changed or deleted'', 1;
END');
GO

-- ── 5. Final legal review ───────────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationReview_Decision')
  ALTER TABLE dbo.LegalVerificationReview DROP CONSTRAINT CK_LegalVerificationReview_Decision;
GO
ALTER TABLE dbo.LegalVerificationReview ADD CONSTRAINT CK_LegalVerificationReview_Decision
  CHECK (Decision IN (N'Verified', N'Returned for Correction', N'Additional Documents Required', N'Further Investigation Required', N'Rejected', N'Reopened'));
IF COL_LENGTH('dbo.LegalVerificationReview', 'Risks') IS NULL
  ALTER TABLE dbo.LegalVerificationReview ADD Risks NVARCHAR(MAX) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerification_Status')
  ALTER TABLE dbo.LegalVerification DROP CONSTRAINT CK_LegalVerification_Status;
GO
ALTER TABLE dbo.LegalVerification ADD CONSTRAINT CK_LegalVerification_Status
  CHECK (Status IN (N'In Progress', N'Ready for Review', N'Returned', N'Verified', N'Rejected', N'On Hold', N'Closed'));
GO

-- ── 6. Mutation and conversion (post-registration) ──────────────────────────────────────────────
IF COL_LENGTH('dbo.LegalMutation', 'Kind') IS NULL
  ALTER TABLE dbo.LegalMutation ADD
    Kind NVARCHAR(20) NOT NULL CONSTRAINT DF_LegalMutation_Kind DEFAULT N'Mutation',
    ApplicantName NVARCHAR(200) NULL, AssignedUserId INT NULL, DueDate DATE NULL,
    Fee DECIMAL(18,2) NULL, PaymentRef NVARCHAR(100) NULL, PaymentDate DATE NULL,
    CurrentClass NVARCHAR(60) NULL, RequestedClass NVARCHAR(60) NULL, InspectionDate DATE NULL,
    CompletionDate DATE NULL, ReportFileId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalMutation_Kind')
  ALTER TABLE dbo.LegalMutation ADD CONSTRAINT CK_LegalMutation_Kind CHECK (Kind IN (N'Mutation', N'Conversion'));
GO
-- A conversion has no new owner.
ALTER TABLE dbo.LegalMutation ALTER COLUMN NewOwner NVARCHAR(300) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LegalMutation_Kind')
  CREATE INDEX IX_LegalMutation_Kind ON dbo.LegalMutation (LandId, Kind, IsActive);
GO
IF OBJECT_ID('dbo.LegalApplicationQuery', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LegalApplicationQuery (
    QueryId      INT IDENTITY(1,1) CONSTRAINT PK_LegalApplicationQuery PRIMARY KEY,
    LandId       INT NOT NULL,
    MutationId   INT NOT NULL CONSTRAINT FK_LegalApplicationQuery_Mutation REFERENCES dbo.LegalMutation (MutationId),
    QueryDate    DATE NOT NULL,
    QueryText    NVARCHAR(1000) NOT NULL,
    ResponseDate DATE NULL,
    ResponseText NVARCHAR(1000) NULL,
    FileId       INT NULL,
    IsActive     BIT NOT NULL CONSTRAINT DF_LegalApplicationQuery_IsActive DEFAULT 1,
    CreatedBy    INT NULL,
    CreatedAt    DATETIME2 NOT NULL CONSTRAINT DF_LegalApplicationQuery_At DEFAULT SYSUTCDATETIME(),
    UpdatedBy    INT NULL,
    UpdatedAt    DATETIME2 NULL
  );
  CREATE INDEX IX_LegalApplicationQuery_Mutation ON dbo.LegalApplicationQuery (MutationId);
END
GO
-- Configurable rules (Setup → Legal Rules; IsBlocking = enforced):
--   conversion_after_mutation  a conversion goes beyond "Applied" only after an approved mutation of the land
--   final_review_gate          Land Approval needs an approved Final Legal Review (or a recorded exception)
IF OBJECT_ID('dbo.LegalRuleConfig', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalRuleConfig WHERE RuleKey = N'conversion_after_mutation')
    INSERT INTO dbo.LegalRuleConfig (RuleKey, RuleName, RiskLevel, IsBlocking, Notes)
    VALUES (N'conversion_after_mutation', N'Conversion only after an approved mutation', N'Medium', 1, N'Post-registration: a conversion may go beyond Applied only after the land has an approved mutation.');
  IF NOT EXISTS (SELECT 1 FROM dbo.LegalRuleConfig WHERE RuleKey = N'final_review_gate')
    INSERT INTO dbo.LegalRuleConfig (RuleKey, RuleName, RiskLevel, IsBlocking, Notes)
    VALUES (N'final_review_gate', N'Land Approval needs an approved Final Legal Review', N'High', 1, N'Land Approval is refused until the Final Legal Review of the land''s enquiry is approved, unless an authorised exception is recorded.');
END
GO
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT p.k, p.l, N'Legal', N'Legal - Land', N'view,create,edit,delete,print,export', p.s, 1, N'migration-719', SYSDATETIME()
FROM (VALUES (N'legal-conversion-master', N'Land Conversion', 395), (N'legal-application-query-master', N'Application Queries', 396)) p(k, l, s)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions d WHERE d.PageKey = p.k);
GO

-- ── 7. Structured ownership events (Activity 8) ─────────────────────────────────────────────────
CREATE OR ALTER VIEW dbo.vw_LegalOwnershipEvent AS
SELECT x.EntryId, a.VerificationId, x.ActivityId,
       JSON_VALUE(x.DataJson, '$.fromOwner') AS PreviousOwner, JSON_VALUE(x.DataJson, '$.toOwner') AS NewOwner,
       JSON_VALUE(x.DataJson, '$.transferType') AS EventType,
       TRY_CAST(JSON_VALUE(x.DataJson, '$.transferDate') AS DATE) AS EventDate, TRY_CAST(JSON_VALUE(x.DataJson, '$.transferYear') AS INT) AS EventYear,
       JSON_VALUE(x.DataJson, '$.shareBefore') AS ShareBefore, JSON_VALUE(x.DataJson, '$.shareAfter') AS ShareAfter,
       TRY_CAST(JSON_VALUE(x.DataJson, '$.areaBefore') AS DECIMAL(18,4)) AS AreaBefore,
       TRY_CAST(JSON_VALUE(x.DataJson, '$.area') AS DECIMAL(18,4)) AS AreaTransferred,
       TRY_CAST(JSON_VALUE(x.DataJson, '$.areaRetained') AS DECIMAL(18,4)) AS AreaRetained,
       JSON_VALUE(x.DataJson, '$.dag') AS Dag, JSON_VALUE(x.DataJson, '$.khatian') AS Khatian,
       JSON_VALUE(x.DataJson, '$.deedNo') AS DeedNo, TRY_CAST(JSON_VALUE(x.DataJson, '$.fileId') AS INT) AS FileId,
       JSON_VALUE(x.DataJson, '$.verification') AS VerificationStatus, JSON_VALUE(x.DataJson, '$.remarks') AS Remarks
FROM dbo.LegalActivityEntry x
JOIN dbo.LegalVerificationActivity a ON a.ActivityId = x.ActivityId
JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
WHERE x.IsActive = 1 AND t.ActivityCode = N'OWNERSHIP-FLOW';
GO
