-- ============================================================
-- Migration 415: crm-money-receipt-received-date-index
-- Why: the money-receipt list now supports a ReceivedDate range filter
-- (fromDate/toDate), added alongside the visual/filter-toolbar rebuild of
-- the Money Receipts page. Separate migration from 414 rather than editing
-- it, since 414 is already applied.
-- Idempotent — safe to re-run.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmMoneyReceipt_ReceivedDate' AND object_id = OBJECT_ID('dbo.CrmMoneyReceipt')
)
  CREATE INDEX IX_CrmMoneyReceipt_ReceivedDate ON dbo.CrmMoneyReceipt (ReceivedDate);