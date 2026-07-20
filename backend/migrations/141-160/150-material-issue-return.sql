-- Migration 150: Issue Return module

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialIssueReturn')
BEGIN
  CREATE TABLE dbo.MaterialIssueReturn (
    ReturnId       INT IDENTITY(1,1) PRIMARY KEY,
    DocNo          NVARCHAR(50)  NOT NULL UNIQUE,
    ReturnDate     DATE          NOT NULL,
    IssueId        INT           NULL REFERENCES dbo.MaterialIssues(IssueId),
    CompanyId      INT           NULL,
    ProjectId      INT           NULL,
    GodownId       INT           NULL,
    Reason         NVARCHAR(500) NULL,
    Remarks        NVARCHAR(1000) NULL,
    Status         NVARCHAR(20)  NOT NULL DEFAULT 'Draft',
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt      DATETIME2     NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialIssueReturnItems')
BEGIN
  CREATE TABLE dbo.MaterialIssueReturnItems (
    ItemId         INT IDENTITY(1,1) PRIMARY KEY,
    ReturnId       INT NOT NULL REFERENCES dbo.MaterialIssueReturn(ReturnId),
    OrigIssueItemId INT NULL,
    M_Id           NVARCHAR(100) NULL,
    ItemName       NVARCHAR(500) NULL,
    Quantity       DECIMAL(18,4) NOT NULL,
    UOMSymbol      NVARCHAR(30)  NULL
  );
END;
