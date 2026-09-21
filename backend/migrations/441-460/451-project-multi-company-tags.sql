-- Migration 451: Project <-> Company multi-tagging
-- Lets a project be tagged to additional companies beyond its single
-- primary company_id (which stays authoritative for GST/ledger/godown
-- logic in projectMaster.js — this is purely an additional-association
-- list, gated behind its own toggle so existing single-company projects
-- are unaffected).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'multi_company_enabled')
  ALTER TABLE dbo.enterprise ADD multi_company_enabled BIT NOT NULL CONSTRAINT DF_enterprise_multi_company_enabled DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectCompanies' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ProjectCompanies (
    ProjectId INT NOT NULL,
    CompanyId INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectCompanies_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT PK_ProjectCompanies PRIMARY KEY (ProjectId, CompanyId),
    CONSTRAINT FK_ProjectCompanies_Project FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_ProjectCompanies_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id)
  );
END
GO

PRINT '451-project-multi-company-tags applied successfully.';
GO
