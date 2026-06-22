-- ============================================================
-- Migration: 113-payment-card-mode.sql
--
-- Adds support for "Card" as a payment mode in dbo.NewPayment,
-- following the same pattern as the existing digital modes
-- (NEFT / UPI / RTGS / IMPS): a single reference-number column
-- used for reconciliation, paired with the existing PBankID
-- column for the issuing/settling bank.
--
-- Safe to run multiple times (guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'NewPayment'
      AND COLUMN_NAME = 'PCardReference'
)
BEGIN
    ALTER TABLE dbo.NewPayment
    ADD PCardReference NVARCHAR(100) NULL;

    PRINT 'PCardReference column added to dbo.NewPayment.';
END
ELSE
    PRINT 'PCardReference column already exists on dbo.NewPayment.';
GO

PRINT '================================================================';
PRINT '113-payment-card-mode applied successfully.';
PRINT '================================================================';
GO
    QAzD