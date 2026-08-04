-- Invoice PDFs were being written to disk (backend/uploads/crm-invoices/*.pdf)
-- and re-derived from InvoiceNo on every read. That's a production liability:
-- the files don't survive a redeploy/new-instance unless the /uploads volume
-- is carried over, they're not in the transactional backup boundary the DB
-- row already gets, and two app instances behind a load balancer wouldn't
-- share the same disk. The PDF is now generated once at invoice-creation
-- time and stored as base64 directly on the CrmInvoice row, so the row IS
-- the invoice — no separate file artifact to lose, sync, or garbage-collect.
--
-- Renumber this file if 269 has already been taken by another migration
-- landed after 268-crm-invoice-milestone-link.sql — this was generated
-- without visibility into the full migrations folder.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'PdfBase64')
  ALTER TABLE dbo.CrmInvoice ADD PdfBase64 NVARCHAR(MAX) NULL;
GO

-- Records when the stored PDF was (re)generated, so a future "regenerate
-- if stale" check (e.g. after a template redesign) has something to key off.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'PdfGeneratedAt')
  ALTER TABLE dbo.CrmInvoice ADD PdfGeneratedAt DATETIME2 NULL;
GO