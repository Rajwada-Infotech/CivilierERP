-- Migration 669: a Salary Structure code can hold several dated versions.
-- Employees are assigned a structure *code* (migration 449) and payroll / Salary Details pick the version whose
-- Effective From/To covers the date (lib/formulaEngine.js pickStructureVersion, highest version wins on overlap) --
-- but UQ_SalaryStructure_Code / UQ_SalaryStructure_Name allowed only one row per code, so a change of structure
-- from a date had to be a second code and the employee switched by hand. Now unique per (Code, Version); the
-- "one code per name" rule is checked in routes/salaryStructure.js.

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_SalaryStructure_Code' AND parent_object_id = OBJECT_ID('dbo.SalaryStructure'))
  ALTER TABLE dbo.SalaryStructure DROP CONSTRAINT UQ_SalaryStructure_Code;
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_SalaryStructure_Name' AND parent_object_id = OBJECT_ID('dbo.SalaryStructure'))
  ALTER TABLE dbo.SalaryStructure DROP CONSTRAINT UQ_SalaryStructure_Name;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_SalaryStructure_CodeVersion' AND object_id = OBJECT_ID('dbo.SalaryStructure'))
  CREATE UNIQUE INDEX UQ_SalaryStructure_CodeVersion ON dbo.SalaryStructure (Code, Version);
GO
