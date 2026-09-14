-- ReceivedPayment already captures RPCheckNumber (cheque number) and
-- RPDepositBankId (bank) for cheque-mode receipts, but has no cheque-date
-- column at all — unlike NewPayment (PChequeDate + PIsPostDated), which
-- means a post-dated cheque received from a customer can't be distinguished
-- from a same-day one, and PDC Tracking (report + reminders) has nothing to
-- read for the receivable side. Adds the same two columns NewPayment has,
-- for parity.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.ReceivedPayment') AND name = N'RPChequeDate'
)
BEGIN
  ALTER TABLE dbo.ReceivedPayment ADD RPChequeDate DATE NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.ReceivedPayment') AND name = N'RPIsPostDated'
)
BEGIN
  ALTER TABLE dbo.ReceivedPayment ADD RPIsPostDated BIT NOT NULL CONSTRAINT DF_ReceivedPayment_RPIsPostDated DEFAULT 0;
END;

PRINT 'ReceivedPayment.RPChequeDate / RPIsPostDated added.';
