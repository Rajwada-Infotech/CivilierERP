-- Adds EIgstRate to ExpenseBooking so direct/manual (TOD) bookings can be
-- taxed as IGST instead of CGST+SGST. EPaymentType/EPartialAmount already
-- exist on this table (added in an earlier migration) but were never wired
-- up by the application — this migration only adds the missing GST column;
-- the payment-type/partial-amount wiring is purely backend/frontend code.
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ExpenseBooking' AND COLUMN_NAME = 'EIgstRate'
)
    ALTER TABLE dbo.ExpenseBooking ADD EIgstRate DECIMAL(5, 2) NULL DEFAULT 0;
