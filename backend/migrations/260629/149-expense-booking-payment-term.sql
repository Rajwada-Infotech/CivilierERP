-- Migration 149: Add PaymentTermId to ExpenseBooking

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'PaymentTermId'
)
  ALTER TABLE dbo.ExpenseBooking ADD PaymentTermId INT NULL;
