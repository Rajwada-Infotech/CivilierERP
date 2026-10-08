-- Migration 547: a Material Issue can be tagged with the Work Order whose materials it is issued against.
--
-- dbo.MaterialIssues gets SourceWOId / SourceWODocNo (same pattern as MaterialRequests.SourceWOId, migration 545) so
-- the issue screen can compare what the work order listed with what has actually been issued. Both nullable: every
-- existing issue, and every issue raised without a work order, stays as it is. No foreign key, to match the rest.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialIssues' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  IF COL_LENGTH('dbo.MaterialIssues', 'SourceWOId') IS NULL
    ALTER TABLE dbo.MaterialIssues ADD SourceWOId INT NULL;
  IF COL_LENGTH('dbo.MaterialIssues', 'SourceWODocNo') IS NULL
    ALTER TABLE dbo.MaterialIssues ADD SourceWODocNo NVARCHAR(100) NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialIssues' AND schema_id = SCHEMA_ID('dbo'))
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MaterialIssues_SourceWOId' AND object_id = OBJECT_ID('dbo.MaterialIssues'))
  EXEC('CREATE INDEX IX_MaterialIssues_SourceWOId ON dbo.MaterialIssues(SourceWOId) WHERE SourceWOId IS NOT NULL');
GO

PRINT '547-material-issue-source-work-order applied successfully.';
GO
