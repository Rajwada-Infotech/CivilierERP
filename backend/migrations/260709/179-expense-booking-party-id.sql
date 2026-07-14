-- Migration 179: Add LHeadId to ExpenseBooking
-- Stores the supplier / contractor party ID directly on the booking so that
-- party resolution works for direct-payment invoices (INV/PAY/...) that have
-- no linked GRN, PO, or WorkDone source to derive the party from.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'ExpenseBooking'
    AND COLUMN_NAME  = 'LHeadId'
)
BEGIN
  ALTER TABLE dbo.ExpenseBooking
    ADD LHeadId INT NULL
      REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Column LHeadId added to ExpenseBooking.';
END
ELSE
  PRINT 'Column LHeadId already exists on ExpenseBooking — skipped.';
GO
