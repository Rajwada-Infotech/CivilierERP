-- Migration 388: Mutation rebuild support.
-- The Mutation tracker (dbo.CrmMutation) previously only recorded a binary
-- Applied -> Approved with no way to reflect the real municipal process: the
-- authority can raise a query/objection requiring resubmission (the exact
-- same "reject -> reprepare -> resubmit" loop already built for Sale Deed),
-- there was nowhere to record the actual outcome (new Khata No, old Khata
-- No for reference, mutation fee paid), and no supporting documents or
-- audit trail.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmMutation') AND name = 'OldKhataNo')
BEGIN
  ALTER TABLE dbo.CrmMutation ADD
    OldKhataNo       NVARCHAR(100) NULL,
    NewKhataNo       NVARCHAR(100) NULL,
    MutationFee      DECIMAL(18,2) NULL,
    QueryRemarks     NVARCHAR(MAX) NULL,   -- set when Status = 'QueryRaised'
    QueryRaisedAt    DATETIME2(3) NULL;
  PRINT 'Added Khata/fee/query columns to dbo.CrmMutation';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmMutationDocument' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmMutationDocument (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    MutationId      INT           NOT NULL REFERENCES dbo.CrmMutation(Id),
    DocumentType    NVARCHAR(50)  NOT NULL,
    Label           NVARCHAR(255) NULL,
    IsMandatory     BIT           NOT NULL DEFAULT 0,
    -- Requested | Uploaded | Verified | Rejected
    Status          NVARCHAR(30)  NOT NULL DEFAULT 'Requested',
    FileName        NVARCHAR(255) NULL,
    MimeType        NVARCHAR(100) NULL,
    FileSize        INT           NULL,
    FileBase64      NVARCHAR(MAX) NULL,
    UploadedByType  NVARCHAR(20)  NULL,
    UploadedAt      DATETIME2(3)  NULL,
    RequestedBy     INT           NULL,
    RequestedAt     DATETIME2(3)  NULL,
    Remarks         NVARCHAR(MAX) NULL,
    CreatedBy       INT           NULL,
    CreatedAt       DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2(3)  NULL
  );
  CREATE INDEX IX_CrmMutationDocument_MutationId ON dbo.CrmMutationDocument(MutationId);
  PRINT 'Created dbo.CrmMutationDocument';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmMutationLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmMutationLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    MutationId  INT           NOT NULL REFERENCES dbo.CrmMutation(Id),
    Action      NVARCHAR(40)  NOT NULL,
    Remarks     NVARCHAR(MAX) NULL,
    ActorType   NVARCHAR(20)  NOT NULL DEFAULT 'Staff',
    ActorId     INT           NULL,
    CreatedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmMutationLog_MutationId ON dbo.CrmMutationLog(MutationId);
  PRINT 'Created dbo.CrmMutationLog';
END
GO

PRINT 'Migration 388 complete — Mutation rebuild support';
GO
