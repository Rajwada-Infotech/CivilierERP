-- CrmPaymentReceipt had no concept of which bank account a non-cash payment
-- was deposited into (unlike dbo.ReceivedPayment's RPDepositBankId/
-- RPDepositBankName), which meant CRM receipts could never be reconciled
-- against a bank statement in BRS. Mirrors ReceivedPayment's pattern: a
-- real FK id when the depositing bank is known, a freetext name fallback
-- otherwise.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'DepositBankId')
  ALTER TABLE dbo.CrmPaymentReceipt ADD DepositBankId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'DepositBankName')
  ALTER TABLE dbo.CrmPaymentReceipt ADD DepositBankName NVARCHAR(200) NULL;
GO
