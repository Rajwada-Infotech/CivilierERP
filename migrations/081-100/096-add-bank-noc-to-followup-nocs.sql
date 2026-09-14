-- 096-add-bank-noc-to-followup-nocs.sql
-- Adds Bank NOC / loan tracking columns to dbo.FollowupNOCs.
-- Each ALTER TABLE is in its own GO batch (SQL Server parse-before-execute).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'BankName'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD BankName NVARCHAR(150) NULL;
  PRINT 'BankName added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanAccountNo'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanAccountNo NVARCHAR(60) NULL;
  PRINT 'LoanAccountNo added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanSanctionStatus'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanSanctionStatus NVARCHAR(30) NULL
    CONSTRAINT CK_FNOC_LoanSanctionStatus
      CHECK (LoanSanctionStatus IN ('Pending','Sanctioned','Rejected') OR LoanSanctionStatus IS NULL);
  PRINT 'LoanSanctionStatus added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanSanctionDate'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanSanctionDate DATE NULL;
  PRINT 'LoanSanctionDate added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanDisbursementStatus'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanDisbursementStatus NVARCHAR(30) NULL
    CONSTRAINT CK_FNOC_LoanDisbursementStatus
      CHECK (LoanDisbursementStatus IN ('Pending','PartiallyDisbursed','FullyDisbursed') OR LoanDisbursementStatus IS NULL);
  PRINT 'LoanDisbursementStatus added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanDisbursementDate'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanDisbursementDate DATE NULL;
  PRINT 'LoanDisbursementDate added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'LoanAmount'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD LoanAmount DECIMAL(18,2) NULL;
  PRINT 'LoanAmount added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'BankNOCStatus'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD BankNOCStatus NVARCHAR(30) NULL
    CONSTRAINT CK_FNOC_BankNOCStatus
      CHECK (BankNOCStatus IN ('NotApplicable','Pending','Applied','Received') OR BankNOCStatus IS NULL);
  PRINT 'BankNOCStatus added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'BankNOCDate'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD BankNOCDate DATE NULL;
  PRINT 'BankNOCDate added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupNOCs') AND name = 'BankNOCNotes'
)
BEGIN
  ALTER TABLE dbo.FollowupNOCs ADD BankNOCNotes NVARCHAR(500) NULL;
  PRINT 'BankNOCNotes added.';
END
GO

PRINT '096 complete.';
