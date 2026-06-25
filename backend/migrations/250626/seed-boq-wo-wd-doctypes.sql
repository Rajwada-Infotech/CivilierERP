-- Seed dbo.TypeOfDoc rows for the BOQ, Work Order, and Work Done doc-type
-- dropdowns (Engineering > Transaction group). Mirrors the exact pattern
-- already used by migrations 046 (BOQ, Work Order) and 052 (Work Done) —
-- this just re-applies those same idempotent inserts in case 046/052 never
-- ran against this database, or ran before links_to existed.
--
-- Safe to re-run.

USE Civilier;
GO

DECLARE @EId_BOQ UNIQUEIDENTIFIER = (
  SELECT TOP 1 E_Id FROM dbo.Entry_Type
  WHERE EntryType LIKE '%bill of quant%' OR EntryType LIKE '%BOQ%'
);
DECLARE @EId_WO  UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type WHERE EntryType = 'Work Order');
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);

IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows found in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

SET @EId_BOQ = ISNULL(@EId_BOQ, @EId_ANY);
SET @EId_WO  = ISNULL(@EId_WO,  @EId_ANY);

-- ── BOQ ───────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc
  WHERE DocNoPrefix = 'BOQ' OR links_to LIKE '%BOQ%'
)
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, ModuleCode, StartingDocNo, DocNoPadding,
     IsActive, EntryTypeId, links_to, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('BOQ', 'BOQ', 'Bill of Quantities', 'BOQ', 1, 4,
     1, @EId_BOQ, 'BOQ', 1, 'migration', GETDATE());
ELSE
  PRINT 'BOQ document type already exists';

-- ── Work Order ────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc
  WHERE DocNoPrefix = 'WO' OR links_to LIKE '%Work Order%'
)
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, ModuleCode, StartingDocNo, DocNoPadding,
     IsActive, EntryTypeId, links_to, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('WO', 'WO', 'Work Order', 'WO', 1, 5,
     1, @EId_WO, 'Work Order', 1, 'migration', GETDATE());
ELSE
  -- Row may already exist from migration 035 without links_to set (pre-046).
  UPDATE dbo.TypeOfDoc
  SET links_to = 'Work Order'
  WHERE DocNoPrefix = 'WO' AND (links_to IS NULL OR links_to = '');

-- ── Work Done ─────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc
  WHERE IsActive = 1 AND (DocNoPrefix = 'WD' OR links_to LIKE '%Work Done%')
)
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive,
     EntryTypeId, links_to, ModuleCode, FinYearReset, CreatedBy, CreatedAt)
  VALUES
    ('WD', 'WD', 'Work Done', 1, 5, 1,
     @EId_ANY, 'Work Done', 'WD', 1, 'migration', GETDATE());
ELSE
  PRINT 'Work Done document type already exists';

SELECT TypeOfDocId, Prefix, Description, links_to, ModuleCode, EntryTypeId
FROM dbo.TypeOfDoc
WHERE DocNoPrefix IN ('BOQ', 'WO', 'WD') OR links_to LIKE '%BOQ%' OR links_to LIKE '%Work Order%' OR links_to LIKE '%Work Done%';
