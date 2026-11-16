-- Migration 662: Employee Master — only ONE employee without a candidate could ever be saved.
-- Migration 435 made CandidateId a plain UNIQUE constraint, and SQL Server counts NULL as a value in a unique
-- constraint: the first employee added directly (no recruitment candidate) took the single allowed NULL and every
-- later one failed with "This candidate has already been added as an employee". A candidate must still become at
-- most ONE employee, so keep the rule — but only for rows that actually have a candidate (filtered unique index).

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_EmployeeMaster_CandidateId' AND parent_object_id = OBJECT_ID('dbo.EmployeeMaster'))
BEGIN
  ALTER TABLE dbo.EmployeeMaster DROP CONSTRAINT UQ_EmployeeMaster_CandidateId;
  PRINT 'Migration 662: dropped the plain UNIQUE constraint on EmployeeMaster.CandidateId.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_EmployeeMaster_CandidateId' AND object_id = OBJECT_ID('dbo.EmployeeMaster'))
BEGIN
  CREATE UNIQUE INDEX UQ_EmployeeMaster_CandidateId ON dbo.EmployeeMaster (CandidateId) WHERE CandidateId IS NOT NULL;
  PRINT 'Migration 662: created filtered unique index UQ_EmployeeMaster_CandidateId.';
END
GO
