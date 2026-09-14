-- Cost Centre now lives only on the item's own Item Master tag
-- (Item_Master_Group.M_CostCenterId, migration 295) — the PO header's own
-- CostCenterId dropdown (migration 148) was removed from the Purchase Order
-- form since a single PO can mix items from different cost centres (e.g. a
-- fixed-asset camera alongside consumption-based sand). Without a per-line
-- column, PurchaseOrderMaster.tsx's item-select auto-fill only ever wrote
-- ONE cost centre onto the whole PO header — whichever item was picked
-- first — silently dropping every other line's own cost centre.
--
-- This adds the per-line column so GRN/Invoice GL posting can resolve each
-- line's real cost centre (by joining GRNItems.itemId back to this table via
-- POID) and post a cost-centre-wise breakdown instead of one flat figure.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PurchaseOrderItems') AND name = 'CostCenterId'
)
  ALTER TABLE dbo.PurchaseOrderItems ADD CostCenterId INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_PurchaseOrderItems_CostCenter'
)
  ALTER TABLE dbo.PurchaseOrderItems
    ADD CONSTRAINT FK_PurchaseOrderItems_CostCenter
    FOREIGN KEY (CostCenterId) REFERENCES dbo.CostCenter(CostCenterId);
GO

-- Backfill existing lines from the PO header's own (soon-to-be-legacy)
-- CostCenterId, so historical POs still show something in the new
-- per-line breakdown instead of going blank.
UPDATE poi
SET poi.CostCenterId = po.CostCenterId
FROM dbo.PurchaseOrderItems poi
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = poi.PurchaseOrderID
WHERE poi.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;
