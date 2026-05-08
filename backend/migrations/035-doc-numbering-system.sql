-- =============================================================================
-- Migration 035-FIX4 — Correct Document Numbering System
-- Civilier ERP
-- Fix: EntryTypeId is uniqueidentifier FK to Entry_Type.E_Id (NOT NULL).
-- We look up the correct E_Id by EntryType name at runtime.
-- =============================================================================

-- ── 1. TypeOfDoc — add columns if not already there ──────────────────────────
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

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'UX_TypeOfDoc_DocNoPrefix'
)
  CREATE UNIQUE INDEX UX_TypeOfDoc_DocNoPrefix
    ON dbo.TypeOfDoc (DocNoPrefix)
    WHERE DocNoPrefix IS NOT NULL AND IsActive = 1;
GO

-- ── 2. Seed TypeOfDoc rows ───────────────────────────────────────────────────
-- Resolve E_Id GUIDs from Entry_Type by EntryType name.
DECLARE @EId_PO   UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Purchase Order');
DECLARE @EId_REC  UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Received Payment');
DECLARE @EId_WO   UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Work Order');
DECLARE @EId_OTH  UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Other Expense');

-- Fallback: if a specific type is missing, use any valid E_Id
DECLARE @EId_ANY  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

-- Use the most appropriate type for each doc prefix, falling back to @EId_ANY
DECLARE @EId_GRN  UNIQUEIDENTIFIER = ISNULL(@EId_PO,  @EId_ANY);  -- GRN is purchase-side
DECLARE @EId_PAY  UNIQUEIDENTIFIER = ISNULL(@EId_OTH, @EId_ANY);  -- outgoing payment
DECLARE @EId_ISS  UNIQUEIDENTIFIER = ISNULL(@EId_OTH, @EId_ANY);  -- material issue
DECLARE @EId_ExB  UNIQUEIDENTIFIER = ISNULL(@EId_OTH, @EId_ANY);  -- expense booking

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

PRINT 'EntryType GUIDs resolved — seeding TypeOfDoc...';

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('PO', 'PO', 'Purchase Order', 1, 5, 1, ISNULL(@EId_PO, @EId_ANY), 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('WO', 'WO', 'Work Order', 1, 5, 1, ISNULL(@EId_WO, @EId_ANY), 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('GRN', 'GRN', 'Goods Received Note', 1, 5, 1, @EId_GRN, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('PAY', 'PAY', 'Payment (Outgoing)', 1, 5, 1, @EId_PAY, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'REC')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('REC', 'REC', 'Received Payment (Incoming)', 1, 5, 1, ISNULL(@EId_REC, @EId_ANY), 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ISS', 'ISS', 'Material / Stock Issue', 1, 5, 1, @EId_ISS, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB', 'ExB', 'Expense Booking', 1, 5, 1, @EId_ExB, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-PO', 'ExB-PO', 'Expense Booking — Purchase Order', 1, 5, 1, ISNULL(@EId_PO, @EId_ANY), 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-WO', 'ExB-WO', 'Expense Booking — Work Order', 1, 5, 1, ISNULL(@EId_WO, @EId_ANY), 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-GRN', 'ExB-GRN', 'Expense Booking — GRN (direct)', 1, 5, 1, @EId_GRN, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-PO-GRN', 'ExB-PO-GRN', 'Expense Booking — GRN against ExB-PO', 1, 5, 1, @EId_GRN, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-WO-GRN', 'ExB-WO-GRN', 'Expense Booking — GRN against ExB-WO', 1, 5, 1, @EId_GRN, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-PAY', 'ExB-PAY', 'Expense Booking — Outgoing Payment', 1, 5, 1, @EId_PAY, 'migration', GETDATE());

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES ('ExB-ISS', 'ExB-ISS', 'Expense Booking — Material Issue', 1, 5, 1, @EId_ISS, 'migration', GETDATE());

PRINT 'TypeOfDoc seed complete.';
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

-- ── 4. MaterialIssues ────────────────────────────────────────────────────────
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

-- ── 7. WorkOrderHeader ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocYear')
  ALTER TABLE dbo.WorkOrderHeader ADD DocYear SMALLINT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'DocSerial')
  ALTER TABLE dbo.WorkOrderHeader ADD DocSerial INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'ParentDocNo')
  ALTER TABLE dbo.WorkOrderHeader ADD ParentDocNo NVARCHAR(100) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrderHeader') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.WorkOrderHeader ADD RootExBDocNo NVARCHAR(100) NULL;
GO

-- ── 8. NewPayment ────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocNo')
  ALTER TABLE dbo.NewPayment ADD DocNo NVARCHAR(100) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocTypeId')
  ALTER TABLE dbo.NewPayment ADD DocTypeId INT NULL REFERENCES dbo.TypeOfDoc(TypeOfDocId);
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocYear')
  ALTER TABLE dbo.NewPayment ADD DocYear SMALLINT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'DocSerial')
  ALTER TABLE dbo.NewPayment ADD DocSerial INT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'ParentDocNo')
  ALTER TABLE dbo.NewPayment ADD ParentDocNo NVARCHAR(100) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.NewPayment ADD RootExBDocNo NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'IX_NewPayment_DocNo')
  CREATE INDEX IX_NewPayment_DocNo ON dbo.NewPayment (DocNo) WHERE DocNo IS NOT NULL;
GO

-- ── 9. ReceivedPayment ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'DocNo')
  ALTER TABLE dbo.ReceivedPayment ADD DocNo NVARCHAR(100) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ReceivedPayment') AND name = 'DocTypeId')
  ALTER TABLE dbo.ReceivedPayment ADD DocTypeId INT NULL REFERENCES dbo.TypeOfDoc(TypeOfDocId);
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

-- 11. DocNumberSequence unique constraint
-- Required for lockNextDocNumber collision-retry logic to work correctly.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence')
    AND name = 'UQ_DocNumberSequence_DocNo'
)
BEGIN
  ALTER TABLE dbo.DocNumberSequence
    ADD CONSTRAINT UQ_DocNumberSequence_DocNo UNIQUE (DocNo);
  PRINT '  + UQ_DocNumberSequence_DocNo unique constraint added';
END
ELSE
  PRINT '  ~ UQ_DocNumberSequence_DocNo already exists';
GO

-- ── 12. vw_DocLineage ────────────────────────────────────────────────────────
CREATE OR ALTER VIEW dbo.vw_DocLineage AS
SELECT
  dns.DocNo,
  dns.DocNoPrefix,
  dns.DocYear,
  dns.DocSerial,
  dns.TableName,
  dns.RecordId,
  dns.IssuedBy,
  COALESCE(
    (SELECT TOP 1 ParentDocNo FROM dbo.GoodsReceiptNotes WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.MaterialIssues     WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.NewPayment         WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 ParentDocNo FROM dbo.ReceivedPayment    WHERE DocNo = dns.DocNo)
  ) AS ParentDocNo,
  COALESCE(
    (SELECT TOP 1 RootExBDocNo FROM dbo.GoodsReceiptNotes WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.MaterialIssues    WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.NewPayment        WHERE DocNo = dns.DocNo),
    (SELECT TOP 1 RootExBDocNo FROM dbo.ExpenseBooking    WHERE EDocNo = dns.DocNo)
  ) AS RootExBDocNo
FROM dbo.DocNumberSequence dns;
GO

PRINT 'Migration 035-FIX4 completed successfully.';
PRINT '  DocNumberSequence - UQ_DocNumberSequence_DocNo unique constraint';
