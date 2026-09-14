-- Migration 370: Owner & Quality Checking page for the Fixed Asset module.
--
-- Tracks, per FA Item Code, the current owner/user, the asset's condition
-- (Quality Status), and a scheduled follow-up. Each saved record is one
-- quality check + its follow-up; the full per-asset history is every
-- non-deleted row for that AssetId. Pending follow-ups drive reminders in
-- dbo.SaNotification via services/fixedAssetFollowupReminders.js — the
-- FixedAssetFollowUpReminderLog table is the once-per-day de-dup guard.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FixedAssetQualityCheck' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FixedAssetQualityCheck (
    QualityCheckId    INT IDENTITY(1,1) PRIMARY KEY,
    DocNo             NVARCHAR(100) NULL,
    DocDate           DATE          NULL,
    CompanyId         INT           NULL,
    ProjectId         INT           NULL,
    -- FA Item Code link (every record is tied to one Fixed Asset Record)
    AssetId           INT           NOT NULL,
    FAItemCode        NVARCHAR(200) NULL,   -- snapshot at check time
    ItemName          NVARCHAR(200) NULL,   -- snapshot at check time
    -- owner snapshot (resolved from the latest Assignment when the check is made)
    CurrentUserId     INT           NULL,
    UserPhoto         NVARCHAR(MAX) NULL,   -- snapshot of the assignment photo
    -- condition
    QualityStatus     NVARCHAR(20)  NOT NULL,
    Remarks           NVARCHAR(MAX) NULL,
    -- follow-up / next update
    NextFollowUpDate  DATE          NOT NULL,
    FollowUpType      NVARCHAR(50)  NULL,
    FollowUpRemarks   NVARCHAR(MAX) NULL,
    ResponsibleUserId INT           NULL,
    FollowUpStatus    NVARCHAR(20)  NOT NULL CONSTRAINT DF_FAQC_FollowUpStatus DEFAULT 'Pending',
    LastFollowUpDate  DATE          NULL,
    NextActionNotes   NVARCHAR(MAX) NULL,
    CompletedBy       NVARCHAR(200) NULL,
    CompletedAt       DATETIME2     NULL,
    -- audit
    Status            NVARCHAR(20)  NOT NULL CONSTRAINT DF_FAQC_Status DEFAULT 'Active',
    CreatedBy         NVARCHAR(200) NULL,
    CreatedAt         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(200) NULL,
    UpdatedAt         DATETIME2     NULL,
    CONSTRAINT FK_FAQC_Asset       FOREIGN KEY (AssetId)           REFERENCES dbo.FixedAssetRecord(AssetId),
    CONSTRAINT FK_FAQC_CurrentUser FOREIGN KEY (CurrentUserId)     REFERENCES dbo.users(id),
    CONSTRAINT FK_FAQC_RespUser    FOREIGN KEY (ResponsibleUserId) REFERENCES dbo.users(id),
    CONSTRAINT CK_FAQC_Quality     CHECK (QualityStatus  IN ('Good','Average','Defective','Repairing')),
    CONSTRAINT CK_FAQC_FUStatus    CHECK (FollowUpStatus IN ('Pending','Completed','Cancelled')),
    CONSTRAINT CK_FAQC_Status      CHECK (Status IN ('Active','Deleted'))
  );
  PRINT 'Created dbo.FixedAssetQualityCheck';
END
ELSE
  PRINT 'dbo.FixedAssetQualityCheck already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAQC_AssetId' AND object_id = OBJECT_ID('dbo.FixedAssetQualityCheck'))
  CREATE INDEX IX_FAQC_AssetId ON dbo.FixedAssetQualityCheck(AssetId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAQC_FollowUp' AND object_id = OBJECT_ID('dbo.FixedAssetQualityCheck'))
  CREATE INDEX IX_FAQC_FollowUp ON dbo.FixedAssetQualityCheck(FollowUpStatus, NextFollowUpDate) WHERE Status <> 'Deleted';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FixedAssetFollowUpReminderLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FixedAssetFollowUpReminderLog (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    QualityCheckId INT           NOT NULL,
    Kind           NVARCHAR(20)  NOT NULL,   -- 'due' | 'overdue'
    NotifiedUserId INT           NULL,
    SentAt         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_FAFURL_QC FOREIGN KEY (QualityCheckId) REFERENCES dbo.FixedAssetQualityCheck(QualityCheckId)
  );
  PRINT 'Created dbo.FixedAssetFollowUpReminderLog';
END
ELSE
  PRINT 'dbo.FixedAssetFollowUpReminderLog already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAFURL_QC_Sent' AND object_id = OBJECT_ID('dbo.FixedAssetFollowUpReminderLog'))
  CREATE INDEX IX_FAFURL_QC_Sent ON dbo.FixedAssetFollowUpReminderLog(QualityCheckId, SentAt);
GO

-- ── TypeOfDoc — FAQ prefix ──────────────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FAQ')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FAQ', 'FAQ', 'Fixed Asset Quality Check', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FAQ';
END
ELSE
  PRINT 'TypeOfDoc FAQ already exists';
GO

-- ── PageDefinitions — fixed-asset-quality-check ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-quality-check' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-quality-check', 'Owner & Quality Checking', 'Fixed Asset', 'Fixed Asset', 'view,create,edit,delete', 237, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-quality-check';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-quality-check already exists';
GO

PRINT '370-fixed-asset-quality-check applied successfully.';
GO
