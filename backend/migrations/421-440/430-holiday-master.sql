-- Migration 430: Holiday Master (HR and Payroll module Setup) —
-- HolidayName + HolidayDate, with FinYearId pointing at the existing
-- shared dbo.FinYear master (the same Financial Year list every other
-- transaction dropdown already reads from) rather than a second FY list.

IF OBJECT_ID('dbo.HolidayMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.HolidayMaster (
    HolidayId    INT            IDENTITY(1,1) PRIMARY KEY,
    HolidayName  NVARCHAR(150)  NOT NULL,
    HolidayDate  DATE           NOT NULL,
    FinYearId    INT            NULL,
    IsActive     BIT            NOT NULL CONSTRAINT DF_HolidayMaster_IsActive DEFAULT 1,
    CreatedBy    INT            NULL,
    CreatedAt    DATETIME2      NOT NULL CONSTRAINT DF_HolidayMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy    INT            NULL,
    UpdatedAt    DATETIME2      NULL,

    CONSTRAINT UQ_HolidayMaster_NameDate UNIQUE (HolidayName, HolidayDate),
    CONSTRAINT FK_HolidayMaster_FinYear FOREIGN KEY (FinYearId) REFERENCES dbo.FinYear(FId),
    CONSTRAINT FK_HolidayMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_HolidayMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_HolidayMaster_FinYearId ON dbo.HolidayMaster(FinYearId);
END
GO

-- Setup item: "Holiday Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'holiday-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Holiday Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 70, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'holiday-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'holiday-master', N'Holiday Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 70, 1, N'migration-430', SYSDATETIME());
GO

PRINT '430-holiday-master applied successfully.';
GO
