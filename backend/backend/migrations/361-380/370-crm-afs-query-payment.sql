-- Migration 370: CrmAfsQueryPayment + CrmAfsQueryPaymentAttachments tables
-- + page definition for crm-afs-query-payment.
--
-- The AFS Query Payment is a distinct tracking event separate from the Sale
-- Deed Query Payment (CrmQueryPayment). It covers:
--   Sub-Registrar Visit 1: stamp duty + registration fee paid by the customer
--   when the Agreement for Sale (AFS) is physically registered.
-- CrmQueryPayment covers Visit 2 (Sale Deed), which happens after handover.
-- Keeping them separate lets the system show the correct net payable at
-- Visit 2 (gross minus the AFS credit already paid at Visit 1).

-- ── Table ────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmAfsQueryPayment') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmAfsQueryPayment (
    Id              INT           IDENTITY(1,1) PRIMARY KEY,
    AfsQPNo         NVARCHAR(30)  NOT NULL,
    BookingId       INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    AgreementId     INT           NULL     REFERENCES dbo.CrmAgreement(Id),
    StampDuty       DECIMAL(18,2) NULL,
    RegistrationFee DECIMAL(18,2) NULL,
    Status          NVARCHAR(20)  NOT NULL DEFAULT 'Pending',
    InfoSentAt      DATETIME2     NULL,
    InfoSentBy      INT           NULL,
    ConfirmedAt     DATETIME2     NULL,
    ConfirmedBy     INT           NULL,
    ConfirmedAmount DECIMAL(18,2) NULL,
    Remarks         NVARCHAR(MAX) NULL,
    CreatedBy       INT           NOT NULL,
    CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy       INT           NULL,
    UpdatedAt       DATETIME2     NULL,
    CONSTRAINT UQ_CrmAfsQueryPayment_BookingId UNIQUE (BookingId)
  );
  PRINT 'Created CrmAfsQueryPayment';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CrmAfsQueryPaymentAttachments') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.CrmAfsQueryPaymentAttachments (
    AttachmentId      INT            IDENTITY(1,1) PRIMARY KEY,
    AfsQueryPaymentId INT            NOT NULL REFERENCES dbo.CrmAfsQueryPayment(Id),
    DocType           NVARCHAR(20)   NOT NULL,
    FileName          NVARCHAR(255)  NOT NULL,
    MimeType          NVARCHAR(100)  NULL,
    FileSize          INT            NULL,
    FileData          VARBINARY(MAX) NOT NULL,
    UploadedBy        INT            NULL,
    UploadedAt        DATETIME2      NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created CrmAfsQueryPaymentAttachments';
END
GO

-- ── Page definition ──────────────────────────────────────────────────────────
MERGE dbo.PageDefinitions AS tgt
USING (VALUES
  ('crm-afs-query-payment', 'AFS Query Payment (Stamp Duty / Registration)', 'CRM', 'CRM Legal', 'view,create,edit', 906, 1, 'migration-370')
) AS src (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy)
ON tgt.PageKey = src.PageKey
WHEN NOT MATCHED THEN
  INSERT (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (src.PageKey, src.Label, src.Module, src.GroupName, src.Actions, src.SortOrder, src.IsActive, src.CreatedBy, SYSDATETIME());
GO

SELECT PageKey, Label, Module, GroupName FROM dbo.PageDefinitions WHERE PageKey = 'crm-afs-query-payment';
GO
