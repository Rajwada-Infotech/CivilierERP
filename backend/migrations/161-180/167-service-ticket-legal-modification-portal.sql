-- ============================================================
-- Migration 167: Legal/Modification ticket categories + customer-raised
-- tickets, synced into the same CrmServiceTicket module (no separate
-- Legal/Modification tables — they stay inside the one ticket system so
-- staff work from a single queue).
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmServiceTicket') AND name = 'RaisedByCustomer')
BEGIN
  ALTER TABLE dbo.CrmServiceTicket ADD RaisedByCustomer BIT NOT NULL DEFAULT 0;
END
GO

PRINT 'Migration 167 complete — Legal/Modification categories + customer-raised ticket tracking';
