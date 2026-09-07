-- Migration 356: Loan repayments settled via Received Payment.
--
-- Every LoanPayment so far has been anchored to dbo.NewPayment (money
-- going OUT — Finance > Payment's Loan EMIs tab), regardless of loan
-- type. That's directionally wrong for a Customer Loan repayment: the
-- company lent money TO a customer, so the customer paying it back is
-- cash coming IN, which belongs on Received Payment (Dr Bank, Cr
-- Customer) — the same convention every other inbound-cash flow in this
-- app already follows. Received Payment had no loan awareness at all
-- until now.
--
-- ReceivedPaymentId is the mirror of NewPaymentId — exactly one of the
-- two is expected to be set per LoanPayment row (whichever direction that
-- particular repayment actually came through), never both.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.LoanPayment') AND name = 'ReceivedPaymentId'
)
BEGIN
  ALTER TABLE dbo.LoanPayment ADD ReceivedPaymentId INT NULL;
END
GO
