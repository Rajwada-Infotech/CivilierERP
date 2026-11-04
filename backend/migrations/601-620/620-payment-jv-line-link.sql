-- Migration 620: a payment can settle SEVERAL Journal Voucher lines
--
-- NewPayment.JVLineId (migration 417) links a payment to the one JV credit line it settles. One payment can pay off more than
-- one JV (e.g. a single ₹33,000 cheque for two JVs of ₹18,000 and ₹15,000 booked the same day). Such a payment keeps JVLineId
-- empty and lists each JV line here with the amount of the payment that went to it, so each JV shows exactly what is paid.
-- A payment settling one line still uses JVLineId and has no rows here.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PaymentJvLineLink')
BEGIN
  CREATE TABLE dbo.PaymentJvLineLink (
    LinkId      INT IDENTITY(1,1) PRIMARY KEY,
    PPaymentID  INT NOT NULL
      CONSTRAINT FK_PaymentJvLineLink_Payment REFERENCES dbo.NewPayment(PPaymentID) ON DELETE CASCADE,
    JVLineId    INT NOT NULL
      CONSTRAINT FK_PaymentJvLineLink_JVLine REFERENCES dbo.JournalVoucherLines(LineID),
    Amount      DECIMAL(18,2) NOT NULL,
    CreatedAt   DATETIME2 NOT NULL CONSTRAINT DF_PaymentJvLineLink_CreatedAt DEFAULT SYSDATETIME(),
    CreatedBy   NVARCHAR(200) NULL,
    CONSTRAINT UQ_PaymentJvLineLink UNIQUE (PPaymentID, JVLineId)
  );
  CREATE INDEX IX_PaymentJvLineLink_JVLine ON dbo.PaymentJvLineLink (JVLineId);
  PRINT 'Created PaymentJvLineLink';
END
ELSE
  PRINT 'PaymentJvLineLink already exists - skipping';
GO
