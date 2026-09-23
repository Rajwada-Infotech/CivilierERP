-- Migration 470: add CrmRefund.PreferredPaymentMode — an optional mode
-- (NEFT/RTGS/IMPS/UPI/Cheque) staff can note when raising a refund, so it
-- carries through as a default when Finance later finance-approves the
-- payout. Never required at either step — a refund can still be raised and
-- approved with no mode set, same as before this migration.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  JOIN sys.tables t ON t.object_id = c.object_id
  WHERE t.name = 'CrmRefund' AND c.name = 'PreferredPaymentMode'
)
BEGIN
  ALTER TABLE dbo.CrmRefund ADD PreferredPaymentMode NVARCHAR(50) NULL;
  PRINT 'CrmRefund.PreferredPaymentMode added.';
END
ELSE
BEGIN
  PRINT 'CrmRefund.PreferredPaymentMode already exists — nothing to do.';
END
GO
