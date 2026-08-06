-- Migration 290: Lender/Borrower Bank A/C tags for Inter-Company loans —
-- which specific bank account (dbo.AccountHeadMaster, LHeadType='B') the
-- funds actually moved out of / into, distinct from LenderBankId (which is
-- only used by the Bank Loan type, where the lender IS the bank itself).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'LenderBankAccountId')
  ALTER TABLE dbo.LoanSanction ADD LenderBankAccountId INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'BorrowerBankAccountId')
  ALTER TABLE dbo.LoanSanction ADD BorrowerBankAccountId INT NULL;
GO
