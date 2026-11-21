-- Migration 285: Customer Loan borrowers can come from either dbo.AccountHeadMaster
-- (LHeadType='A', the formal Customer Master) or dbo.CrmCustomer (real-estate
-- buyers/applicants) — two independent id sequences, so we need to know which
-- table BorrowerCustomerId actually points into.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'BorrowerCustomerSource')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD BorrowerCustomerSource NVARCHAR(10) NULL; -- 'AH' | 'CRM'
END
GO

-- Backfill existing Customer Loan rows (the only source that existed before
-- this migration) as 'AH'.
UPDATE dbo.LoanSanction
SET BorrowerCustomerSource = 'AH'
WHERE BorrowerCustomerId IS NOT NULL AND BorrowerCustomerSource IS NULL;
GO
