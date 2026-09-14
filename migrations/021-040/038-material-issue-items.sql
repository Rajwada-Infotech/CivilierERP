-- ============================================================
-- Migration: 038-material-issue-items.sql
-- Extends material issues to support multi-item cart model.
--
-- Changes:
--   1. Add FinYearId to dbo.MaterialIssues
--   2. Create dbo.MaterialIssueItems  (one row per cart line)
--   3. Migrate existing single-item rows into the new child table
--   4. Indexes for fast lookup
-- Safe to run multiple times (all guarded with IF NOT EXISTS).
-- ============================================================

-- ── 1. Add FinYearId to MaterialIssues ───────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'MaterialIssues' AND COLUMN_NAME = 'FinYearId'
)
  ALTER TABLE dbo.MaterialIssues ADD FinYearId INT NULL
    REFERENCES dbo.FinYear(FId);
GO

-- ── 2. Create MaterialIssueItems ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('dbo.MaterialIssueItems'))
BEGIN
  CREATE TABLE dbo.MaterialIssueItems (
    IssueItemId   INT           IDENTITY(1,1) PRIMARY KEY,
    IssueId       INT           NOT NULL
                                REFERENCES dbo.MaterialIssues(IssueId) ON DELETE CASCADE,
    ItemId        NVARCHAR(100) NOT NULL,    -- FK to Item_Master_Group.M_Id (stored as string)
    UOMCode       NVARCHAR(20)  NULL,        -- FK to UOMMaster.UOMCode
    Quantity      DECIMAL(18,2) NOT NULL CHECK (Quantity > 0),
    Remarks       NVARCHAR(MAX) NULL,
    CreatedAt     DATETIME2     DEFAULT GETDATE()
  );

  PRINT 'MaterialIssueItems table created.';
END
ELSE
  PRINT 'MaterialIssueItems table already exists.';
GO

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.MaterialIssueItems') AND name = 'IX_MII_IssueId'
)
  CREATE NONCLUSTERED INDEX IX_MII_IssueId
    ON dbo.MaterialIssueItems (IssueId);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.MaterialIssueItems') AND name = 'IX_MII_ItemId'
)
  CREATE NONCLUSTERED INDEX IX_MII_ItemId
    ON dbo.MaterialIssueItems (ItemId);
GO

-- ── 4. Migrate existing single-item rows ──────────────────────────────────────
-- If a MaterialIssues row has ItemId set but no child rows yet, seed one child.
INSERT INTO dbo.MaterialIssueItems (IssueId, ItemId, UOMCode, Quantity)
SELECT mi.IssueId, mi.ItemId, mi.UOMId, mi.Quantity
FROM   dbo.MaterialIssues mi
WHERE  mi.ItemId IS NOT NULL
  AND  mi.Quantity > 0
  AND  NOT EXISTS (
         SELECT 1 FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId
       );
GO

PRINT '038-material-issue-items applied successfully.';
GO
