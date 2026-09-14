-- The milestone payment UI (CrmPaymentMilestones.tsx PUT /:id) records
-- payments directly against the milestone row, not via a CrmPaymentReceipt
-- (that's the separate POST /:id/receipts path, which already got
-- DepositBankId/DepositBankName in migration 221). Mirror the same two
-- columns onto CrmPaymentMilestone itself so staff can record which Company
-- Bank a non-cash milestone payment landed in, shown alongside the
-- customer's own on-file bank (CrmCustomerBankDetail) for reference.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DepositBankId')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DepositBankId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentMilestone') AND name = 'DepositBankName')
  ALTER TABLE dbo.CrmPaymentMilestone ADD DepositBankName NVARCHAR(200) NULL;
GO
