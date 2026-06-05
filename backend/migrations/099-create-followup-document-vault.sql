-- Migration 099: Create dbo.FollowupDocumentVault
-- Documents are linked to FollowupApplications (not AccountHeadMaster).
-- ApplicantId here is a FK to dbo.FollowupApplications.Id.

IF OBJECT_ID('dbo.FollowupDocumentVault', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupDocumentVault (
    Id          INT           IDENTITY(1,1) PRIMARY KEY,
    DocNo       NVARCHAR(50)  NULL,                         -- auto: DV000001
    ApplicantId INT           NOT NULL,                     -- FK → FollowupApplications.Id
    Category    NVARCHAR(100) NOT NULL
      CONSTRAINT DF_FDV_Category  DEFAULT 'Other',
    DocName     NVARCHAR(255) NULL,
    FileName    NVARCHAR(255) NULL,
    FilePath    NVARCHAR(500) NULL,
    FileSize    BIGINT        NULL,
    MimeType    NVARCHAR(100) NULL,
    Notes       NVARCHAR(MAX) NULL,
    Tags        NVARCHAR(500) NULL,
    CreatedBy   NVARCHAR(100) NULL,
    CreatedAt   DATETIME2     NOT NULL
      CONSTRAINT DF_FDV_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy   NVARCHAR(100) NULL,
    UpdatedAt   DATETIME2     NULL,
    IsDeleted   BIT           NOT NULL
      CONSTRAINT DF_FDV_IsDeleted DEFAULT 0
  );

  ALTER TABLE dbo.FollowupDocumentVault
    ADD CONSTRAINT FK_FDV_ApplicantId
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplications(Id);

  CREATE INDEX IX_FDV_ApplicantId ON dbo.FollowupDocumentVault(ApplicantId);
  CREATE INDEX IX_FDV_Category    ON dbo.FollowupDocumentVault(Category);
  CREATE INDEX IX_FDV_IsDeleted   ON dbo.FollowupDocumentVault(IsDeleted);

  PRINT 'Created dbo.FollowupDocumentVault';
END
ELSE
  PRINT 'dbo.FollowupDocumentVault already exists — skipping';
