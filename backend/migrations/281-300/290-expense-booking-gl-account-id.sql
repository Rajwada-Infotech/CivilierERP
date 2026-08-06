-- Migration 290: Add EGLAccountId to ExpenseBooking
-- Replaces the old free-text EGLAccount field with a proper FK into
-- dbo.AccountHeadMaster (LHeadType='GL') so invoices post against a real
-- GL ledger head chosen from the General Ledger master, instead of an
-- arbitrary typed string. EGLAccount (text) is kept for backward
-- compatibility / legacy records and is now just a display fallback.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'ExpenseBooking'
    AND COLUMN_NAME  = 'EGLAccountId'
)
BEGIN
  ALTER TABLE dbo.ExpenseBooking
    ADD EGLAccountId INT NULL
      REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Column EGLAccountId added to ExpenseBooking.';
END
ELSE
  PRINT 'Column EGLAccountId already exists on ExpenseBooking — skipped.';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ExpenseBooking')
    AND name = 'IX_EB_EGLAccountId'
)
  CREATE NONCLUSTERED INDEX IX_EB_EGLAccountId
    ON dbo.ExpenseBooking (EGLAccountId)
    WHERE EGLAccountId IS NOT NULL;
GO

PRINT '290-expense-booking-gl-account-id applied successfully.';
GO
