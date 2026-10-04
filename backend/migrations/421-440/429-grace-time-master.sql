-- Migration 429: Grace Time Master (HR and Payroll module Setup) — the
-- late-attendance grace period rules (e.g. "10 minutes grace before a
-- shift is marked late"). TimeMinutes is a plain integer (minutes), not a
-- clock time like Shift Master's In/Out Time.

IF OBJECT_ID('dbo.GraceTimeMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GraceTimeMaster (
    GraceId        INT            IDENTITY(1,1) PRIMARY KEY,
    GraceName      NVARCHAR(100)  NOT NULL,
    GraceCode      NVARCHAR(30)   NOT NULL,
    TimeMinutes    INT            NOT NULL,
    ReasonRemarks  NVARCHAR(500)  NULL,
    IsActive       BIT            NOT NULL CONSTRAINT DF_GraceTimeMaster_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_GraceTimeMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT UQ_GraceTimeMaster_Name UNIQUE (GraceName),
    CONSTRAINT UQ_GraceTimeMaster_Code UNIQUE (GraceCode),
    CONSTRAINT FK_GraceTimeMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_GraceTimeMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- Setup item: "Grace Time Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'grace-time-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Grace Time Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 60, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'grace-time-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'grace-time-master', N'Grace Time Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 60, 1, N'migration-429', SYSDATETIME());
GO

PRINT '429-grace-time-master applied successfully.';
GO
