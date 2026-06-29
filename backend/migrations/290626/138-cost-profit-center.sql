-- Migration 138: Cost Center & Profit Center masters (Finance module).
-- Each is a simple Code/Name/Description master; GL accounts (dbo.AccountHeadMaster
-- WHERE LHeadType='GL') are tagged to at most one Cost Center and one Profit
-- Center each via new nullable FK columns, set from the master's own
-- "GL Accounts" multiselect rather than from the GL account screen itself.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CostCenter'
)
BEGIN
  CREATE TABLE dbo.CostCenter (
    CostCenterId INT           IDENTITY(1,1) PRIMARY KEY,
    Code         NVARCHAR(50)  NOT NULL,
    Name         NVARCHAR(200) NOT NULL,
    Description  NVARCHAR(500) NULL,
    IsActive     BIT           NOT NULL CONSTRAINT DF_CC_IsActive_138 DEFAULT 1,
    CreatedBy    NVARCHAR(150) NULL,
    CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_CC_CreatedAt_138 DEFAULT SYSDATETIME(),
    UpdatedBy    NVARCHAR(150) NULL,
    UpdatedAt    DATETIME2     NULL,
    CONSTRAINT UQ_CostCenter_Code UNIQUE (Code)
  );
  PRINT 'Created dbo.CostCenter';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ProfitCenter'
)
BEGIN
  CREATE TABLE dbo.ProfitCenter (
    ProfitCenterId INT           IDENTITY(1,1) PRIMARY KEY,
    Code           NVARCHAR(50)  NOT NULL,
    Name           NVARCHAR(200) NOT NULL,
    Description    NVARCHAR(500) NULL,
    IsActive       BIT           NOT NULL CONSTRAINT DF_PC_IsActive_138 DEFAULT 1,
    CreatedBy      NVARCHAR(150) NULL,
    CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_PC_CreatedAt_138 DEFAULT SYSDATETIME(),
    UpdatedBy      NVARCHAR(150) NULL,
    UpdatedAt      DATETIME2     NULL,
    CONSTRAINT UQ_ProfitCenter_Code UNIQUE (Code)
  );
  PRINT 'Created dbo.ProfitCenter';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'CostCenterId'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD CostCenterId INT NULL;
  ALTER TABLE dbo.AccountHeadMaster
    ADD CONSTRAINT FK_AHM_CostCenter FOREIGN KEY (CostCenterId)
    REFERENCES dbo.CostCenter(CostCenterId);
  PRINT 'Added AccountHeadMaster.CostCenterId';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'ProfitCenterId'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster ADD ProfitCenterId INT NULL;
  ALTER TABLE dbo.AccountHeadMaster
    ADD CONSTRAINT FK_AHM_ProfitCenter FOREIGN KEY (ProfitCenterId)
    REFERENCES dbo.ProfitCenter(ProfitCenterId);
  PRINT 'Added AccountHeadMaster.ProfitCenterId';
END
GO

-- PageDefinitions — Finance Masters group, same convention as the other
-- Finance master pages (account-head, general-ledger, billing-terms, etc.)
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'cost-center' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('cost-center', 'Cost Center Master', 'Finance', 'Finance Masters', 'view,create,edit,delete,print,export', 195, 1, 'migration', GETDATE());

  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'profit-center' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('profit-center', 'Profit Center Master', 'Finance', 'Finance Masters', 'view,create,edit,delete,print,export', 196, 1, 'migration', GETDATE());

  PRINT 'Seeded cost-center, profit-center page definitions';
END
GO
