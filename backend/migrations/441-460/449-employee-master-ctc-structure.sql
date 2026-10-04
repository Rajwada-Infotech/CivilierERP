-- Migration 449: Employee Master gains CTC + Salary Structure assignment
-- (spec 4/12). CTCAmount + CTCFrequency together describe the employee's
-- CTC in whichever unit was entered -- Annual/Monthly CTC are always
-- derived in application code from these two, never stored twice.
-- SalaryStructureCode references the structure *family* (SalaryStructure.
-- Code), not one specific version's row, so payroll can resolve whichever
-- version's Effective From/To window covers the period being processed
-- (spec 16).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'CTCAmount')
  ALTER TABLE dbo.EmployeeMaster ADD CTCAmount DECIMAL(18,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'CTCFrequency')
  ALTER TABLE dbo.EmployeeMaster ADD CTCFrequency NVARCHAR(10) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeMaster_CTCFrequency')
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT CK_EmployeeMaster_CTCFrequency
    CHECK (CTCFrequency IS NULL OR CTCFrequency IN (N'Annual', N'Monthly'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'SalaryStructureCode')
  ALTER TABLE dbo.EmployeeMaster ADD SalaryStructureCode NVARCHAR(30) NULL;
GO

PRINT '449-employee-master-ctc-structure applied successfully.';
GO
