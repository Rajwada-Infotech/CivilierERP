-- Migration 357: GST split columns on payment receipt tables (B1)
--
-- Adds BaseAmount / GSTAmount to CrmPaymentReceipt and CrmMoneyReceipt so
-- Finance can reconcile output-tax liability per receipt.  The GST share is
-- computed at INSERT time from CrmBooking.TotalGstAmount / GrandTotal (the
-- effective weighted rate across unit/parking 1-or-5% and extra-charges 18%).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'GSTAmount'
)
  ALTER TABLE dbo.CrmPaymentReceipt ADD GSTAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'BaseAmount'
)
  ALTER TABLE dbo.CrmPaymentReceipt ADD BaseAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmMoneyReceipt') AND name = 'GSTAmount'
)
  ALTER TABLE dbo.CrmMoneyReceipt ADD GSTAmount DECIMAL(18,2) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmMoneyReceipt') AND name = 'BaseAmount'
)
  ALTER TABLE dbo.CrmMoneyReceipt ADD BaseAmount DECIMAL(18,2) NULL;
GO

PRINT 'Migration 357 complete — GSTAmount / BaseAmount on CrmPaymentReceipt and CrmMoneyReceipt';
