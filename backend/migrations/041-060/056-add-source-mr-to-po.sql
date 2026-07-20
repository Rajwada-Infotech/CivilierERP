-- 056-add-source-mr-to-po.sql
-- Adds POType (Normal / Direct / WO_PO) and SourceMRId linkage to PurchaseOrders.
-- Safe to run multiple times.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'POType'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD POType NVARCHAR(20) NOT NULL CONSTRAINT DF_PurchaseOrders_POType DEFAULT 'Direct';
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceMRId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceMRId INT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SourceMRDocNo'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceMRDocNo NVARCHAR(100) NULL;
END;
GO

-- Back-fill: WO_PO for rows that already have SourceWOId
UPDATE dbo.PurchaseOrders
SET    POType = 'WO_PO'
WHERE  SourceWOId IS NOT NULL AND POType = 'Direct';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'IX_PurchaseOrders_SourceMRId'
)
BEGIN
  CREATE INDEX IX_PurchaseOrders_SourceMRId
    ON dbo.PurchaseOrders (SourceMRId)
    WHERE SourceMRId IS NOT NULL;
END;
GO

PRINT '056-add-source-mr-to-po completed.';
