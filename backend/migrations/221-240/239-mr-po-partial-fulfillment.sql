-- Material Request → Purchase Order partial-fulfillment support.
--
-- Links each PurchaseOrderItems row back to the MaterialRequestItems row it
-- was ordered against (when the PO was created from an MR), so remaining
-- pending quantity can be computed per MR line item rather than just at the
-- MR header level — required for the "order 200 of 500, come back later for
-- the other 300" partial-PO workflow.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrderItems') AND name = 'MRItemId'
)
  ALTER TABLE dbo.PurchaseOrderItems ADD MRItemId INT NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrderItems') AND name = 'IX_PurchaseOrderItems_MRItemId'
)
  CREATE INDEX IX_PurchaseOrderItems_MRItemId ON dbo.PurchaseOrderItems (MRItemId) WHERE MRItemId IS NOT NULL;

-- Backfill: existing PurchaseOrderItems rows predate this column, so they'd
-- otherwise read as 0 ordered against their MR item — silently letting a
-- fully-ordered MR reset back to "Approved" the next time a PO touches it.
-- Match on (SourceMRId, ItemId), same key the app itself relies on.
UPDATE poi
SET poi.MRItemId = mri.MRItemId
FROM dbo.PurchaseOrderItems poi
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
JOIN dbo.MaterialRequestItems mri
  ON mri.MRId = po.SourceMRId AND mri.ItemId = poi.ItemId
WHERE po.SourceMRId IS NOT NULL AND poi.MRItemId IS NULL;
