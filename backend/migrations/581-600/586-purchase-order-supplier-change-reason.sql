-- Migration 586: why a PO went to a supplier other than the lowest (L1) one on the quotation raised for its Material
-- Request. Required whenever that happens; the directors are told. Until this runs the reason is kept in Remarks.

IF COL_LENGTH('dbo.PurchaseOrders', 'SupplierChangeReason') IS NULL
BEGIN
    ALTER TABLE dbo.PurchaseOrders ADD SupplierChangeReason NVARCHAR(1000) NULL;
    PRINT 'Added dbo.PurchaseOrders.SupplierChangeReason';
END
GO
