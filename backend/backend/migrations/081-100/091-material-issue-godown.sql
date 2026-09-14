-- ============================================================
-- Migration 091: Material Issues — Godown-based stock deduction
--
-- Changes:
--   1. Add GodownId to dbo.MaterialIssues (header-level source godown)
--   2. Drop dependent index before dropping reference columns
--   3. Drop ReferenceType, ReferenceId, ReferenceDocNo columns
--   4. Index on GodownId for fast lookup
-- Safe to run multiple times (all guarded with IF NOT/EXISTS).
-- ============================================================

-- ── 1. Add GodownId to MaterialIssues ────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues' AND COLUMN_NAME = 'GodownId'
)
  ALTER TABLE dbo.MaterialIssues
    ADD GodownId INT NULL
      REFERENCES dbo.Godowns(GodownID);
GO

-- ── 2. Drop the composite index that blocks column removal ────────────────────
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.MaterialIssues')
    AND name = 'IX_MI_ReferenceType_ReferenceId'
)
  DROP INDEX IX_MI_ReferenceType_ReferenceId ON dbo.MaterialIssues;
GO

-- ── 3. Drop reference columns (no longer needed) ──────────────────────────────
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues' AND COLUMN_NAME = 'ReferenceType'
)
  ALTER TABLE dbo.MaterialIssues DROP COLUMN ReferenceType;
GO

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues' AND COLUMN_NAME = 'ReferenceId'
)
  ALTER TABLE dbo.MaterialIssues DROP COLUMN ReferenceId;
GO

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues' AND COLUMN_NAME = 'ReferenceDocNo'
)
  ALTER TABLE dbo.MaterialIssues DROP COLUMN ReferenceDocNo;
GO

-- ── 4. Index on GodownId ──────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'IX_MI_GodownId'
)
  CREATE NONCLUSTERED INDEX IX_MI_GodownId
    ON dbo.MaterialIssues (GodownId);
GO

-- Backfill: point existing rows to the main godown so they remain consistent
UPDATE dbo.MaterialIssues
SET GodownId = (
  SELECT TOP 1 GodownID FROM dbo.Godowns
  WHERE IsMain = 1 AND IsDeleted = 0
  ORDER BY GodownID
)
WHERE GodownId IS NULL;
GO

PRINT '091-material-issue-godown applied successfully.';
GO
