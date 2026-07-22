-- Every real payment receipt now auto-generates its own matching invoice
-- (see crmPayments.js createReceiptForMilestone) instead of invoices only
-- existing for the Agreement/Possession auto-triggers or a manual click.
-- ReceiptId ties each invoice back to the exact receipt that earned it —
-- both for traceability and so the trigger is idempotent (a receipt can
-- never end up with two invoices even if something retries).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'ReceiptId')
  ALTER TABLE dbo.CrmInvoice ADD ReceiptId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmInvoice') AND name = 'UQ_CrmInvoice_ReceiptId')
  CREATE UNIQUE INDEX UQ_CrmInvoice_ReceiptId ON dbo.CrmInvoice(ReceiptId) WHERE ReceiptId IS NOT NULL;
GO
