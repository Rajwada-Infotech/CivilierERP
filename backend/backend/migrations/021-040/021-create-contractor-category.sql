IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ContractorCategoryType' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ContractorCategoryType (
    CtId INT IDENTITY(1,1) PRIMARY KEY,
    CtCode NVARCHAR(50) NOT NULL,
    CtName NVARCHAR(255) NOT NULL,
    CtIsActive BIT NOT NULL DEFAULT 1,
    CtCreatedBy NVARCHAR(100) NULL,
    CtCreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CtUpdatedBy NVARCHAR(100) NULL,
    CtUpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_ContractorCategoryType_Code UNIQUE (CtCode)
  );

  INSERT INTO dbo.ContractorCategoryType (CtCode, CtName, CtCreatedBy)
  VALUES
    ('CIV', 'Civil', 'system'),
    ('ELE', 'Electrical', 'system'),
    ('MEC', 'Mechanical', 'system'),
    ('PLU', 'Plumbing', 'system'),
    ('GEN', 'General', 'system');
END
