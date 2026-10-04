-- 470: Cost Centre wasn't consistently propagated from Item Master
-- (Item_Master_Group.M_CostCenterId) into every module that lines up items
-- against it. Purchase Order already does this correctly per line
-- (PurchaseOrderItems.CostCenterId, auto-filled from the item's own tag).
-- Material Request and Material Issue had no per-line Cost Centre concept
-- at all — this adds the same FK column to both, matching PO's own shape,
-- so the rest of the chain (GRN/Invoice, already fixed to read it from a
-- linked PO or fall back to the item) has something real to inherit from
-- MR too, and Issue can finally tag which cost centre actually consumed
-- the material instead of relying on its separate free-text header field.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.MaterialRequestItems') AND name = 'CostCenterId'
)
BEGIN
  ALTER TABLE dbo.MaterialRequestItems ADD CostCenterId INT NULL;
  PRINT 'Added MaterialRequestItems.CostCenterId';
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CostCenter' AND schema_id = SCHEMA_ID('dbo'))
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialRequestItems') AND name = 'CostCenterId')
   AND NOT EXISTS (
     SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MaterialRequestItems_CostCenter'
   )
BEGIN
  ALTER TABLE dbo.MaterialRequestItems
    ADD CONSTRAINT FK_MaterialRequestItems_CostCenter
    FOREIGN KEY (CostCenterId) REFERENCES dbo.CostCenter(CostCenterId);
  PRINT 'Added FK_MaterialRequestItems_CostCenter';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.MaterialIssueItems') AND name = 'CostCenterId'
)
BEGIN
  ALTER TABLE dbo.MaterialIssueItems ADD CostCenterId INT NULL;
  PRINT 'Added MaterialIssueItems.CostCenterId';
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CostCenter' AND schema_id = SCHEMA_ID('dbo'))
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaterialIssueItems') AND name = 'CostCenterId')
   AND NOT EXISTS (
     SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MaterialIssueItems_CostCenter'
   )
BEGIN
  ALTER TABLE dbo.MaterialIssueItems
    ADD CONSTRAINT FK_MaterialIssueItems_CostCenter
    FOREIGN KEY (CostCenterId) REFERENCES dbo.CostCenter(CostCenterId);
  PRINT 'Added FK_MaterialIssueItems_CostCenter';
END
GO
