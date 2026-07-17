-- ============================================================
-- Migration: 092-material-issues-status.sql
-- Adds Status column to dbo.MaterialIssues so Issues can
-- participate in the approval workflow (Draft → Pending →
-- Approved | Rejected), matching all other transaction tables.
-- Safe to run multiple times (guarded with IF NOT EXISTS).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'MaterialIssues'
    AND COLUMN_NAME  = 'Status'
)
BEGIN
  ALTER TABLE dbo.MaterialIssues
    ADD Status NVARCHAR(20) NOT NULL DEFAULT 'Pending';

  -- Back-fill existing rows to 'Pending' so they surface in
  -- the approval queue rather than being silently ignored.
  UPDATE dbo.MaterialIssues SET Status = 'Pending' WHERE Status IS NULL;

  PRINT '092: Status column added to MaterialIssues.';
END
ELSE
  PRINT '092: Status column already exists on MaterialIssues — skipped.';
GO
