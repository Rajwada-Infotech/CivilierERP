-- ============================================================
-- Migration 420: Invoice / Non-Invoice mode on Customer records
--
-- New per-customer choice: Invoice (a Sale/Tax invoice may be generated for
-- them) or Non-Invoice (default — no invoice is ever generated for this
-- customer, from any module). Added to BOTH customer identity tables in
-- this codebase, since they are two separate, unlinked systems with their
-- own independent invoicing pipelines:
--   dbo.CrmCustomer        -> gates CrmInvoice generation from CRM bookings
--                             (crmBookings.js POST /:id/invoices,
--                             generateMilestoneInvoiceForBooking, bulk-generate)
--   dbo.AccountHeadMaster  -> gates the standalone Accounts Sale Invoice
--                             module (saleInvoices.js POST /), scoped to
--                             LHeadType='A' (Customer) rows only
-- Default 'NonInvoice' on both, per product requirement — an existing
-- customer/ledger row with no prior invoicing behavior stays exactly as
-- conservative as before (no invoice) unless someone explicitly opts them in.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomer') AND name = 'InvoiceMode')
BEGIN
  ALTER TABLE dbo.CrmCustomer ADD InvoiceMode NVARCHAR(20) NOT NULL
    CONSTRAINT DF_CrmCustomer_InvoiceMode DEFAULT ('NonInvoice')
    CONSTRAINT CK_CrmCustomer_InvoiceMode CHECK (InvoiceMode IN ('Invoice', 'NonInvoice'));
  PRINT 'Added CrmCustomer.InvoiceMode';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'InvoiceMode')
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD InvoiceMode NVARCHAR(20) NOT NULL
    CONSTRAINT DF_AccountHeadMaster_InvoiceMode DEFAULT ('NonInvoice')
    CONSTRAINT CK_AccountHeadMaster_InvoiceMode CHECK (InvoiceMode IN ('Invoice', 'NonInvoice'));
  PRINT 'Added AccountHeadMaster.InvoiceMode';
END
GO
