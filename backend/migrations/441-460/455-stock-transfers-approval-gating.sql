-- Migration 455: Stock Transfer gains real approval gating.
-- Previously every transfer posted its StockLedger IN/OUT rows immediately
-- at creation, hardcoded to Status='Completed' — an approval workflow
-- configured for it (the old frontend "Stock Transfer" module option) had
-- nothing to actually gate. PostedToStock tracks whether the ledger rows
-- have been written yet, so posting can move to final-approval time
-- (mirrors dbo.SaleOrders.PostedToStock / routes/saleOrders.js) without
-- risking a double post if an approve request is retried.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.StockTransfers') AND name = 'PostedToStock')
  ALTER TABLE dbo.StockTransfers ADD PostedToStock BIT NOT NULL CONSTRAINT DF_StockTransfers_PostedToStock DEFAULT 0;
GO

-- Every pre-existing row already moved its stock at creation time (the old
-- behavior) — back-fill them as posted so they aren't mistaken for
-- awaiting-approval transfers that still need their ledger rows written.
UPDATE dbo.StockTransfers SET PostedToStock = 1 WHERE Status = 'Completed';
GO

PRINT '455-stock-transfers-approval-gating applied successfully.';
GO
