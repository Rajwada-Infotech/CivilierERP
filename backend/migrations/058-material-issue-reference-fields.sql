-- ============================================================
-- Migration: 058-material-issue-reference-fields.sql
-- Adds source reference tracking and IssuedTo / CostCenter
-- fields to dbo.MaterialIssues for full spec compliance.
--
-- New columns on MaterialIssues:
--   ReferenceType   NVARCHAR(20)  NULL  -- 'GRN' | 'MR' | 'WORK_DONE'
--   ReferenceId     INT           NULL  -- FK to source record
--   ReferenceDocNo  NVARCHAR(100) NULL  -- human-readable doc number
--   IssuedTo        NVARCHAR(200) NULL  -- department / employee / project
--   CostCenter      NVARCHAR(200) NULL  -- cost centre or project code
--   Purpose         NVARCHAR(500) NULL  -- free-text consumption purpose
--
-- Safe to run multiple times (all guarded with IF NOT EXISTS).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'ReferenceType'
)
  ALTER TABLE dbo.MaterialIssues
    ADD ReferenceType NVARCHAR(20) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'ReferenceId'
)
  ALTER TABLE dbo.MaterialIssues
    ADD ReferenceId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'ReferenceDocNo'
)
  ALTER TABLE dbo.MaterialIssues
    ADD ReferenceDocNo NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'IssuedTo'
)
  ALTER TABLE dbo.MaterialIssues
    ADD IssuedTo NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'CostCenter'
)
  ALTER TABLE dbo.MaterialIssues
    ADD CostCenter NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues'
    AND COLUMN_NAME = 'Purpose'
)
  ALTER TABLE dbo.MaterialIssues
    ADD Purpose NVARCHAR(500) NULL;
GO

-- Index for fast lookup by reference source
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.MaterialIssues')
    AND name = 'IX_MI_ReferenceType_ReferenceId'
)
  CREATE NONCLUSTERED INDEX IX_MI_ReferenceType_ReferenceId
    ON dbo.MaterialIssues (ReferenceType, ReferenceId)
    WHERE ReferenceType IS NOT NULL AND ReferenceId IS NOT NULL;
GO

PRINT '058-material-issue-reference-fields applied successfully.';
GO
