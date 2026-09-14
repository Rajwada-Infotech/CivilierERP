-- ============================================================
-- Migration: 111-approval-workflows-leveldata-column.sql
--
-- Root cause: migration 101 tried to add a JSON-string column named
-- 'levels', guarded by:
--   IF NOT EXISTS (... WHERE COLUMN_NAME = 'levels')
-- but the table already had a column 'Levels' (INT) from migration
-- 022. INFORMATION_SCHEMA.COLUMNS comparisons use the server's
-- default (case-insensitive) collation, so that EXISTS check matched
-- the old 'Levels' column and the ALTER TABLE ADD was skipped.
-- The application code (approvalWorkflows.js, approvalService.js)
-- has been reading/writing a column it assumed was named 'levels'
-- holding JSON, but no such column was ever actually created —
-- only the legacy INT 'Levels' (just a count) exists.
--
-- Fix: add a distinctly-named column, LevelsData, to hold the JSON
-- ApprovalLevel[] array, and leave the legacy 'Levels' INT column
-- alone (still maintained as a simple level count for any old code
-- that reads it).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'ApprovalWorkflows'
      AND COLUMN_NAME = 'LevelsData'
)
BEGIN
    ALTER TABLE dbo.ApprovalWorkflows
    ADD LevelsData NVARCHAR(MAX) NOT NULL DEFAULT '[]';

    PRINT 'LevelsData column added to ApprovalWorkflows.';
END
ELSE
    PRINT 'LevelsData column already exists on ApprovalWorkflows.';
GO

PRINT '================================================================';
PRINT '111-approval-workflows-leveldata-column applied successfully.';
PRINT '================================================================';
GO
