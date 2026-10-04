-- Migration 497: Vehicle In/Out line items gain an optional Brand field.
-- Free-text, captured per line at entry time alongside Qty This Lot /
-- Quality / Photo — not sourced from the PO item (PurchaseOrderItems has
-- no Brand column), since the same ordered item can arrive under different
-- brands lot to lot.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.VehicleInOutItems') AND name = 'Brand')
  ALTER TABLE dbo.VehicleInOutItems ADD Brand NVARCHAR(100) NULL;
GO

PRINT '497-vehicle-in-out-item-brand applied successfully.';
GO
