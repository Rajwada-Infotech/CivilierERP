-- Migration 625: one live Final invoice per booking, enforced by the database.
--
-- The Final invoice route checks for an existing one and then inserts, and already turns a duplicate-key error into
-- "already has its final invoice", but no index ever backed that up. Two requests close together could both pass the
-- check and book the income and GST twice. A voided Final invoice can still be re-issued.
--
-- Additive and safe to run again. If a booking already has two live Final invoices the index is not created: it says
-- so, and those need voiding first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmInvoice_OneFinal' AND object_id = OBJECT_ID('dbo.CrmInvoice'))
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.CrmInvoice WHERE InvoiceType = 'Final' AND Status <> 'Void' GROUP BY BookingId HAVING COUNT(*) > 1)
    PRINT 'Migration 625: a booking has more than one live Final invoice. Void the extra one, then run this again.';
  ELSE
    EXEC('CREATE UNIQUE INDEX UQ_CrmInvoice_OneFinal ON dbo.CrmInvoice (BookingId) WHERE InvoiceType = ''Final'' AND Status <> ''Void''');
END
GO
