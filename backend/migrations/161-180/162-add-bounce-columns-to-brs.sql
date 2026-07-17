-- Migration 162: Add cheque bounce tracking columns to BankReconciliation
-- When a bank bounces or returns a payment (dishonoured cheque, insufficient funds, etc.)
-- the operator marks it bounced here in BRS; the row turns highlighted and shows bounce details.

ALTER TABLE dbo.BankReconciliation
  ADD IsBounced     BIT           NOT NULL DEFAULT 0,
      BounceDate    DATE          NULL,
      BounceReason  NVARCHAR(200) NULL,
      BounceRemarks NVARCHAR(500) NULL;

-- Index for fast "show me all bounced entries" filter
CREATE INDEX IX_BRS_Bounced
  ON dbo.BankReconciliation (IsBounced)
  INCLUDE (SourceType, SourceID, BounceDate);
