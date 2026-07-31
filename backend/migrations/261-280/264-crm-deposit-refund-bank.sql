-- Migration 264: Company deposit/refund bank tracking
-- The Application's Payment Details step needs to capture which real company
-- bank account the token payment lands in (the auto-synced Milestone #1
-- receipt has had no way to record this at all — it only ever captured the
-- CUSTOMER's own bank via CrmCustomerBankDetail, never the company side).
-- Cancellation/refund needs the mirror image: which company bank account the
-- refund goes out of, defaulting to (but editable away from) wherever the
-- money actually came in.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'DepositBankId')
BEGIN
  ALTER TABLE dbo.CrmApplication ADD DepositBankId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Added CrmApplication.DepositBankId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCancellation') AND name = 'RefundBankId')
BEGIN
  ALTER TABLE dbo.CrmCancellation ADD RefundBankId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Added CrmCancellation.RefundBankId';
END
GO
