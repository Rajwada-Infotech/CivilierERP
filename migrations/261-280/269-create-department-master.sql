-- Migration 269: Department Master — feeds the Task Master "Department"
-- field (dropdown, no longer free text) under the Follow-Up module's Setup
-- menu.

IF OBJECT_ID('dbo.DepartmentMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DepartmentMaster (
    Id             INT            IDENTITY(1,1) PRIMARY KEY,
    DepartmentName NVARCHAR(150)  NOT NULL,
    IsActive       BIT            NOT NULL CONSTRAINT DF_DepartmentMaster_IsActive DEFAULT 1,
    CreatedBy      INT            NULL,
    CreatedAt      DATETIME2      NOT NULL CONSTRAINT DF_DepartmentMaster_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy      INT            NULL,
    UpdatedAt      DATETIME2      NULL,

    CONSTRAINT UQ_DepartmentMaster_Name UNIQUE (DepartmentName),
    CONSTRAINT FK_DepartmentMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.users(id),
    CONSTRAINT FK_DepartmentMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.users(id)
  );
END
GO

-- New Setup item: "Department Master", reachable from CRM/Follow-Up Setup.
INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'followup-department-master', 'Department Master', 'CRM', 'CRM Setup', 'view,create,edit,delete', 175, 1, 'migration-269', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'followup-department-master' AND pd.IsActive = 1
);
GO

-- TaskMaster.Department was free text — existing values are preserved as-is
-- (no data migration into DepartmentMaster; the dropdown starts empty and
-- admins re-seed it, same as any other new master).
