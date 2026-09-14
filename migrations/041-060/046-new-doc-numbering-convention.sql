-- =============================================================================
-- Migration 046 — New Document Numbering Convention
-- Civilier ERP
--
-- New format:  {ProjectInitials}-{ModuleCode}/{Serial}/{FinYear}
-- Example:     GC-WO/0001/26-27
--
-- Changes in this migration:
--   1. TypeOfDoc  — add ModuleCode + FinYearReset columns
--   2. TypeOfDoc  — add ProjectCode column (stores project short_name snapshot)
--   3. DocNumberSequence — add FinYear column for per-financial-year counters
--   4. Seed missing TypeOfDoc rows  (BOQ, WO_PO)
--   5. Update links_to values on existing seeded rows so backend filtering works
--   6. Backfill ModuleCode on rows seeded by migration 035
-- =============================================================================

-- ── 1. TypeOfDoc: new columns ─────────────────────────────────────────────────

-- ModuleCode: canonical code used in new-format doc numbers (e.g. "WO", "GRN")
-- This is the {ModuleCode} segment of {ProjectInitials}-{ModuleCode}/{Serial}/{FinYear}
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'ModuleCode'
)
  ALTER TABLE dbo.TypeOfDoc ADD ModuleCode NVARCHAR(20) NULL;
GO

-- FinYearReset: 1 = counter resets each financial year (new convention, default)
--              0 = global counter that never resets (legacy rows)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'FinYearReset'
)
  ALTER TABLE dbo.TypeOfDoc ADD FinYearReset BIT NOT NULL DEFAULT 1;
GO

-- ProjectCode: snapshot of enterprise.short_name at time of record creation.
-- Stored here so doc number generation does not need a runtime join on enterprise.
-- NULL = applies to all projects (uses only ModuleCode in the prefix).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'ProjectCode'
)
  ALTER TABLE dbo.TypeOfDoc ADD ProjectCode NVARCHAR(20) NULL;
GO

-- ── 2. DocNumberSequence: add FinYear column ─────────────────────────────────
-- Stores the financial year string (e.g. "26-27") so counters scope per
-- (DocNoPrefix/ModuleCode + FinYear) independently.
-- NULL = legacy rows that pre-date this migration.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND name = 'FinYear'
)
  ALTER TABLE dbo.DocNumberSequence ADD FinYear NVARCHAR(10) NULL;
GO

-- Index to speed up MAX(DocSerial) lookups scoped by (DocNoPrefix, FinYear)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.DocNumberSequence')
    AND name = 'IX_DocNumberSequence_ModuleFinYear'
)
  CREATE INDEX IX_DocNumberSequence_ModuleFinYear
    ON dbo.DocNumberSequence (DocNoPrefix, FinYear)
    WHERE FinYear IS NOT NULL;
GO

-- ── 3. Backfill ModuleCode on rows seeded by migration 035 ───────────────────
-- These rows already have DocNoPrefix set; map them to the canonical ModuleCode.
UPDATE dbo.TypeOfDoc SET ModuleCode = 'WO'      WHERE DocNoPrefix = 'WO'          AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'WO_PO'   WHERE DocNoPrefix = 'ExB-WO'      AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'PO'       WHERE DocNoPrefix = 'PO'          AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'GRN'      WHERE DocNoPrefix = 'GRN'         AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB'         AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'PAY'      WHERE DocNoPrefix = 'PAY'         AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'RECP'     WHERE DocNoPrefix = 'REC'         AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'MIS'      WHERE DocNoPrefix = 'ISS'         AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-PO'      AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-GRN'     AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-PO-GRN'  AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-WO-GRN'  AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-PAY'     AND ModuleCode IS NULL;
UPDATE dbo.TypeOfDoc SET ModuleCode = 'ExB'      WHERE DocNoPrefix = 'ExB-ISS'     AND ModuleCode IS NULL;
GO

-- ── 4. Backfill links_to on rows seeded by migration 035 ─────────────────────
-- links_to is the field the backend will NOW use to filter by module (Stage 3).
-- We set it on existing rows so they appear correctly in every module's selector.
UPDATE dbo.TypeOfDoc SET links_to = 'Work Order'                   WHERE DocNoPrefix = 'WO'          AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Work Order, Work Order PO'    WHERE DocNoPrefix = 'ExB-WO'      AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Purchase Order'               WHERE DocNoPrefix = 'PO'          AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'GRN'                          WHERE DocNoPrefix = 'GRN'         AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Expense Booking'              WHERE DocNoPrefix = 'ExB'         AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Payment'                      WHERE DocNoPrefix = 'PAY'         AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Received Payment'             WHERE DocNoPrefix = 'REC'         AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Material Issue'               WHERE DocNoPrefix = 'ISS'         AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Purchase Order, Expense Booking' WHERE DocNoPrefix = 'ExB-PO'  AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'GRN, Expense Booking'         WHERE DocNoPrefix = 'ExB-GRN'    AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'GRN, Expense Booking'         WHERE DocNoPrefix = 'ExB-PO-GRN' AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'GRN, Expense Booking'         WHERE DocNoPrefix = 'ExB-WO-GRN' AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Payment, Expense Booking'     WHERE DocNoPrefix = 'ExB-PAY'    AND (links_to IS NULL OR links_to = '');
UPDATE dbo.TypeOfDoc SET links_to = 'Material Issue, Expense Booking' WHERE DocNoPrefix = 'ExB-ISS' AND (links_to IS NULL OR links_to = '');
GO

-- ── 5. Seed missing TypeOfDoc rows ───────────────────────────────────────────
-- Resolve E_Id GUIDs needed for new rows
DECLARE @EId_BOQ  UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType LIKE '%bill of quant%' OR EntryType LIKE '%BOQ%');
DECLARE @EId_WO   UNIQUEIDENTIFIER = (SELECT E_Id FROM dbo.Entry_Type WHERE EntryType = 'Work Order');
DECLARE @EId_ANY  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

-- Guard: abort if Entry_Type is empty
IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows in dbo.Entry_Type. Populate Entry_Type before running this migration.', 16, 1);
  RETURN;
END

-- BOQ — Bill of Quantities
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'BOQ')
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, ModuleCode, StartingDocNo, DocNoPadding,
     IsActive, EntryTypeId, links_to, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('BOQ', 'BOQ', 'Bill of Quantities', 'BOQ', 1, 4,
     1, ISNULL(@EId_BOQ, @EId_ANY), 'BOQ', 1, 'migration-046', GETDATE());

-- WO_PO — Work Order for Materials (a Work-Order-type PO)
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'WO_PO')
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, ModuleCode, StartingDocNo, DocNoPadding,
     IsActive, EntryTypeId, links_to, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('WO_PO', 'WO_PO', 'Work Order for Materials', 'WO_PO', 1, 4,
     1, ISNULL(@EId_WO, @EId_ANY), 'Work Order PO', 1, 'migration-046', GETDATE());
GO

-- ── 6. Verify ─────────────────────────────────────────────────────────────────
SELECT
  TypeOfDocId,
  DocNoPrefix,
  ModuleCode,
  Prefix,
  Description,
  links_to,
  FinYearReset,
  IsActive
FROM dbo.TypeOfDoc
ORDER BY DocNoPrefix;
GO

PRINT '046-new-doc-numbering-convention applied successfully.';
PRINT '  + ModuleCode column added to TypeOfDoc';
PRINT '  + FinYearReset column added to TypeOfDoc';
PRINT '  + ProjectCode column added to TypeOfDoc';
PRINT '  + FinYear column added to DocNumberSequence';
PRINT '  + ModuleCode backfilled on existing rows';
PRINT '  + links_to backfilled on existing rows';
PRINT '  + BOQ and WO_PO TypeOfDoc rows seeded';
GO
