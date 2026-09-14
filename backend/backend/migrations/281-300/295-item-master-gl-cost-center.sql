-- Migration 295: Add GL Ledger + Cost Centre tagging to Item Master
--
-- Lets an item be tagged with a GL Account (dbo.AccountHeadMaster,
-- LHeadType='GL') and a Cost Centre (dbo.CostCenter), independently of each
-- other and of the Cost Centre master's own GL tagging (AccountHeadMaster.
-- CostCenterId, the reverse direction). When a Purchase Order line uses a
-- tagged item, the PO's Cost Centre auto-fills from it (see
-- src/pages/material/PurchaseOrderMaster.tsx handleItemSelect).
--
-- GL posting itself is NOT changed by this migration — GRN/Invoice posting
-- still lumps into the shared system "Purchase A/c" ledger. Splitting
-- postings per item's tagged GL head is a separate follow-up.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Item_Master_Group' AND COLUMN_NAME = 'M_GLHeadId'
)
  ALTER TABLE dbo.Item_Master_Group
    ADD M_GLHeadId INT NULL
      REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Item_Master_Group' AND COLUMN_NAME = 'M_CostCenterId'
)
  ALTER TABLE dbo.Item_Master_Group
    ADD M_CostCenterId INT NULL
      REFERENCES dbo.CostCenter(CostCenterId);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Item_Master_Group') AND name = 'IX_ItemMaster_GLHeadId'
)
  CREATE NONCLUSTERED INDEX IX_ItemMaster_GLHeadId
    ON dbo.Item_Master_Group (M_GLHeadId)
    WHERE M_GLHeadId IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Item_Master_Group') AND name = 'IX_ItemMaster_CostCenterId'
)
  CREATE NONCLUSTERED INDEX IX_ItemMaster_CostCenterId
    ON dbo.Item_Master_Group (M_CostCenterId)
    WHERE M_CostCenterId IS NOT NULL;
GO

PRINT '295-item-master-gl-cost-center applied successfully.';
GO
