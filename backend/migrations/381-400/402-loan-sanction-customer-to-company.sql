-- ============================================================
-- Migration 402: Customer Loan gets a second direction — "Customer to
-- Company" (a customer lends money TO us), alongside the existing
-- "Company to Customer" (we lend to a customer).
--
-- The existing Customer Loan shape only has BorrowerCustomerId/Source (the
-- customer as BORROWER) — there was no way to record a customer as the
-- LENDER. Symmetric new columns, same AH/CRM dual-source convention as the
-- existing Borrower ones:
--   LenderCustomerId/LenderCustomerSource — which customer lent the money.
--   LenderCustomerBankName — free-text/major-minor bank name (same
--     BankNamePicker the frontend already uses for Received Payment's
--     Customer Bank Name and Bank Loan's lender bank) — descriptive only,
--     not itself a GL account (the customer already gets one via
--     ensureLoanLedgerHead, same as their existing Borrower role).
--
-- Direction is inferred from which lender FK is populated (LenderCustomerId
-- vs LenderCompanyId) — no separate flag column, same convention Bank Loan
-- already uses (isBankLoan is inferred purely from LenderBankId being set).
--
-- Also adds Demand Draft's own reference number + date pair (DemandDraftNo/
-- DemandDraftDate) — DD needs both, same as Cheque has ChequeNo+ChequeDate,
-- rather than sharing the single generic DigitalRefNumber field NEFT/RTGS
-- use.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'LenderCustomerId'
)
  ALTER TABLE dbo.LoanSanction ADD LenderCustomerId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'LenderCustomerSource'
)
  ALTER TABLE dbo.LoanSanction ADD LenderCustomerSource NVARCHAR(10) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'LenderCustomerBankName'
)
  ALTER TABLE dbo.LoanSanction ADD LenderCustomerBankName NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'DemandDraftNo'
)
  ALTER TABLE dbo.LoanSanction ADD DemandDraftNo NVARCHAR(30) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LoanSanction' AND COLUMN_NAME = 'DemandDraftDate'
)
  ALTER TABLE dbo.LoanSanction ADD DemandDraftDate DATE NULL;
GO

PRINT '402-loan-sanction-customer-to-company applied successfully.';
GO
