-- DisbursedAmount on CrmLoanDetail is no longer a manually-typed figure —
-- GET /:id/loan in crmBookings.js now computes it live from real receipts
-- (CrmPaymentReceipt + CrmOnAccountPayment, PaymentMode = 'Home Loan').
-- A stored column that can drift from actual money received is worse than
-- no column at all, so it's dropped rather than left unused.
--
-- Guarded — this DB already had DisbursedAmount removed outside the
-- migration system at some point (150-crm-aftersales-workflow.sql, which
-- created it, is tracked as applied, but no tracked migration ever dropped
-- it before this one), so the unguarded DROP COLUMN failed with "column
-- does not exist". IF EXISTS makes this converge correctly regardless of
-- which state a given DB is starting from.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmLoanDetail') AND name = 'DisbursedAmount'
)
BEGIN
  ALTER TABLE dbo.CrmLoanDetail DROP COLUMN DisbursedAmount;
END