-- CRM booking documents, agreement documents, and booking attachments were
-- being written to disk (backend/uploads/crm-booking-documents,
-- crm-agreement-documents, crm-booking-attachments). Same production
-- liability already fixed for invoice PDFs in 269-crm-invoice-pdf-base64.sql:
-- files don't survive a redeploy/new-instance unless the /uploads volume is
-- carried over, they're outside the transactional backup boundary, and two
-- app instances behind a load balancer wouldn't share the same disk.
--
-- All three tables have zero rows in production as of this migration, so
-- this is a clean additive change — no backfill needed. FilePath/StoredName
-- columns are kept (not dropped) for schema compat; the app just stops
-- writing new files to disk and reads/writes FileBase64 instead.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBookingDocument') AND name = 'FileBase64')
  ALTER TABLE dbo.CrmBookingDocument ADD FileBase64 NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'FileBase64')
  ALTER TABLE dbo.CrmAgreementDocument ADD FileBase64 NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBookingAttachment') AND name = 'FileBase64')
  ALTER TABLE dbo.CrmBookingAttachment ADD FileBase64 NVARCHAR(MAX) NULL;
GO
