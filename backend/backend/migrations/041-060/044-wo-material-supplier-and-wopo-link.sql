-- Migration 044: WO Material Supplier per line + WO-PO linkage
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Each material line on a Work Order can now carry its own SupplierIdPerLine
--    (FK to AccountHeadMaster). This drives the auto WO-PO split logic.
-- 2. PurchaseOrders gets a SourceWOId column so WO-POs can be traced back to
--    their parent Work Order.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. SupplierIdPerLine on WorkOrderActivityMaterials
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.WorkOrderActivityMaterials')
    AND name = 'SupplierIdPerLine'
)
BEGIN
  ALTER TABLE dbo.WorkOrderActivityMaterials
    ADD SupplierIdPerLine INT NULL;
END;
GO

-- 2. SourceWOId on PurchaseOrders  (the WO that triggered auto-creation)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders')
    AND name = 'SourceWOId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceWOId INT NULL;
END;
GO

-- 3. Index for fast "show all WO-POs for a given WO" lookup
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders')
    AND name = 'IX_PurchaseOrders_SourceWOId'
)
BEGIN
  CREATE INDEX IX_PurchaseOrders_SourceWOId
    ON dbo.PurchaseOrders (SourceWOId)
    WHERE SourceWOId IS NOT NULL;
END;
GO
