-- Migration 188: Let a payment opt out of automatic On A/C balance use
--
-- backend/routes/newPayment.js's PUT /:id/approve already auto-applies a
-- party's existing OnAccountLedger balance against the invoice's remaining
-- amount whenever a payment leaves it partially unpaid — unconditionally,
-- with no way to decline. This column lets the payment form set "don't
-- touch this party's on-account balance for this payment" explicitly
-- (the "keep the balance on his on account" checkbox state), checked by
-- the approve-time hook before it fires.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.NewPayment') AND name = 'OASkipAutoApply'
)
BEGIN
  ALTER TABLE dbo.NewPayment
    ADD OASkipAutoApply BIT NOT NULL CONSTRAINT DF_NewPayment_OASkipAutoApply DEFAULT 0;
  PRINT 'Added OASkipAutoApply to NewPayment (default 0 — preserves current auto-apply behavior)';
END
