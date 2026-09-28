-- Migration 494: adds the GST columns Inter-Company Transfer needs.
--
-- interCompanyTransfer.js already tries to add these itself at server
-- startup (ensureIctGstColumns, a setImmediate best-effort ALTER) because
-- this schema change shipped without a tracked migration. That runtime
-- ALTER only succeeds if the app's own DB login has DDL rights — on any
-- environment where it doesn't (the app login is usually DML-only), it
-- fails silently (caught + console.warn'd, invisible to users) and every
-- GET /api/inter-company-transfer/:id then 500s referencing the missing
-- GstPct/GstAmount/AmountInclGst/TotalGstAmount/TotalAmountInclGst columns
-- — surfacing in the UI as "Could not load transfer details" in the Stock
-- Transfer view modal and "Couldn't load the full record" in the Approval
-- Inbox review panel. Running this via migrate.js (an admin/DBA login)
-- applies it regardless of the app login's own permissions.
--
-- IF NOT EXISTS guards make this safe to run even where the runtime ALTER
-- already succeeded.

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'InterCompanyTransferItems' AND COLUMN_NAME = 'GstPct')
  ALTER TABLE dbo.InterCompanyTransferItems ADD GstPct DECIMAL(5,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'InterCompanyTransferItems' AND COLUMN_NAME = 'GstAmount')
  ALTER TABLE dbo.InterCompanyTransferItems ADD GstAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'InterCompanyTransferItems' AND COLUMN_NAME = 'AmountInclGst')
  ALTER TABLE dbo.InterCompanyTransferItems ADD AmountInclGst DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'InterCompanyTransfer' AND COLUMN_NAME = 'TotalGstAmount')
  ALTER TABLE dbo.InterCompanyTransfer ADD TotalGstAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'InterCompanyTransfer' AND COLUMN_NAME = 'TotalAmountInclGst')
  ALTER TABLE dbo.InterCompanyTransfer ADD TotalAmountInclGst DECIMAL(18,2) NULL;
GO
