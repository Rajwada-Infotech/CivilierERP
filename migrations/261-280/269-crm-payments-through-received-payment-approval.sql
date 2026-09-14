-- Every CRM payment (Application token capture, Booking's Record Payment,
-- and every later milestone payment) now submits into Finance's existing
-- Received Payment approval queue instead of posting to CrmPaymentReceipt
-- directly — Account's Head (or admin/super_admin/dba) must approve before
-- the money is reflected as Paid anywhere in CRM. These link columns tie a
-- ReceivedPayment row back to the exact milestone/booking/application it
-- came from, mirroring the existing ContractId/SourceSaleInvoiceId source
-- pattern already on this table.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'CrmMilestoneId')
  ALTER TABLE dbo.ReceivedPayment ADD CrmMilestoneId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'CrmBookingId')
  ALTER TABLE dbo.ReceivedPayment ADD CrmBookingId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'CrmApplicationId')
  ALTER TABLE dbo.ReceivedPayment ADD CrmApplicationId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'IX_ReceivedPayment_CrmMilestoneId')
  CREATE INDEX IX_ReceivedPayment_CrmMilestoneId ON dbo.ReceivedPayment(CrmMilestoneId) WHERE CrmMilestoneId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'IX_ReceivedPayment_CrmBookingId')
  CREATE INDEX IX_ReceivedPayment_CrmBookingId ON dbo.ReceivedPayment(CrmBookingId) WHERE CrmBookingId IS NOT NULL;
GO

-- Back-reference from the real CRM receipt/on-account row to the
-- ReceivedPayment row whose approval created it — traceability, and the
-- unique index makes approval idempotent (the same ReceivedPayment can never
-- produce two receipts even if an approval retries).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'SourceReceivedPaymentId')
  ALTER TABLE dbo.CrmPaymentReceipt ADD SourceReceivedPaymentId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'UQ_CrmPaymentReceipt_SourceRP')
  CREATE UNIQUE INDEX UQ_CrmPaymentReceipt_SourceRP ON dbo.CrmPaymentReceipt(SourceReceivedPaymentId) WHERE SourceReceivedPaymentId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmOnAccountPayment') AND name = 'SourceReceivedPaymentId')
  ALTER TABLE dbo.CrmOnAccountPayment ADD SourceReceivedPaymentId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmOnAccountPayment') AND name = 'UQ_CrmOnAccountPayment_SourceRP')
  CREATE UNIQUE INDEX UQ_CrmOnAccountPayment_SourceRP ON dbo.CrmOnAccountPayment(SourceReceivedPaymentId) WHERE SourceReceivedPaymentId IS NOT NULL;
GO
