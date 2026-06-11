-- ============================================================
-- Migration 103: Project <-> Company belongs-to links
--
-- A project can belong to one or more companies. The existing
-- dbo.enterprise.company_id column is kept as the primary/legacy
-- company link; this table stores the canonical many-to-many set.
-- ============================================================

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.ProjectCompanies', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProjectCompanies (
    ProjectId INT NOT NULL,
    CompanyId INT NOT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectCompanies_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT PK_ProjectCompanies PRIMARY KEY (ProjectId, CompanyId),
    CONSTRAINT FK_ProjectCompanies_Project FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_ProjectCompanies_Company FOREIGN KEY (CompanyId) REFERENCES dbo.enterprise(id)
  );

  PRINT 'ProjectCompanies table created.';
END
ELSE
  PRINT 'ProjectCompanies table already exists.';
GO

INSERT INTO dbo.ProjectCompanies (ProjectId, CompanyId)
SELECT p.id, p.company_id
FROM dbo.enterprise p
WHERE p.business_type = 'P'
  AND p.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.ProjectCompanies pc
    WHERE pc.ProjectId = p.id
      AND pc.CompanyId = p.company_id
  );
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.ProjectCompanies')
    AND name = N'IX_ProjectCompanies_CompanyId'
)
BEGIN
  CREATE INDEX IX_ProjectCompanies_CompanyId
    ON dbo.ProjectCompanies (CompanyId, ProjectId);
  PRINT 'IX_ProjectCompanies_CompanyId created.';
END
ELSE
  PRINT 'IX_ProjectCompanies_CompanyId already exists.';
GO

PRINT '103-project-companies applied successfully.';
GO
