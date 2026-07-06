-- Migration 139: add a Project scope to Cost Center & Profit Center masters.
-- Project is sourced from dbo.enterprise (the Project rows, business_type/type
-- column distinguishes Company vs Project rows elsewhere in the app) — nullable,
-- since a center can be company-wide and not tied to a single project.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CostCenter') AND name = 'ProjectId'
)
BEGIN
  ALTER TABLE dbo.CostCenter ADD ProjectId INT NULL;
  ALTER TABLE dbo.CostCenter
    ADD CONSTRAINT FK_CostCenter_Project FOREIGN KEY (ProjectId)
    REFERENCES dbo.enterprise(id);
  PRINT 'Added CostCenter.ProjectId';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.ProfitCenter') AND name = 'ProjectId'
)
BEGIN
  ALTER TABLE dbo.ProfitCenter ADD ProjectId INT NULL;
  ALTER TABLE dbo.ProfitCenter
    ADD CONSTRAINT FK_ProfitCenter_Project FOREIGN KEY (ProjectId)
    REFERENCES dbo.enterprise(id);
  PRINT 'Added ProfitCenter.ProjectId';
END
GO
