-- Migration 355: LoanPayment reversal tracking — cancelling the cheque a
-- loan repayment was made with (chequeCancellation.js) previously reversed
-- the payment's GL entries and reopened the invoice it was linked to, but
-- had zero awareness that the payment might actually be a loan repayment:
-- the LoanPayment row stayed exactly as-is, its LoanEMISchedule rows stayed
-- IsPaid=1, and dbo.LoanSanction's own GL/OnAccount entries were never
-- reversed. The loan looked fully repaid even though the cheque backing
-- that repayment never actually cleared.
--
-- IsReversed follows the same soft-reversal convention already used on
-- dbo.GeneralLedgerEntry (never delete a real financial record, flag it
-- instead) — the LoanPayment row stays as the historical fact "this
-- repayment was attempted/recorded on this date", with IsReversed=1
-- marking that it was later undone. Queries that sum "how much has
-- actually been paid" (POST /:id/pay's alreadyPaidRes, GET /:id/payments)
-- must filter WHERE IsReversed = 0.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanPayment') AND name = 'IsReversed'
)
BEGIN
  ALTER TABLE dbo.LoanPayment ADD IsReversed BIT NOT NULL CONSTRAINT DF_LoanPayment_IsReversed DEFAULT 0;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanPayment') AND name = 'ReversedAt'
)
BEGIN
  ALTER TABLE dbo.LoanPayment ADD ReversedAt DATETIME2(3) NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanPayment') AND name = 'ReversedReason'
)
BEGIN
  ALTER TABLE dbo.LoanPayment ADD ReversedReason NVARCHAR(500) NULL;
END
GO
