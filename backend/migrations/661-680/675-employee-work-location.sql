-- Migration 675: link an employee to a Work Location (Work Location Master).
-- EmployeeMaster.WorkLocationId points at dbo.WorkLocationMaster; NULL = not placed at a location. The older free-text
-- BranchLocation column stays as it was.

IF COL_LENGTH('dbo.EmployeeMaster', 'WorkLocationId') IS NULL
  ALTER TABLE dbo.EmployeeMaster ADD WorkLocationId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EmployeeMaster_WorkLocation')
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT FK_EmployeeMaster_WorkLocation
    FOREIGN KEY (WorkLocationId) REFERENCES dbo.WorkLocationMaster (LocationId);
GO

PRINT '675-employee-work-location applied successfully.';
GO
