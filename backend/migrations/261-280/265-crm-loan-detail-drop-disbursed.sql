-- DisbursedAmount on CrmLoanDetail is no longer a manually-typed figure —
-- GET /:id/loan in crmBookings.js now computes it live from real receipts
-- (CrmPaymentReceipt + CrmOnAccountPayment, PaymentMode = 'Home Loan').
-- A stored column that can drift from actual money received is worse than
-- no column at all, so it's dropped rather than left unused.
--
-- NNN placeholder: rename this file with the actual next free migration
-- number from the migrations folder before applying — not verified here.

ALTER TABLE dbo.CrmLoanDetail DROP COLUMN DisbursedAmount;