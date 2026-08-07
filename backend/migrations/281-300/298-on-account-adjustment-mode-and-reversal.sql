-- Migration 298: On Account Adjustment — payment mode support + reversible
-- link back to the party's on-account balance.
--
-- Two gaps this closes:
--
-- 1. apply-adjustment (routes/onAccount.js) always wrote the synthetic
--    settlement payment as Mode='Cash' regardless of how the money actually
--    moved. Mode + cheque-leaf columns mirror what NewPayment/FundTransfer
--    already carry, so a cheque leaf consumed here is consumed everywhere.
--
-- 2. Deleting the synthetic "On Account Adjustment" NewPayment row already
--    reverts the INVOICE side (syncBillStatus recomputes ETotalPaid/
--    ERemainingAmount from the remaining NewPayment rows once this one is
--    gone) but nothing reverted the PARTY side — the OnAccountLedger DEBIT
--    row and the balance taken off AccountHeadMaster.OnAccountBalance stayed
--    in place forever, permanently losing that money from the party's
--    on-account pool. NewPayment.PLinkedOAId is the explicit link the
--    DELETE handler needs to find and reverse that ledger entry.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.OnAccountLedger') AND name = 'AdjustmentDocNo')
BEGIN
  ALTER TABLE dbo.OnAccountLedger ADD AdjustmentDocNo NVARCHAR(100) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'PLinkedOAId')
BEGIN
  ALTER TABLE dbo.NewPayment ADD PLinkedOAId INT NULL CONSTRAINT FK_NewPayment_LinkedOA FOREIGN KEY REFERENCES dbo.OnAccountLedger(OAId);
END
GO

PRINT '298-on-account-adjustment-mode-and-reversal applied successfully.';
GO
