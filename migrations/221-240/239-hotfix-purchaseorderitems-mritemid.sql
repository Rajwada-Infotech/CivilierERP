-- =============================================================================
-- Hotfix: PurchaseOrderItems.MRItemId — migration 239 manual fix
-- =============================================================================
-- Context:  239-mr-po-partial-fulfillment.sql failed with two errors:
--   1. ALTER TABLE + UPDATE in the same batch — SQL Server could not see the
--      new column in the same compilation unit.
--   2. Filtered index creation required SET QUOTED_IDENTIFIER ON.
-- Applied:  Manually executed on 2026-07-26 (prod). 49 rows backfilled.
--
-- Marking step executed manually:
--   INSERT INTO __Migrations (name, applied_at)
--   VALUES ('239-mr-po-partial-fulfillment.sql', GETUTCDATE());
--
-- This file is idempotent — safe to re-run on a fresh DB.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
GO

-- 1. Add column (idempotent guard)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrderItems') AND name = 'MRItemId'
)
BEGIN
  ALTER TABLE dbo.PurchaseOrderItems ADD MRItemId INT NULL;
END;
GO

-- 2. Filtered index (idempotent guard)
SET QUOTED_IDENTIFIER ON;
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrderItems')
    AND name = 'IX_PurchaseOrderItems_MRItemId'
)
BEGIN
  CREATE INDEX IX_PurchaseOrderItems_MRItemId
    ON dbo.PurchaseOrderItems (MRItemId)
    WHERE MRItemId IS NOT NULL;
END;
GO

-- 3. Backfill: match PO items to their source MR items via SourceMRId + ItemId
--    (safe to re-run — only touches rows where MRItemId is still NULL)
SET QUOTED_IDENTIFIER ON;
UPDATE poi
SET poi.MRItemId = mri.MRItemId
FROM dbo.PurchaseOrderItems poi
JOIN dbo.PurchaseOrders      po  ON po.PurchaseOrderID  = poi.PurchaseOrderID
JOIN dbo.MaterialRequestItems mri ON mri.MRId           = po.SourceMRId
                                  AND mri.ItemId         = poi.ItemId
WHERE po.SourceMRId IS NOT NULL
  AND poi.MRItemId  IS NULL;
GO
