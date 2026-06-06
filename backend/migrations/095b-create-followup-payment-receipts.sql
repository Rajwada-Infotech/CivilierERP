-- 095-create-followup-payment-receipts.sql
-- Creates FollowupPaymentReceipts table to track actual payments
-- against demanded milestones (BookingPaymentTerms rows).

IF OBJECT_ID('dbo.FollowupPaymentReceipts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupPaymentReceipts (
    Id               INT IDENTITY(1,1) PRIMARY KEY,
    BookingTermId    INT           NOT NULL
                       REFERENCES dbo.BookingPaymentTerms(Id),
    BookingID        INT           NOT NULL
                       REFERENCES dbo.FollowupBookings(Id),
    ReceiptNo        NVARCHAR(60)  NOT NULL,          -- REC-BKG000042-001
    AmountReceived   DECIMAL(18,2) NOT NULL,
    PaymentMode      NVARCHAR(30)  NOT NULL DEFAULT 'Cash',
                     -- Cash | Cheque | NEFT | RTGS | UPI | DD
    PaymentDate      DATE          NOT NULL,
    ReferenceNo      NVARCHAR(100) NULL,              -- cheque/UTR/UPI ref
    BankName         NVARCHAR(100) NULL,
    Notes            NVARCHAR(500) NULL,
    RecordedBy       NVARCHAR(200) NULL,
    CreatedAt        DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_FPR_BookingTermId ON dbo.FollowupPaymentReceipts (BookingTermId);
  CREATE INDEX IX_FPR_BookingID     ON dbo.FollowupPaymentReceipts (BookingID);
  CREATE INDEX IX_FPR_PaymentDate   ON dbo.FollowupPaymentReceipts (PaymentDate DESC);
  CREATE INDEX IX_FPR_CreatedAt     ON dbo.FollowupPaymentReceipts (CreatedAt DESC);

  PRINT 'FollowupPaymentReceipts created.';
END
ELSE
  PRINT 'FollowupPaymentReceipts already exists — skipped.';
GO

-- When a receipt is recorded, mark the milestone as Paid
-- (handled in application logic, but add the FK constraint here)

PRINT '095 complete.';
