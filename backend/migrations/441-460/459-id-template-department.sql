-- Migration 459: ID Template Master gains an optional Department column.
-- Nullable; no longer used to build FA Item Codes (the department shown in a
-- code now follows the asset's current custodian instead) -- kept only
-- because templates already hold values in it.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.IDTemplateMaster') AND name = 'DepartmentId')
  ALTER TABLE dbo.IDTemplateMaster ADD DepartmentId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_IDTemplateMaster_Department')
  ALTER TABLE dbo.IDTemplateMaster ADD CONSTRAINT FK_IDTemplateMaster_Department
    FOREIGN KEY (DepartmentId) REFERENCES dbo.DepartmentMaster(Id);
GO

PRINT '459-id-template-department applied successfully.';
GO
