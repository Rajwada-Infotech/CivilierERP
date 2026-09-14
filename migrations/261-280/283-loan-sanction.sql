-- Migration 283: Loan Sanction module
-- New dbo.LoanSanction table + a top-level "LOANS AND ADVANCES" AccountGroup
-- used to park the system-generated per-company loan ledger heads that
-- routes/loanSanction.js auto-creates on first use (mirrors the pattern in
-- routes/projectMaster.js's ensureProjectLedgerHeads).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoanSanction' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.LoanSanction (
    LoanId            INT IDENTITY(1,1) PRIMARY KEY,
    LoanNo            NVARCHAR(50)   NOT NULL,
    LoanType          NVARCHAR(20)   NOT NULL, -- 'Inter-Company' | 'Intra-Company'
    LenderCompanyId   INT            NOT NULL,
    BorrowerCompanyId INT            NOT NULL,
    LoanDate          DATE           NOT NULL,
    Amount            DECIMAL(18,2)  NOT NULL,
    InterestRate      DECIMAL(5,2)   NULL,
    TenureMonths      INT            NULL,
    Purpose           NVARCHAR(500)  NULL,
    Status            NVARCHAR(20)   NOT NULL DEFAULT 'Sanctioned', -- 'Sanctioned' | 'Adjusted' | 'Closed'
    LenderLHeadId     INT            NULL, -- system-generated GL ledger head (AccountHeadMaster)
    BorrowerLHeadId   INT            NULL, -- system-generated GL ledger head (AccountHeadMaster)
    Remarks           NVARCHAR(500)  NULL,
    CreatedBy         NVARCHAR(150)  NULL,
    CreatedAt         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(150)  NULL,
    UpdatedAt         DATETIME2      NULL,
    CONSTRAINT UQ_LoanSanction_LoanNo UNIQUE (LoanNo)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Name = 'LOANS AND ADVANCES' AND ParentGroupId IS NULL)
BEGIN
  DECLARE @AdminUserId INT = (SELECT TOP 1 id FROM dbo.users WHERE email = 'superadmin@civilier.com');
  IF @AdminUserId IS NOT NULL
    INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
    VALUES ('LOANS AND ADVANCES', 'LNA', NULL, 1, @AdminUserId, SYSDATETIME());
END
GO
