-- ============================================================
-- Migration: 060-bill-status-tracking.sql
-- Adds bill status tracking columns to dbo.ExpenseBooking.
-- These are updated automatically by newPayment.js after every
-- approved payment against a booking.
--
-- New columns:
--   EBillStatus       NVARCHAR(20)   NULL  -- Payment Due | Partially Paid | Paid
--   ETotalPaid        DECIMAL(18,2)  NULL  -- sum of all approved payments
--   ERemainingAmount  DECIMAL(18,2)  NULL  -- ENetAmount - ETotalPaid
--
-- Safe to run multiple times (IF NOT EXISTS guards).
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'EBillStatus'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD EBillStatus NVARCHAR(20) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'ETotalPaid'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD ETotalPaid DECIMAL(18, 2) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking'
    AND COLUMN_NAME = 'ERemainingAmount'
)
  ALTER TABLE dbo.ExpenseBooking
    ADD ERemainingAmount DECIMAL(18, 2) NULL;
GO

-- Seed EBillStatus for existing approved expense bookings that already have payments
UPDATE eb
SET
  eb.ETotalPaid       = ISNULL(p.TotalPaid, 0),
  eb.ERemainingAmount = ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0)) - ISNULL(p.TotalPaid, 0),
  eb.EBillStatus      = CASE
    WHEN ISNULL(p.TotalPaid, 0) = 0 THEN 'Payment Due'
    WHEN ISNULL(p.TotalPaid, 0) >= ISNULL(eb.ENetAmount, ISNULL(eb.EAmount, 0)) THEN 'Paid'
    ELSE 'Partially Paid'
  END
FROM dbo.ExpenseBooking eb
OUTER APPLY (
  SELECT SUM(np.PAmount) AS TotalPaid
  FROM dbo.NewPayment np
  WHERE np.PExpenseRef = eb.EDocNo
    AND np.Status = 'Approved'
) p
WHERE eb.EStatus = 'Approved'
  AND eb.EDocNo IS NOT NULL;
GO

-- Index: filter/sort by bill status quickly
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.ExpenseBooking')
    AND name = 'IX_EB_EBillStatus'
)
  CREATE NONCLUSTERED INDEX IX_EB_EBillStatus
    ON dbo.ExpenseBooking (EBillStatus)
    WHERE EBillStatus IS NOT NULL;
GO

PRINT '060-bill-status-tracking applied successfully.';
GO
