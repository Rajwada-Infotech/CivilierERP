-- Migration 426: Designation Master (HR and Payroll module Setup) —
-- DesignationName + DesignationCode (DG Code), with DepartmentId pointing
-- at the existing shared dbo.DepartmentMaster (same table Task Master's
-- Department dropdown already reads from) rather than inventing a second
-- department list.

IF OBJECT_ID('dbo.DesignationMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DesignationMaster (
    Id               INT            IDENTITY(1,1) PRIMARY KEY,
    DesignationName  NVARCHAR(150)  NOT NULL,
    DesignationCode  NVARCHAR(30)   NOT NULL,
    DepartmentId     INT            NULL,
    IsActive         BIT            NOT NULL CONSTRAINT DF_DesignationMaster_IsActive DEFAULT 1,
    CreatedBy        INT            NULL,
    CreatedAt        DATETIME2      NOT NULL CONSTRAINT DF_DesignationMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy        INT            NULL,
    UpdatedAt        DATETIME2      NULL,

    CONSTRAINT UQ_DesignationMaster_Name UNIQUE (DesignationName),
    CONSTRAINT UQ_DesignationMaster_Code UNIQUE (DesignationCode),
    CONSTRAINT FK_DesignationMaster_Department FOREIGN KEY (DepartmentId) REFERENCES dbo.DepartmentMaster(Id),
    CONSTRAINT FK_DesignationMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_DesignationMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
  CREATE INDEX IX_DesignationMaster_DepartmentId ON dbo.DesignationMaster(DepartmentId);
END
GO

-- Setup item: "Designation Master" under the HR and Payroll module.
IF EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'designation-master')
  UPDATE dbo.PageDefinitions
    SET Label = N'Designation Master', Module = N'HR and Payroll', GroupName = N'HR and Payroll Masters',
        Actions = N'view,create,edit,delete,print,export', SortOrder = 30, IsActive = 1, UpdatedAt = SYSDATETIME()
  WHERE PageKey = N'designation-master';
ELSE
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'designation-master', N'Designation Master', N'HR and Payroll', N'HR and Payroll Masters', N'view,create,edit,delete,print,export', 30, 1, N'migration-426', SYSDATETIME());
GO

PRINT '426-designation-master applied successfully.';
GO
