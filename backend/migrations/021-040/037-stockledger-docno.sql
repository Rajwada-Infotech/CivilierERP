-- ============================================================
-- Migration: 037-stockledger-docno.sql
-- Adds DocNo to StockLedger so each entry carries the source
-- document reference (GRN number, Issue number, etc.) and can
-- be fetched directly when creating related documents such as
-- Material Issues.
-- Safe to run multiple times (all changes are guarded).
-- ============================================================

-- Add DocNo column
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'StockLedger'
    AND COLUMN_NAME  = 'DocNo'
)
  ALTER TABLE dbo.StockLedger
  ADD DocNo NVARCHAR(100) NULL;
GO

-- Back-fill DocNo for existing GRN entries from GoodsReceiptNotes.DocNo
UPDATE sl
SET    sl.DocNo = grn.DocNo
FROM   dbo.StockLedger      sl
JOIN   dbo.GoodsReceiptNotes grn ON grn.GRNID = sl.RefID
WHERE  sl.RefType = 'GRN'
  AND  sl.DocNo   IS NULL
  AND  grn.DocNo  IS NOT NULL;
GO

-- Back-fill DocNo for existing ISS entries from MaterialIssues.DocNo
UPDATE sl
SET    sl.DocNo = iss.DocNo
FROM   dbo.StockLedger   sl
JOIN   dbo.MaterialIssues iss ON iss.IssueId = sl.RefID
WHERE  sl.RefType = 'ISS'
  AND  sl.DocNo   IS NULL
  AND  iss.DocNo  IS NOT NULL;
GO

-- Index for fetching ledger rows by DocNo (e.g. lookup from material-issue creation)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_StockLedger_DocNo'
)
  CREATE NONCLUSTERED INDEX IX_StockLedger_DocNo
  ON dbo.StockLedger (DocNo)
  INCLUDE (ItemID, Qty, Type, RefType, RefID, CreatedDate);
GO

PRINT '037-stockledger-docno applied successfully.';
GO
