-- Migration 673: a Material Request can be raised from an approved BOQ (same as from a Work Order, migration 545).
--
-- dbo.MaterialRequests gets SourceBoqId / SourceBoqDocNo. Both nullable: existing MRs stay as they are.
-- No foreign key on purpose, matching SourceWOId.

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequests' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  IF COL_LENGTH('dbo.MaterialRequests', 'SourceBoqId') IS NULL
    ALTER TABLE dbo.MaterialRequests ADD SourceBoqId INT NULL;
  IF COL_LENGTH('dbo.MaterialRequests', 'SourceBoqDocNo') IS NULL
    ALTER TABLE dbo.MaterialRequests ADD SourceBoqDocNo NVARCHAR(100) NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MaterialRequests' AND schema_id = SCHEMA_ID('dbo'))
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MaterialRequests_SourceBoqId' AND object_id = OBJECT_ID('dbo.MaterialRequests'))
  EXEC('CREATE INDEX IX_MaterialRequests_SourceBoqId ON dbo.MaterialRequests(SourceBoqId) WHERE SourceBoqId IS NOT NULL');
GO

PRINT '673-material-request-source-boq applied successfully.';
GO
