-- Migration 040: WO-PO auto-creation support
-- Adds per-material supplier selection and WO→PO back-link columns.
-- All columns are nullable — no data loss, safe on existing rows.

-- 1. SupplierIdPerLine on materials: lets each material line carry its own supplier
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.WorkOrderActivityMaterials')
    AND name = N'SupplierIdPerLine'
)
  ALTER TABLE dbo.WorkOrderActivityMaterials
    ADD SupplierIdPerLine INT NULL;
GO

-- 2. FK to AccountHeadMaster for SupplierIdPerLine
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_WOAMaterials_SupplierIdPerLine'
)
  ALTER TABLE dbo.WorkOrderActivityMaterials
    ADD CONSTRAINT FK_WOAMaterials_SupplierIdPerLine
    FOREIGN KEY (SupplierIdPerLine) REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

-- 3. SourceWOId: links a WO-PO back to its originating Work Order
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders')
    AND name = N'SourceWOId'
)
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceWOId INT NULL;
GO

-- 4. SourceWODocNo: human-readable WO doc number for display/search
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.PurchaseOrders')
    AND name = N'SourceWODocNo'
)
  ALTER TABLE dbo.PurchaseOrders
    ADD SourceWODocNo NVARCHAR(100) NULL;
GO

-- 5. FK from PurchaseOrders back to WorkOrderHeader
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_PurchaseOrders_SourceWO'
)
  ALTER TABLE dbo.PurchaseOrders
    ADD CONSTRAINT FK_PurchaseOrders_SourceWO
    FOREIGN KEY (SourceWOId) REFERENCES dbo.WorkOrderHeader(Id);
GO
