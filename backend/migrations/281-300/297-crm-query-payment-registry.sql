-- Migration 297: Query Payment + Registry — the two post-agreement CRM
-- stages between Sales Deed and full registration.
--
-- Query Payment: the customer remits stamp duty + registration fee DIRECTLY
-- to the government (Sub-Registrar Office), not to the company — this is
-- deliberately NOT modeled as a CrmPaymentMilestone/ReceivedPayment (the
-- company never receives this money). It IS tracked as a real pipeline
-- stage: staff sends the customer the required amount + paperwork
-- (Attachments, DocType='Info'), then staff confirms once the customer has
-- actually paid the government (ConfirmedAmount/ConfirmedAt), optionally
-- attaching the customer's payment proof (Attachments, DocType='Proof').
-- Amount shown to the customer is read live from CrmSalesDeed.StampDuty +
-- RegistrationFee — never duplicated here.
--
-- Registry: a lightweight, separate tracker (per explicit instruction, not
-- just gating Sales Deed's own RegistrationNo field) for the act of
-- registering the deed at the Sub-Registrar Office. Gated on Query Payment
-- being Confirmed. Once Registry reaches Completed, THAT is what unlocks
-- CrmSalesDeed.RegistrationNo being settable (see crmSalesDeed.js PUT /:id)
-- — the actual registration details (RegistrationNo/Date/BookNo/PartNo/
-- SubRegistrarOffice) stay on CrmSalesDeed exactly as they already were;
-- Registry only tracks the workflow gate/checkpoint, not duplicate data.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmQueryPayment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmQueryPayment (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    QPNo             NVARCHAR(30)   NULL,
    BookingId        INT            NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    SalesDeedId      INT            NULL REFERENCES dbo.CrmSalesDeed(Id),
    -- 'Pending' -> 'InfoSent' -> 'Confirmed'
    Status           NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
    InfoSentAt       DATETIME2(3)   NULL,
    InfoSentBy       INT            NULL,
    ConfirmedAt      DATETIME2(3)   NULL,
    ConfirmedBy      INT            NULL,
    ConfirmedAmount  DECIMAL(18,2)  NULL,
    Remarks          NVARCHAR(MAX)  NULL,
    CreatedBy        INT            NULL,
    CreatedAt        DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy        INT            NULL,
    UpdatedAt        DATETIME2(3)   NULL
  );
  PRINT 'Created dbo.CrmQueryPayment';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmQueryPaymentAttachments' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmQueryPaymentAttachments (
    AttachmentId     INT IDENTITY(1,1) PRIMARY KEY,
    QueryPaymentId   INT            NOT NULL REFERENCES dbo.CrmQueryPayment(Id) ON DELETE CASCADE,
    -- 'Info' (staff -> customer paperwork/instructions) or 'Proof' (customer's payment receipt)
    DocType          NVARCHAR(20)   NOT NULL DEFAULT 'Info',
    FileName         NVARCHAR(255)  NOT NULL,
    MimeType         NVARCHAR(100)  NOT NULL,
    FileSize         INT            NOT NULL,
    FileData         VARBINARY(MAX) NOT NULL,
    UploadedBy       INT            NULL,
    UploadedAt       DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_CrmQueryPaymentAttachments_QPId ON dbo.CrmQueryPaymentAttachments(QueryPaymentId);
  PRINT 'Created dbo.CrmQueryPaymentAttachments';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmRegistry' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmRegistry (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    RegNo          NVARCHAR(30)   NULL,
    BookingId      INT            NOT NULL UNIQUE REFERENCES dbo.CrmBooking(Id),
    SalesDeedId    INT            NULL REFERENCES dbo.CrmSalesDeed(Id),
    -- 'Pending' -> 'Scheduled' -> 'Completed'
    Status         NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
    ScheduledDate  DATE           NULL,
    CompletedDate  DATE           NULL,
    Remarks        NVARCHAR(MAX)  NULL,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2(3)   NULL
  );
  PRINT 'Created dbo.CrmRegistry';
END
GO
