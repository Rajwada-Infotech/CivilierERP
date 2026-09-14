-- Migration 187: Materialized On Account balance per party
--
-- dbo.OnAccountLedger remains the audit trail (every CREDIT/DEBIT row, who,
-- when, against which invoice/payment). This column is a cached read of
-- SUM(CREDIT) - SUM(DEBIT) for that party, kept in lockstep by every write
-- path (backend/routes/newPayment.js approve-hook, backend/routes/onAccount.js
-- apply-adjustment) so /balance and /balance-by-ref can be a single-row read
-- instead of an aggregate over the whole ledger on every call.
--
-- Seeded from the CURRENT live ledger sum for every existing party that has
-- ledger history, so this migration does not reset anyone's already-earned
-- advance to zero. New suppliers default to 0.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'OnAccountBalance'
)
BEGIN
  ALTER TABLE dbo.AccountHeadMaster
    ADD OnAccountBalance DECIMAL(18,2) NOT NULL CONSTRAINT DF_AccountHeadMaster_OnAccountBalance DEFAULT 0;
  PRINT 'Added OnAccountBalance to AccountHeadMaster (default 0)';
END
GO

-- Backfill: seed every party's column from their current live ledger sum,
-- clamped at 0 (mirrors the clamp already applied by GET /balance/:partyId).
UPDATE ahm
SET OnAccountBalance = ledger.Balance
FROM dbo.AccountHeadMaster ahm
CROSS APPLY (
  SELECT
    CASE WHEN SUM(CASE WHEN ol.TxnType = 'CREDIT' THEN ol.Amount ELSE -ol.Amount END) > 0
      THEN SUM(CASE WHEN ol.TxnType = 'CREDIT' THEN ol.Amount ELSE -ol.Amount END)
      ELSE 0
    END AS Balance
  FROM dbo.OnAccountLedger ol
  WHERE ol.PartyId = ahm.LHeadId
) ledger
WHERE EXISTS (SELECT 1 FROM dbo.OnAccountLedger ol2 WHERE ol2.PartyId = ahm.LHeadId);

PRINT 'Backfilled OnAccountBalance from OnAccountLedger for parties with existing ledger history';
