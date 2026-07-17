-- Add Discount column to PurchaseOrders table for billing terms support
IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'Discount'
)
BEGIN
    ALTER TABLE dbo.PurchaseOrders ADD Discount NVARCHAR(MAX) NULL;
END
GO
