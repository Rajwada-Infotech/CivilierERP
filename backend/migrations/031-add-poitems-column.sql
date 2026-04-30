-- Migration 031: Add POItems column to PurchaseOrders table
-- This allows storing multiple line items as a JSON array
-- Each item in the array has: { itemDescription, quantity, unit, rate, amount }

-- Check if column exists, if not add it
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'POItems'
)
BEGIN
    ALTER TABLE dbo.PurchaseOrders ADD POItems NVARCHAR(MAX) NULL;
    PRINT 'Column POItems added to PurchaseOrders table';
END
ELSE
BEGIN
    PRINT 'Column POItems already exists in PurchaseOrders table';
END
GO
