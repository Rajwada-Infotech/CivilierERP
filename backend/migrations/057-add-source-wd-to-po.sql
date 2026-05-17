-- 057-add-source-wd-to-po.sql
-- Adds SourceWDId / SourceWDDocNo (Work Done → WO_PO) to PurchaseOrders.
-- Safe to run multiple times (idempotent).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceWDId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceWDId INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceWDDocNo'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceWDDocNo NVARCHAR(100) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'IX_PurchaseOrders_SourceWDId'
)
BEGIN
  CREATE INDEX IX_PurchaseOrders_SourceWDId
    ON dbo.PurchaseOrders (SourceWDId)
    WHERE SourceWDId IS NOT NULL;
END;
GO

PRINT '057-add-source-wd-to-po completed.';
