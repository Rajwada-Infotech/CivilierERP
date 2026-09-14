-- ============================================================
-- Migration: 059-expense-booking-invoice-allocation.sql
-- Adds vendor invoice tracking, additional charges JSON, and
-- expense allocation fields to dbo.ExpenseBooking per spec Step 6.
--
-- New columns:
--   EVendorInvoiceNo    NVARCHAR(100)  NULL  -- supplier's invoice number
--   EVendorInvoiceDate  DATE           NULL  -- supplier's invoice date
--   EAdditionalCharges  NVARCHAR(MAX)  NULL  -- JSON array of {label, amount}
--   ECostCenter         NVARCHAR(200)  NULL  -- cost centre / department
--   EGLAccount          NVARCHAR(200)  NULL  -- GL account code/name
--   EWorkDoneRef        NVARCHAR(100)  NULL  -- Work Done doc reference (auto-set)
--
-- Safe to run multiple times (all guards with IF NOT EXISTS).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EVendorInvoiceNo'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EVendorInvoiceNo NVARCHAR(100) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EVendorInvoiceDate'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EVendorInvoiceDate DATE NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EAdditionalCharges'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EAdditionalCharges NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'ECostCenter'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD ECostCenter NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EGLAccount'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EGLAccount NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EWorkDoneRef'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EWorkDoneRef NVARCHAR(100) NULL;
GO

-- Index: fast lookup of bookings by vendor invoice number (dedup / matching)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ExpenseBooking')
    AND name = 'IX_EB_EVendorInvoiceNo'
)
  CREATE NONCLUSTERED INDEX IX_EB_EVendorInvoiceNo
    ON dbo.ExpenseBooking (EVendorInvoiceNo)
    WHERE EVendorInvoiceNo IS NOT NULL;
GO

PRINT '059-expense-booking-invoice-allocation applied successfully.';
GO
