-- ============================================================
-- Migration: 036-brs-source-columns.sql
-- Extends BankReconciliation to reference both NewPayment
-- and ReceivedPayment rows, enabling the unified BRS view.
-- Safe to run multiple times (all changes are guarded).
-- ============================================================

-- Add SourceType column (PAYMENT | RECEIVED)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'BankReconciliation'
    AND COLUMN_NAME  = 'SourceType'
)
  ALTER TABLE dbo.BankReconciliation
  ADD SourceType NVARCHAR(20) NULL;
GO

-- Add SourceID column (FK value in source table)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'BankReconciliation'
    AND COLUMN_NAME  = 'SourceID'
)
  ALTER TABLE dbo.BankReconciliation
  ADD SourceID INT NULL;
GO

-- Add UpdatedAt column
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'BankReconciliation'
    AND COLUMN_NAME  = 'UpdatedAt'
)
  ALTER TABLE dbo.BankReconciliation
  ADD UpdatedAt DATETIME2 NULL;
GO

-- Performance index for the unified JOIN
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_BankReconciliation_Source'
)
  CREATE NONCLUSTERED INDEX IX_BankReconciliation_Source
  ON dbo.BankReconciliation (SourceType, SourceID)
  INCLUDE (IsMatched, BRSID);
GO

PRINT '036-brs-source-columns applied successfully.';
GO
