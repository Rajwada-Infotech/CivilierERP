-- Migration 444: Deduction and Addition Master (HR and Payroll module Setup) --
-- Name + Code, with LedgerId pointing at the existing shared
-- dbo.AccountHeadMaster (LHeadType = 'GL') so each deduction/addition
-- component can be posted to a real General Ledger account, same table
-- General Ledger's own /options endpoint already reads from.

IF OBJECT_ID('dbo.DeductionAdditionMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DeductionAdditionMaster (
    Id         INT            IDENTITY(1,1) PRIMARY KEY,
    Name       NVARCHAR(150)  NOT NULL,
    Code       NVARCHAR(30)   NOT NULL,
    LedgerId   INT            NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_DeductionAdditionMaster_IsActive DEFAULT 1,
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_DeductionAdditionMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2      NULL,

    CONSTRAINT UQ_DeductionAdditionMaster_Name UNIQUE (Name),
    CONSTRAINT UQ_DeductionAdditionMaster_Code UNIQUE (Code),
    CONSTRAINT FK_DeductionAdditionMaster_Ledger FOREIGN KEY (LedgerId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT FK_DeductionAdditionMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_DeductionAdditionMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_DeductionAdditionMaster_LedgerId ON dbo.DeductionAdditionMaster(LedgerId);
END
GO

-- Setup item: "Deduction and Addition Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'deduction-addition-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Deduction and Addition Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 80, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'deduction-addition-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'deduction-addition-master', N'Deduction and Addition Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 80, 1, N'migration-444', SYSDATETIME());
GO

PRINT '444-deduction-addition-master applied successfully.';
GO
