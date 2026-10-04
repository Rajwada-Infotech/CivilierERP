-- Migration 428: Shift Master (HR and Payroll module Setup) — ShiftName,
-- ShiftCode, InTime/OutTime (stored as plain "HH:MM" strings rather than
-- SQL Server's TIME type, which round-trips through the mssql driver as a
-- 1970-01-01-anchored Date and complicates the client), and WeekOff (one
-- of the 7 day names).

IF OBJECT_ID('dbo.ShiftMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ShiftMaster (
    ShiftId    INT            IDENTITY(1,1) PRIMARY KEY,
    ShiftName  NVARCHAR(100)  NOT NULL,
    ShiftCode  NVARCHAR(30)   NOT NULL,
    InTime     NVARCHAR(10)   NOT NULL,
    OutTime    NVARCHAR(10)   NOT NULL,
    WeekOff    NVARCHAR(20)   NULL,
    IsActive   BIT            NOT NULL CONSTRAINT DF_ShiftMaster_IsActive DEFAULT 1,
    CreatedBy  INT            NULL,
    CreatedAt  DATETIME2      NOT NULL CONSTRAINT DF_ShiftMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy  INT            NULL,
    UpdatedAt  DATETIME2      NULL,

    CONSTRAINT UQ_ShiftMaster_Name UNIQUE (ShiftName),
    CONSTRAINT UQ_ShiftMaster_Code UNIQUE (ShiftCode),
    CONSTRAINT FK_ShiftMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_ShiftMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Setup item: "Shift Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'shift-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Shift Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 50, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'shift-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'shift-master', N'Shift Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 50, 1, N'migration-428', SYSDATETIME());
GO

PRINT '428-shift-master applied successfully.';
GO
