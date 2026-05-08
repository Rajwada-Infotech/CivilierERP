-- =============================================================================
-- Migration 035 — Full Document Numbering System
-- Civilier ERP  |  Apply once against the target database
-- =============================================================================
-- Changes:
--   1. TypeOfDoc          — add DocNoPrefix, DocNoPadding columns + ISS seed row
--   2. DocNumberSequence  — add DocNoPrefix, DocYear, DocSerial, RecordId cols
--   3. MaterialIssues     — add DocNo, DocTypeId, DocYear, DocSerial,
--                           ParentDocNo, RootExBDocNo; rename IssueNo → IssueNo
--                           (kept for backward compat), index on DocNo
--   4. GoodsReceiptNotes  — add ParentDocNo, RootExBDocNo, DocYear, DocSerial
--   5. PurchaseOrders     — add ParentDocNo, RootExBDocNo, DocYear, DocSerial
--   6. WorkOrders         — add ParentDocNo, RootExBDocNo, DocYear, DocSerial
--   7. Payments           — add ParentDocNo, RootExBDocNo, DocYear, DocSerial
--   8. ExpenseBooking     — add RootExBDocNo (self-reference), DocYear, DocSerial
-- =============================================================================

-- ── 1. TypeOfDoc ─────────────────────────────────────────────────────────────

ALTER TABLE dbo.TypeOfDoc
  ADD DocNoPrefix  NVARCHAR(30)  NULL,         -- e.g. "ExB-PO-GRN", "ISS", "PAY"
      DocNoPadding INT           NOT NULL DEFAULT 5;  -- zero-pad width for serial

GO

-- Unique constraint: one active row per prefix
CREATE UNIQUE INDEX UX_TypeOfDoc_DocNoPrefix
  ON dbo.TypeOfDoc (DocNoPrefix)
  WHERE DocNoPrefix IS NOT NULL AND IsActive = 1;

GO

-- ── 1a. Seed: standard document types (INSERT IGNORE pattern) ────────────────
-- Only insert if a row with that DocNoPrefix doesn't already exist.

-- PO (normal)
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('PO', 'PO', 'PO', 'Purchase Order', 'PO', 5, 1, 1);

-- WO (normal)
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('WO', 'WO', 'WO', 'Work Order', 'WO', 5, 1, 1);

-- GRN (normal — against a plain PO)
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('GRN', 'GRN', 'GRN', 'Goods Received Note', 'GRN', 5, 1, 1);

-- PAY — outgoing payment
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('PAY', 'PAY', 'PAY', 'Payment (Outgoing)', 'PAY', 5, 1, 1);

-- REC — incoming received payment
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'REC')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('REC', 'REC', 'REC', 'Received Payment (Incoming)', 'REC', 5, 1, 1);

-- ISS — Material / Stock Issue  ← NEW
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ISS', 'ISS', 'ISS', 'Material / Stock Issue', 'ISS', 5, 1, 1);

-- ExB — Expense Booking (root document)
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB', 'ExB', 'ExB', 'Expense Booking', 'ExB', 5, 1, 1);

-- ExB child types
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-PO', 'ExB-PO', 'ExB-PO', 'Expense Booking — Purchase Order', 'PO', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-WO', 'ExB-WO', 'ExB-WO', 'Expense Booking — Work Order', 'WO', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-GRN', 'ExB-GRN', 'ExB-GRN', 'Expense Booking — GRN (direct)', 'GRN', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-PO-GRN', 'ExB-PO-GRN', 'ExB-PO-GRN', 'Expense Booking — GRN against ExB-PO', 'GRN', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-WO-GRN')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-WO-GRN', 'ExB-WO-GRN', 'ExB-WO-GRN', 'Expense Booking — GRN against ExB-WO', 'GRN', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-PAY')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-PAY', 'ExB-PAY', 'ExB-PAY', 'Expense Booking — Outgoing Payment', 'PAY', 5, 1, 1);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'ExB-ISS')
  INSERT INTO dbo.TypeOfDoc (DocNoPrefix, Prefix, FullPrefix, Description, EntryType, DocNoPadding, IsActive, StartingDocNo)
  VALUES ('ExB-ISS', 'ExB-ISS', 'ExB-ISS', 'Expense Booking — Material Issue', 'ISS', 5, 1, 1);

GO

-- ── 2. DocNumberSequence ─────────────────────────────────────────────────────

ALTER TABLE dbo.DocNumberSequence
  ADD DocNoPrefix  NVARCHAR(30)  NULL,   -- mirrors TypeOfDoc.DocNoPrefix
      DocYear      SMALLINT      NULL,   -- calendar year (4-digit)
      DocSerial    INT           NULL,   -- numeric serial for this prefix+year
      RecordId     INT           NULL;   -- FK back to the created record (back-patched)

GO

CREATE INDEX IX_DocNumberSequence_PrefixYear
  ON dbo.DocNumberSequence (DocNoPrefix, DocYear)
  WHERE DocNoPrefix IS NOT NULL;

GO

-- ── 3. MaterialIssues ────────────────────────────────────────────────────────

-- Add the new columns; IssueNo is kept as-is for backward compatibility.
-- New documents will ALSO populate DocNo (which equals IssueNo for ISS prefix docs).

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

CREATE INDEX IX_MaterialIssues_DocNo ON dbo.MaterialIssues (DocNo) WHERE DocNo IS NOT NULL;
CREATE INDEX IX_MaterialIssues_DocYear ON dbo.MaterialIssues (DocYear, DocSerial) WHERE DocYear IS NOT NULL;

GO

-- ── 4. GoodsReceiptNotes ─────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocYear')
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DocSerial')
  ALTER TABLE dbo.GoodsReceiptNotes ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'ParentDocNo')
  ALTER TABLE dbo.GoodsReceiptNotes ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.GoodsReceiptNotes ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 5. PurchaseOrders ────────────────────────────────────────────────────────
-- (column names may vary — adjust table name if yours differs)

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocYear')
  ALTER TABLE dbo.PurchaseOrders ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'DocSerial')
  ALTER TABLE dbo.PurchaseOrders ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'ParentDocNo')
  ALTER TABLE dbo.PurchaseOrders ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.PurchaseOrders ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 6. WorkOrders ────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrders') AND name = 'DocYear')
  ALTER TABLE dbo.WorkOrders ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrders') AND name = 'DocSerial')
  ALTER TABLE dbo.WorkOrders ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrders') AND name = 'ParentDocNo')
  ALTER TABLE dbo.WorkOrders ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.WorkOrders') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.WorkOrders ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 7. Payments (outgoing) ───────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Payments') AND name = 'DocYear')
  ALTER TABLE dbo.Payments ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Payments') AND name = 'DocSerial')
  ALTER TABLE dbo.Payments ADD DocSerial INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Payments') AND name = 'ParentDocNo')
  ALTER TABLE dbo.Payments ADD ParentDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Payments') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.Payments ADD RootExBDocNo NVARCHAR(100) NULL;

GO

-- ── 8. ExpenseBooking ────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'RootExBDocNo')
  ALTER TABLE dbo.ExpenseBooking ADD RootExBDocNo NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'DocYear')
  ALTER TABLE dbo.ExpenseBooking ADD DocYear SMALLINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'DocSerial')
  ALTER TABLE dbo.ExpenseBooking ADD DocSerial INT NULL;

GO

-- ── 9. Helpful views for lineage breadcrumb ──────────────────────────────────

-- vw_DocLineage: shows full parent→child chain for any document
CREATE OR ALTER VIEW dbo.vw_DocLineage AS
SELECT
  dns.DocNo,
  dns.DocNoPrefix,
  dns.DocYear,
  dns.DocSerial,
  dns.TableName,
  dns.RecordId,
  parent.DocNo    AS ParentDocNo,
  parent.TableName AS ParentTable,
  root.DocNo      AS RootExBDocNo,
  dns.IssuedOn,
  dns.IssuedBy
FROM dbo.DocNumberSequence dns
LEFT JOIN dbo.DocNumberSequence parent
  ON parent.DocNo = (
      SELECT TOP 1 ParentDocNo
      FROM (
        SELECT ParentDocNo FROM dbo.GoodsReceiptNotes WHERE DocNo = dns.DocNo
        UNION ALL
        SELECT ParentDocNo FROM dbo.MaterialIssues    WHERE DocNo = dns.DocNo
        UNION ALL
        SELECT ParentDocNo FROM dbo.Payments          WHERE DocNo = dns.DocNo
      ) x
  )
LEFT JOIN dbo.DocNumberSequence root
  ON root.DocNo = (
      SELECT TOP 1 RootExBDocNo
      FROM (
        SELECT RootExBDocNo FROM dbo.GoodsReceiptNotes WHERE DocNo = dns.DocNo
        UNION ALL
        SELECT RootExBDocNo FROM dbo.MaterialIssues    WHERE DocNo = dns.DocNo
        UNION ALL
        SELECT RootExBDocNo FROM dbo.Payments          WHERE DocNo = dns.DocNo
        UNION ALL
        SELECT RootExBDocNo FROM dbo.ExpenseBooking    WHERE EDocNo = dns.DocNo
      ) x
  );

GO

PRINT 'Migration 035 completed successfully.';
