-- ============================================================
-- Migration 102: GoodsReceiptNotes — per-godown stock tracking
--
-- Without this column every GRN always writes stock into the
-- global Main Godown regardless of which project the GRN
-- belongs to, causing Stock page totals to diverge from what
-- the Issues page shows per-godown.
--
-- Changes:
--   1. Add GodownID (FK → Godowns) to GoodsReceiptNotes
--   2. Backfill existing rows → Main Godown
--   3. Covering index for godown-filtered GRN lookups
-- Safe to run multiple times (all guarded with IF NOT EXISTS).
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Add GodownID to GoodsReceiptNotes ─────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'GoodsReceiptNotes'
    AND COLUMN_NAME  = 'GodownID'
)
BEGIN
  ALTER TABLE dbo.GoodsReceiptNotes
    ADD GodownID INT NULL
      CONSTRAINT FK_GRN_Godowns REFERENCES dbo.Godowns(GodownID);
  PRINT 'GodownID column added to GoodsReceiptNotes.';
END
ELSE
  PRINT 'GodownID column already exists on GoodsReceiptNotes.';
GO

-- ── 2. Backfill existing GRNs → Main Godown ──────────────────────────────────
UPDATE dbo.GoodsReceiptNotes
SET GodownID = (
  SELECT TOP 1 GodownID
  FROM   dbo.Godowns
  WHERE  IsMain = 1 AND IsDeleted = 0
  ORDER  BY GodownID
)
WHERE GodownID IS NULL;
GO
PRINT 'Backfill completed.';
GO

-- ── 3. Index for godown-filtered GRN queries ──────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes')
    AND name = 'IX_GRN_GodownID'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_GRN_GodownID
    ON dbo.GoodsReceiptNotes (GodownID)
    INCLUDE (GRNID, GRNNo, DocNo, Status, GRNDate);
  PRINT 'Index IX_GRN_GodownID created.';
END
ELSE
  PRINT 'Index IX_GRN_GodownID already exists.';
GO

PRINT '================================================================';
PRINT '102-grn-godown applied successfully.';
PRINT '================================================================';
GO
