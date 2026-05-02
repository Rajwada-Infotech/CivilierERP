-- Add GST column to PurchaseOrders table
-- Stores GST configuration as JSON: {"applicable": true, "type": "cgst_sgst", "rate": 18}
IF NOT EXISTS (SELECT * FROM sys.columns WHERE Object_ID = Object_ID('dbo.PurchaseOrders') AND name = 'GST')
BEGIN
    ALTER TABLE dbo.PurchaseOrders ADD GST NVARCHAR(MAX) NULL
    PRINT 'Added GST column to PurchaseOrders table'
END
ELSE
BEGIN
    PRINT 'GST column already exists in PurchaseOrders table'
END
GO

-- Add GST column to WorkOrderHeader table
IF NOT EXISTS (SELECT * FROM sys.columns WHERE Object_ID = Object_ID('dbo.WorkOrderHeader') AND name = 'GST')
BEGIN
    ALTER TABLE dbo.WorkOrderHeader ADD GST NVARCHAR(MAX) NULL
    PRINT 'Added GST column to WorkOrderHeader table'
END
ELSE
BEGIN
    PRINT 'GST column already exists in WorkOrderHeader table'
END
GO

PRINT 'Migration complete: Added GST columns'
