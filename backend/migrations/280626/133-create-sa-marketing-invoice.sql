-- 133-create-sa-marketing-invoice.sql
-- Sales Automation Phase 5: Marketing Expense & Invoice Management.
-- Tracks invoices from ad vendors linked to campaigns/ads.
-- Idempotent: guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaMarketingInvoice' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaMarketingInvoice (
    Id              INT            IDENTITY(1,1) PRIMARY KEY,
    InvoiceNumber   NVARCHAR(50)   NOT NULL CONSTRAINT UQ_SaMarketingInvoice_No UNIQUE,
    VendorName      NVARCHAR(200)  NULL,
    CampaignId      INT            NULL CONSTRAINT FK_SaMktInv_Campaign FOREIGN KEY REFERENCES dbo.SaCampaign(Id),
    AdId            INT            NULL CONSTRAINT FK_SaMktInv_Ad FOREIGN KEY REFERENCES dbo.SaAd(Id),
    InvoiceDate     DATE           NULL,
    Amount          DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaMktInv_Amount DEFAULT (0),
    GstAmount       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_SaMktInv_Gst DEFAULT (0),
    TotalAmount     AS (Amount + GstAmount) PERSISTED,
    DueDate         DATE           NULL,
    PaymentStatus   NVARCHAR(20)   NOT NULL CONSTRAINT DF_SaMktInv_PayStatus DEFAULT ('Pending'),
    Notes           NVARCHAR(MAX)  NULL,
    IsActive        BIT            NOT NULL CONSTRAINT DF_SaMktInv_IsActive DEFAULT (1),
    CreatedBy       INT            NULL,
    CreatedAt       DATETIME2(3)   NOT NULL CONSTRAINT DF_SaMktInv_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       INT            NULL,
    UpdatedAt       DATETIME2(3)   NULL
  );

  CREATE INDEX IX_SaMktInv_Campaign ON dbo.SaMarketingInvoice(CampaignId) INCLUDE (PaymentStatus, Amount);
  CREATE INDEX IX_SaMktInv_Status ON dbo.SaMarketingInvoice(PaymentStatus) INCLUDE (InvoiceNumber, DueDate, Amount);
END
GO

PRINT 'Migration 133: SaMarketingInvoice created';
GO
