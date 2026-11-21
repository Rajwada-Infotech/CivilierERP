-- Migration 286: Loan Sanction redesign — Bank Loan type, doc number,
-- SI/CI interest calculation toggle, interest on/off toggle.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'LoanDocNo')
  ALTER TABLE dbo.LoanSanction ADD LoanDocNo NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'InterestType')
  ALTER TABLE dbo.LoanSanction ADD InterestType NVARCHAR(10) NOT NULL CONSTRAINT DF_LoanSanction_InterestType DEFAULT 'CI'; -- 'SI' | 'CI'
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'HasInterest')
  ALTER TABLE dbo.LoanSanction ADD HasInterest BIT NOT NULL CONSTRAINT DF_LoanSanction_HasInterest DEFAULT 1;
GO

-- Bank Loan type: lender is a Bank (AccountHeadMaster LHeadType='B') rather
-- than a Company — its own existing ledger head is used directly as
-- LenderLHeadId, no separate LenderCompanyId row needed for that case.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'LenderBankId')
  ALTER TABLE dbo.LoanSanction ADD LenderBankId INT NULL;
GO

-- LenderCompanyId was NOT NULL — Bank Loan rows have no lender company.
IF EXISTS (
  SELECT 1 FROM sys.columns c
  WHERE c.object_id = OBJECT_ID('dbo.LoanSanction') AND c.name = 'LenderCompanyId' AND c.is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.LoanSanction ALTER COLUMN LenderCompanyId INT NULL;
END
GO

-- Backfill existing rows explicitly (defaults above only apply going forward
-- to NEW rows on some SQL Server configurations for ADD ... DEFAULT, but be
-- explicit for safety across existing data).
UPDATE dbo.LoanSanction SET InterestType = 'CI' WHERE InterestType IS NULL;
UPDATE dbo.LoanSanction SET HasInterest = CASE WHEN InterestRate IS NOT NULL AND InterestRate > 0 THEN 1 ELSE 0 END
WHERE HasInterest IS NULL;
GO
