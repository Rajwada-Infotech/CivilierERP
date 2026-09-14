-- Migration 284: Loan EMI schedule + Loan-to-Customer support.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanSanction') AND name = 'BorrowerCustomerId')
BEGIN
  ALTER TABLE dbo.LoanSanction ADD BorrowerCustomerId INT NULL;
END
GO

-- Existing rows always had a company borrower; nothing to backfill for the
-- new nullable column. BorrowerCompanyId itself becomes optional going
-- forward (Customer Loans have no borrower company) — SQL Server has no
-- ALTER COLUMN ... DROP NOT NULL shortcut check, so guard it.
IF EXISTS (
  SELECT 1 FROM sys.columns c
  WHERE c.object_id = OBJECT_ID('dbo.LoanSanction') AND c.name = 'BorrowerCompanyId' AND c.is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.LoanSanction ALTER COLUMN BorrowerCompanyId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoanEMISchedule' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.LoanEMISchedule (
    EMIId               INT IDENTITY(1,1) PRIMARY KEY,
    LoanId              INT NOT NULL,
    InstallmentNo       INT NOT NULL,
    DueDate             DATE NOT NULL,
    EMIAmount           DECIMAL(18,2) NOT NULL,
    PrincipalComponent  DECIMAL(18,2) NOT NULL,
    InterestComponent   DECIMAL(18,2) NOT NULL DEFAULT 0,
    IsPaid              BIT NOT NULL DEFAULT 0,
    PaidDate            DATE NULL,
    PaidBy              NVARCHAR(150) NULL,
    CreatedAt           DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_LoanEMISchedule_Loan FOREIGN KEY (LoanId) REFERENCES dbo.LoanSanction(LoanId),
    CONSTRAINT UQ_LoanEMISchedule_LoanInstallment UNIQUE (LoanId, InstallmentNo)
  );
END
GO
