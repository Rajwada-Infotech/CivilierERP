-- Migration 148: Add CostCenterId and VendorInvoiceDate to PurchaseOrders

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'CostCenterId'
)
  ALTER TABLE dbo.PurchaseOrders ADD CostCenterId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'VendorInvoiceDate'
)
  ALTER TABLE dbo.PurchaseOrders ADD VendorInvoiceDate DATE NULL;

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PurchaseOrders' AND COLUMN_NAME = 'VendorInvoiceNo'
)
  ALTER TABLE dbo.PurchaseOrders ADD VendorInvoiceNo NVARCHAR(100) NULL;
