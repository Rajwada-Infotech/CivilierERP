-- On-Account payments had no deposit-bank tracking at all, unlike Milestone
-- receipts (CrmPaymentReceipt.DepositBankId/DepositBankName already existed).
-- Same shape, same convention.
ALTER TABLE dbo.CrmOnAccountPayment ADD DepositBankId INT NULL, DepositBankName NVARCHAR(200) NULL;
