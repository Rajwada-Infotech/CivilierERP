-- Trial Balance was supposed to show transactions tagged with the PO's Cost
-- Centre, but dbo.GeneralLedgerEntry never carried a CostCenterId column at
-- all — CostCenterId was only ever stored on the source document
-- (PurchaseOrders), never threaded through to the posted GL legs.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.GeneralLedgerEntry') AND name = 'CostCenterId'
)
  ALTER TABLE dbo.GeneralLedgerEntry ADD CostCenterId INT NULL;
