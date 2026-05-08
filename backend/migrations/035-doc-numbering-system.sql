-- =============================================================================
-- Migration 035-FIX — Correct Document Numbering System
-- Civilier ERP
--
-- Fixes all errors from the first 035 run:
--   1. DocNoPrefix already exists in TypeOfDoc      → guarded with IF NOT EXISTS
--   2. UX_TypeOfDoc_DocNoPrefix index already exists → guarded
--   3. EntryType column doesn't exist               → removed (uses EntryTypeId FK)
--   4. RecordId already exists in DocNumberSequence → guarded
--   5. DocNoPrefix col in DocNumberSequence already → guarded
--   6. IX_MaterialIssues_DocNo already exists       → guarded
--   7. WorkOrders table doesn't exist               → correct name: WorkOrderHeader
--   8. Payments table doesn't exist                 → correct name: NewPayment
--   9. vw_DocLineage used dbo.Payments              → fixed to NewPayment/ReceivedPayment
-- =============================================================================

-- ── 1. TypeOfDoc — add DocNoPadding only if not already there ────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'DocNoPrefix'
)
  ALTER TABLE dbo.TypeOfDoc ADD DocNoPrefix NVARCHAR(30) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'DocNoPadding'
)
  ALTER TABLE dbo.TypeOfDoc ADD DocNoPadding INT NOT NULL DEFAULT 5;

GO

-- Unique index — only create if it doesn't already exist
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'UX_TypeOfDoc_DocNoPrefix'
)
  CREATE UNIQUE INDEX UX_TypeOfDoc_DocNoPrefix
    ON dbo.TypeOfDoc (DocNoPrefix)
    WHERE DocNoPrefix IS NOT NULL AND IsActive = 1;

GO

-- ── 2. Seed TypeOfDoc rows ───────────────────────────────────────────────────
-- Uses EntryTypeId (INT FK to Entry_Type) — NOT the non-existent EntryType column.
-- All INSERTs are guarded so they are safe to re-run.

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('PO', 'PO', 'PO', 'Purchase Order', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('WO', 'WO', 'WO', 'Work Order', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('GRN', 'GRN', 'GRN', 'Goods Received Note', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('PAY', 'PAY', 'PAY', 'Payment (Outgoing)', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'REC')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('REC', 'REC', 'REC', 'Received Payment (Incoming)', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ISS', 'ISS', 'ISS', 'Material / Stock Issue', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB', 'ExB', 'ExB', 'Expense Booking', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-PO', 'ExB-PO', 'ExB-PO', 'Expense Booking — Purchase Order', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-WO', 'ExB-WO', 'ExB-WO', 'Expense Booking — Work Order', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-GRN', 'ExB-GRN', 'ExB-GRN', 'Expense Booking — GRN (direct)', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-PO-GRN', 'ExB-PO-GRN', 'ExB-PO-GRN', 'Expense Booking — GRN against ExB-PO', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-WO-GRN', 'ExB-WO-GRN', 'ExB-WO-GRN', 'Expense Booking — GRN against ExB-WO', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-PAY', 'ExB-PAY', 'ExB-PAY', 'Expense Booking — Outgoing Payment', 1, 5, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, StartingDocNo, DocNoPadding, IsActive)
  VALUES ('ExB-ISS', 'ExB-ISS', 'ExB-ISS', 'Expense Booking — Material Issue', 1, 5, 1);

GO

-- ── 3. DocNumberSequence — add missing columns (all guarded) ─────────────────

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'DocNoPrefix'
)
  ALTER TABLE dbo.DocNumberSequence ADD DocNoPrefix NVARCHAR(30) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'DocYear'
)
  ALTER TABLE dbo.DocNumberSequence ADD DocYear SMALLINT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'DocSerial'
)
  ALTER TABLE dbo.DocNumberSequence ADD DocSerial INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'RecordId'
)
  ALTER TABLE dbo.DocNumberSequence ADD RecordId INT NULL;

GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence')
    AND name = 'IX_DocNumberSequence_PrefixYear'
)
  CREATE INDEX IX_DocNumberSequence_PrefixYear
    ON dbo.DocNumberSequence (DocNoPrefix, DocYear)
    WHERE DocNoPrefix IS NOT NULL;

GO

-- ── 4. MaterialIssues — add missing columns (all guarded) ────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'DocNo')
  ALTER TABLE dbo.MaterialIssues ADD DocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'DocTypeId')
  ALTER TABLE dbo.MaterialIssues ADD DocTypeId INT NULL REFERENCES dbo.TypeOfDoc(TypeOfDocId);

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'DocYear')
  ALTER TABLE dbo.MaterialIssues ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'DocSerial')
  ALTER TABLE dbo.MaterialIssues ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'ParentDocNo')
  ALTER TABLE dbo.MaterialIssues ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.MaterialIssues ADD RootExBDocNo NVARCHAR(100) NULL;

GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'IX_MaterialIssues_DocNo')
  CREATE INDEX IX_MaterialIssues_DocNo ON dbo.MaterialIssues (DocNo) WHERE DocNo IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.MaterialIssues') AND name = 'IX_MaterialIssues_DocYear')
  CREATE INDEX IX_MaterialIssues_DocYear ON dbo.MaterialIssues (DocYear, DocSerial) WHERE DocYear IS NOT NULL;

GO

-- ── 5. GoodsReceiptNotes ─────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocYear')
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocSerial')
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'ParentDocNo')
  ALTER TABLE dbo.GoodsReceiptNotes ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.GoodsReceiptNotes ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 6. PurchaseOrders ────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocYear')
  ALTER TABLE dbo.PurchaseOrders ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocSerial')
  ALTER TABLE dbo.PurchaseOrders ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ParentDocNo')
  ALTER TABLE dbo.PurchaseOrders ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.PurchaseOrders ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 7. WorkOrderHeader  (NOT "WorkOrders" — that table does not exist) ────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocYear')
  ALTER TABLE dbo.WorkOrderHeader ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocSerial')
  ALTER TABLE dbo.WorkOrderHeader ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'ParentDocNo')
  ALTER TABLE dbo.WorkOrderHeader ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.WorkOrderHeader ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 8. NewPayment  (NOT "Payments" — that table does not exist) ───────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocYear')
  ALTER TABLE dbo.NewPayment ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocSerial')
  ALTER TABLE dbo.NewPayment ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'ParentDocNo')
  ALTER TABLE dbo.NewPayment ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.NewPayment ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 9. ReceivedPayment — same pattern ────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'DocYear')
  ALTER TABLE dbo.ReceivedPayment ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'DocSerial')
  ALTER TABLE dbo.ReceivedPayment ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'ParentDocNo')
  ALTER TABLE dbo.ReceivedPayment ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.ReceivedPayment ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 10. ExpenseBooking ───────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.ExpenseBooking ADD RootExBDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'DocYear')
  ALTER TABLE dbo.ExpenseBooking ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'DocSerial')
  ALTER TABLE dbo.ExpenseBooking ADD DocSerial INT NULL;

GO

-- ── 11. vw_DocLineage — recreate with correct table names ────────────────────
-- Uses NewPayment and ReceivedPayment (the real tables in this DB).

CREATE OR ALTER VIEW dbo.vw_DocLineage AS
SELECT
  dns.DocNo,
  dns.DocNoPrefix,
  dns.DocYear,
  dns.DocSerial,
  dns.TableName,
  dns.RecordId,
  dns.IssuedBy,
  -- Resolve ParentDocNo from whichever table holds this DocNo
  COALESCE(
    (SELECT TOP 1 ParentDocNo FROM dbo.GoodsReceiptNotes  WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.MaterialIssues     WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.NewPayment         WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.ReceivedPayment    WHERE DocNo = dns.DocNo)
  ) AS ParentDocNo,
  -- Resolve RootExBDocNo
  COALESCE(
    (SELECT TOP 1 RootExBDocNo FROM dbo.GoodsReceiptNotes  WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.MaterialIssues     WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.NewPayment         WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.ExpenseBooking     WHERE EDocNo = dns.DocNo)
  ) AS RootExBDocNo
FROM dbo.DocNumberSequence dns;

GO

PRINT 'Migration 035-FIX completed successfully — 0 errors expected.';
