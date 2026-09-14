-- Migration 186: Track when supplies were dispatched + optional challan ref
-- Adds SuppliedDate (set when supplier ticks "Mark as Supplied") and
-- ChallanNumber (optional, prompted at the same time) to dbo.PurchaseOrders.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SuppliedDate'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SuppliedDate DATE NULL;
  PRINT 'Added SuppliedDate to PurchaseOrders';
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ChallanNumber'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD ChallanNumber NVARCHAR(100) NULL;
  PRINT 'Added ChallanNumber to PurchaseOrders';
END
