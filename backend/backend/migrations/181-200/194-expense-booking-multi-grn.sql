-- ============================================================
-- Migration: 194-expense-booking-multi-grn.sql
--
-- Adds ELinkedGrnIds to dbo.ExpenseBooking — a JSON array of GRN IDs for
-- invoices that combine multiple GRNs raised against the same Purchase
-- Order into one total-amount invoice (see backend/services/
-- invoiceLinking.js: computeMultiGRNInvoice).
--
-- The existing ESourceType/ESourceId pair keeps pointing at the primary
-- (first) linked GRN for backward compatibility with the many existing
-- joins keyed on eb.ESourceType='GRN' AND eb.ESourceId — those still work
-- unchanged for both single- and multi-GRN bookings. ELinkedGrnIds is
-- additive: NULL for every existing/ordinary single-source booking, and
-- for multi-GRN bookings it's how the full combined set is recovered.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'ELinkedGrnIds'
)
BEGIN
    ALTER TABLE dbo.ExpenseBooking
        ADD ELinkedGrnIds NVARCHAR(MAX) NULL;

    PRINT 'dbo.ExpenseBooking.ELinkedGrnIds added.';
END
ELSE
    PRINT 'dbo.ExpenseBooking.ELinkedGrnIds already exists — skipped.';
GO

PRINT '================================================================';
PRINT '194-expense-booking-multi-grn applied successfully.';
PRINT '================================================================';
GO
