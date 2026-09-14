-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: Add DocTypeId + DocNo to PurchaseOrders, WorkOrderHeader,
--                GoodsReceiptNotes and DebitNote
-- Safe to run multiple times (all changes guarded with IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PurchaseOrders ─────────────────────────────────────────────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocTypeId'
)
  ALTER TABLE dbo.PurchaseOrders ADD DocTypeId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocNo'
)
  ALTER TABLE dbo.PurchaseOrders ADD DocNo NVARCHAR(100) NULL;

-- ── 2. WorkOrderHeader ────────────────────────────────────────────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocTypeId'
)
  ALTER TABLE dbo.WorkOrderHeader ADD DocTypeId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocNo'
)
  ALTER TABLE dbo.WorkOrderHeader ADD DocNo NVARCHAR(100) NULL;

-- ── 3. GoodsReceiptNotes ──────────────────────────────────────────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocTypeId'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocTypeId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocNo'
)
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocNo NVARCHAR(100) NULL;

-- ── 4. DebitNote ──────────────────────────────────────────────────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DebitNote') AND name = 'doc_type_id'
)
  ALTER TABLE dbo.DebitNote ADD doc_type_id INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DebitNote') AND name = 'doc_no'
)
  ALTER TABLE dbo.DebitNote ADD doc_no NVARCHAR(100) NULL;

-- ── Optional FK constraints (comment out if TypeOfDoc table name differs) ─────
-- ALTER TABLE dbo.PurchaseOrders  ADD CONSTRAINT FK_PO_DocType    FOREIGN KEY (DocTypeId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
-- ALTER TABLE dbo.WorkOrderHeader ADD CONSTRAINT FK_WO_DocType    FOREIGN KEY (DocTypeId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
-- ALTER TABLE dbo.GoodsReceiptNotes ADD CONSTRAINT FK_GRN_DocType FOREIGN KEY (DocTypeId) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
-- ALTER TABLE dbo.DebitNote       ADD CONSTRAINT FK_DN_DocType    FOREIGN KEY (doc_type_id) REFERENCES dbo.TypeOfDoc(TypeOfDocId);
