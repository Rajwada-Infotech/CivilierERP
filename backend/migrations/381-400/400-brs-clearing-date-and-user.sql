-- ============================================================
-- Migration 400: BRS bank clearing date + cleared-by audit trail.
--
-- BankReconciliation.UpdatedAt already exists but it's a generic "row last
-- touched" system timestamp, not something a user picks — there was no way
-- to record the actual date the bank cleared a transaction (as opposed to
-- whenever the operator happened to click the checkbox), and no record of
-- WHO cleared it. Same NVARCHAR(150) email convention every other audit
-- column in this codebase uses (CreatedBy/ApprovedBy/etc).
--
-- Cleared* columns describe the CURRENT clear state and are nulled out by
-- the unclear route (see routes/brs.js) — same overwrite convention
-- BounceDate/BounceReason already use, since clearing is no longer a
-- one-way lock (see that same migration's PR: unclear no longer 409s once
-- IsMatched=1).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BankReconciliation' AND COLUMN_NAME = 'BankClearingDate'
)
  ALTER TABLE dbo.BankReconciliation ADD BankClearingDate DATE NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BankReconciliation' AND COLUMN_NAME = 'ClearedBy'
)
  ALTER TABLE dbo.BankReconciliation ADD ClearedBy NVARCHAR(150) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'BankReconciliation' AND COLUMN_NAME = 'ClearedAt'
)
  ALTER TABLE dbo.BankReconciliation ADD ClearedAt DATETIME2 NULL;
GO

PRINT '400-brs-clearing-date-and-user applied successfully.';
GO
