-- Migration 450: Payroll Run -- computes and *locks* monthly payroll
-- snapshots per employee (spec 13/15/16 runtime). Lines are denormalized
-- (head name/code/type frozen at computation time) so a later rename or
-- change to the live Salary Head / Salary Structure can never alter a
-- payslip that has already been generated.

IF OBJECT_ID('dbo.PayrollRun', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PayrollRun (
    PayrollRunId  INT            IDENTITY(1,1) PRIMARY KEY,
    CompanyId     INT            NULL,
    PeriodMonth   INT            NOT NULL,
    PeriodYear    INT            NOT NULL,
    Status        NVARCHAR(20)   NOT NULL CONSTRAINT DF_PayrollRun_Status DEFAULT N'Draft',
    ProcessedAt   DATETIME2      NULL,
    ProcessedBy   INT            NULL,
    CreatedBy     INT            NULL,
    CreatedAt     DATETIME2      NOT NULL CONSTRAINT DF_PayrollRun_CreatedAt DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_PayrollRun_Status CHECK (Status IN (N'Draft', N'Processed', N'Locked')),
    CONSTRAINT CK_PayrollRun_Month CHECK (PeriodMonth BETWEEN 1 AND 12),
    CONSTRAINT UQ_PayrollRun_Period UNIQUE (CompanyId, PeriodMonth, PeriodYear),
    CONSTRAINT FK_PayrollRun_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_PayrollRun_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_PayrollRun_ProcessedBy FOREIGN KEY (ProcessedBy) REFERENCES dbo.users(id)
  );
END
GO

IF OBJECT_ID('dbo.PayrollRunEmployee', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PayrollRunEmployee (
    PayrollRunEmployeeId   INT            IDENTITY(1,1) PRIMARY KEY,
    PayrollRunId           INT            NOT NULL,
    EmployeeId             INT            NOT NULL,
    SalaryStructureId      INT            NULL,
    CTCUsed                DECIMAL(18,2)  NULL,
    MonthlyCTCUsed         DECIMAL(18,2)  NULL,
    GrossSalary            DECIMAL(18,2)  NULL,
    TotalEmployeeDeduction DECIMAL(18,2)  NULL,
    NetSalary              DECIMAL(18,2)  NULL,
    TotalEmployerContribution DECIMAL(18,2) NULL,
    TotalCTC               DECIMAL(18,2)  NULL,
    ComputedAt              DATETIME2     NOT NULL CONSTRAINT DF_PayrollRunEmployee_ComputedAt DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UQ_PayrollRunEmployee_RunEmployee UNIQUE (PayrollRunId, EmployeeId),
    CONSTRAINT FK_PayrollRunEmployee_Run FOREIGN KEY (PayrollRunId) REFERENCES dbo.PayrollRun(PayrollRunId) ON DELETE CASCADE,
    CONSTRAINT FK_PayrollRunEmployee_Employee FOREIGN KEY (EmployeeId) REFERENCES dbo.EmployeeMaster(EmployeeId),
    CONSTRAINT FK_PayrollRunEmployee_Structure FOREIGN KEY (SalaryStructureId) REFERENCES dbo.SalaryStructure(SalaryStructureId)
  );
  CREATE INDEX IX_PayrollRunEmployee_RunId ON dbo.PayrollRunEmployee(PayrollRunId);
END
GO

IF OBJECT_ID('dbo.PayrollRunEmployeeLines', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PayrollRunEmployeeLines (
    LineId                 INT            IDENTITY(1,1) PRIMARY KEY,
    PayrollRunEmployeeId   INT            NOT NULL,
    DeductionAdditionId    INT            NULL,
    HeadName               NVARCHAR(150)  NOT NULL,
    HeadCode               NVARCHAR(30)   NOT NULL,
    ComponentType           NVARCHAR(30)  NOT NULL,
    Amount                  DECIMAL(18,2) NOT NULL,
    IncludeInGross          BIT           NOT NULL,
    IncludeInCTC            BIT           NOT NULL,
    IncludeInNet            BIT           NOT NULL,
    Taxable                 BIT           NOT NULL,

    CONSTRAINT FK_PayrollRunEmployeeLines_Employee FOREIGN KEY (PayrollRunEmployeeId)
      REFERENCES dbo.PayrollRunEmployee(PayrollRunEmployeeId) ON DELETE CASCADE
  );
  CREATE INDEX IX_PayrollRunEmployeeLines_PREId ON dbo.PayrollRunEmployeeLines(PayrollRunEmployeeId);
END
GO

-- Setup/Transaction items under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'salary-structure')
  UPDATE dbo.PageDefinitions SET SortOrder = 90 WHERE PageKey = N'salary-structure';
GO
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'payroll-run')
  UPDATE dbo.PageDefinitions
    SET Label = N'Payroll Run', Module = N'HR and Payroll', GroupName = N'HR and Payroll',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 10, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'payroll-run';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'payroll-run', N'Payroll Run', N'HR and Payroll', N'HR and Payroll', N'view,create,edit,delete,print,export', 10, 1, N'migration-450', SYSDATETIME());
GO

PRINT '450-payroll-run applied successfully.';
GO
