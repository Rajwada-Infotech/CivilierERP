-- ============================================================
-- Migration 185: Booking Invoice + Attachments
-- Backs the new Booking page's Invoice and Attachments tabs.
--
-- CrmInvoice is deliberately its OWN table, numbered through the same
-- shared dbo.CrmDocNumberSequence service every other CRM document uses
-- (Application/Booking/Agreement/Ticket/...) — NOT the ERP-wide
-- dbo.SaleInvoices table, which requires a mandatory SaleOrderID tied to
-- dbo.CustomerSaleOrders (the Materials/Sales module's own domain). A CRM
-- booking has no sale order and forcing one into existence just to satisfy
-- that FK would be a fake record, not a real integration. This is the
-- correct-fit reuse: same numbering infrastructure, its own table.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmInvoice' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmInvoice (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    InvoiceNo    NVARCHAR(30)  NOT NULL UNIQUE,
    BookingId    INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    -- What this invoice is for — Booking-stage token/down-payment today;
    -- Agreement and Possession invoices (per the workflow spec's later
    -- steps) can reuse this same table/type column when those are built,
    -- without a schema change.
    InvoiceType  NVARCHAR(30)  NOT NULL DEFAULT 'Booking',
    Amount       DECIMAL(18,2) NOT NULL,
    InvoiceDate  DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    Description  NVARCHAR(500) NULL,
    Status       NVARCHAR(20)  NOT NULL DEFAULT 'Generated',
    CreatedBy    INT           NULL,
    CreatedAt    DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmInvoice';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBookingAttachment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBookingAttachment (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    BookingId    INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    Label        NVARCHAR(200) NULL,
    FileName     NVARCHAR(300) NOT NULL,
    StoredName   NVARCHAR(300) NOT NULL,
    FileSize     INT           NULL,
    MimeType     NVARCHAR(150) NULL,
    UploadedBy   INT           NULL,
    UploadedAt   DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmBookingAttachment';
END
GO
