-- ============================================================
-- Migration 168: Link Construction Updates to the real Unit Master project
-- CrmConstructionUpdate previously matched customers to updates by a loose
-- ProjectName string (typo-prone, no FK) and was never actually queried by
-- the Customer Portal despite its own UI claiming "shared with buyers".
-- This adds a real ProjectId FK and backfills it from the existing
-- ProjectName text by matching against dbo.enterprise.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmConstructionUpdate') AND name = 'ProjectId')
BEGIN
  ALTER TABLE dbo.CrmConstructionUpdate ADD ProjectId INT NULL REFERENCES dbo.enterprise(id);
END
GO

UPDATE u
SET u.ProjectId = e.id
FROM dbo.CrmConstructionUpdate u
JOIN dbo.enterprise e ON e.name = u.ProjectName AND e.business_type = 'P'
WHERE u.ProjectId IS NULL;
GO

PRINT 'Migration 168 complete — Construction Updates linked to Unit Master projects';
