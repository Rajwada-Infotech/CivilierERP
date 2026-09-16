-- Migration 435: Employee Master — CandidateId, linking an employee record
-- back to the recruitment candidate they came from (Interview Selected ->
-- Offer Letter -> Joining confirmed -> Employee Master), so a joined
-- candidate can be turned into an employee with fields pre-filled, and
-- can't accidentally be turned into two employee records.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'CandidateId'
)
BEGIN
  ALTER TABLE dbo.EmployeeMaster ADD CandidateId INT NULL;
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT FK_EmployeeMaster_Candidate
    FOREIGN KEY (CandidateId) REFERENCES dbo.CandidateMaster(CandidateId);
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT UQ_EmployeeMaster_CandidateId UNIQUE (CandidateId);
END
GO

PRINT '435-employee-master-candidate-link applied successfully.';
GO
