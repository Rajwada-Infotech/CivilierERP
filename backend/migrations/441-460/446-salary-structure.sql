-- Migration 446: Salary Structure (HR and Payroll module Setup) -- a
-- header (Company, Name, Code) with a child grid of Deduction/Addition
-- lines (head + Percentage + Amount, both independent manual fields, no
-- auto-calculation between them), mirroring the parent/child +
-- ON DELETE CASCADE pattern Quotations already uses for its line items.

IF OBJECT_ID('dbo.SalaryStructure', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SalaryStructure (
    SalaryStructureId INT            IDENTITY(1,1) PRIMARY KEY,
    CompanyId         INT            NULL,
    Name              NVARCHAR(150)  NOT NULL,
    Code              NVARCHAR(30)   NOT NULL,
    IsActive          BIT            NOT NULL CONSTRAINT DF_SalaryStructure_IsActive DEFAULT 1,
    CreatedBy         INT            NULL,
    CreatedAt         DATETIME2      NOT NULL CONSTRAINT DF_SalaryStructure_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy         INT            NULL,
    UpdatedAt         DATETIME2      NULL,

    CONSTRAINT UQ_SalaryStructure_Name UNIQUE (Name),
    CONSTRAINT UQ_SalaryStructure_Code UNIQUE (Code),
    CONSTRAINT FK_SalaryStructure_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_SalaryStructure_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_SalaryStructure_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_SalaryStructure_CompanyId ON dbo.SalaryStructure(CompanyId);
END
GO

IF OBJECT_ID('dbo.SalaryStructureLines', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SalaryStructureLines (
    LineId              INT            IDENTITY(1,1) PRIMARY KEY,
    SalaryStructureId   INT            NOT NULL,
    DeductionAdditionId INT            NOT NULL,
    Percentage          DECIMAL(9,4)   NULL,
    Amount              DECIMAL(18,2)  NULL,
    CreatedAt           DATETIME2      NOT NULL CONSTRAINT DF_SalaryStructureLines_CreatedAt DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_SalaryStructureLines_Structure FOREIGN KEY (SalaryStructureId)
      REFERENCES dbo.SalaryStructure(SalaryStructureId) ON DELETE CASCADE,
    CONSTRAINT FK_SalaryStructureLines_Head FOREIGN KEY (DeductionAdditionId)
      REFERENCES dbo.DeductionAdditionMaster(Id),
    CONSTRAINT UQ_SalaryStructureLines_StructureHead UNIQUE (SalaryStructureId, DeductionAdditionId)
  );
  CREATE INDEX IX_SalaryStructureLines_StructureId ON dbo.SalaryStructureLines(SalaryStructureId);
END
GO

-- Setup item: "Salary Structure" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'salary-structure')
  UPDATE dbo.PageDefinitions
    SET Label = N'Salary Structure', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 90, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'salary-structure';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'salary-structure', N'Salary Structure', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 90, 1, N'migration-446', SYSDATETIME());
GO

PRINT '446-salary-structure applied successfully.';
GO
