-- Migration 382: CrmSalesDeedDocument — file attachment tracking for Sale Deeds.
-- Mirrors CrmAgreementDocument exactly so the same upload/download/document-
-- progress patterns apply. One deed can have multiple documents:
--   DeedDraft   — the draft prepared by the lawyer (MANDATORY — blocks Senior Approval)
--   ExecutedDeed — the signed deed scan received post-SRO registration
--   Other       — any addendum, power-of-attorney, KYC proof etc.
-- FileBase64 stores the file content as a Base64 string (same as AgreementDocument).
-- IsMandatory=1 rows must all have FileBase64 before Senior Approval can proceed.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmSalesDeedDocument' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmSalesDeedDocument (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    SalesDeedId     INT              NOT NULL REFERENCES dbo.CrmSalesDeed(Id) ON DELETE CASCADE,
    -- 'DeedDraft' | 'ExecutedDeed' | 'Other'
    DocumentType    NVARCHAR(50)     NOT NULL DEFAULT 'DeedDraft',
    Label           NVARCHAR(200)    NULL,
    -- IsMandatory = 1 blocks Senior Approval until FileBase64 is uploaded
    IsMandatory     BIT              NOT NULL DEFAULT 0,
    -- 'Requested' → 'Uploaded' → 'Verified'
    Status          NVARCHAR(30)     NOT NULL DEFAULT 'Requested',
    FileName        NVARCHAR(255)    NULL,
    MimeType        NVARCHAR(100)    NULL,
    FileSize        INT              NULL,
    FileBase64      NVARCHAR(MAX)    NULL,
    -- 'Staff' or 'Customer' (for audit — portal upload would be 'Customer')
    UploadedByType  NVARCHAR(20)     NULL,
    RequestedBy     INT              NULL,
    RequestedAt     DATETIME2(3)     NULL,
    UploadedAt      DATETIME2(3)     NULL,
    Remarks         NVARCHAR(MAX)    NULL,
    VersionNo       INT              NOT NULL DEFAULT 1,
    CreatedBy       INT              NULL,
    CreatedAt       DATETIME2(3)     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT              NULL,
    UpdatedAt       DATETIME2(3)     NULL
  );
  CREATE INDEX IX_CrmSalesDeedDocument_DeedId ON dbo.CrmSalesDeedDocument(SalesDeedId);
  PRINT 'Created dbo.CrmSalesDeedDocument';
END
GO

PRINT 'Migration 382 complete — CrmSalesDeedDocument';
GO
