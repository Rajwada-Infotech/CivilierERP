-- ============================================================
-- Migration 183: On-Account Payments
-- Every payment recorded today (POST /:id/receipts) is forced onto a
-- specific milestone. This introduces the missing case: a customer pays
-- MORE than what's currently due, or pays before any milestone is due at
-- all — that excess is held as an unapplied credit against the booking
-- until staff (or a future auto-apply rule) allocates it to a milestone
-- as one comes due. Applying it re-uses the existing CrmPaymentReceipt
-- machinery (which already correctly re-derives AmountPaid/Status from
-- SUM(receipts)), tagged with OnAccountPaymentId so the money trail stays
-- traceable back to its original on-account deposit.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmOnAccountPayment' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmOnAccountPayment (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    ReceiptNo      NVARCHAR(30)  NULL,
    BookingId      INT           NOT NULL REFERENCES dbo.CrmBooking(Id),
    Amount         DECIMAL(18,2) NOT NULL,
    AppliedAmount  DECIMAL(18,2) NOT NULL DEFAULT 0,
    -- Unapplied / PartiallyApplied / Applied — derived from Amount vs
    -- AppliedAmount, kept as a real column (not computed) so it can be
    -- filtered/indexed cheaply from the booking's on-account list.
    Status         NVARCHAR(20)  NOT NULL DEFAULT 'Unapplied',
    ReceivedDate   DATE          NOT NULL DEFAULT CAST(SYSDATETIME() AS DATE),
    PaymentMode    NVARCHAR(50)  NULL,
    TransactionRef NVARCHAR(200) NULL,
    Notes          NVARCHAR(MAX) NULL,
    CreatedBy      INT           NULL,
    CreatedAt      DATETIME2(3)  NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created dbo.CrmOnAccountPayment';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'OnAccountPaymentId')
BEGIN
  ALTER TABLE dbo.CrmPaymentReceipt ADD OnAccountPaymentId INT NULL REFERENCES dbo.CrmOnAccountPayment(Id);
  PRINT 'Added CrmPaymentReceipt.OnAccountPaymentId';
END
GO
