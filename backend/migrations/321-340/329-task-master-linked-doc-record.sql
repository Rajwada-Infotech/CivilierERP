-- Migration 329: Task Master linked document record — once a task's Entry
-- Type -> Type of Doc chain resolves to a module (via that TypeOfDoc's
-- links_to label), the new Doc Selector combobox (GET /api/doc-selector)
-- lets the user pick an ACTUAL document row (a real PO, GRN, Work Order...)
-- rather than just the doc-numbering definition LinkedTypeOfDocId already
-- points at.
--
-- LinkedDocRecordId is intentionally NOT a foreign key — it's polymorphic,
-- referencing whichever table LinkedTypeOfDocId's links_to resolves to
-- (dbo.PurchaseOrders, dbo.GoodsReceiptNotes, dbo.WorkOrderHeader, ...), so
-- a single FK constraint isn't possible. LinkedDocNo is a denormalized
-- snapshot of the document's number at selection time, so the grid/view can
-- display it without a dynamic cross-table join on every read.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'LinkedDocRecordId'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD LinkedDocRecordId INT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TaskMaster') AND name = 'LinkedDocNo'
)
BEGIN
  ALTER TABLE dbo.TaskMaster ADD LinkedDocNo NVARCHAR(50) NULL;
END
GO
