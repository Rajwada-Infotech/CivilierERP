-- ============================================================
-- Migration: 034-payment-mode-columns.sql
-- Adds cheque, post-dated cheque, and digital reference
-- columns to dbo.NewPayment, plus Status column.
-- Safe to run multiple times (all ALTER COLUMNs are guarded).
-- ============================================================

-- Status column (Draft / Pending / Approved / Rejected)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'Status'
)
  ALTER TABLE dbo.NewPayment ADD Status NVARCHAR(20) NOT NULL DEFAULT 'Draft';
GO

-- ── Cheque columns ────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeNo'
)
  ALTER TABLE dbo.NewPayment ADD PChequeNo NVARCHAR(50) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeLotId'
)
  ALTER TABLE dbo.NewPayment ADD PChequeLotId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeLotNumber'
)
  ALTER TABLE dbo.NewPayment ADD PChequeLotNumber NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeDate'
)
  ALTER TABLE dbo.NewPayment ADD PChequeDate DATE NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeAccountNumber'
)
  ALTER TABLE dbo.NewPayment ADD PChequeAccountNumber NVARCHAR(50) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PChequeIfsc'
)
  ALTER TABLE dbo.NewPayment ADD PChequeIfsc NVARCHAR(20) NULL;
GO

-- Post-dated flag
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PIsPostDated'
)
  ALTER TABLE dbo.NewPayment ADD PIsPostDated BIT NOT NULL DEFAULT 0;
GO

-- ── Digital reference columns ─────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PNeftNumber'
)
  ALTER TABLE dbo.NewPayment ADD PNeftNumber NVARCHAR(50) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PUpiTransactionId'
)
  ALTER TABLE dbo.NewPayment ADD PUpiTransactionId NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PRtgsReference'
)
  ALTER TABLE dbo.NewPayment ADD PRtgsReference NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PImpsReference'
)
  ALTER TABLE dbo.NewPayment ADD PImpsReference NVARCHAR(100) NULL;
GO

-- ── Optional FK to ChequeMaster ───────────────────────────────
-- Uncomment if you want referential integrity on the lot link:
-- ALTER TABLE dbo.NewPayment
--   ADD CONSTRAINT FK_NewPayment_ChequeMaster
--   FOREIGN KEY (PChequeLotId) REFERENCES dbo.ChequeMaster(CId);
-- GO

-- ── Backfill Status for existing rows ────────────────────────
UPDATE dbo.NewPayment SET Status = 'Draft' WHERE Status IS NULL OR Status = '';
GO

PRINT 'Migration 034-payment-mode-columns applied successfully.';
GO
