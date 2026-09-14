-- Add UpdatedBy / UpdatedAt audit columns to CrmAgreementDocument.
-- These were referenced in the proxy-attach UPDATE query but missing from
-- the table schema, causing a 500 "Invalid column name 'UpdatedAt'" error.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'UpdatedBy')
  ALTER TABLE dbo.CrmAgreementDocument ADD UpdatedBy INT NULL REFERENCES dbo.Users(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmAgreementDocument') AND name = 'UpdatedAt')
  ALTER TABLE dbo.CrmAgreementDocument ADD UpdatedAt DATETIME2(3) NULL;
GO
PRINT 'Migration 380 complete — CrmAgreementDocument audit columns added';
