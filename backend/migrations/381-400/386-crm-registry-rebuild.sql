-- Migration 386: Registry rebuild support.
-- The Registry tracker (dbo.CrmRegistry) previously only recorded
-- Pending -> Scheduled -> Completed with a single date each — nowhere to
-- capture the actual registration particulars (RegistrationNo/Book/Part/
-- Sub-Registrar Office), no way to record a postponed appointment without
-- losing the original schedule, no cancellation, and no supporting
-- documents (registration receipt/challan, stamped deed copy) or audit
-- trail. This migration adds what the rebuilt page and API need.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmRegistry') AND name = 'RegistrationNo')
BEGIN
  ALTER TABLE dbo.CrmRegistry ADD
    RegistrationNo      NVARCHAR(100) NULL,
    BookNo               NVARCHAR(100) NULL,
    PartNo               NVARCHAR(100) NULL,
    SubRegistrarOffice   NVARCHAR(255) NULL,
    RegistrationDate     DATE NULL,
    -- How many times the appointment has been pushed — surfaced in the UI
    -- so a repeatedly-postponed registration is visible at a glance.
    RescheduleCount      INT NOT NULL DEFAULT 0,
    CancelledReason      NVARCHAR(MAX) NULL,
    CancelledAt          DATETIME2(3) NULL,
    CancelledBy          INT NULL;
  PRINT 'Added registration-detail columns to dbo.CrmRegistry';
END
GO

-- Supporting documents (registration receipt/challan, stamped deed copy).
-- Mirrors dbo.CrmSalesDeedDocument in shape and IsMandatory semantics.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmRegistryDocument' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmRegistryDocument (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    RegistryId      INT           NOT NULL REFERENCES dbo.CrmRegistry(Id),
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
  CREATE INDEX IX_CrmRegistryDocument_RegistryId ON dbo.CrmRegistryDocument(RegistryId);
  PRINT 'Created dbo.CrmRegistryDocument';
END
GO

-- Audit trail — Started | Scheduled | Rescheduled | Completed | Cancelled.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmRegistryLog' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmRegistryLog (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    RegistryId  INT           NOT NULL REFERENCES dbo.CrmRegistry(Id),
    Action      NVARCHAR(40)  NOT NULL,
    Remarks     NVARCHAR(MAX) NULL,
    ActorType   NVARCHAR(20)  NOT NULL DEFAULT 'Staff',
    ActorId     INT           NULL,
    CreatedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmRegistryLog_RegistryId ON dbo.CrmRegistryLog(RegistryId);
  PRINT 'Created dbo.CrmRegistryLog';
END
GO

PRINT 'Migration 386 complete — Registry rebuild support';
GO
