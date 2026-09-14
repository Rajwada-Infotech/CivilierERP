-- Migration 184: Supplier Portal "Orders" — POs visible to their supplier
-- Adds supplier acknowledgment fields to PurchaseOrders and a comment thread
-- table (mirrors dbo.ticket_comments's shape) for PO<->supplier chat.

-- ── 1. PurchaseOrders — supplier acknowledgment ─────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SupplierAcknowledged'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SupplierAcknowledged BIT NOT NULL DEFAULT 0;
  PRINT 'Added SupplierAcknowledged to PurchaseOrders';
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'SupplierAcknowledgedAt'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrders
    ADD SupplierAcknowledgedAt DATETIME2 NULL;
  PRINT 'Added SupplierAcknowledgedAt to PurchaseOrders';
END

-- ── 2. PurchaseOrderComments — PO<->supplier chat thread ────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'PurchaseOrderComments'
)
BEGIN
  CREATE TABLE dbo.PurchaseOrderComments (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    PurchaseOrderId INT           NOT NULL,
    Comment         NVARCHAR(MAX) NOT NULL,
    AuthorName      NVARCHAR(200) NULL,
    AuthorId        INT           NULL,
    AuthorRole      NVARCHAR(50)  NULL,
    CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_POComments_PO FOREIGN KEY (PurchaseOrderId)
      REFERENCES dbo.PurchaseOrders(PurchaseOrderID) ON DELETE CASCADE
  );
  CREATE INDEX IX_POComments_PO ON dbo.PurchaseOrderComments(PurchaseOrderId, CreatedAt);
  PRINT 'Created dbo.PurchaseOrderComments';
END
ELSE
  PRINT 'dbo.PurchaseOrderComments already exists';
