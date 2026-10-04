-- Migration 425: Add Company to Employee Master. Reuses the existing
-- dbo.enterprise table (business_type='C' rows, same source
-- /api/enterprises/options?business_type=C already powers Bank/Card/
-- Cheque Master's Company pickers) rather than inventing a parallel
-- company list.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.EmployeeMaster') AND name = 'CompanyId'
)
BEGIN
  ALTER TABLE dbo.EmployeeMaster ADD CompanyId INT NULL;
  ALTER TABLE dbo.EmployeeMaster ADD CONSTRAINT FK_EmployeeMaster_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id);
  CREATE INDEX IX_EmployeeMaster_CompanyId ON dbo.EmployeeMaster(CompanyId);
END
GO
