-- Migration 347: Project is no longer mandatory on the Invoice
-- (Expense Booking) page.
--
-- dbo.ExpenseBooking.EProjectName was NOT NULL with no fallback default,
-- so every create/update path 400'd on a missing project ("EProjectName
-- is required.") purely because the column couldn't hold NULL — not
-- because a project is actually always known at booking time (e.g. a
-- standalone/company-level expense with no specific project). Widening
-- this to nullable, matching how EProjectName is already read elsewhere
-- (COALESCE/ISNULL against it, TRY_CAST tolerating non-numeric/blank).

IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'EProjectName' AND IS_NULLABLE = 'NO'
)
BEGIN
  ALTER TABLE dbo.ExpenseBooking ALTER COLUMN EProjectName NVARCHAR(150) NULL;
END
GO
